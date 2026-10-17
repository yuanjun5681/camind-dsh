// M2-06 authenticated job/pack routes: connection gate, session isolation, cancellation,
// cache-first conversion, single-flight, disposal, no-store descriptors and SHA headers.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createDrawingPreviewService } from './lib/service.js'
import { createJobQueue } from './lib/jobs.js'
import { createDrawingRouteHandler, DRAWING_ROUTE_PREFIX } from './lib/routes.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-routes-check-'))
const sourceFile = path.join(home, 'part.dxf')
const cancelFile = path.join(home, 'cancel.dxf')
await fs.writeFile(sourceFile, '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')
await fs.writeFile(cancelFile, '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n999\ncancel\n0\nEOF\n')
const sourceSha = createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex')
const fingerprint = 'a'.repeat(64)
const identityFor = (source, channel) => {
  const fields = [source, 'dr-1', channel, fingerprint, 'sem-rules-0', 'view-rules-0']
  return { fields, identity: createHash('sha256').update(JSON.stringify(fields)).digest('hex') }
}
let conversions = 0
const converter = {
  async convertDxf(_text, options) {
    conversions++
    if (options.sourceName === 'cancel.dxf') {
      await new Promise((_, reject) => {
        const abort = () => reject(new Error('图纸转换已取消'))
        if (options.signal.aborted) return abort()
        options.signal.addEventListener('abort', abort, { once: true })
      })
    }
    await new Promise(resolve => setTimeout(resolve, 10))
    const source = createHash('sha256').update(options.sourceBytes).digest('hex')
    return {
      format: 'camind-draft-pack', format_version: 1, pipeline_version: 'dr-1',
      source_file: options.sourceName, source_sha256: source,
      origin: { channel: 'autocad' }, conversion: { tool: 'stub', commit: 'test', libredwg: 'n/a', ezdxf: 'n/a' },
      rules_version: 'sem-rules-0', view_rule_version: 'view-rules-0',
      entities: [{ id: 0, type: 'line' }], dims: [{ id: 'dim-1' }], missing: {},
      self_check: { dropped: { by_type: {} } },
    }
  },
  async convertDwg() { throw new Error('本自检不使用 DWG') },
  check: () => [],
  identity: pack => identityFor(pack.source_sha256, pack.origin.channel),
  identities: source => ['autocad', 'nx', 'unknown'].map(channel => identityFor(source, channel)),
}
const resolve = async (sessionId, requested) => {
  const file = requested === 'part.dxf' ? sourceFile : requested === 'cancel.dxf' ? cancelFile : null
  if (sessionId !== 's1' || !file) throw Object.assign(new Error('拒绝访问'), { name: 'FilePreviewForbiddenError' })
  return { file, displayPath: requested }
}
const service = createDrawingPreviewService({ home, resolve, draftConverter: converter })
let rejection
const handler = createDrawingRouteHandler({ service, connection: { requestRejection: () => rejection } })

function response() {
  return {
    status: null, headers: null, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(chunk = '') { this.body += chunk; this.done = true },
  }
}
async function request(method, url, { body, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }
  const res = response()
  await handler(req, res)
  return { ...res, json: res.body ? JSON.parse(res.body) : null }
}
async function waitUntil(check, message = '条件未满足') {
  for (let i = 0; i < 150; i++) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(message)
}
const waitReady = (target, jobId) => waitUntil(() => {
  const status = target.status('s1', jobId)
  if (status?.state === 'error') throw new Error(status.error.message)
  return status?.state === 'ready' ? status : null
}, '作业未就绪')

rejection = 401
const unauthorized = await request('POST', `${DRAWING_ROUTE_PREFIX}/s1/packs`, { body: { path: 'part.dxf' } })
assert.equal(unauthorized.status, 401)
assert.equal(unauthorized.headers['cache-control'], 'no-store')
rejection = undefined
console.log('ok - connection rejection precedes all drawing operations')

