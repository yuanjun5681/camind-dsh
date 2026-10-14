// Assert-only formal-task checks: real filesystem/locks; NX and geometry facts are explicit fixtures, never production evidence.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCamTasks, digest, validateOperations } from './lib/tasks.js'
import { requirementDraft } from './lib/requirement-summary.js'
import { decodeDrawing } from './lib/drawing.js'
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-tasks-'))
try {
  const projectionTask = { inputs:{dwg:{sha256:'sha'}}, answers:{a:{resolved:true,value:'待提供颜色对照表'},b:{resolved:false,value:'暂不确定'}}, questions:[{id:'a',scope:'review'},{id:'b',scope:'review'}], requirements:[
    {text:'材料：SKD61（标题栏 Material-S）',source:{kind:'drawing',sha256:'sha',quote:'SKD61'}},
    {text:'关键尺寸：Ø8.000 +0.005/0（实体 2f23）',source:{kind:'drawing',sha256:'sha'}},
    {text:'件名：重复件名',source:{kind:'drawing',sha256:'sha'}},
    {text:'旧要求',stale:true,source:{kind:'drawing',sha256:'sha'}},
    {text:'旧输入要求',source:{kind:'drawing',sha256:'old'}},
    {text:'Agent 尚未采纳的建议',source:{kind:'recommendation'}}] }
  const projected = requirementDraft(projectionTask)
  assert.deepEqual(projected.map(item => item.text), ['材料：SKD61','关键尺寸：Ø8.000 +0.005/0','待提供颜色对照表'])
  assert.equal(requirementDraft({ ...projectionTask, questions:[], requirements:[{text:'关键尺寸：3.075，需核对原图配对',source:{kind:'drawing',sha256:'sha'}}] })[0].group, 'agreements', 'Unverified dimensions remain explicit constraints')
  assert.equal(projected[2].group,'agreements', 'A promise to provide evidence must remain an agreement, not a measured fact')
  const prt = path.join(home, 'source.prt'), dwg = path.join(home, 'source.dwg')
  await fs.writeFile(prt, 'synthetic NX fixture'); await fs.writeFile(dwg, 'AC1027 fixture')
  const drawing = { readable: true, units: 'mm', preview_partial: true, annotations: [{ id: 'a1', text: '材料6061' }], svg: '<svg/>', note: 'fixture only' }
  const options = { home, resolve: async (sid, ref) => { assert.equal(sid, 'session-a'); if (!['prt', 'dwg'].includes(ref)) throw new Error('not owned'); return { file: ref === 'prt' ? prt : dwg } },
    machineRegistry: { snapshot: id => { assert.equal(id, 'machine-a'); return { id, version: 1, spindle: { rpm_min: 50, rpm_max: 12000 }, kinematics: { max_cut_feed_mm_min: 10000 } } } },
    geometry: async () => ({ state: 'ready', geometry_sha256: 'a'.repeat(64), manifest: { units: 'mm' } }), drawingReader: async () => drawing }
  let service = createCamTasks(options), task = await service.read('session-a')
  assert.equal(task.version, 0); assert(task.blockers.length)
  await assert.rejects(service.collect('../escape', 0, { prt: 'prt' }))
  await assert.rejects(service.collect('session-b', 0, { prt: 'prt' }))
  task = await service.collect('session-a', 0, { prt: 'prt', dwg: 'dwg' })
  assert.equal(task.inputs.prt.sha256, digest('synthetic NX fixture'))
  await assert.rejects(service.finishReview('session-a', task.version, task.review.fingerprint), /对应/)
  await assert.rejects(service.answer('session-a', task.version, 'input_pair', '暂不确定', true), /尚未确认/)
  task = await service.answer('session-a', task.version, 'input_pair', '暂不确定', false)
  assert.equal(task.review.status, 'pending')
  task = await service.update('session-a', task.version, { requirements: [{ value: '6061', source: { kind: 'drawing', sha256: task.inputs.dwg.sha256, entity_id: 'a1', quote: '材料6061' } }], questions: [{ id: 'future', prompt: '后续装夹', critical: true, scope: 'planning' }] })
  task = await service.answer('session-a', task.version, 'input_pair', 'confirm')
  task = await service.finishReview('session-a', task.version, task.review.fingerprint)
  assert.equal(task.review.status, 'complete')
  assert.equal(task.requirement_summary.status, 'unconfirmed', 'Legacy review does not imply requirements were shown to the user')
  await assert.rejects(service.finishReview('session-a', task.version, task.review.fingerprint, []), /勾选/)
  await assert.rejects(service.finishReview('session-a', task.version, task.review.fingerprint, ['not-in-list']), /勾选/)
  task = await service.finishReview('session-a', task.version, task.review.fingerprint, task.requirement_summary.draft.map(item => item.id))
  assert.equal(task.requirement_summary.status, 'confirmed')
  assert.equal(task.requirement_summary.confirmed.items[0].text, '6061')
  const oldReviewFingerprint = task.review.fingerprint
  task = await service.update('session-a', task.version, { requirements: task.requirements.map(entry => ({ ...entry, value: '6061 T6' })) })
  assert.equal(task.requirement_summary.status, 'stale')
  assert.equal(task.requirement_summary.confirmed, null, 'Never show old requirements as current after a change')
  await assert.rejects(service.finishReview('session-a', task.version, oldReviewFingerprint, task.requirement_summary.draft.map(item => item.id)), /已变更/)
  task = await service.finishReview('session-a', task.version, task.review.fingerprint, task.requirement_summary.draft.map(item => item.id))
  assert.equal(task.phase, '审图完成')
  assert.equal(task.authorization, null)
  assert(task.blockers.some(text => text.includes('机床')), 'Intake completion must not bypass programming prerequisites')
  service = createCamTasks(options)
  assert.equal((await service.read('session-a')).review.status, 'complete', 'Intake completion survives restart')
  assert.equal((await service.read('session-a')).requirement_summary.confirmed.items[0].text, '6061 T6', 'Frozen reviewed list survives restart')

  assert.equal((await service.resolveInput('session-a', 'task-input://1/prt')).sha256, task.inputs.prt.sha256)
  await assert.rejects(service.resolveInput('session-a', 'task-input://99/prt'))
  await assert.rejects(service.update('session-a', 0, { goal: 'stale' }), { code: 'TaskConflict' })
  await assert.rejects(service.update('session-a', task.version, { authorization: { fake: true } }))
  await assert.rejects(service.update('session-a', task.version, { setup: { material: { value: '6061', source: { kind: 'user' } } } }))
  await assert.rejects(service.update('session-a', task.version, { requirements: [{ value: '7075', source: { kind: 'drawing', sha256: task.inputs.dwg.sha256, entity_id: 'a1', quote: '7075' } }] }))
  const op = { id: 'op-a', type: 'from_scratch_workpiece_op', new_name: 'OP_{suffix}', source_name: 'TEMPLATE', station: 'station-a', depends_on: [], execution: 'nc', inspection: ['核对尺寸'], spindle: 1000, feed: 100 }
  assert.throws(() => validateOperations([{ ...op, depends_on: ['later'] }]))
  assert.throws(() => validateOperations([op, { ...op }]))
  assert.throws(() => validateOperations([{ ...op, spindle: null }]))
  assert.throws(() => validateOperations([{ ...op, feed: -1 }]))
  task = await service.update('session-a', task.version, { machine_id: 'machine-a', goal: 'fixture task', prepare: { init_setup: { ensure_tool: true, tool_diameter: 10 } }, operations: [op], questions: [{ id: 'quantity', prompt: '数量？', critical: true }] })
  assert.equal(task.review.status, 'pending', 'New review questions invalidate completion')
  await assert.rejects(service.authorize('session-a', task.version, task.fingerprint))
  task = await service.recordSurvey('session-a', task.inputs.prt.sha256, { bbox: [0, 0, 0, 10, 20, 30], bodies: { part_body_count: 1 } })
  for (const id of ['material', 'stock', 'datum', 'fixture', 'quantity', 'input_pair']) task = await service.answer('session-a', task.version, id, id === 'input_pair' ? 'confirm' : `fixture ${id}`)
  assert.equal(task.blockers.length, 0)
  service = createCamTasks(options)
  assert.equal((await service.read('session-a')).version, task.version, 'record survives service restart')
  await assert.rejects(service.authorize('session-a', task.version, task.fingerprint, { 'op-a': { feed: [80, 10001] } }))
  await assert.rejects(service.authorize('session-a', task.version, 'stale-review'), { code: 'TaskConflict' })
  await assert.rejects(service.authorize('session-a', task.version, task.fingerprint, { 'op-a': { feed: [110, 150] } }))
  task = await service.authorize('session-a', task.version, task.fingerprint, { 'op-a': { feed: [80, 150] } })
  await service.assertAuthorized('session-a', [{ ...op, feed: 120 }])
  await service.assertAuthorized('session-a', [Object.fromEntries(Object.entries({ ...op, feed: 120 }).reverse())])
  await assert.rejects(service.assertAuthorized('session-a', [{ ...op, feed: 151 }]))
  const withoutFeed = { ...op }; delete withoutFeed.feed
  await assert.rejects(service.assertAuthorized('session-a', [withoutFeed]))
  await assert.rejects(service.assertAuthorized('session-a', [{ ...op, station: 'other' }]))
  await assert.rejects(service.assertAuthorized('session-a', [{ ...op, spindle: 1200 }]))
  task = await service.update('session-a', task.version, { operations: [{ ...op, feed: 120 }] }, 'user')
  assert.equal(task.authorization, null, 'User edits revoke the prior signature')
  assert.equal(task.audit.at(-1).actor, 'user')
  task = await service.update('session-a', task.version, { operations: [op] }, 'user')
  task = await service.authorize('session-a', task.version, task.fingerprint, { 'op-a': { feed: [80, 150] } })
  const job = { operations: [op], prepare: { init_setup: { tool_diameter: 10, ensure_tool: true } }, test: true, formal_task: { revision: task.revision, authorization: task.authorization.fingerprint }, machine_context: { machine_instance_id: task.machine_id }, post_name: task.post_name, prt_sha256: task.inputs.prt.sha256, prt_local: (await service.inputFile('session-a', 'prt')).file }
  await assert.rejects(service.assertJob('session-a', { ...job, prt_sha256: 'c'.repeat(64) }))
  await assert.rejects(service.assertJob('session-a', { ...job, post_name: 'OTHER_POST' }))
  task = await service.bindRun('session-a', 'run-a', job)
  task = await service.beginRun('session-a', 'run-a', job)
  await assert.rejects(service.update('session-a', task.version, { goal: 'unsafe live change' }))
  task = await service.stop('session-a', task.version)
  await assert.rejects(service.assertAuthorized('session-a'))
  task = await service.finishRun('session-a', 'run-a', { overall: 'error', reason: 'fixture stopped' })
  assert.equal(task.active_run, null)
  task = await service.revise('session-a', task.version, '实测超差，保留证据待分析')
  assert.equal(task.revision, 2); assert.equal(task.authorization, null); assert.equal(task.operations.length, 0)
  assert.equal(task.revisions[0].operations[0].id, 'op-a')
  const results = await Promise.allSettled([service.update('session-a', task.version, { goal: 'one' }), service.update('session-a', task.version, { goal: 'two' })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter(r => r.status === 'rejected')[0].reason.code, 'TaskConflict')
  const parsed = decodeDrawing({ HEADER: { INSUNITS: 4 }, OBJECTS: [{ object: 'LAYER', handle: [0, 1, 7], name: '尺寸' }, { entity: 'TEXT', handle: [0, 1, 10], layer: [5, 1, 7], text_value: '%%c10\\P±0.02' }] })
  assert.equal(parsed.annotations[0].id, 'a'); assert.equal(parsed.annotations[0].text, 'Ø10\n±0.02'); assert.equal(parsed.annotations[0].layer, '尺寸')
  assert.equal(decodeDrawing({ OBJECTS: [{ entity: 'ACAD_PROXY_ENTITY' }] }).readable, false)
  const current = await service.read('session-a'), blob = await service.inputFile('session-a', 'prt')
  await fs.writeFile(blob.file, 'changed'); await assert.rejects(service.inputFile('session-a', 'prt'))
  assert(current.audit.every(entry => entry.actor && Number.isInteger(entry.version)))
  console.log('formal task selfcheck: PASS (filesystem + simulated NX facts; no production machining)')
} finally { await fs.rm(home, { recursive: true, force: true }) }
