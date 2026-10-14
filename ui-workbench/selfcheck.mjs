// Client contract regressions using DSH 0.2 target('chat').legacy and the native reference/input facade.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const registrations = [], services = new Map(), effects = [], values = [], subscribers = new Set()
let cursor = 0, activeView = null, files = [{ name: 'part.prt' }], mounted = 's1', codec, validReference = true, focusCount = 0
const state = { draft: '', phase: 'plain', draftRev: 3, occurrences: [] }
const inserted = []
let taskComponents
const input = {
  state: { getSnapshot: () => state, subscribe: () => () => {} }, focus: () => { focusCount++ },
  insertReference(reference, span) {
    const expected = state.draft.length - state.occurrences.reduce((n, item) => n + item.length - 1, 0)
    assert.equal(span.start, expected); assert.equal(span.end, expected); assert.equal(span.draftRev, state.draftRev)
    inserted.push(reference); state.occurrences.push({ ...reference, length: reference.clipboardText.length })
    state.draft += reference.clipboardText + ' '; state.draftRev++
    return true
  },
  setDraft: () => { throw new Error('Adding a reference must not replace the draft') },
}
const store = { getSnapshot: () => ({ view: activeView }), actions: { setView: view => { activeView = view } } }
const React = {
  Component: class { constructor(props) { this.props = props } setState(next) { this.state = { ...this.state, ...next } } },
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: initial => { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next }] },
  useEffect: fn => effects.push(fn),
  useRef: () => ({ current: null }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
let chat = { timeline: { turnOrder: [1], turns: new Map([[1, { data: new Map([['deliverables', { produced: [{ path: 'delivery/test.nc' }], presented: [{ path: 'report.md' }] }]]) }]]) }, legacy: { partial: null, nodes: [
  { kind: 'assistant', blocks: [{ kind: 'reasoning', text: 'PRIVATE_REASONING' }, { kind: 'text', text: 'PUBLIC_REPLY' }] },
  { kind: 'tool-result', call: { name: 'write', argsRaw: '{}' }, content: [], subCalls: [] },
] } }
const source = { getSnapshot: () => chat, subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn) } }
const ctx = {
  slots: { inject: (_name, fn) => fn(), register: (options, component) => registrations.push({ options, component }),
    entriesOfSlot: name => name === 'conversation.session' ? [{}] : registrations.filter(r => r.options.name === name), hostFace: () => ({ storeOf: () => store }) },
  effect: (fn, label) => { if (label?.includes('native selection')) fn() },
  provide: (name, value) => services.set(name, value), get: name => services.get(name),
}
let running = true
services.set('sessions', { binding: () => ({ ctx: {} }), scope: () => ({ get: () => ({ input: { for: () => input } }) }),
  list: { getSnapshot: () => ({ byId: { s1: { running } } }), subscribe: () => () => {} } })
services.set('uiConversation', { binding: () => ({
  snapshot: { getSnapshot() { throw new Error('The top-level binding snapshot is NOT a chat node array') } },
  target: name => { assert.equal(name, 'chat'); return source },
}) })
services.set('sidebarRight', { mounted: { getSnapshot: () => mounted }, active: () => undefined, isExpanded: () => false })
services.set('inputTriggers', { registerSource: definition => { codec = definition; return () => {} } })
async function load(file) {
  let plugin
  let code = await fs.readFile(new URL(file, import.meta.url), 'utf8')
  if (file === './lib/client.js') code = code.replace('exports.apply = apply', 'exports.taskComponents = { submitWorkbenchRequest, composerViewportRect, TaskOperations, TaskAnswer, OperationEditor, PlanReview, DeliverablesTab, TaskWizard, WizardQuestion, TaskRequirements, RequirementList }; exports.apply = apply')
  vm.runInNewContext(code, {
    window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === 'react' ? React : name === 'react-dom' ? { createPortal: node => node } : { Button: 'button', Tooltip: 'tooltip', MarkdownText: 'markdown', IconGaugeOutlineRegular: 'icon' }) } } },
    Blob, URL, URLSearchParams, AbortController, document: { body: {} },
    fetch: async url => url.includes('/selection?')
      ? { ok: validReference, status: 409, json: async () => validReference ? { kind: 'faces', path: 'reference://part', source_sha256: 'a'.repeat(64), geometry_sha256: 'b'.repeat(64), fids: ['F000001'] } : { message: '源模型已变更' } }
      : { ok: true, json: async () => url.includes('/cam/runs?') ? { runs: [{ run_id: 'test-run', delivery: [{ name: 'nc_batch.zip', bytes: 100 }] }] } : { files } },
    setTimeout: () => 1, clearTimeout: () => {},
  })
  plugin.apply(ctx)
  if (plugin.taskComponents) taskComponents = plugin.taskComponents
}
await load('../ui-preview/lib/client.js')
await load('./lib/client.js')
const canvasRect = { left: 280, right: 885, bottom: 820, width: 605, height: 686 }
const collapsedStage = { left: 280, right: 280, bottom: 407, width: 0, height: 0 }
assert.equal(taskComponents.composerViewportRect(canvasRect, collapsedStage, false), canvasRect, 'Collapsed model viewport must not collapse composer or approval')
assert.equal(taskComponents.composerViewportRect(canvasRect, { ...canvasRect, width: 300 }, true), canvasRect, 'Approval uses the stable canvas bounds')

