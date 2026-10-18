// M4-01 preview targets: model/drawing channels are independent and source versions invalidate targets.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
assert.ok(source.includes('[path, sessionId, version]'), 'source version must participate in file-preview reloads')
let plugin, filePreview
const ctx = {
  slots: { inject: (_name, fn) => fn(), register: () => {}, entriesOfSlot: () => [] },
  effect: () => {},
  get: () => null,
  provide: (name, value) => { if (name === 'filePreview') filePreview = value },
}
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === 'react' ? { createElement: () => ({}), useSyncExternalStore: () => ({}) } : {}) } } },
  URL, URLSearchParams, Blob, AbortController, setTimeout, clearTimeout,
})
plugin.apply(ctx)
let modelEvents = 0, drawingEvents = 0
filePreview.subscribe('s1', () => { modelEvents++ }, 'model')
filePreview.subscribe('s1', () => { drawingEvents++ }, 'drawing')
filePreview.preview('s1', 'part.prt', 'model', 'a'.repeat(64))
filePreview.preview('s1', 'task-input://1/dwg', 'drawing', 'b'.repeat(64))
assert.deepEqual([modelEvents, drawingEvents], [1, 1], 'channels receive independent target publications')
let modelReplay = 0, drawingReplay = 0
filePreview.subscribe('s1', () => { modelReplay++ }, 'model')
filePreview.subscribe('s1', () => { drawingReplay++ }, 'drawing')
assert.deepEqual([modelReplay, drawingReplay], [1, 1], 'mounting a subscriber replays the current channel target')
assert.equal(filePreview.consumeActivation('s1').channel, 'drawing', 'an explicit activation is consumable once by a mounting workbench')
assert.equal(filePreview.consumeActivation('s1'), undefined, 'the same activation cannot override later saved modes')
filePreview.preview('s1', 'task-input://1/dwg', 'drawing', 'c'.repeat(64))
assert.deepEqual([modelEvents, drawingEvents], [1, 2], 'same URI with a new source SHA is a new preview target')
console.log('ok - model/drawing preview channels and source-version invalidation')
