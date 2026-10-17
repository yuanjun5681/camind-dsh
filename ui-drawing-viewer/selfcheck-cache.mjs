// M2-05 cache correctness: atomic writes, independent pack SHA, single-flight, LRU,
// corruption rebuild, symlink rejection and authorization on every cache hit.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDraftCache } from './lib/cache.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-cache-check-'))
const key = '1'.repeat(64)
const cache = createDraftCache({ home, maxEntries: 1, maxBytes: 1024 * 1024, check: () => [] })
let authorizations = 0
const resolve = async () => { authorizations++ }
await cache.put('s1', key, { name: 'first.dwg', packText: '{"ok":true}' })
const first = await cache.get('s1', key, { name: 'first.dwg', resolve, build: async () => { throw new Error('不应重建') } })
assert.equal(first.packText, '{"ok":true}')
const renamed = await cache.get('s1', key, { name: 'renamed.dwg', resolve, build: async () => { throw new Error('不应重建') } })
assert.equal(renamed.name, 'renamed.dwg')
assert.equal(authorizations, 2, '每次缓存命中都必须重新授权')
console.log('ok - cache hit integrity, display name and re-authorization')

const key2 = '2'.repeat(64)
let builds = 0
const build = async () => { builds++; await new Promise(resolve => setTimeout(resolve, 20)); return '{"second":true}' }
const [a, b] = await Promise.all([
  cache.get('s1', key2, { name: 'second.dwg', resolve, build }),
  cache.get('s1', key2, { name: 'second.dwg', resolve, build }),
])
assert.equal(a.packText, b.packText)
assert.equal(builds, 1, '同键并发只能转换一次')
await fs.writeFile(path.join(home, 'draft-previews/s1', `${key2}.json`), 'corrupt')
await cache.get('s1', key2, { name: 'second.dwg', resolve, build })
assert.equal(builds, 2, '损坏缓存必须重建')
console.log('ok - single-flight and corruption rebuild')

await cache.put('s1', key, { name: 'evicted.dwg', packText: '{"evicted":true}' })
await assert.rejects(fs.stat(path.join(home, 'draft-previews/s1', `${key2}.json`)), 'LRU must evict old pack')
console.log('ok - LRU eviction')

await fs.mkdir(path.join(home, 'draft-previews/s1'), { recursive: true })
await fs.writeFile(path.join(home, 'draft-previews/s1', `${key}.json`), 'x')
const outside = path.join(home, 'outside.json')
await fs.writeFile(outside, '{}')
await fs.rm(path.join(home, 'draft-previews/s1', `${key}.json`), { force: true })
await fs.symlink(outside, path.join(home, 'draft-previews/s1', `${key}.json`))
await assert.rejects(cache.get('s1', key, { name: 'escape.dwg', resolve, build }), /越界/)
console.log('ok - symlink escape rejected')

const rejecting = createDraftCache({ home: path.join(home, 'reject'), check: () => ['bad'] })
await assert.rejects(rejecting.put('s1', key, { name: 'bad.dwg', packText: '{}' }), /writer/)
await cache.deleteSession('s1')
await assert.rejects(fs.stat(path.join(home, 'draft-previews/s1')))
await fs.rm(home, { recursive: true, force: true })
console.log('ok - writer rejection and session cleanup')
