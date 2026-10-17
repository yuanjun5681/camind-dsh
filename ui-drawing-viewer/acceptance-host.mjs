// M2-08 real HTTP acceptance: actual converter/cache/queue/routes with curl positive and negative cases.
// Desktop dsh-app:// smoke remains a separate environment-dependent acceptance item.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { apply as applyConverter } from '../service-draft-converter/index.js'
import { createJobQueue } from './lib/jobs.js'
import { createDrawingPreviewService } from './lib/service.js'
import { createDrawingReferenceVerifier } from './lib/reference.js'
import { createDrawingRouteHandler, DRAWING_ROUTE_PREFIX } from './lib/routes.js'

const execFileAsync = promisify(execFile)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const HEADER = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n`
const TABLES = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nContinuous\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0\n41\n1.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n`
function makeDxf(count) {
  const lines = Array.from({ length: count }, (_, i) => `0\nLINE\n5\n${100 + i}\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n${i}.0\n20\n0.0\n30\n0.0\n11\n${i + 1}.0\n21\n0.0\n31\n0.0\n`).join('')
  return `${HEADER}${TABLES}0\nSECTION\n2\nENTITIES\n${lines}0\nENDSEC\n0\nEOF\n`
}

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-host-acceptance-'))
const workspace = path.join(home, 'workspace')
const dshHome = path.join(home, 'dsh')
await fs.mkdir(workspace, { recursive: true })
const files = new Map()
for (const [name, content] of [
  ['part.dxf', makeDxf(1)],
  ['retry.dxf', makeDxf(2)],
  ['large.dxf', makeDxf(12000)],
  ['missing-tool.dwg', Buffer.from('DWG')],
]) {
  const file = path.join(workspace, name)
  await fs.writeFile(file, content)
  files.set(name, file)
}

const converterServices = new Map()
applyConverter({ provide: (name, service) => converterServices.set(name, service) }, {
  dwg2dxfPath: path.join(home, 'missing-dwg2dxf'),
})
const rawConverter = converterServices.get('draftConverter')
const starts = new Map()
const converter = {
  ...rawConverter,
  async convertDxf(text, options) {
    const count = (starts.get(options.sourceName) ?? 0) + 1
    starts.set(options.sourceName, count)
    if (options.sourceName === 'retry.dxf' && count === 1) throw new Error('图纸转换超时')
    return rawConverter.convertDxf(text, options)
  },
  async convertDwg(file, options) {
    starts.set('missing-tool.dwg', (starts.get('missing-tool.dwg') ?? 0) + 1)
    return rawConverter.convertDwg(file, options)
  },
}
const resolve = async (sessionId, requested) => {
  if (sessionId !== 's1' || !files.has(requested)) {
    throw Object.assign(new Error('拒绝访问该图纸引用'), { name: 'FilePreviewForbiddenError' })
  }
  return { file: files.get(requested), displayPath: requested }
}
const queue = createJobQueue({ maxGlobal: 2, maxPerSession: 2, maxMemoryMb: 1024 })
const service = createDrawingPreviewService({ home: dshHome, resolve, draftConverter: converter, queue })
const referenceVerifier = createDrawingReferenceVerifier({ snapshotSource: service.snapshotSource, readPack: service.readPack })
const handler = createDrawingRouteHandler({
  service,
  referenceVerifier,
  connection: { requestRejection: ({ headers }) => headers['x-test-auth'] === 'allow' ? undefined : 401 },
})
const server = http.createServer((req, res) => {
  void handler(req, res).catch(error => {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: false, message: error.message }))
  })
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const base = `http://127.0.0.1:${server.address().port}${DRAWING_ROUTE_PREFIX}`

