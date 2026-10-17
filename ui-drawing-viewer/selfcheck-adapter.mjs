// M1-03 adapter and slot registration checks: content mode is read-only, references are
// candidates only (M2 still requires /refs/verify), and the built module registers the slot.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { stripTypeScriptTypes } from 'node:module'

const source = fs.readFileSync('ui-drawing-viewer/src/adapter.ts', 'utf8')
const adapter = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)
const base = {
  name: 'part.dwg', packText: '{"format":"camind-draft-pack"}',
  session: 's1',
  source: { uri: 'upload://batch/part.dwg', sha256: '1'.repeat(64), name: 'part.dwg' },
  pack: { sha256: '2'.repeat(64), identity: '3'.repeat(64) },
}
const refs = adapter.drawingReferences(base, [{ type: 'dim', id: 'D1' }, { type: 'entity', id: 7 }])
assert.equal(refs.length, 2)
assert.deepEqual(refs[0], {
  kind: 'camind-drawing-ref', version: 1, session: 's1',
  source: base.source, pack: base.pack, target: { type: 'dim', id: 'D1' },
})
adapter.validateDescriptor(base)
assert.equal(adapter.descriptorProvenance(base).session, 's1')

const content = { name: 'inline.dwg', packText: '{}' }
adapter.validateDescriptor(content)
assert.equal(adapter.descriptorProvenance(content), null)
assert.deepEqual(adapter.drawingReferences(content, [{ type: 'entity', id: 1 }]), [])
assert.throws(() => adapter.validateDescriptor({ ...base, pack: undefined }), /来源身份不完整/)
assert.throws(() => adapter.validateDescriptor({ ...base, name: '' }), /name/)
assert.throws(() => adapter.validateDescriptor({ ...base, packText: '' }), /packText/)
console.log('ok - descriptor provenance, content-mode read-only and reference candidates')

const code = fs.readFileSync('ui-drawing-viewer/lib/client.js', 'utf8')
let registration
const document = {
  createElement: () => ({ remove() {}, textContent: '' }),
  head: { append() {} },
}
vm.runInNewContext(code, {
  window: { __ModuleLoader__: { load(value) { registration = value } } },
  document,
})
assert.equal(registration.id, 'camind-ui-drawing-viewer')
const require = createRequire(new URL('../ui-shell/package.json', import.meta.url))
const client = registration.factory(require)
const registered = []
const ctx = {
  effect: (fn) => fn(),
  slots: {
    inject: (_name, cb) => cb(),
    register: (meta, component) => { registered.push({ meta, component }) },
  },
}
client.apply(ctx)
assert.equal(registered.length, 1)
assert.equal(registered[0].meta.name, 'cam.drawing.preview')
assert.equal(registered[0].meta.key, 'drawing-viewer')
assert.equal(registered[0].component, client.DrawingPreview)
console.log('ok - built module registers cam.drawing.preview/drawing-viewer')
