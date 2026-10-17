// M4-01 task drawing slot: the new Preview is used and only the frozen task-input URI is opened.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
assert.equal(source.includes('h(DwgPane, { sessionId, record'), false, 'the drawing slot must not render the legacy DwgPane')
assert.ok(source.includes("hidden: mode !== 'drawing' }, Preview"), 'the drawing slot must render the shared Preview')
assert.ok(source.includes("mode === 'drawing' ? require('react-dom').createPortal"), 'the drawing slot keeps the workbench header integration')
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
