// M3-02 native DrawingReference: verify-before-insert, native codec re-verification,
// draft preservation, session isolation, openReference and content-mode read-only behavior.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { drawingReferences } from '../ui-drawing-viewer/src/adapter.ts'

const reference = {
  kind: 'camind-drawing-ref', version: 1, session: 's1',
  source: { uri: 'upload://batch/part.dxf', sha256: '1'.repeat(64), name: 'part.dxf' },
  pack: { sha256: '2'.repeat(64), identity: '3'.repeat(64) },
  target: { type: 'dim', id: 'dim-1' },
}
assert.deepEqual(drawingReferences({ name: 'part.dxf', packText: '{}' }, [{ type: 'entity', id: 0 }]), [], 'content mode cannot issue references')
assert.deepEqual(drawingReferences({
  name: 'part.dxf', packText: '{}', session: 's1', source: reference.source, pack: reference.pack,
}, [reference.target]), [reference], 'trusted descriptor produces the complete v1 contract')
console.log('ok - trusted descriptor contract and content-mode read-only')

let plugin, sourceDefinition, allow = true, mounted = 's1', deferred = null
const inserted = [], verifyCalls = [], previewCalls = [], events = []
let state = { draft: '问题', phase: 'plain', draftRev: 1, occurrences: [] }
const input = {
  state: { getSnapshot: () => state },
  focus: () => { events.push('focus') },
  insertReference(ref, span) {
    const expected = state.draft.length - state.occurrences.reduce((n, item) => n + item.length - 1, 0)
    assert.equal(span.start, expected)
    assert.equal(span.end, expected)
    assert.equal(span.draftRev, state.draftRev)
    events.push('insert')
    inserted.push(ref)
    state = {
      ...state,
      draft: `${state.draft}${ref.clipboardText} `,
      draftRev: state.draftRev + 1,
      occurrences: [...state.occurrences, { ...ref, length: ref.clipboardText.length }],
    }
    return true
  },
}
async function fetch(url, options = {}) {
  if (!url.includes('/refs/verify')) throw new Error(`unexpected fetch: ${url}`)
  const claimed = JSON.parse(options.body)
  verifyCalls.push({ claimed, signal: options.signal })
  events.push('verify')
  if (deferred) return deferred(claimed)
  return {
    ok: allow,
    json: async () => allow ? {
      reference: claimed,
      descriptor: {},
      targetContent: claimed.target.type === 'dim'
        ? { type: 'dim', id: claimed.target.id, displayText: 'Ø10 ±0.1' }
        : { type: 'entity', id: claimed.target.id, text: '备注' },
    } : { message: '图纸引用已失效' },
  }
}
const ctx = {
  slots: { inject: (_name, fn) => fn(), register: () => {} },
  effect: (fn, label) => { if (label?.includes('native drawing references')) fn() },
  get: name => {
    if (name === 'sessions') return { scope: () => ({ get: () => ({ input: { for: () => input } }) }) }
    if (name === 'sidebarRight') return { mounted: { getSnapshot: () => mounted } }
    if (name === 'inputTriggers') return { registerSource: definition => { sourceDefinition = definition; return () => {} } }
    if (name === 'filePreview') return { preview: (sessionId, uri) => { previewCalls.push([sessionId, uri]) } }
    return null
  },
}
const code = (await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8'))
  .replace('exports.apply = apply', 'exports.__drawingReferenceTest = { addDrawingReferenceToDraft, addPreviewReferenceToDraft }; exports.apply = apply')
vm.runInNewContext(code, {
  window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === 'react' ? { createElement: () => ({}), Component: class {} } : {}) } } },
  fetch, URLSearchParams, AbortController, Blob, URL, setTimeout, clearTimeout,
})
plugin.apply(ctx)
const api = plugin.__drawingReferenceTest
assert.ok(sourceDefinition)
assert.equal(sourceDefinition.name, 'cam-drawing-ref')

await api.addPreviewReferenceToDraft('s1', reference)
assert.equal(inserted.length, 1)
assert.deepEqual(events.filter(event => event === 'verify' || event === 'insert'), ['verify', 'insert'])
assert.equal(inserted[0].source, 'cam-drawing-ref')
assert.deepEqual(JSON.parse(inserted[0].ref), reference)
assert.match(inserted[0].label, /dim-1/)
assert.ok(state.draft.startsWith('问题'), 'existing draft must be preserved')
await api.addPreviewReferenceToDraft('s1', reference)
assert.equal(inserted.length, 1, 'identical verified reference is idempotent')
console.log('ok - verify-before-insert and native chip creation preserve drafts')

allow = false
await assert.rejects(api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 9 } }), /失效/)
assert.equal(inserted.length, 1, 'failed verification cannot insert a chip')
allow = true
const serialized = await sourceDefinition.codec.serialize(JSON.stringify(reference), new AbortController().signal)
assert.match(serialized, /CAM_DRAWING_REFERENCE/)
assert.match(serialized, /dim-1/)
assert.match(serialized, /Ø10 ±0.1/)
assert.ok(verifyCalls.every(call => call.signal === undefined || call.signal instanceof AbortSignal))
console.log('ok - native codec re-verifies before send and includes target content')

mounted = 's2'
const beforeWrongSession = verifyCalls.length
await assert.rejects(sourceDefinition.codec.serialize(JSON.stringify(reference), new AbortController().signal), /当前会话/)
assert.equal(verifyCalls.length, beforeWrongSession, 'wrong session is rejected before any verification or send')
mounted = 's1'
allow = false
await assert.rejects(sourceDefinition.codec.serialize(JSON.stringify(reference), new AbortController().signal), /失效/)
allow = true
console.log('ok - failed or cross-session verification cannot be sent')

assert.equal(sourceDefinition.openReference({ sessionId: 's2' }, { ref: JSON.stringify(reference) }), false)
assert.equal(sourceDefinition.openReference({ sessionId: 's1' }, { ref: JSON.stringify(reference) }), true)
assert.deepEqual(previewCalls, [['s1', reference.source.uri]])
console.log('ok - openReference returns to the authorized drawing preview')

state = { draft: '问题', phase: 'plain', draftRev: 1, occurrences: [] }
inserted.length = 0
const pending = new Map()
deferred = claimed => new Promise(resolve => {
  pending.set(claimed.target.id, () => resolve({
    ok: true,
    json: async () => ({ reference: claimed, targetContent: {} }),
  }))
})
const first = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 1 } })
const second = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 2 } })
pending.get(2)()
await second
pending.get(1)()
await first
assert.deepEqual(inserted.map(ref => JSON.parse(ref.ref).target.id), [2], 'an older verification cannot supersede the latest pick')
const third = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 3 } })
state = { ...state, draft: `${state.draft}新文字`, draftRev: state.draftRev + 1 }
pending.get(3)()
await third
assert.deepEqual(inserted.map(ref => JSON.parse(ref.ref).target.id), [2, 3])
assert.ok(state.draft.includes('新文字'), 'verification re-reads and preserves the latest draft snapshot')
deferred = null
console.log('ok - concurrent picks are sequenced and draft snapshots refresh after verification')