const started = await request('POST', `${DRAWING_ROUTE_PREFIX}/s1/packs`, { body: { path: 'part.dxf' } })
assert.equal(started.status, 202, started.body)
assert.ok(started.json.jobId)
const ready = await waitReady(service, started.json.jobId)
assert.equal(ready.result.descriptor.source.sha256, sourceSha)
const key = ready.result.key
const status = await request('GET', `${DRAWING_ROUTE_PREFIX}/s1/packs/${started.json.jobId}/status`)
assert.equal(status.status, 200)
assert.equal(status.json.result.descriptor.pack.identity, key)
const wrongSession = await request('GET', `${DRAWING_ROUTE_PREFIX}/other/packs/${started.json.jobId}/status`)
assert.equal(wrongSession.status, 404)
assert.equal(conversions, 1)
console.log('ok - start/status flow and session-isolated jobs')

const repeated = service.prepare('s1', 'part.dxf')
await waitReady(service, repeated.jobId)
assert.equal(conversions, 1, '已有六项身份缓存时不得重复转换')
console.log('ok - repeated preparation reuses cache before conversion')

const flightService = createDrawingPreviewService({
  home: path.join(home, 'flights'), resolve, draftConverter: converter,
  queue: createJobQueue({ maxGlobal: 2, maxPerSession: 2, maxMemoryMb: 1024 }),
})
const flightA = flightService.prepare('s1', 'part.dxf')
const flightB = flightService.prepare('s1', 'part.dxf')
const [flightReadyA, flightReadyB] = await Promise.all([waitReady(flightService, flightA.jobId), waitReady(flightService, flightB.jobId)])
assert.equal(flightReadyA.result.key, flightReadyB.result.key)
assert.equal(conversions, 2, '同身份冷缺失只能执行一次转换')
await flightService.dispose()
console.log('ok - cold cache misses share one conversion flight')

const missingPath = await request('GET', `${DRAWING_ROUTE_PREFIX}/s1/packs/${key}`)
assert.equal(missingPath.status, 400)
const forbidden = await request('GET', `${DRAWING_ROUTE_PREFIX}/s1/packs/${key}?path=other.dxf`)
assert.equal(forbidden.status, 403)
const pack = await request('GET', `${DRAWING_ROUTE_PREFIX}/s1/packs/${key}?path=part.dxf`)
assert.equal(pack.status, 200)
assert.equal(pack.headers['x-pack-sha256'], createHash('sha256').update(pack.json.packText).digest('hex'))
assert.equal(pack.headers['cache-control'], 'no-store')
assert.equal(pack.json.source.sha256, sourceSha)
assert.equal(pack.json.pack.identity, key)
assert.equal(pack.json.packText.includes(sourceFile), false, 'descriptor 不得泄露 Host 临时路径')
console.log('ok - authorized pack read, no-store and independent SHA header')

const oldJob = service.prepare('s1', 'cancel.dxf')
await waitUntil(() => conversions === 3, '取消用例未进入转换')
const cancelled = await request('POST', `${DRAWING_ROUTE_PREFIX}/s1/packs/${oldJob.jobId}/cancel`)
assert.equal(cancelled.status, 200)
assert.equal(cancelled.json.error.code, 'cancelled')
await waitUntil(() => service.status('s1', oldJob.jobId)?.state === 'error')
const otherCancel = await request('POST', `${DRAWING_ROUTE_PREFIX}/other/packs/${oldJob.jobId}/cancel`)
assert.equal(otherCancel.status, 404)
console.log('ok - cancellation aborts conversion and remains session scoped')

const disposing = service.prepare('s1', 'cancel.dxf')
await waitUntil(() => conversions === 4, '释放用例未进入转换')
await service.dispose()
assert.equal(service.status('s1', disposing.jobId), null)
assert.throws(() => service.prepare('s1', 'part.dxf'), /已释放/)
await fs.rm(home, { recursive: true, force: true })
console.log('ok - dispose aborts owned work and drawing route selfcheck complete')
