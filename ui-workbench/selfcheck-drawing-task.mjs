// M4-01 task drawing slot: the new Preview is used and only the frozen task-input URI is opened.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
assert.equal(source.includes('h(DwgPane, { sessionId, record'), false, 'the drawing slot must not render the legacy DwgPane')
assert.ok(source.includes("hidden: mode !== 'drawing' }, Preview"), 'the drawing slot must render the shared Preview')
assert.ok(source.includes("mode === 'drawing' ? require('react-dom').createPortal"), 'the drawing slot keeps the workbench header integration')
const code = source.replace('exports.apply = apply', 'exports.__drawingTaskTest = { openTaskDrawingPreview }; exports.apply = apply')
let plugin
const previewCalls = []
const ctx = {
  slots: { inject: (_name, fn) => fn(), register: () => {} },
  effect: () => {},
  get(name) { return name === 'filePreview' ? { preview: (sessionId, uri) => { previewCalls.push([sessionId, uri]) } } : null },
}
const sandbox = {
  window: { __ModuleLoader__: { load(definition) { plugin = definition.factory(name => name === 'react' ? { createElement: () => ({}), Component: class {} } : {}) } } },
  URL, URLSearchParams, Blob, AbortController, setTimeout, clearTimeout,
}
vm.runInNewContext(code, sandbox)
plugin.apply(ctx)
const task = { inputs: { dwg: { uri: 'task-input://1/dwg', reference: 'original/user/path.dwg', sha256: '1'.repeat(64) } } }
plugin.__drawingTaskTest.openTaskDrawingPreview('s1', task)
assert.deepEqual(previewCalls, [['s1', 'task-input://1/dwg']], 'the frozen task-input URI is mandatory; the original path must not be reparsed')
console.log('ok - drawing slot uses the new Preview and only the frozen task-input URI')
