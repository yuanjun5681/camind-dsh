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
const inserted = [], verifyCalls = [], previewCalls = [], events = [], disposers = []
let state = { draft: '问题', phase: 'plain', draftRev: 1, occurrences: [], attachmentIds: [] }
const stateListeners = new Set(), submissionListeners = new Set(), admittedListeners = new Set()
let submissionSnapshot = { pendingSubmissions: [] }, admittedSnapshot = { legacy: { nodes: [] } }
const submissionFace = {
  getSnapshot: () => submissionSnapshot,
  subscribe: listener => { submissionListeners.add(listener); return () => submissionListeners.delete(listener) },
}
const admittedFace = {
  getSnapshot: () => admittedSnapshot,
  subscribe: listener => { admittedListeners.add(listener); return () => admittedListeners.delete(listener) },
}
const input = {
  state: {
    getSnapshot: () => state,
    subscribe: listener => { stateListeners.add(listener); return () => stateListeners.delete(listener) },
  },
  focus: () => { events.push('focus') },
  notify: () => { events.push('notify') },
  insertReference(ref, span) {
    assert.equal(span.draftRev, state.draftRev)
    events.push('insert')
    inserted.push(ref)
    const ownedIndex = state.occurrences.findIndex(item => item.source === 'cam-drawing-ref')
    if (ownedIndex >= 0) {
      const previous = state.occurrences[ownedIndex]
      const before = state.occurrences.filter(item => item.offset < previous.offset)
      const expectedStart = previous.offset - before.reduce((sum, item) => sum + item.length - 1, 0)
      assert.equal(span.start, expectedStart)
      assert.equal(span.end, expectedStart + 1)
      const occurrences = [...state.occurrences]
      occurrences[ownedIndex] = { ...ref, offset: previous.offset, length: ref.clipboardText.length }
      state = { ...state, occurrences, draftRev: state.draftRev + 1 }
      return true
    }
    const expected = state.draft.length - state.occurrences.reduce((n, item) => n + item.length - 1, 0)
    assert.equal(span.start, expected)
    assert.equal(span.end, expected)
    state = {
      ...state,
      draft: `${state.draft}${ref.clipboardText} `,
      draftRev: state.draftRev + 1,
      occurrences: [...state.occurrences, { ...ref, offset: state.draft.length, length: ref.clipboardText.length }],
    }
    return true
  },
}
function publish(patch) {
  state = { ...state, ...patch, draftRev: state.draftRev + 1 }
  for (const listener of stateListeners) listener()
}
function publishPending(pendingSubmissions) {
  submissionSnapshot = { pendingSubmissions }
  for (const listener of submissionListeners) listener()
}
function publishAdmitted(nodes) {
  admittedSnapshot = { legacy: { nodes } }
  for (const listener of admittedListeners) listener()
}
const tick = () => new Promise(resolve => setImmediate(resolve))
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
  effect: (fn, label) => {
    if (!label?.includes('native drawing references') && !label?.includes('drawing questions')) return
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
  },
  get: name => {
    if (name === 'sessions') return {
      binding: () => ({ session: submissionFace }),
      scope: () => ({
        get: () => ({ input: { for: () => input } }),
        bail: (_token, { guard }) => {
          const owned = state.occurrences.filter(item => item.source === 'cam-drawing-ref')
          if (!owned.length) return false
          const previous = owned[0]
          const before = state.occurrences.filter(item => item.offset < previous.offset)
          const expectedStart = previous.offset - before.reduce((sum, item) => sum + item.length - 1, 0)
          assert.equal(guard.span.start, expectedStart)
          assert.equal(guard.span.end, expectedStart + 1)
          assert.equal(guard.span.draftRev, state.draftRev)
          state = { ...state, occurrences: state.occurrences.filter(item => item !== previous), draftRev: state.draftRev + 1 }
          return true
        },
      }),
    }
    if (name === 'uiConversation') return { binding: () => ({ target: () => admittedFace }) }
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

state = {
  draft: '问题[FILE]', phase: 'plain', draftRev: 1,
  occurrences: [{ source: 'file', ref: 'manual', label: 'keep', clipboardText: '[FILE]', offset: 2, length: 6 }],
}
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
assert.deepEqual(state.occurrences.filter(item => item.source === 'cam-drawing-ref').map(item => JSON.parse(item.ref).target.id), [2], 'an older verification cannot supersede the latest pick')
const third = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 3 } })
state = { ...state, draft: `${state.draft}新文字`, draftRev: state.draftRev + 1 }
pending.get(3)()
await third
assert.deepEqual(inserted.map(ref => JSON.parse(ref.ref).target.id), [2, 3])
assert.deepEqual(state.occurrences.filter(item => item.source === 'cam-drawing-ref').map(item => JSON.parse(item.ref).target.id), [3], 'a new pick replaces the owned occurrence')
assert.equal(state.occurrences[0].source, 'file', 'unrelated references are preserved during replacement')
assert.ok(state.draft.includes('新文字'), 'verification re-reads and preserves the latest draft snapshot')
deferred = null
console.log('ok - concurrent picks replace one owned occurrence and preserve unrelated content')

