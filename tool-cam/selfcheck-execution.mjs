// Integration selfcheck: real task/filesystem/tool registration, synthetic NX responses; no production evidence.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createCamTasks, digest } from './lib/tasks.js'
import { registerCamPlan } from './lib/tools/plan.js'
import { executeCamRun, registerCamRun, regenerationItemsOf, resumeDecisionOf } from './lib/tools/run.js'
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
  let done, ncName, calls = [], stopBeforeNext = false, invalidToolReadback = false, failedFinalize = false, throwFinalize = false, postFailure = false, pendingRegeneration = false, crossOperationPending = false
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
      if (endpoint === '/cam_finalize_work_copy' && throwFinalize) throw Error('unexpected finalize failure')
      if (endpoint === '/cam_finalize_work_copy') return { status: 'ok', data: { ok: !failedFinalize, saved: true, save_verified: true, modified_after_save: false, closed: !failedFinalize, error: failedFinalize ? 'close refused' : undefined } }
      if (endpoint === '/cam_set_tool_numbers') {
        const after = { num: 3, adj: 3, cutcom: 3, num_tog: null, adj_tog: null, cutcom_tog: null }
        if (typeof invalidToolReadback === 'string' && invalidToolReadback.startsWith('missing_')) delete after[invalidToolReadback.slice(8)]
        else if (invalidToolReadback) after[invalidToolReadback] = invalidToolReadback.endsWith('_tog') ? 0 : 1
        return { status: 'ok', data: { ok: true, saved: true, tools: { AP_MILL_D10: { after } } } }
      }
      if (endpoint === '/cam_copy_postprocess' && postFailure === 't501') return { status: 'error', errorType: 'FieldGuardError', errorClass: 'refused', errorDetail: { regeneration_required: [{ operation: params.new_name, tool: 'AP_MILL_D10', reason: 'missing T/H/D or definition bits' }], confirmation_param: 'allow_regenerate_toolpaths' } }
      if (endpoint === '/cam_build_workpiece_op') return { status: 'ok', data: { created: true, path_exists: true, toolpath_length: 10 } }
      if (endpoint === '/postprocess' && crossOperationPending) {
        const name = params.operations[0]
        if (name.startsWith('A_')) return { status: 'error', errorType: 'WorkerError', msg: 'ordinary post failure', errorDetail: { posts: ['MILL_3_AXIS'] } }
        ncName = name + '.nc'
        return { status: 'ok', data: { files: { [name]: ncName }, regenerated_operations: [name], other_operations_pending_regeneration: [name.replace(/^B_/, 'A_')] } }
      }
      if (endpoint === '/postprocess' && postFailure === 'ordinary') return { status: 'error', errorType: 'FieldGuardError', errorClass: 'refused', errorDetail: { posts: ['MILL_3_AXIS'] } }
      if (endpoint === '/postprocess' && postFailure === 't501') return { status: 'error', errorType: 'FieldGuardError', errorClass: 'refused', errorDetail: { regeneration_required: [{ operation: params.operations[0], tool: 'AP_MILL_D10', reason: 'missing T/H/D or definition bits' }], confirmation_param: 'allow_regenerate_toolpaths' } }
      if (endpoint === '/postprocess') {
        ncName = params.operations[0] + '.nc'
        const pendingFields = {}
        if (pendingRegeneration) {
          pendingFields.regenerated_operations = [params.operations[0]]
          pendingFields.other_operations_pending_regeneration = ['OTHER']
          pendingFields.tool_numbers_fixed = { AP_MILL_D10: 3 }
        }
        return { status: 'ok', data: {
          files: { [params.operations[0]]: ncName },
          ...pendingFields,
        } }
      }
      return { status: 'ok', data: { verdict: 'PASS' } }
    }, listDir: async () => ({ status: 'ok', data: { entries: [{ name: ncName, is_dir: false }] } }) }
  services.set('jobs', { start: spec => {
    assert.equal(spec.owner, 's1', 'DSH 0.2 job owner is SessionId, not Agent')
    done = spec.run().done; return 'cam-run-1'
  } })
  registerCamRun(ctx, pipeline)
  const accepted = JSON.parse(await tools.get('cam_run').execute({ run_id: planned.run_id }, exec)); assert.equal(accepted.status, 'accepted')
  const outcome = await done; assert.equal(outcome.status, 'completed', JSON.stringify(outcome)); assert.equal(typeof outcome.result, 'string', 'DSH 0.2 terminal payload is result')
  const summary = JSON.parse(outcome.result); assert.equal(summary.overall, 'ok')
  assert.equal(calls.find(c => c.endpoint === '/cam_build_workpiece_op').params.feed, 100)
  assert.deepEqual(calls.find(c => c.endpoint === '/cam_set_tool_numbers').params.numbers, { AP_MILL_D10: 3 })
  assert.ok(calls.findIndex(c => c.endpoint === '/cam_set_tool_numbers') < calls.findIndex(c => c.endpoint === '/cam_build_workpiece_op'))
  assert.match((await tasks.read('s1')).phase, /NC 已生成.*待打包/)
  assert.equal(summary.cleanup.status, 'complete')
  assert.ok(calls.findIndex(c => c.endpoint === '/cam_finalize_work_copy') > calls.findIndex(c => c.endpoint === '/cam_gouge_check'))
  assert.equal(calls.some(c => c.endpoint === '/cam_close_part'), false)
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
  const pendingCopy = JSON.parse(await tools.get('cam_plan').execute(args, exec))
  failedFinalize = true; calls = []
  await tools.get('cam_run').execute({ run_id: pendingCopy.run_id }, exec)
  const pendingSummary = JSON.parse((await done).result)
  assert.equal(pendingSummary.overall, 'ok', 'NC generation survives finalization failure')
  assert.equal(pendingSummary.cleanup.status, 'pending')
  assert.match((await tasks.read('s1')).phase, /副本待处理/)
  assert.equal(calls.some(c => c.endpoint === '/cam_close_part'), false)
  failedFinalize = false
  const thrownCopy = JSON.parse(await tools.get('cam_plan').execute(args, exec))
  throwFinalize = true
  await tools.get('cam_run').execute({ run_id: thrownCopy.run_id }, exec)
  const thrownSummary = JSON.parse((await done).result)
  assert.equal(thrownSummary.overall, 'ok')
  assert.equal(thrownSummary.cleanup.status, 'pending')
  throwFinalize = false
  // Any mismatched/missing T/H/D register or undefined definition bit halts before generation or posting.
  for (const field of ['num', 'adj', 'cutcom', 'num_tog', 'adj_tog', 'cutcom_tog', 'missing_num_tog', 'missing_adj_tog', 'missing_cutcom_tog']) {
    const badBinding = JSON.parse(await tools.get('cam_plan').execute(args, exec))
    calls = []; invalidToolReadback = field
    await tools.get('cam_run').execute({ run_id: badBinding.run_id }, exec)
    const refusedBinding = JSON.parse((await done).result)
    assert.notEqual(refusedBinding.overall, 'ok')
    assert.equal(calls.some(c => ['/cam_build_workpiece_op', '/postprocess'].includes(c.endpoint)), false)
  }
  invalidToolReadback = false
  assert.deepEqual(regenerationItemsOf({ other_operations_pending_regeneration: [], regeneration_required: false, error_detail: { regeneration_required: {} } }), [])
  assert.equal(resumeDecisionOf('ok', { other_operations_pending_regeneration: [] }), 'skip')
  assert.deepEqual(regenerationItemsOf({ error_detail: { regeneration_required: [null, ' A ', { operation: 'B', reason: '需重算' }, true, {}] } }), [{ operation: 'A' }, { operation: 'B', reason: '需重算' }, { operation: '未知工序' }])
  assert.deepEqual(regenerationItemsOf({ regeneration_required: { operations: ['C', 'D'] } }), [{ operation: 'C' }, { operation: 'D' }])
  assert.equal(resumeDecisionOf('generated', { error_detail: { regeneration_required: true } }), 'stop')
  assert.equal(resumeDecisionOf('generated', { error_detail: { regeneration_required: 'A' } }), 'stop')
  // Ordinary post failures retain generated/resume-post semantics; only T-501 becomes a hard error.
  const ordinaryPost = JSON.parse(await tools.get('cam_plan').execute(args, exec))
  postFailure = 'ordinary'; calls = []
  await tools.get('cam_run').execute({ run_id: ordinaryPost.run_id }, exec)
  const ordinaryPostSummary = JSON.parse((await done).result)
  assert.equal(ordinaryPostSummary.overall, 'incomplete')
  assert.equal(ordinaryPostSummary.ops[0].status, 'generated')
  const ordinaryPosts = calls.filter(call => call.endpoint === '/postprocess').length
  await tools.get('cam_run').execute({ run_id: ordinaryPost.run_id, resume: true }, exec)
  const ordinaryResumeSummary = JSON.parse((await done).result)
  assert.equal(ordinaryResumeSummary.ops[0].decision, 'post')
  assert.equal(calls.filter(call => call.endpoint === '/postprocess').length, ordinaryPosts + 1)
  postFailure = false
  // T-501: refusal is an error, never a normal generated state, and no authorization flag is injected.
  const refusedT501 = JSON.parse(await tools.get('cam_plan').execute(args, exec))
  postFailure = 't501'; calls = []
  await tools.get('cam_run').execute({ run_id: refusedT501.run_id }, exec)
  const refusedT501Summary = JSON.parse((await done).result)
  assert.equal(refusedT501Summary.overall, 'error')
  assert.equal(refusedT501Summary.ops[0].status, 'error')
  assert.equal(refusedT501Summary.ops[0].error_detail.confirmation_param, 'allow_regenerate_toolpaths')
  assert.equal(calls.every(call => !Object.hasOwn(call.params, 'allow_regenerate_toolpaths')), true)
  const refusedPosts = calls.filter(call => call.endpoint === '/postprocess').length
  await tools.get('cam_run').execute({ run_id: refusedT501.run_id, resume: true }, exec)
  const refusedResumeSummary = JSON.parse((await done).result)
  assert.equal(refusedResumeSummary.ops[0].decision, 'stop')
  assert.equal(calls.filter(call => call.endpoint === '/postprocess').length, refusedPosts)
  postFailure = false
  const refusedDelivery = await executeCamDeliver({ camPipeline: pipeline, runDir: refusedT501.run_dir, runId: refusedT501.run_id, tasks, sessionId: 's1' })
  assert.ok(refusedDelivery.blockers.some(text => text.includes(`待重算刀路：${refusedT501Summary.ops[0].name}`)))
  assert.match(await fs.readFile(path.join(refusedT501.run_dir, 'delivery/delivery_report.md'), 'utf8'), /待重算刀路/)
  // The copy path is fail-closed in the same way and cannot assume parameter forwarding.
  const copyT501 = JSON.parse(await tools.get('cam_plan').execute({ ...args, operations: task.operations.map(op => ({ ...op, type: 'copy_postprocess', template: 'TEMPLATE_OP' })) }, exec))
  postFailure = 't501'; calls = []
  await tools.get('cam_run').execute({ run_id: copyT501.run_id }, exec)
  const copyT501Summary = JSON.parse((await done).result)
  assert.equal(copyT501Summary.overall, 'error')
  assert.equal(copyT501Summary.ops[0].error_detail.confirmation_param, 'allow_regenerate_toolpaths')
  assert.equal(calls.some(call => call.endpoint === '/postprocess'), false)
  assert.equal(calls.every(call => !Object.hasOwn(call.params, 'allow_regenerate_toolpaths')), true)
  postFailure = false
  // Successful current operation with another pending operation blocks delivery and resume.
  const pendingT501 = JSON.parse(await tools.get('cam_plan').execute(args, exec))
  pendingRegeneration = true; calls = []
  await tools.get('cam_run').execute({ run_id: pendingT501.run_id }, exec)
  const pendingT501Summary = JSON.parse((await done).result)
  assert.equal(pendingT501Summary.overall, 'incomplete')
  assert.match(pendingT501Summary.reason, /待重算刀路：OTHER/)
  assert.equal(pendingT501Summary.ops[0].status, 'ok')
  assert.equal(pendingT501Summary.ops[0].other_operations_pending_regeneration[0], 'OTHER')
  assert.equal(pendingT501Summary.ops[0].regenerated_operations[0], pendingT501Summary.ops[0].name)
  assert.equal(pendingT501Summary.ops[0].tool_numbers_fixed.AP_MILL_D10, 3)
  const pendingDelivery = await executeCamDeliver({ camPipeline: pipeline, runDir: pendingT501.run_dir, runId: pendingT501.run_id, tasks, sessionId: 's1' })
  assert.ok(pendingDelivery.blockers.some(text => text.includes('待重算刀路：OTHER')))
  const pendingManifest = JSON.parse(await fs.readFile(path.join(pendingT501.run_dir, 'delivery/manifest.json'), 'utf8'))
  assert.equal(pendingManifest.package_complete, false)
  assert.ok(pendingManifest.blockers.some(text => typeof text === 'string' && text.includes('待重算刀路：OTHER')))
  assert.match(await fs.readFile(path.join(pendingT501.run_dir, 'delivery/delivery_report.md'), 'utf8'), /待重算刀路：OTHER/)
  const postCallsBeforeResume = calls.filter(call => call.endpoint === '/postprocess').length
  await tools.get('cam_run').execute({ run_id: pendingT501.run_id, resume: true }, exec)
  const resumeT501Summary = JSON.parse((await done).result)
  assert.equal(resumeT501Summary.overall, 'incomplete')
  assert.equal(resumeT501Summary.ops[0].decision, 'stop')
  assert.equal(calls.filter(call => call.endpoint === '/postprocess').length, postCallsBeforeResume)
  pendingRegeneration = false
  // A later operation can name an earlier one as pending; resume must scan all records before any retry.
  const crossDir = path.join(home, 'cross-t501')
  await fs.mkdir(crossDir)
  await fs.writeFile(path.join(crossDir, 'job.json'), JSON.stringify({
    prt: 'input/part.prt', out_dir: 'output', post_name: 'MILL_3_AXIS', operations: [
      { ...task.operations[0], new_name: 'A_{suffix}' },
      { ...task.operations[0], id: 'op2', new_name: 'B_{suffix}' },
    ],
  }))
  const crossArgs = { camPipeline: pipeline, runDir: crossDir, runId: 'cross-t501', dshHome: home, isCancelled: () => false }
  crossOperationPending = true; calls = []
  const crossT501Summary = await executeCamRun({ ...crossArgs, resume: false })
  assert.equal(crossT501Summary.ops[0].status, 'generated', JSON.stringify(crossT501Summary.ops))
  assert.equal(crossT501Summary.ops[1].status, 'ok')
  assert.deepEqual(crossT501Summary.ops[1].other_operations_pending_regeneration, [crossT501Summary.ops[0].name])
  calls = []
  const crossResumeSummary = await executeCamRun({ ...crossArgs, resume: true })
  assert.deepEqual(crossResumeSummary.ops.map(op => op.decision), ['stop', 'stop'])
  assert.equal(calls.some(call => ['/cam_build_workpiece_op', '/postprocess'].includes(call.endpoint)), false)
  assert.match(crossResumeSummary.reason, new RegExp(`待重算刀路：${crossT501Summary.ops[0].name}`))
  crossOperationPending = false
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