async function curl(method, url, { body, auth = true } = {}) {
  const args = ['--noproxy', '*', '-sS', '-i', '-X', method]
  if (auth) args.push('-H', 'x-test-auth: allow')
  if (body !== undefined) args.push('-H', 'content-type: application/json', '--data', JSON.stringify(body))
  args.push(url)
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 128 * 1024 * 1024 })
  const separator = stdout.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n'
  const split = stdout.indexOf(separator)
  const head = stdout.slice(0, split)
  const text = stdout.slice(split + separator.length)
  const status = Number(/^HTTP\/\S+\s+(\d+)/m.exec(head)?.[1])
  const headers = Object.fromEntries(head.split(/\r?\n/).slice(1).map(line => {
    const index = line.indexOf(':')
    return index < 0 ? [line.toLowerCase(), ''] : [line.slice(0, index).toLowerCase().trim(), line.slice(index + 1).trim()]
  }))
  return { status, headers, text, json: text ? JSON.parse(text) : null }
}
const start = (name, session = 's1') => curl('POST', `${base}/${session}/packs`, { body: { path: name } })
async function waitJob(jobId, session = 's1') {
  for (let i = 0; i < 500; i++) {
    const response = await curl('GET', `${base}/${session}/packs/${jobId}/status`)
    assert.equal(response.status, 200, response.text)
    if (['ready', 'error'].includes(response.json.state)) return response.json
    await sleep(10)
  }
  throw new Error(`作业未进入终态：${jobId}`)
}
async function waitReady(jobId) {
  const job = await waitJob(jobId)
  assert.equal(job.state, 'ready', JSON.stringify(job.error))
  return job
}
async function waitUntil(check, message) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return
    await sleep(5)
  }
  throw new Error(message)
}

