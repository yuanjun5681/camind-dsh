// Integration selfcheck: real task/filesystem/tool registration, synthetic NX responses; no production evidence.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createCamTasks, digest } from './lib/tasks.js'
import { registerCamPlan } from './lib/tools/plan.js'
import { registerCamRun } from './lib/tools/run.js'
import { executeCamDeliver } from './lib/tools/deliver.js'
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-execution-')), previous = process.env.DSH_HOME
process.env.DSH_HOME = home
try {
  const files = {}; for (const role of ['prt', 'dwg']) { files[role] = path.join(home, `source.${role}`); await fs.writeFile(files[role], `synthetic ${role}`) }
  const machine = { machine_id: 'm1', version: 1, spindle: { rpm_min: 50, rpm_max: 12000 }, kinematics: { max_cut_feed_mm_min: 10000 }, magazine: { pockets: [{ control_tool_id: 'T3', tool: { tool_assembly_id: 'D10' } }] } }
  const registry = { get: () => machine, snapshot: () => structuredClone(machine) }
  const tasks = createCamTasks({ home, resolve: async (_sid, ref) => ({ file: files[ref] }), machineRegistry: registry,
    geometry: async () => ({ state: 'ready', geometry_sha256: 'a'.repeat(64), manifest: { units: 'mm' } }), drawingReader: async () => ({ readable: true, units: 'mm', annotations: [{ id: 'material', text: 'fixture material' }] }) })
  let task = await tasks.collect('s1', 0, { prt: 'prt', dwg: 'dwg' })
  task = await tasks.recordSurvey('s1', task.inputs.prt.sha256, { bbox: [0, 0, 0, 10, 10, 10], bodies: { part_body_count: 1 } })
  for (const id of ['input_pair', 'material', 'stock', 'datum', 'fixture']) task = await tasks.answer('s1', task.version, id, id === 'input_pair' ? 'confirm' : 'synthetic only')
  const op = { id: 'op1', new_name: 'OP_{suffix}', station: 'TEST', type: 'from_scratch_workpiece_op', geometry: 'FS_WORKPIECE', parent: 'MCS_MAIN', tool: 'AP_MILL_D10', tool_assembly_id: 'D10', feed: 100, spindle: 1000, execution: 'nc', depends_on: [], inspection: ['synthetic only'] }
  task = await tasks.update('s1', task.version, { machine_id: 'm1', operations: [op], requirements: [{ text: 'fixture material', source: { kind: 'drawing', sha256: task.inputs.dwg.sha256, entity_id: 'material', quote: 'fixture material' } }] })
  task = await tasks.finishReview('s1', task.version, task.review.fingerprint, task.requirement_summary.draft.map(item => item.id))
  task = await tasks.authorize('s1', task.version, task.fingerprint, { op1: { feed: [80, 120] } })
  const tools = new Map(), services = new Map([['camTasks', tasks]])
  let done, ncName, calls = [], stopBeforeNext = false, invalidToolReadback = false
  const ctx = { get: name => services.get(name), tools: { register: tool => tools.set(tool.name, tool) } }
  const exec = { agent: { id: 's1', session: { header: { cwd: home } } } }
  registerCamPlan(ctx, { machineRegistry: registry })
  const args = { part_id: 'TEST', part: 'task-input://1/prt', machine_id: 'm1', operations: task.operations }
  const planned = JSON.parse(await tools.get('cam_plan').execute(args, exec)); assert.equal(planned.status, 'ok')
  const dir = planned.run_dir
  const pipeline = { ensureReady: async () => ({ status: 'ok' }), stat: async () => ({ status: 'ok', data: { exists: true } }), windowsPath: async value => ({ status: 'ok', data: value }),
    run: async (endpoint, params) => {
      calls.push({ endpoint, params })
      if (endpoint === '/cam_copy_part') {
        if (stopBeforeNext) { const now = await tasks.read('s1'); await tasks.stop('s1', now.version) }
        return { status: 'ok', data: { ok: true } }
      }
      if (endpoint === '/cam_set_tool_numbers') return { status: 'ok', data: { ok: true, saved: true, tools: { AP_MILL_D10: { after: { num: invalidToolReadback ? 1 : 3 } } } } }
      if (endpoint === '/cam_build_workpiece_op') return { status: 'ok', data: { created: true, path_exists: true, toolpath_length: 10 } }
      if (endpoint === '/postprocess') { ncName = params.operations[0] + '.nc'; return { status: 'ok', data: { files: { [params.operations[0]]: ncName } } } }
      return { status: 'ok', data: { verdict: 'PASS' } }
    }, listDir: async () => ({ status: 'ok', data: { entries: [{ name: ncName, is_dir: false }] } }) }
  services.set('jobs', { start: spec => {
    assert.equal(spec.owner, 's1', 'DSH 0.2 job owner is SessionId, not Agent')
    done = spec.run().done; return 'cam-run-1'
  } })
  registerCamRun(ctx, pipeline)
  const accepted = JSON.parse(await tools.get('cam_run').execute({ run_id: planned.run_id }, exec)); assert.equal(accepted.status, 'accepted')
  const outcome = await done; assert.equal(outcome.status, 'completed'); assert.equal(typeof outcome.result, 'string', 'DSH 0.2 terminal payload is result')
  const summary = JSON.parse(outcome.result); assert.equal(summary.overall, 'ok')
  assert.equal(calls.find(c => c.endpoint === '/cam_build_workpiece_op').params.feed, 100)
  assert.deepEqual(calls.find(c => c.endpoint === '/cam_set_tool_numbers').params.numbers, { AP_MILL_D10: 3 })
  assert.ok(calls.findIndex(c => c.endpoint === '/cam_set_tool_numbers') < calls.findIndex(c => c.endpoint === '/cam_build_workpiece_op'))
  assert.match((await tasks.read('s1')).phase, /NC 已生成.*待打包/)
  assert.match(await fs.readFile(path.join(dir, 'runstate.json'), 'utf8'), /production_overall/)
  assert.equal((await tasks.read('s1')).active_run, null)
  // Central-directory ZIP comes from standard Python zipfile, not hand-forged archive headers.
  const bytes = execFileSync('python3', ['-c', 'import io,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:z.writestr(sys.argv[1],"G90\\nM30\\n")\nsys.stdout.buffer.write(b.getvalue())', ncName])
  pipeline.zipDir = async () => ({ status: 'ok', data: { bytes, sha256: digest(bytes) } })
  const delivered = await executeCamDeliver({ camPipeline: pipeline, runDir: dir, runId: planned.run_id, tasks, sessionId: 's1' })
  assert.equal(delivered.package_kind, 'problem'); assert.equal(delivered.overall, 'incomplete')
  task = await tasks.read('s1'); assert.equal(task.deliveries.length, 1)
  assert.match(await fs.readFile(path.join(dir, 'delivery/delivery_report.md'), 'utf8'), /^# 问题包：禁止/)
  assert.equal(task.deliveries[0].production_overall, 'incomplete')
  const deliveryManifest = JSON.parse(await fs.readFile(path.join(dir, 'delivery/manifest.json'), 'utf8'))
  assert.equal(deliveryManifest.package_complete, true)
  assert.equal(deliveryManifest.execution_overall, 'ok')
  assert.equal(deliveryManifest.production_overall, 'incomplete')
  await assert.rejects(tasks.release('s1', task.version, planned.run_id), /不能生产放行/)
  const frozen = await fs.readFile(path.join(dir, 'delivery/manifest.json'))
  assert.equal((await executeCamDeliver({ camPipeline: pipeline, runDir: dir, runId: planned.run_id, tasks, sessionId: 's1' })).stage, 'immutable')
  assert.deepEqual(await fs.readFile(path.join(dir, 'delivery/manifest.json')), frozen)
  // A mismatched NX tool number halts before any toolpath generation or posting.
  const badBinding = JSON.parse(await tools.get('cam_plan').execute(args, exec))
  calls = []; invalidToolReadback = true
  await tools.get('cam_run').execute({ run_id: badBinding.run_id }, exec)
  const refusedBinding = JSON.parse((await done).result)
  assert.notEqual(refusedBinding.overall, 'ok')
  assert.equal(calls.some(c => ['/cam_build_workpiece_op', '/postprocess'].includes(c.endpoint)), false)
  invalidToolReadback = false
  // Task stop prevents the next NX submission, without claiming an in-flight cancellation.
  const second = JSON.parse(await tools.get('cam_plan').execute(args, exec)); stopBeforeNext = true; calls = []
  await tools.get('cam_run').execute({ run_id: second.run_id }, exec); const stopped = JSON.parse((await done).result)
  assert.notEqual(stopped.overall, 'ok'); assert.equal(calls.some(c => c.endpoint === '/cam_build_workpiece_op'), false)
  task = await tasks.read('s1'); task = await tasks.revise('s1', task.version, 'synthetic feedback')
  assert.equal(task.revision, 2); assert.equal(task.authorization, null)
  assert.equal((await tasks.resolveInput('s1', 'task-input://1/prt')).sha256, digest('synthetic prt'))
  assert.deepEqual(await fs.readFile(path.join(dir, 'delivery/manifest.json')), frozen)
  assert.equal(JSON.parse(await tools.get('cam_run').execute({ run_id: planned.run_id }, exec)).stage, 'authorization')
  console.log('formal execution integration: PASS (scoped batch, SDK jobs, parameter forwarding, stop, immutable problem package, denied release, revision)')
} finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; await fs.rm(home, { recursive: true, force: true }) }
