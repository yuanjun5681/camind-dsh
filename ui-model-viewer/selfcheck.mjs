// Offline regression checks: parser corruption, cache identity, NX guards, and authenticated routes.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { Package, parseFaces } from './lib/host-core.js'
import { validatePackage, createModelService, FILES } from './lib/models.js'
import { apply } from './index.js'
import { validateSelectionMessages } from './lib/selection.js'
import { apply as applyPreview } from '../ui-preview/index.js'
import './selfcheck-controls.mjs'
import './selfcheck-joint.mjs'
const fixture = fileURLToPath(new URL('./fixtures/box/', import.meta.url))
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-model-check-'))
try {
  const raw = JSON.parse(await fs.readFile(path.join(fixture, 'manifest.json')))
  const valid = await validatePackage(fixture, raw.part_sha256)
  assert.equal(valid.faces.length, 6)
  assert.equal(valid.triangles > 0, true)
  const faceWithBody = body => JSON.stringify([{ fid: 'F000001', ...(body !== undefined ? { body } : {}), area_mm2: 1 }])
  assert.equal(parseFaces(faceWithBody(0), 1)[0].body, 0)
  assert.equal(parseFaces(faceWithBody(2), 1)[0].body, 2)
  for (const body of [undefined, -1, 0.5]) assert.throws(() => parseFaces(faceWithBody(body), 1), /body/)
  await assert.rejects(validatePackage(fixture, '0'.repeat(64)), /版本不符/)
  const corrupt = path.join(tmp, 'corrupt')
  await fs.cp(fixture, corrupt, { recursive: true })
  await fs.writeFile(path.join(corrupt, 'mesh_fine.bin'), 'bad')
  assert.throws(() => Package.open(corrupt).loadMesh(1), /字节|sha256/)
  await fs.copyFile(path.join(fixture, 'mesh_fine.bin'), path.join(corrupt, 'mesh_fine.bin'))
  await fs.rm(path.join(corrupt, 'edges.bin'))
  await fs.symlink(path.join(fixture, 'edges.bin'), path.join(corrupt, 'edges.bin'))
  await assert.rejects(validatePackage(corrupt, raw.part_sha256), /越界/)
  const prt = path.join(tmp, 'test.prt')
  await fs.writeFile(prt, 'offline fixture')
  let uploads = 0
  const service = createModelService({ home: tmp, resolve: async () => ({ file: prt }), pipeline: {
    ensureReady: async () => ({ status: 'ok', data: { queue_pending: 0, queue_processing: 0 } }),
    run: async () => ({ status: 'ok', data: { modified_parts: ['unsaved.prt'], modified_unreadable: 0 } }),
    uploadFile: async () => { uploads++; throw new Error('should not upload') },
  } })
  const t = await service.target('session', 'test.prt')
  assert.equal(t.sha, createHash('sha256').update('offline fixture').digest('hex'))
  assert.equal((await service.status(t)).state, 'missing')
  assert.equal((await service.prepare(t)).state, 'running')
  for (let i = 0; i < 100 && (await service.status(t)).state === 'running'; i++) await new Promise(r => setTimeout(r, 5))
  assert.match((await service.status(t)).message, /未保存/)
  assert.equal(uploads, 0)
  assert.equal((await service.status(t)).retryable, true, 'Preflight failure must be retryable')
  assert.equal((await service.prepare(t)).state, 'running', 'Retryable preflight failure re-runs on prepare')
  for (let i = 0; i < 100 && (await service.status(t)).state === 'running'; i++) await new Promise(r => setTimeout(r, 5))
  assert.match((await service.status(t)).message, /未保存/)
  assert.equal(uploads, 0)
  await assert.rejects(service.target('../escape', 'test.prt'), /会话/)
  // Exercise the complete five-step export without a live NX or proprietary fixture.
  const { zipSync } = createRequire(new URL('../ui-shell/package.json', import.meta.url))('fflate')
  const entries = {}
  const sourceSha = t.sha
  for (const name of FILES) entries[name] = await fs.readFile(path.join(fixture, name))
  entries['manifest.json'] = Buffer.from(JSON.stringify({ ...raw, part_sha256: sourceSha }))
  const calls = []
  let closeConfirmed = true
  const pipeline = {
    ensureReady: async () => ({ status: 'ok', data: { queue_pending: 0, queue_processing: 0 } }),
    uploadFile: async () => ({ status: 'ok', data: {} }),
    run: async (endpoint, args) => {
      calls.push(endpoint)
      if (endpoint === '/cam_close_part') assert.match(args.prt, /^work\/preview_[a-f0-9]{32}_geom\/stamped\.prt$/, 'Close only the newly created clone')
      return { status: 'ok', data: endpoint === '/ele_session_state' ? { modified_parts: [], modified_unreadable: 0 } : endpoint === '/cam_geompack_open' ? { stamped: { name: 'stamped.prt' } } : endpoint === '/cam_close_part' ? { closed: closeConfirmed } : {} }
    },
    zipDir: async () => ({ status: 'ok', data: { bytes: Buffer.from(zipSync(entries)) } }),
  }
  const success = createModelService({ home: path.join(tmp, 'success'), resolve: async () => ({ file: prt }), pipeline })
  const good = await success.target('session', 'test.prt')
  await success.prepare(good)
  for (let i = 0; i < 100 && (await success.status(good)).state === 'running'; i++) await new Promise(r => setTimeout(r, 5))
  assert.equal((await success.status(good)).state, 'ready')
  assert.deepEqual(calls, ['/ele_session_state', '/cam_geompack_open', '/cam_geompack_facet', '/cam_geompack_facet', '/cam_geompack_edges', '/cam_geompack_manifest', '/cam_close_part'])
  await success.prepare(good)
  assert.equal(calls.length, 7, 'Committed cache must not repeat NX export')
  const ready = await success.status(good)
  const selection = await success.selection('session', 'test.prt', sourceSha, ready.geometry_sha256, ['F000001', 'F000001'])
  assert.deepEqual(selection.fids, ['F000001'])
  assert.equal(selection.faces[0].area_mm2 > 0, true)
  await assert.rejects(success.selection('session', 'test.prt', sourceSha, '0'.repeat(64), ['F000001']), /几何包已变更/)
  await assert.rejects(success.selection('session', 'test.prt', sourceSha, ready.geometry_sha256, ['F999999']), /不存在/)
  await assert.rejects(success.selection('session', 'test.prt', sourceSha, ready.geometry_sha256, []), /1 至 100/)
  await assert.rejects(success.selection('session', 'test.prt', sourceSha, ready.geometry_sha256, Array(101).fill('F000001')), /1 至 100/)
  const reference = { ...selection, session_id: 'session' }
  const message = ref => ({ source: { kind: 'user' }, content: [{ type: 'text', text: `[CAM_SELECTION]\n${JSON.stringify(ref)}\n[/CAM_SELECTION]` }] })
  await validateSelectionMessages([message(reference)], 'session', success)
  await assert.rejects(validateSelectionMessages([message(reference)], 'other', success), /不属于当前会话/)
  await assert.rejects(validateSelectionMessages([message(null)], 'session', success), /不属于当前会话/)
  await assert.rejects(validateSelectionMessages([{ source: { kind: 'user' }, content: [{ type: 'text', text: '[CAM_SELECTION] broken' }] }], 'session', success), /不完整/)
  await fs.writeFile(prt, 'changed source')
  await assert.rejects(success.selection('session', 'test.prt', sourceSha, ready.geometry_sha256, ['F000001']), /源模型已变更/)
  await assert.rejects(validateSelectionMessages([message(reference)], 'session', success), /源模型已变更/)
  await validateSelectionMessages([message(reference), { source: { kind: 'user' }, content: [{ type: 'text', text: '开启新版本分析' }] }], 'session', success)
  await fs.writeFile(prt, 'offline fixture')
  assert.equal(calls.length, 7, 'Selection must not call NX')
  closeConfirmed = false
  const failedClose = createModelService({ home: path.join(tmp, 'failed-close'), resolve: async () => ({ file: prt }), pipeline })
  const failedTarget = await failedClose.target('session', 'test.prt')
  await failedClose.prepare(failedTarget)
  for (let i = 0; i < 100 && (await failedClose.status(failedTarget)).state === 'running'; i++) await new Promise(r => setTimeout(r, 5))
  assert.match((await failedClose.status(failedTarget)).message, /副本关闭未确认/)
  await assert.rejects(fs.stat(failedTarget.dir), { code: 'ENOENT' })
  assert.equal((await failedClose.status(failedTarget)).retryable, false, 'Mid-export failure stays fail-closed')
  const callsBeforeRetry = calls.length
  await failedClose.prepare(failedTarget)
  assert.equal(calls.length, callsBeforeRetry, 'Sticky error must not re-run NX export')
  assert.equal((await failedClose.status(failedTarget)).state, 'error')
  // The renderer shares the existing preview path boundary, including official attachments.
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmp
  const workspace = path.join(tmp, 'workspace')
  await fs.mkdir(workspace)
  let previewFiles
  const live = { header: { cwd: workspace } }
  applyPreview({ agents: { get: id => id === 'session' ? { session: live } : undefined }, sessions: { get() {} },
    get: name => name === 'uploads' ? { resolveFile(exec, batch, requested) {
      assert.equal(exec.agent.id, 'session'); assert.equal(exec.agent.session, live)
      assert.equal(batch, 'attachments'); assert.equal(requested, 'attachments/test.prt')
      return { file: { absolute: prt } }
    } } : undefined,
    provide: (name, service) => { if (name === 'previewFiles') previewFiles = service }, webServer: { register() {} },
  })
  assert.equal((await previewFiles.resolve('session', 'upload://attachments/attachments/test.prt')).file, prt)
  await assert.rejects(previewFiles.resolve('other-session', 'upload://attachments/attachments/test.prt'), { name: 'FilePreviewNotFoundError' })
  await assert.rejects(previewFiles.resolve('session', '../test.prt'), /超出会话/)
  const batch = path.join(tmp, 'uploads/session/upload-test/files')
  await fs.mkdir(batch, { recursive: true }); await fs.symlink(prt, path.join(batch, 'escape.prt'))
  await assert.rejects(previewFiles.resolve('session', 'upload://upload-test/files/escape.prt'), /超出批次/)
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  let handler
  apply({ tools: { register() {} }, on() {}, previewFiles: { resolve: async () => ({ file: prt }) }, camPipeline: {}, provide() {}, get: () => ({ requestRejection: () => 401 }), webServer: { register: r => { handler = r.handler } } })
  let status
  await handler({ method: 'POST', headers: {}, url: '/camind/api/models/sessions/session/model?path=test.prt' }, { writeHead: code => { status = code }, end() {} })
  assert.equal(status, 401)
  apply({ tools: { register() {} }, on() {}, previewFiles: {}, camPipeline: {}, provide() {}, get: () => undefined, webServer: { register: r => { handler = r.handler } } })
  await handler({ method: 'GET', headers: {}, url: '/camind/api/models/sessions/session/files' }, { writeHead: code => { status = code }, end() {} })
  assert.equal(status, 404, 'Removed standalone model list route must not remain exposed')
  process.env.DSH_HOME = path.join(tmp, 'success')
  let selectionTool, preStep
  apply({ tools: { register: tool => { selectionTool = tool } }, on: (name, fn) => { assert.equal(name, 'agent/pre-step'); preStep = fn },
    previewFiles: { resolve: async session => { if (session !== 'session') throw new Error('会话未授权'); return { file: prt } } }, camPipeline: {}, provide() {}, get: () => undefined,
    webServer: { register: route => { handler = route.handler } } })
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  assert.equal(selectionTool.name, 'read_model_selection')
  const toolArgs = { path: 'test.prt', source_sha256: sourceSha, geometry_sha256: ready.geometry_sha256, fids: ['F000001'] }
  assert.equal(JSON.parse(await selectionTool.execute(toolArgs, { agent: { id: 'session' } })).status, 'ok')
  assert.equal(JSON.parse(await selectionTool.execute(toolArgs, { agent: { id: 'other' } })).status, 'error')
  assert.equal(JSON.parse(await selectionTool.execute(toolArgs, {})).status, 'error')
  let forwarded = 0
  const payload = { agent: { id: 'session' }, messages: [message(reference)], signal: new AbortController().signal }
  assert.equal((await preStep(payload, async () => { forwarded++; return { kind: 'enter', messages: payload.messages } })).kind, 'enter')
  await assert.rejects(preStep({ ...payload, agent: { id: 'other' } }, async () => { forwarded++ }), /不属于当前会话/)
  assert.equal(forwarded, 1)
  const query = new URLSearchParams({ path: 'test.prt', sha: sourceSha, geometry: ready.geometry_sha256, fids: 'F000001' })
  let body
  await handler({ method: 'GET', headers: {}, url: `/camind/api/models/sessions/session/selection?${query}` }, { writeHead: code => { status = code }, end: value => { body = JSON.parse(value) } })
  assert.equal(status, 200); assert.deepEqual(body.fids, ['F000001'])
  await handler({ method: 'POST', headers: {}, url: `/camind/api/models/sessions/session/selection?${query}` }, { writeHead: code => { status = code }, end() {} })
  assert.equal(status, 405)
  let client
  runInNewContext(await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { client = entry.factory(name => {
      if (name === 'react') return { createElement() {} }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button() {} }
      throw new Error(`Unexpected browser dependency: ${name}`)
    }) } } },
  })
  const seats = []
  client.apply({ effect() {}, slots: { inject: (name, register) => { seats.push(name); register() }, register() {} } })
  assert.deepEqual(seats, ['cam.model.preview', 'cam.nc.preview'], 'Unified renderer must extend both existing preview seats, not add another tab')
  console.log(`model-viewer selfcheck passed: ${FILES.length} package files, corruption/version/symlink checks, dirty NX guard, auth`)
} finally { await fs.rm(tmp, { recursive: true, force: true }) }
