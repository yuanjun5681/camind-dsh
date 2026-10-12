// Offline regression checks: parser corruption, cache identity, NX guards, and authenticated routes.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { Package } from './lib/host-core.js'
import { validatePackage, createModelService, FILES } from './lib/models.js'
import { apply } from './index.js'
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
  await assert.rejects(service.target('../escape', 'test.prt'), /会话/)
  // Exercise the complete five-step export without a live NX or proprietary fixture.
  const { zipSync } = createRequire(new URL('../ui-shell/package.json', import.meta.url))('fflate')
  const entries = {}
  const sourceSha = t.sha
  for (const name of FILES) entries[name] = await fs.readFile(path.join(fixture, name))
  entries['manifest.json'] = Buffer.from(JSON.stringify({ ...raw, part_sha256: sourceSha }))
  const calls = []
  const success = createModelService({ home: path.join(tmp, 'success'), resolve: async () => ({ file: prt }), pipeline: {
    ensureReady: async () => ({ status: 'ok', data: { queue_pending: 0, queue_processing: 0 } }),
    uploadFile: async () => ({ status: 'ok', data: {} }),
    run: async endpoint => { calls.push(endpoint); return { status: 'ok', data: endpoint === '/ele_session_state' ? { modified_parts: [], modified_unreadable: 0 } : endpoint === '/cam_geompack_open' ? { stamped: { name: 'stamped.prt' } } : {} } },
    zipDir: async () => ({ status: 'ok', data: { bytes: Buffer.from(zipSync(entries)) } }),
  } })
  const good = await success.target('session', 'test.prt')
  await success.prepare(good)
  for (let i = 0; i < 100 && (await success.status(good)).state === 'running'; i++) await new Promise(r => setTimeout(r, 5))
  assert.equal((await success.status(good)).state, 'ready')
  assert.deepEqual(calls, ['/ele_session_state', '/cam_geompack_open', '/cam_geompack_facet', '/cam_geompack_facet', '/cam_geompack_edges', '/cam_geompack_manifest'])
  await success.prepare(good)
  assert.equal(calls.length, 6, 'Committed cache must not repeat NX export')
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
  apply({ previewFiles: { resolve: async () => ({ file: prt }) }, camPipeline: {}, provide() {}, get: () => ({ requestRejection: () => 401 }), webServer: { register: r => { handler = r.handler } } })
  let status
  await handler({ method: 'POST', headers: {}, url: '/camind/api/models/sessions/session/model?path=test.prt' }, { writeHead: code => { status = code }, end() {} })
  assert.equal(status, 401)
  apply({ previewFiles: {}, camPipeline: {}, provide() {}, get: () => undefined, webServer: { register: r => { handler = r.handler } } })
  await handler({ method: 'GET', headers: {}, url: '/camind/api/models/sessions/session/files' }, { writeHead: code => { status = code }, end() {} })
  assert.equal(status, 404, 'Removed standalone model list route must not remain exposed')
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
