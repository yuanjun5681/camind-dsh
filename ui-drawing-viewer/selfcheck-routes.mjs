// M2-06 authenticated job/pack routes: connection gate, session isolation, cancellation,
// no-store descriptors and SHA headers are exercised with the real service, cache and queue.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createDrawingPreviewService } from './lib/service.js'
import { createDrawingRouteHandler, DRAWING_ROUTE_PREFIX } from './lib/routes.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-routes-check-'))
const sourceFile = path.join(home, 'part.dxf')
await fs.writeFile(sourceFile, '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')
const sourceSha = createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex')
const fingerprint = 'a'.repeat(64)
const converter = {
  async convertDxf(_text, options) {
    return {
      format: 'camind-draft-pack', format_version: 1, pipeline_version: 'dr-1',
      source_file: options.sourceName, source_sha256: createHash('sha256').update(options.sourceBytes).digest('hex'),
      origin: { channel: 'autocad' }, conversion: { tool: 'stub', commit: 'test', libredwg: 'n/a', ezdxf: 'n/a' },
      rules_version: 'sem-rules-0', view_rule_version: 'view-rules-0',
      entities: [{ id: 0, type: 'line' }], dims: [{ id: 'dim-1' }], missing: {},
      self_check: { dropped: { by_type: {} } },
    }
  },
  async convertDwg() { throw new Error('本自检不使用 DWG') },
  check: () => [],
  identity(pack) {
    const fields = [pack.source_sha256, pack.pipeline_version, pack.origin.channel, fingerprint, pack.rules_version, pack.view_rule_version]
    return { fields, identity: createHash('sha256').update(JSON.stringify(fields)).digest('hex') }
  },
}
const resolve = async (sessionId, requested) => {
  if (sessionId !== 's1' || requested !== 'part.dxf') {
    throw Object.assign(new Error('拒绝访问'), { name: 'FilePreviewForbiddenError' })
  }
  return { file: sourceFile, displayPath: 'part.dxf' }
}
const service = createDrawingPreviewService({ home, resolve, draftConverter: converter })
let rejection
const handler = createDrawingRouteHandler({
  service,
  connection: { requestRejection: () => rejection },
})

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
async function waitReady(jobId) {
  for (let i = 0; i < 100; i++) {
    const status = service.status('s1', jobId)
    if (status.state === 'ready') return status
    if (status.state === 'error') throw new Error(status.error.message)
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('作业未就绪')
}

rejection = 401
const unauthorized = await request('POST', `${DRAWING_ROUTE_PREFIX}/s1/packs`, { body: { path: 'part.dxf' } })
assert.equal(unauthorized.status, 401)
assert.equal(unauthorized.headers['cache-control'], 'no-store')
rejection = undefined
console.log('ok - connection rejection precedes all drawing operations')

const started = await request('POST', `${DRAWING_ROUTE_PREFIX}/s1/packs`, { body: { path: 'part.dxf' } })
assert.equal(started.status, 202, started.body)
assert.ok(started.json.jobId)
const ready = await waitReady(started.json.jobId)
assert.equal(ready.result.descriptor.source.sha256, sourceSha)
const key = ready.result.key
const status = await request('GET', `${DRAWING_ROUTE_PREFIX}/s1/packs/${started.json.jobId}/status`)
assert.equal(status.status, 200)
assert.equal(status.json.result.descriptor.pack.identity, key)
const wrongSession = await request('GET', `${DRAWING_ROUTE_PREFIX}/other/packs/${started.json.jobId}/status`)
assert.equal(wrongSession.status, 404)
console.log('ok - start/status flow and session-isolated jobs')

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

const oldJob = service.prepare('s1', 'part.dxf')
const cancelled = await request('POST', `${DRAWING_ROUTE_PREFIX}/s1/packs/${oldJob.jobId}/cancel`)
assert.equal(cancelled.status, 200)
assert.equal(cancelled.json.error.code, 'cancelled')
const otherCancel = await request('POST', `${DRAWING_ROUTE_PREFIX}/other/packs/${oldJob.jobId}/cancel`)
assert.equal(otherCancel.status, 404)
console.log('ok - cancellation remains session scoped')

await service.deleteSession('s1')
await fs.rm(home, { recursive: true, force: true })
console.log('ok - drawing route selfcheck complete')