let firstJobId, packKey, packDescriptor
try {
  const unauthorized = await curl('POST', `${base}/s1/packs`, { body: { path: 'part.dxf' }, auth: false })
  assert.equal(unauthorized.status, 401)
  assert.equal(starts.size, 0)
  console.log('ok - unauthenticated connection rejected before conversion')

  const [a, b] = await Promise.all([start('part.dxf'), start('part.dxf')])
  assert.equal(a.status, 202, a.text)
  assert.equal(b.status, 202, b.text)
  const [readyA, readyB] = await Promise.all([waitReady(a.json.jobId), waitReady(b.json.jobId)])
  assert.equal(readyA.result.key, readyB.result.key)
  assert.equal(starts.get('part.dxf'), 1, '并发冷启动只能转换一次')
  firstJobId = a.json.jobId
  packKey = readyA.result.key
  const repeated = await start('part.dxf')
  await waitReady(repeated.json.jobId)
  assert.equal(starts.get('part.dxf'), 1, '缓存命中不得重复转换')
  console.log('ok - concurrent single-flight and cache-first repeated preparation')

  const wrongSession = await curl('GET', `${base}/other/packs/${firstJobId}/status`)
  assert.equal(wrongSession.status, 404)
  const missingPath = await curl('GET', `${base}/s1/packs/${packKey}`)
  assert.equal(missingPath.status, 400)
  const forbidden = await curl('GET', `${base}/s1/packs/${packKey}?path=other.dxf`)
  assert.equal(forbidden.status, 403)
  const pack = await curl('GET', `${base}/s1/packs/${packKey}?path=part.dxf`)
  assert.equal(pack.status, 200, pack.text)
  assert.equal(pack.headers['cache-control'], 'no-store')
  packDescriptor = pack.json
  const expectedSha = createHash('sha256').update(Buffer.from(packDescriptor.packText, 'utf8')).digest('hex')
  assert.equal(pack.headers['x-pack-sha256'], expectedSha)
  assert.equal(packDescriptor.pack.sha256, expectedSha)
  console.log('ok - session boundary, re-authorization, no-store and pack SHA header')

  const exportDir = path.join(home, 'export')
  await fs.mkdir(exportDir)
  const exportFile = path.join(exportDir, 'part.pack.json')
  await fs.writeFile(exportFile, packDescriptor.packText)
  assert.equal(await fs.readFile(exportFile, 'utf8'), packDescriptor.packText)
  assert.equal(await fs.stat(path.join(workspace, 'draft-previews')).catch(() => null), null)
  console.log('ok - delivery export is explicit and derived cache stays outside workspace')

  const reference = {
    kind: 'camind-drawing-ref', version: 1, session: 's1',
    source: packDescriptor.source, pack: packDescriptor.pack, target: { type: 'entity', id: 0 },
  }
  const verified = await curl('POST', `${base}/s1/refs/verify`, { body: reference })
  assert.equal(verified.status, 200, verified.text)
  assert.deepEqual(verified.json.reference, reference)
  const badTarget = await curl('POST', `${base}/s1/refs/verify`, {
    body: { ...reference, target: { type: 'entity', id: 999 } },
  })
  assert.equal(badTarget.status, 400)
  const badSession = await curl('POST', `${base}/s1/refs/verify`, { body: { ...reference, session: 'other' } })
  assert.equal(badSession.status, 400)
  console.log('ok - DrawingReference verification positive and negative cases')

  const retryStart = await start('retry.dxf')
  const retryError = await waitJob(retryStart.json.jobId)
  assert.equal(retryError.state, 'error')
  assert.equal(retryError.error.code, 'timeout')
  assert.equal(retryError.retryable, true)
  const retried = await curl('POST', `${base}/s1/packs/${retryStart.json.jobId}/retry`)
  assert.equal(retried.status, 202, retried.text)
  await waitReady(retried.json.jobId)
  assert.equal(starts.get('retry.dxf'), 2)
  console.log('ok - classified timeout and retry flow')

  const missing = await start('missing-tool.dwg')
  const missingError = await waitJob(missing.json.jobId)
  assert.equal(missingError.state, 'error')
  assert.equal(missingError.error.code, 'tool_missing')
  assert.match(missingError.error.message, /dwg2dxf/)
  assert.equal(missingError.retryable, false)
  console.log('ok - missing external CLI has classified Chinese error')

  const large = await start('large.dxf')
  await waitUntil(() => starts.get('large.dxf') === 1, '大 DXF 未进入 worker 转换')
  const cancelled = await curl('POST', `${base}/s1/packs/${large.json.jobId}/cancel`)
  assert.equal(cancelled.status, 200, cancelled.text)
  const cancelledJob = await waitJob(large.json.jobId)
  assert.equal(cancelledJob.state, 'error')
  assert.equal(cancelledJob.error.code, 'cancelled')
  await sleep(50)
  assert.equal(process._getActiveHandles().some(handle => handle.constructor.name === 'Worker'), false)
  console.log('ok - real cancellation terminates conversion work')

  const cacheFile = path.join(dshHome, 'draft-previews', 's1', `${packKey}.json`)
  await fs.writeFile(cacheFile, 'corrupt')
  const corrupted = await curl('GET', `${base}/s1/packs/${packKey}?path=part.dxf`)
  assert.equal(corrupted.status, 409)
  const rebuilt = await start('part.dxf')
  await waitReady(rebuilt.json.jobId)
  assert.equal(starts.get('part.dxf'), 2)
  const repaired = await curl('GET', `${base}/s1/packs/${packKey}?path=part.dxf`)
  assert.equal(repaired.status, 200)
  console.log('ok - corrupted cache is rejected and rebuilt')

  await fs.writeFile(files.get('part.dxf'), makeDxf(2))
  const changed = await curl('GET', `${base}/s1/packs/${packKey}?path=part.dxf`)
  assert.equal(changed.status, 409)
  await fs.writeFile(files.get('part.dxf'), makeDxf(1))
  console.log('ok - stale source reference is rejected with source-change semantics')

  await service.deleteSession('s1')
  const expired = await curl('GET', `${base}/s1/packs/${firstJobId}/status`)
  assert.equal(expired.status, 404)
  assert.equal(await fs.stat(path.join(dshHome, 'draft-previews', 's1')).catch(() => null), null)
  console.log('ok - expired jobs are isolated and session cache is cleaned')
  console.log('M2 Host acceptance passed (desktop smoke tracked separately)')
} finally {
  await service.dispose()
  await new Promise(resolveClose => server.close(resolveClose))
  await fs.rm(home, { recursive: true, force: true })
}
