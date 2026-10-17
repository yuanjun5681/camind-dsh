// M2-05 cache correctness: atomic writes, independent pack SHA, single-flight, LRU,
// corruption rebuild, symlink rejection and authorization on every cache hit.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDraftCache } from './lib/cache.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-cache-check-'))
const key = '1'.repeat(64)
const key2 = '2'.repeat(64)
const key3 = '3'.repeat(64)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const allow = async () => {}
const noBuild = async () => { throw new Error('不应重建') }
const cache = createDraftCache({ home, maxEntries: 3, maxBytes: 1024 * 1024, check: () => [] })
let authorizations = 0
const resolve = async () => { authorizations++ }
await cache.put('s1', key, { name: 'first.dwg', packText: '{"ok":true}' })
const first = await cache.get('s1', key, { name: 'first.dwg', resolve, build: noBuild })
assert.equal(first.packText, '{"ok":true}')
const renamed = await cache.get('s1', key, { name: 'renamed.dwg', resolve, build: noBuild })
assert.equal(renamed.name, 'renamed.dwg')
assert.equal(authorizations, 2, '每次缓存命中都必须重新授权')
console.log('ok - cache hit integrity, display name and re-authorization')

let builds = 0, releaseBuild
const buildGate = new Promise(resolve => { releaseBuild = resolve })
const build = async () => {
  builds++
  if (builds === 1) await buildGate
  return '{"second":true}'
}
let firstAuthorized = 0, secondAuthorized = 0
const aPromise = cache.get('s1', key2, {
  name: 'second.dwg', sourceUri: 'upload://batch/second.dwg',
  resolve: async (_session, uri) => { assert.equal(uri, 'upload://batch/second.dwg'); firstAuthorized++ }, build,
})
const bPromise = cache.get('s1', key2, {
  name: 'alias.dwg', resolve: async () => { secondAuthorized++ }, build,
})
const denied = cache.get('s1', key2, {
  name: 'denied.dwg', resolve: async () => { throw new Error('denied') }, build,
})
await assert.rejects(denied, /denied/, '单飞调用方必须独立授权')
releaseBuild()
const [a, b] = await Promise.all([aPromise, bPromise])
assert.equal(a.packText, b.packText)
assert.equal(a.name, 'second.dwg')
assert.equal(b.name, 'alias.dwg')
assert.equal(firstAuthorized, 1)
assert.equal(secondAuthorized, 1)
assert.equal(builds, 1, '同键并发只能转换一次')
await fs.writeFile(path.join(home, 'draft-previews/s1', `${key2}.json`), 'corrupt')
await cache.get('s1', key2, { name: 'second.dwg', resolve, build })
assert.equal(builds, 2, '损坏缓存必须重建')
await fs.writeFile(path.join(home, 'draft-previews/s1', `${key2}.sidecar.json`), '{')
await cache.get('s1', key2, { name: 'second.dwg', resolve, build })
assert.equal(builds, 3, '损坏 sidecar 必须重建')
console.log('ok - single-flight authorization and corruption rebuild')

const concurrent = createDraftCache({ home: path.join(home, 'concurrent'), maxBytes: 1024 * 1024, check: () => [] })
await Promise.all([
  concurrent.put('s1', key, { name: 'a.dxf', packText: '{"source_file":"a.dxf"}' }),
  concurrent.put('s1', key, { name: 'b.dxf', packText: '{"source_file":"b.dxf"}' }),
])
const published = await concurrent.get('s1', key, { name: 'current.dxf', resolve: allow, build: noBuild })
const publishedSha = createHash('sha256').update(Buffer.from(published.packText, 'utf8')).digest('hex')
assert.equal(published.sidecar.packSha256, publishedSha, '同键并发发布不得错配 pack 与 sidecar')
assert.equal(published.sidecar.bytes, Buffer.byteLength(published.packText, 'utf8'))
console.log('ok - same-key concurrent publications stay consistent')