deferred = claimed => new Promise(resolve => {
  pending.set(claimed.target.id, () => resolve({
    ok: true,
    json: async () => ({ reference: claimed, targetContent: {} }),
  }))
})
const fourth = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 4 } })
publish({ phase: 'submitting' })
publish({ phase: 'plain', draft: '新问题' })
pending.get(4)()
await fourth
assert.deepEqual(inserted.map(ref => JSON.parse(ref.ref).target.id), [2, 3], 'a pending pick cannot cross a submit/reset boundary into a new question')
assert.equal(stateListeners.size, 1, 'one persistent controller subscription remains for send handoff')
console.log('ok - pending references are discarded across submit/reset boundaries')

const fifth = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 5 } })
api.addPreviewReferenceToDraft('s1', null)
pending.get(5)()
await fifth
assert.deepEqual(inserted.map(ref => JSON.parse(ref.ref).target.id), [2, 3], 'deselection invalidates a pending verification')
deferred = null
console.log('ok - deselection or source invalidation cancels pending insertions')

deferred = claimed => {
  if (claimed.target.id === 6) return Promise.reject(new Error('旧引用失效'))
  return new Promise(resolve => {
    pending.set(claimed.target.id, () => resolve({
      ok: true,
      json: async () => ({ reference: claimed, targetContent: {} }),
    }))
  })
}
const sixth = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 6 } })
const seventh = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 7 } })
pending.get(7)()
await seventh
await sixth
assert.deepEqual(state.occurrences.filter(item => item.source === 'cam-drawing-ref').map(item => JSON.parse(item.ref).target.id), [7], 'superseded verification failures cannot overwrite the current selection')
deferred = null
console.log('ok - superseded verification failures are suppressed')

api.addPreviewReferenceToDraft('s1', null)
assert.equal(state.occurrences.some(item => item.source === 'cam-drawing-ref'), false, 'source invalidation removes the stale chip')
assert.equal(state.occurrences[0].source, 'file', 'unrelated references survive chip invalidation')
assert.ok(state.draft.includes('新问题'), 'question text survives chip invalidation')
console.log('ok - source invalidation consumes stale chips without deleting question content')

state = { draft: '', phase: 'plain', draftRev: 100, occurrences: [], attachmentIds: [] }
inserted.length = 0
deferred = null; allow = true; mounted = 's1'
const ownedIds = () => state.occurrences.filter(item => item.source === 'cam-drawing-ref').map(item => JSON.parse(item.ref).target.id)
async function selectId(id) {
  const candidate = { ...reference, target: { type: 'entity', id } }
  assert.equal(await api.addPreviewReferenceToDraft('s1', candidate), true)
  return JSON.stringify(candidate)
}
async function serializeAndClear(ref, requestId) {
  const serialized = await sourceDefinition.codec.serialize(ref, new AbortController().signal)
  publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
  publishPending([{ requestId, placement: 'transcript', time: 1, text: 'sent', attachments: [] }])
  return serialized
}

const ref10 = await selectId(10)
const afterSelect10 = inserted.length
const sent10 = await serializeAndClear(ref10, 'request-10')
assert.deepEqual(ownedIds(), [])
publishAdmitted([{ kind: 'user', turn: 1 }])
await tick()
assert.deepEqual(ownedIds(), [10], 'admission reattaches the current object exactly once')
assert.equal(inserted.length, afterSelect10 + 1)
assert.equal(verifyCalls.filter(call => call.claimed.target.id === 10).length, 3, 'select, send and readmission each verify independently')
const afterAdmission10 = inserted.length
publishAdmitted([{ kind: 'user', turn: 1 }])
await tick()
assert.equal(inserted.length, afterAdmission10, 'duplicate admission cannot duplicate the chip')
assert.match(sent10, /"id":10/)
console.log('ok - immutable send snapshot and verified admission reattach')