const edits = [], originalVersion = 3
const draftOp = { id: 'op-a', new_name: 'OP_{suffix}', station: 'station-a', type: 'from_scratch_workpiece_op', depends_on: [], inspection: ['check'], feed: 100 }
const editRecord = { task: { version: originalVersion, operations: [draftOp] }, act: async (action, args) => edits.push({ action, args }) }
values.length = 0; cursor = 0
const editorTree = taskComponents.OperationEditor({ op: draftOp, record: editRecord, close: () => {} })
editRecord.task.version = 9
await editorTree.props.onSubmit({ preventDefault() {} })
assert.equal(edits[0].action, 'operations'); assert.equal(edits[0].args.version, originalVersion, 'Editor pins reviewed version rather than silently overwriting a background update')
// Existing operations must render their planning confirmations, including after restart.
values.length = 0; cursor = 0
const operationsRecord = { ...editRecord, task: { ...editRecord.task, revision: 1, blockers: [], questions: [{ id: 'post', scope: 'planning', prompt: '核对后处理' }], answers: {} } }
const operationsTree = taskComponents.TaskOperations({ sessionId: 's1', record: operationsRecord })
assert.ok(JSON.stringify(operationsTree).includes('方案参数与确认'))
const snapshot = { version: 4, revision: 1, fingerprint: 'a'.repeat(64), inputs: {}, operations: [draftOp] }
values.length = 0; cursor = 0
const review = taskComponents.PlanReview({ snapshot, record: editRecord, close: () => {} })
assert.ok(JSON.stringify(review).includes('缺失事实不因签字变成已验证'))
const confirmation = review.children[0].children.find(child => child?.type === 'div').children[0]
assert.equal(confirmation.props.disabled, true)
await confirmation.props.onClick()
assert.equal(edits.at(-1).args.version, snapshot.version)
assert.equal(edits.at(-1).args.fingerprint, snapshot.fingerprint)
values.length = 0; cursor = 0
const workbench = registrations.find(r => r.options.id === 'workbench' && r.options.name === 'conversation.view')
assert.ok(workbench.options.order < 0)
assert.equal(registrations.some(r => r.options.name === 'sidebar.right.pane.tab'), false)
const preview = services.get('filePreview')
preview.preview('s1', 'upload://batch/part.prt'); assert.equal(activeView, 'workbench')
let targetChanges = 0
const unsubscribe = preview.subscribe('s1', () => targetChanges++)
preview.previewContent('s2', 'other.nc', 'G1 X1'); assert.equal(targetChanges, 0)
preview.preview('s1', 'upload://batch/part.prt'); assert.equal(targetChanges, 1); unsubscribe()
cursor = 0
const first = preview.View({ sessionId: 's1', embedded: true })
assert.equal(first.props.className, 'campv-view campv-embedded')
assert.ok(JSON.stringify(first).includes('upload://batch/part.prt'))
const dwgBody = first.children[0].children[1].children[0]
const dwg = dwgBody.type({ sessionId: 's1', preview: { name: 'drawing.dwg', path: 'upload://batch/drawing.dwg' } })
assert.match(JSON.stringify(dwg), /CAD 图纸预览待接入/)
assert.match(JSON.stringify(dwg), /不能据此视为已审图/)
const header = registrations.find(r => r.options.id === 'workbench' && r.options.name.includes('utilities'))
for (const preference of [null, 'chat', 'trajectory']) {
  activeView = preference; effects.length = 0; cursor = 0
  header.component({ sessionId: 's1' }); const cleanup = effects.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(activeView, preference === null ? 'workbench' : preference); cleanup()
}
for (const missing of [[], [{ name: 'missing.prt', available: false }]]) {
  activeView = null; files = missing; effects.length = 0; cursor = 0
  header.component({ sessionId: 's1' }); const cleanup = effects.shift()()
  await new Promise(resolve => setImmediate(resolve)); assert.equal(activeView, null); cleanup()
}
values.length = 0; cursor = 0; effects.length = 0
const entryTree = workbench.component({ sessionId: 's1' })
const boundary = new entryTree.type(entryTree.props)
boundary.state = entryTree.type.getDerivedStateFromError(Error('render failure'))
assert.ok(JSON.stringify(boundary.render()).includes('工作台显示失败'))
const viewNode = entryTree.children[0]
const tree = viewNode.type(viewNode.props)
const agent = tree.children.at(-1)
values.length = 0; cursor = 0; effects.length = 0
agent.type(agent.props); const dispose = effects.shift()(); values[1] = { left: 10, width: 600, bottom: 12 }; cursor = 0
let rendered = agent.type(agent.props)
assert.ok(JSON.stringify(rendered).includes('停止'), 'Running state must expose the official stop action')
assert.ok(JSON.stringify(rendered).includes('PUBLIC_REPLY'))
assert.ok(!JSON.stringify(rendered).includes('PRIVATE_REASONING'))
chat.legacy.nodes.push({ kind: 'user', blocks: [{ kind: 'text', text: 'NEW_REQUEST' }] })
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.ok(!JSON.stringify(rendered).includes('PUBLIC_REPLY'), 'A newly submitted turn must not display the preceding reply')
chat = { ...chat, legacy: { nodes: chat.legacy.nodes, partial: { blocks: [{ kind: 'reasoning', text: 'PRIVATE_STREAM' }] } } }
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.ok(JSON.stringify(rendered).includes('公开回复生成中'), 'Expose public streaming text while generating')
assert.ok(JSON.stringify(rendered).includes('正在等待公开输出'))
assert.ok(!JSON.stringify(rendered).includes('PRIVATE_STREAM'))
assert.ok(!JSON.stringify(rendered).includes('PUBLIC_REPLY'), 'Do not present an old reply as this stream')
chat.legacy.partial.blocks.push({ kind: 'text', text: 'LIVE_DELTA' })
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.ok(JSON.stringify(rendered).includes('LIVE_DELTA'))
assert.ok(!JSON.stringify(rendered).includes('PRIVATE_STREAM'))
await load('../ui-compact-composer/lib/client.js')
cursor = 0; rendered = agent.type(agent.props)
assert.ok(JSON.stringify(rendered).includes('wb-compact-response')); assert.ok(JSON.stringify(rendered).includes('LIVE_DELTA'))
assert.ok(!JSON.stringify(rendered).includes('PRIVATE_STREAM'))
services.set('uiSession', { sessionStatus: { getSnapshot: () => new Map([['s1', { pendingInteraction: {} }]]) } })
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.equal(rendered, null, 'Pending approval keeps the official confirmation surface instead of the compact response')
services.delete('uiSession')
chat.legacy.nodes.push({ kind: 'assistant', blocks: [{ kind: 'text', text: 'FINAL_REPLY' }] }); chat.legacy.partial = null
running = false
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.equal(rendered, null, 'Completion restores the composer instead of retaining a response panel'); dispose()
// Deliverables remain backed by the official projection after moving to the side panel.
const delivery = { type: taskComponents.DeliverablesTab, props: { sessionId: 's1' } }
values.length = 0; cursor = 0; effects.length = 0
delivery.type(delivery.props); const disposeDelivery = effects.splice(0).map(fn => fn())
await new Promise(resolve => setImmediate(resolve)); cursor = 0
const deliveryTree = JSON.stringify(delivery.type(delivery.props))
assert.ok(deliveryTree.includes('delivery/test.nc')); assert.ok(deliveryTree.includes('report.md'))
assert.ok(deliveryTree.includes('nc_batch.zip')); assert.ok(deliveryTree.includes('不是放行结论'))
for (const dispose of disposeDelivery) dispose()
// Planning confirmation failures keep the typed answer and do not claim success.
values.length = 0; cursor = 0
const planningCalls = []
const planningRecord = { task: { answers: { stock: { value: '原有毛坯说明', resolved: false } } }, busy: false, act: async (action, args) => { planningCalls.push({ action, args }); throw Error('版本冲突') } }
let planningTree = taskComponents.TaskAnswer({ record: planningRecord, question: { id: 'stock', prompt: '毛坯' } })
planningTree.children.find(n => n?.type === 'textarea').props.onChange({ target: { value: '测试毛坯120×187×30.5' } })
cursor = 0; planningTree = taskComponents.TaskAnswer({ record: planningRecord, question: { id: 'stock', prompt: '毛坯' } })
await planningTree.props.onSubmit({ preventDefault() {} })
await new Promise(resolve => setImmediate(resolve))
cursor = 0; planningTree = taskComponents.TaskAnswer({ record: planningRecord, question: { id: 'stock', prompt: '毛坯' } })
assert.equal(planningCalls[0].args.resolved, true)
assert.equal(planningTree.children.find(n => n?.type === 'textarea').props.value, '测试毛坯120×187×30.5')
assert.ok(JSON.stringify(planningTree).includes('版本冲突'))
// Wizard choices save once, advance only after success and preserve unresolved decisions.
const findAll = (node, predicate) => {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, predicate))
  return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(child => findAll(child, predicate))]
}
let advanced = 0, answerCalls = [], rejectAnswer = false
const wizardRecord = { busy: false, task: { revision:1, inputs:{}, questions:[{id:'q1',prompt:'Only this question',recommendation:'Use this recommendation'}], answers:{input_pair:{resolved:true,value:'confirm'}}, review:{blockers:['Only this question'],fingerprint:'fp'} }, act: async (action,args) => { answerCalls.push({action,args}); if (rejectAnswer) throw Error('conflict') } }
const questionProps = { record:wizardRecord, question:wizardRecord.task.questions[0], draft:'My answer', setDraft:()=>{}, next:()=>advanced++ }
values.length = 0; cursor = 0
let choiceTree = taskComponents.WizardQuestion(questionProps)
let choices = findAll(choiceTree, n => n.type === 'button')
assert.equal(choices.length, 3)
await Promise.all([choices[0].props.onClick(), choices[0].props.onClick()])
assert.equal(answerCalls.length,1,'Repeated clicks while saving must not submit twice')
assert.equal(answerCalls.at(-1).args.value, 'Use this recommendation'); assert.equal(answerCalls.at(-1).args.resolved,true); assert.equal(advanced,1)
await choices[1].props.onClick()
assert.equal(answerCalls.at(-1).args.resolved,false); assert.equal(advanced,2)
rejectAnswer = true; await choices[0].props.onClick(); assert.equal(advanced,2, 'Failed persistence must not advance')
rejectAnswer = false
choices[2].props.onClick(); cursor = 0; choiceTree = taskComponents.WizardQuestion(questionProps)
await findAll(choiceTree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}})
await new Promise(resolve => setImmediate(resolve))
assert.equal(answerCalls.at(-1).args.value,'My answer'); assert.equal(advanced,3)
values.length=0;cursor=0
choiceTree=taskComponents.WizardQuestion({...questionProps,question:{id:'input_pair',prompt:'Pair?' }})
await findAll(choiceTree,n=>n.type==='button')[0].props.onClick()
assert.equal(answerCalls.at(-1).args.value,'confirm')
values.length=0;cursor=0
let wizardTree=taskComponents.TaskWizard({sessionId:'s1',record:wizardRecord,close(){},complete(){}})
assert.equal(findAll(wizardTree,n=>n.type===taskComponents.WizardQuestion).length,1,'Render one question, not the full list')
assert.equal(findAll(wizardTree,n=>n.type===taskComponents.WizardQuestion)[0].props.question.id,'q1','Resume at the first unresolved question')
const summaryButton=findAll(wizardTree,n=>n.type==='button'&&n.children.includes('汇总'))[0]
summaryButton.props.onClick();cursor=0
wizardTree=taskComponents.TaskWizard({sessionId:'s1',record:wizardRecord,close(){},complete(){}})
assert.equal(findAll(wizardTree,n=>n.type===taskComponents.WizardQuestion).length,0)
assert.equal(findAll(wizardTree,n=>n.children?.includes('完成确认'))[0].props.disabled,true,'Summary keeps unresolved confirmation blocked')
const confirmedRecord = {task:{goal:'DO_NOT_SHOW_GOAL',requirements:[{value:'DO_NOT_SHOW_RAW'}],answers:{},review_confirmation:{revision:1},requirement_summary:{status:'confirmed',confirmed:{items:[{id:'one',group:'material',text:'材料：SKD61'}]}}}}
const requirementTree=taskComponents.TaskRequirements({record:confirmedRecord})
assert.ok(!JSON.stringify(requirementTree).includes('DO_NOT_SHOW'))
assert.equal(findAll(requirementTree,n=>n.type==='button').length,0,'Requirements panel is read only')
const readonlyList=taskComponents.RequirementList({items:confirmedRecord.task.requirement_summary.confirmed.items})
assert.equal(findAll(readonlyList,n=>n.type==='input'||n.type==='button').length,0)
confirmedRecord.task.requirement_summary.status='stale'
assert.match(JSON.stringify(taskComponents.TaskRequirements({record:confirmedRecord})),/待重新确认/)
assert.ok(!JSON.stringify(taskComponents.TaskRequirements({record:confirmedRecord})).includes('SKD61'))
// Native reference append preserves user text and existing chips; no submit method exists in this fake.
const stage = tree.children[1].children[0].children[0].children[0]
const reference = { kind: 'faces', path: 'reference://part', source_sha256: 'a'.repeat(64), geometry_sha256: 'b'.repeat(64), fids: ['F000001'] }
state.draft = '原有问题 OTHER_CHIP'; state.occurrences = [{ source: 'file', ref: 'other', length: 10 }]
await stage.props.onReference(reference)
assert.equal(inserted.length, 1); assert.ok(state.draft.startsWith('原有问题 OTHER_CHIP'))
assert.equal(inserted[0].source, 'cam-selection'); assert.match(inserted[0].label, /F000001/)
await stage.props.onReference(reference); assert.equal(inserted.length, 1, 'Do not duplicate the same chip')
assert.ok(focusCount > 0)
state.phase = 'submitting'; await assert.rejects(stage.props.onReference(reference), /正在提交/); state.phase = 'plain'
const signal = new AbortController().signal
assert.match(await codec.codec.serialize(inserted[0].ref, signal), /CAM_SELECTION/)
validReference = false; await assert.rejects(codec.codec.serialize(inserted[0].ref, signal), /源模型已变更/); validReference = true
mounted = 's2'; await assert.rejects(codec.codec.serialize(inserted[0].ref, signal), /不属于当前会话/); mounted = 's1'
assert.equal(codec.openReference({ sessionId: 's2' }, { ref: inserted[0].ref }), false)
assert.equal(codec.openReference({ sessionId: 's1' }, { ref: inserted[0].ref }), true)
console.log('workbench selfcheck passed: real chat target shape, partial/final public text only, deliverables, native versioned chips, draft preservation, stale/cross-session refusal')

// Workflow actions submit through the native composer and preserve drafts/references.
running = false; state.phase = 'plain'; state.draft = ''; state.occurrences = []
const submissions = []
input.setDraft = text => { state.draft = text }
input.submit = (...args) => submissions.push(args)
taskComponents.submitWorkbenchRequest('s1', 'generate frozen NC')
assert.equal(state.draft, 'generate frozen NC')
assert.deepEqual(submissions[0], [undefined, 'click'])
assert.throws(() => taskComponents.submitWorkbenchRequest('s1', 'overwrite'), /未发送内容/)
assert.equal(state.draft, 'generate frozen NC')
state.draft = ''; state.occurrences = [{}]
assert.throws(() => taskComponents.submitWorkbenchRequest('s1', 'overwrite reference'), /未发送内容/)
state.occurrences = []; running = true
assert.throws(() => taskComponents.submitWorkbenchRequest('s1', 'duplicate'), /正在处理/)
assert.equal(submissions.length, 1)
