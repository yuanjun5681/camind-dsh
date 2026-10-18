// M4-01 task drawing slot: the new Preview is used and only the frozen task-input URI is opened.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
assert.equal(source.includes('h(DwgPane, { sessionId, record'), false, 'the drawing slot must not render the legacy DwgPane')
assert.ok(source.includes("hidden: mode !== 'drawing' }, Preview"), 'the drawing slot must render the shared Preview')
assert.ok(source.includes("mode === 'drawing' ? require('react-dom').createPortal"), 'the drawing slot keeps the workbench header integration')
assert.ok(source.includes("if (!refreshingTaskDrawing.current && (!initial || !readBenchPreference(sessionId).mode)) setMode('drawing')"), 'opening a drawing reference activates without forcing hidden refreshes or overwriting a saved mode')
assert.ok(source.includes('refreshingTaskDrawing.current = true'), 'task input changes must refresh the hidden drawing preview for invalidation')
assert.ok(source.includes('drawingReferenceController(sessionId).invalidateSource(previous)'), 'formal input URI/SHA changes must invalidate references even when conversion later fails')
assert.ok(source.includes("subscribe(sessionId, initial => { if (!initial || !readBenchPreference(sessionId).mode) setMode('preview') }, 'default')"), 'default preview producers activate only after explicit changes or without a saved mode')
assert.ok(source.includes('consumeActivation?.(sessionId)'), 'explicit preview activation must be honored once before later saved modes take precedence')
assert.ok(source.includes("activation.channel === 'default' ? 'preview' : activation.channel"), 'default activation must map to the rendered preview mode')
assert.ok(source.includes('const paneActive = active'), 'hidden stale panes must not invalidate newer verified references')
assert.ok(source.includes('drawingActive: mode ==='), 'pane activity must be passed explicitly from the workbench mode')
assert.ok(source.includes("hidden: mode !== 'preview' }, Preview"), 'default/content/run previews must have a visible workbench outlet')
assert.ok(source.includes('task?.inputs.dwg?.sha256])'), 'source SHA changes must retrigger the drawing preview effect')
assert.ok(source.includes('useDrawingReferenceQuestion(sessionId)'), 'composer controls must observe the new drawing-reference controller')
assert.ok(source.includes('[data-composer-chip="cam-drawing-ref"]'), 'composer clear action must recognize the migrated native chip')
assert.ok(source.includes('.cmv-stage, .cdv-canvas'), 'composer positioning must include the new drawing viewport')
assert.ok(source.includes("active?.source?.uri?.startsWith('task-input://')"), 'initial task load must also compare retained references with the frozen input')
const code = source.replace('exports.apply = apply', 'exports.__drawingTaskTest = { openTaskDrawingPreview, openTaskModelPreview }; exports.apply = apply')
let plugin
const previewCalls = []
const ctx = {
  slots: { inject: (_name, fn) => fn(), register: () => {} },
  effect: () => {},
  get(name) { return name === 'filePreview' ? { preview: (...args) => { previewCalls.push(args) } } : null },
}
const sandbox = {
  window: { __ModuleLoader__: { load(definition) { plugin = definition.factory(name => name === 'react' ? { createElement: () => ({}), Component: class {} } : {}) } } },
  URL, URLSearchParams, Blob, AbortController, setTimeout, clearTimeout,
}
vm.runInNewContext(code, sandbox)
plugin.apply(ctx)
const task = { inputs: { dwg: { uri: 'task-input://1/dwg', reference: 'original/user/path.dwg', sha256: '1'.repeat(64) } } }
plugin.__drawingTaskTest.openTaskDrawingPreview('s1', task)
const modelTask = { inputs: { prt: { uri: 'task-input://1/prt', sha256: '2'.repeat(64) } } }
plugin.__drawingTaskTest.openTaskModelPreview('s1', modelTask)
assert.deepEqual(previewCalls, [
  ['s1', 'task-input://1/dwg', 'drawing', '1'.repeat(64)],
  ['s1', 'task-input://1/prt', 'model', '2'.repeat(64)],
], 'each pane uses its own channel and source version; original paths must not be reparsed')
console.log('ok - drawing/model slots use independent preview channels and source versions')
