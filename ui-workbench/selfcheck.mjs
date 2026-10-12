// Client contract regressions using DSH 0.2 target('chat').legacy and the native reference/input facade.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const registrations = [], services = new Map(), effects = [], values = [], subscribers = new Set()
let cursor = 0, activeView = null, files = [{ name: 'part.prt' }], mounted = 's1', codec, validReference = true, focusCount = 0
const state = { draft: '', phase: 'plain', draftRev: 3, occurrences: [] }
const inserted = []
const input = {
  state: { getSnapshot: () => state }, focus: () => { focusCount++ },
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
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: initial => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next }] },
  useEffect: fn => effects.push(fn),
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
services.set('sessions', { binding: () => ({ ctx: {} }), scope: () => ({ get: () => ({ input: { for: () => input } }) }),
  list: { getSnapshot: () => ({ byId: { s1: { running: true } } }), subscribe: () => () => {} } })
services.set('uiConversation', { binding: () => ({
  snapshot: { getSnapshot() { throw new Error('The top-level binding snapshot is NOT a chat node array') } },
  target: name => { assert.equal(name, 'chat'); return source },
}) })
services.set('sidebarRight', { mounted: { getSnapshot: () => mounted }, active: () => undefined, isExpanded: () => false })
services.set('inputTriggers', { registerSource: definition => { codec = definition; return () => {} } })
async function load(file) {
  let plugin
  vm.runInNewContext(await fs.readFile(new URL(file, import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === 'react' ? React : { Button: 'button', Tooltip: 'tooltip', MarkdownText: 'markdown', IconGaugeOutlineRegular: 'icon' }) } } },
    Blob, URL, URLSearchParams, AbortController,
    fetch: async url => url.includes('/selection?')
      ? { ok: validReference, status: 409, json: async () => validReference ? { kind: 'faces', path: 'reference://part', source_sha256: 'a'.repeat(64), geometry_sha256: 'b'.repeat(64), fids: ['F000001'] } : { message: '源模型已变更' } }
      : { ok: true, json: async () => url.includes('/cam/runs?') ? { runs: [{ run_id: 'test-run', delivery: [{ name: 'nc_batch.zip', bytes: 100 }] }] } : { files } },
    setTimeout: () => 1, clearTimeout: () => {},
  })
  plugin.apply(ctx)
}
await load('../ui-preview/lib/client.js')
await load('./lib/client.js')
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
const tree = workbench.component({ sessionId: 's1' })
const agent = tree.children.at(-1)
values.length = 0; cursor = 0; effects.length = 0
agent.type(agent.props); const dispose = effects.shift()(); cursor = 0
let rendered = agent.type(agent.props)
assert.equal(rendered.children[1].props.open, false, 'Finished replies should not consume the canvas by default')
assert.ok(JSON.stringify(rendered).includes('PUBLIC_REPLY'))
assert.ok(!JSON.stringify(rendered).includes('PRIVATE_REASONING'))
chat = { ...chat, legacy: { nodes: chat.legacy.nodes, partial: { blocks: [{ kind: 'reasoning', text: 'PRIVATE_STREAM' }] } } }
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.equal(rendered.children[1].props.open, true, 'Expose public streaming text while generating')
assert.ok(JSON.stringify(rendered).includes('正在等待公开回复'))
assert.ok(!JSON.stringify(rendered).includes('PRIVATE_STREAM'))
assert.ok(!JSON.stringify(rendered).includes('PUBLIC_REPLY'), 'Do not present an old reply as this stream')
chat.legacy.partial.blocks.push({ kind: 'text', text: 'LIVE_DELTA' })
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.ok(JSON.stringify(rendered).includes('LIVE_DELTA'))
assert.ok(!JSON.stringify(rendered).includes('PRIVATE_STREAM'))
chat.legacy.nodes.push({ kind: 'assistant', blocks: [{ kind: 'text', text: 'FINAL_REPLY' }] }); chat.legacy.partial = null
for (const sync of subscribers) sync(); cursor = 0; rendered = agent.type(agent.props)
assert.equal(rendered.children[1].props.open, false)
assert.ok(JSON.stringify(rendered).includes('FINAL_REPLY')); dispose()
// Find the existing deliverables component through the left panel, using its actual target projection.
const left = tree.children[2].children[0].children[0]
values.length = 0; values[0] = 'deliverables'; cursor = 0
const tab = left.type(left.props), delivery = tab.children[1].children.find(node => node?.type?.name === 'DeliverablesTab')
values.length = 0; cursor = 0; effects.length = 0
delivery.type(delivery.props); const disposeDelivery = effects.splice(0).map(fn => fn())
await new Promise(resolve => setImmediate(resolve)); cursor = 0
const deliveryTree = JSON.stringify(delivery.type(delivery.props))
assert.ok(deliveryTree.includes('delivery/test.nc')); assert.ok(deliveryTree.includes('report.md'))
assert.ok(deliveryTree.includes('nc_batch.zip')); assert.ok(deliveryTree.includes('不是放行结论'))
for (const dispose of disposeDelivery) dispose()
// Native reference append preserves user text and existing chips; no submit method exists in this fake.
const stage = tree.children[2].children[1].children[0].children[0]
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