const ref11 = await selectId(11)
const sent11 = await serializeAndClear(ref11, 'request-11')
publish({ draft: '追问：保留这段文字 ', occurrences: [], attachmentIds: [], phase: 'plain' })
await tick()
assert.deepEqual(ownedIds(), [11], 'typing a follow-up before admission admits the retained object early')
assert.ok(state.draft.startsWith('追问：保留这段文字 '), 'early reattach preserves the new question text')
const afterEarly11 = inserted.length
publishAdmitted([{ kind: 'user', turn: 2 }])
await tick()
assert.equal(inserted.length, afterEarly11, 'later admission cannot attach a second copy')
assert.match(sent11, /"id":11/)
console.log('ok - early follow-up reattach preserves text and admits once')

const ref12 = await selectId(12)
const sent12 = await serializeAndClear(ref12, 'request-12')
await selectId(13)
publishAdmitted([{ kind: 'user', turn: 3 }])
await tick()
assert.deepEqual(ownedIds(), [13], 'a later pick supersedes the sent object before admission')
assert.match(sent12, /"id":12/)
assert.equal(sent12.includes('"id":13'), false, 'the earlier send snapshot is not rewritten by a later pick')
console.log('ok - late selection cannot rewrite an in-flight request')

const ref14 = await selectId(14)
const restoredDraft = state.draft, restoredOccurrences = state.occurrences
const sent14 = await serializeAndClear(ref14, 'request-14')
publishPending([])
const beforeRestore14 = inserted.length
publish({ draft: restoredDraft, occurrences: restoredOccurrences, attachmentIds: [], phase: 'plain' })
publishAdmitted([{ kind: 'user', turn: 4 }])
await tick()
assert.deepEqual(ownedIds(), [14])
assert.equal(inserted.length, beforeRestore14, 'native failure restoration must not add another chip')
assert.match(sent14, /"id":14/)
console.log('ok - failed-send snapshot restore does not duplicate references')

deferred = claimed => new Promise(resolve => {
  pending.set(claimed.target.id, () => resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) }))
})
const detached15 = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 15 } })
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
publishPending([{ requestId: 'request-detached-15', placement: 'transcript', time: 1, text: 'other', attachments: [] }])
pending.get(15)()
await detached15
assert.equal(ownedIds().includes(15), false, 'detached plain-phase send invalidates a pending old selection')
deferred = null
console.log('ok - pendingSubmissions closes the plain-phase submission boundary')

const ref16 = await selectId(16)
await serializeAndClear(ref16, 'request-16')
api.addPreviewReferenceToDraft('s1', null)
publishAdmitted([{ kind: 'user', turn: 5 }])
await tick()
assert.equal(ownedIds().includes(16), false, 'clearing selection before admission cancels retained handoff')
const ref17 = await selectId(17)
await serializeAndClear(ref17, 'request-17')
mounted = 's2'
api.addPreviewReferenceToDraft('s1', null)
publishAdmitted([{ kind: 'user', turn: 6 }])
await tick()
assert.equal(ownedIds().includes(17), false, 'session navigation invalidation prevents stale readmission')
mounted = 's1'
console.log('ok - clear and session invalidation cancel retained handoff')

const ref18 = await selectId(18)
await serializeAndClear(ref18, 'request-18')
allow = false
publishAdmitted([{ kind: 'user', turn: 7 }])
await tick()
assert.equal(ownedIds().includes(18), false, 'failed readmission verification cannot restore a chip')
allow = true
console.log('ok - readmission remains fail-closed')

const ref19 = await selectId(19)
allow = false
await assert.rejects(sourceDefinition.codec.serialize(ref19, new AbortController().signal), /失效/)
allow = true
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
publishAdmitted([{ kind: 'user', turn: 8 }])
await tick()
assert.equal(ownedIds().includes(19), false, 'failed serialization must not arm retained handoff when the restored chip is later removed')
console.log('ok - serialization failure does not arm retained handoff')

api.addPreviewReferenceToDraft('s1', null)
for (const dispose of disposers) dispose()
assert.equal(stateListeners.size, 0)
assert.equal(submissionListeners.size, 0)
assert.equal(admittedListeners.size, 0)
console.log('M4-04 drawing reference handoff selfcheck complete')