const lruHome = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-cache-lru-'))
const lru = createDraftCache({ home: lruHome, maxEntries: 2, maxBytes: 1024 * 1024, check: () => [] })
await lru.put('s1', key, { name: 'a.dwg', packText: '{"a":true}' })
await sleep(10)
await lru.put('s1', key2, { name: 'b.dwg', packText: '{"b":true}' })
await sleep(10)
await lru.get('s1', key, { name: 'a.dwg', resolve: allow, build: noBuild })
await sleep(10)
await lru.put('s1', key3, { name: 'c.dwg', packText: '{"c":true}' })
await fs.stat(path.join(lruHome, 'draft-previews/s1', `${key}.json`))
await assert.rejects(fs.stat(path.join(lruHome, 'draft-previews/s1', `${key2}.json`)), 'LRU must evict least recently used pack')
console.log('ok - LRU eviction uses cache hits as recency')

await fs.mkdir(path.join(home, 'draft-previews/s1'), { recursive: true })
const outside = path.join(home, 'outside.json')
await fs.writeFile(outside, '{}')
await fs.rm(path.join(home, 'draft-previews/s1', `${key}.json`), { force: true })
await fs.symlink(outside, path.join(home, 'draft-previews/s1', `${key}.json`))
await assert.rejects(cache.get('s1', key, { name: 'escape.dwg', resolve: allow, build }), /越界/)
const outsideDir = path.join(home, 'outside-dir')
await fs.mkdir(outsideDir)
await fs.symlink(outsideDir, path.join(home, 'draft-previews/evil'))
await assert.rejects(cache.put('evil', key3, { name: 'evil.dwg', packText: '{}' }), /越界/)
assert.deepEqual(await fs.readdir(outsideDir), [], '写入前必须拒绝会话目录 symlink 逃逸')
console.log('ok - pack and session symlink escapes rejected')

await fs.writeFile(path.join(home, 'draft-previews/s1', `${key3}.json.tmp`), 'interrupted')
await cache.put('s1', key3, { name: 'recovered.dwg', packText: '{"recovered":true}' })
assert.equal((await cache.get('s1', key3, { name: 'recovered.dwg', resolve: allow, build: noBuild })).packText, '{"recovered":true}')
console.log('ok - interrupted temporary files do not block writes')

const smallHome = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-cache-small-'))
const small = createDraftCache({ home: smallHome, maxEntries: 2, maxBytes: 32, check: () => [] })
await small.put('s1', key, { name: 'small.dwg', packText: '{"ok":true}' })
await assert.rejects(small.put('s1', key2, { name: 'large.dwg', packText: `{"large":"${'x'.repeat(64)}` + '"}' }), /容量上限/)
assert.equal((await small.get('s1', key, { name: 'small.dwg', resolve: allow, build: noBuild })).packText, '{"ok":true}')
console.log('ok - oversized packs reject before cache eviction')

const deleting = createDraftCache({ home: path.join(home, 'deleting'), maxBytes: 1024 * 1024, check: () => [] })
let releaseDeletedBuild, deletedBuildStarted
const deletedStarted = new Promise(resolve => { deletedBuildStarted = resolve })
const deletedGate = new Promise(resolve => { releaseDeletedBuild = resolve })
const pendingGet = deleting.get('gone', key, {
  name: 'gone.dwg', resolve: allow,
  build: async () => { deletedBuildStarted(); await deletedGate; return '{"gone":true}' },
})
const pendingRejection = assert.rejects(pendingGet, /已清理/)
await deletedStarted
const deletion = deleting.deleteSession('gone')
releaseDeletedBuild()
await pendingRejection
await deletion
await assert.rejects(fs.stat(path.join(home, 'deleting/draft-previews/gone')))
console.log('ok - session deletion invalidates pending builds')

const rejecting = createDraftCache({ home: path.join(home, 'reject'), check: () => ['bad'] })
await assert.rejects(rejecting.put('s1', key, { name: 'bad.dwg', packText: '{}' }), /writer/)
await cache.deleteSession('s1')
await assert.rejects(fs.stat(path.join(home, 'draft-previews/s1')))
await Promise.all([home, lruHome, smallHome].map(dir => fs.rm(dir, { recursive: true, force: true })))
console.log('ok - writer rejection and session cleanup')
