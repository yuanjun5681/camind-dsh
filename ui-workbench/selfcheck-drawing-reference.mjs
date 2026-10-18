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
const inserted = [], verifyCalls = [], previewCalls = [], events = [], disposers = [], submitCalls = []
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
  submit(...args) {
    submitCalls.push({ args, targets: state.occurrences.filter(item => item.source === 'cam-drawing-ref').map(item => JSON.parse(item.ref).target.id) })
  },
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
    if (name === 'filePreview') return { preview: (sessionId, uri, channel, version) => { previewCalls.push([sessionId, uri, channel, version]) } }
    return null
  },
}
const code = (await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8'))
  .replace('exports.apply = apply', 'exports.__drawingReferenceTest = { addDrawingReferenceToDraft, addPreviewReferenceToDraft, drawingReferenceController, selectLegacyDrawingReference }; exports.apply = apply')
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
api.addPreviewReferenceToDraft('s1', null, { ...reference, source: { ...reference.source, sha256: '9'.repeat(64) } })
assert.equal(state.occurrences.filter(item => item.source === 'cam-drawing-ref').length, 1, 'cleanup from another preview identity cannot remove the active chip')
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
assert.deepEqual(previewCalls, [['s1', reference.source.uri, 'default', reference.source.sha256]], 'generic drawing references open the rendered default channel')
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
  const flight = sourceDefinition.codec.serialize(ref, new AbortController().signal)
  publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
  const serialized = await flight
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
api.addPreviewReferenceToDraft('s1', null)
publish({ draft: 'old question', occurrences: [], attachmentIds: ['attachment-1'], phase: 'plain' })
const editing29 = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 29 } })
publish({ draft: 'question', attachmentIds: [] })
pending.get(29)()
assert.equal(await editing29, true, 'ordinary prefix editing and attachment removal cannot cancel a pending selection')
assert.deepEqual(ownedIds(), [29])
assert.ok(state.draft.startsWith('question'))
api.addPreviewReferenceToDraft('s1', null)
console.log('ok - ordinary edits are not submission boundaries')

const detached15 = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 15 } })
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
publishPending([{ requestId: 'request-detached-15', placement: 'transcript', time: 1, text: 'other', attachments: [] }])
pending.get(15)()
await detached15
assert.equal(ownedIds().includes(15), false, 'detached plain-phase send invalidates a pending old selection')
deferred = null
console.log('ok - optimistic reset closes the plain-phase submission boundary before any late echo')

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
const restoreDraft19 = state.draft, restoreOccurrences19 = state.occurrences
allow = false
const failed19 = sourceDefinition.codec.serialize(ref19, new AbortController().signal)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
await assert.rejects(failed19, /失效/)
allow = true
publish({ draft: restoreDraft19, occurrences: restoreOccurrences19, attachmentIds: [], phase: 'plain' })
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
publishAdmitted([{ kind: 'user', turn: 8 }])
await tick()
assert.equal(ownedIds().includes(19), false, 'failed serialization must not arm retained handoff when the restored chip is later removed')
console.log('ok - serialization failure cancels provisional handoff')

const ref20 = await selectId(20)
let codec20 = true, release20
deferred = claimed => {
  if (claimed.target.id === 20 && codec20) {
    return new Promise(resolve => {
      release20 = () => {
        codec20 = false; deferred = null
        resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) })
      }
    })
  }
  return { ok: true, json: async () => ({ reference: claimed, targetContent: {} }) }
}
const flight20 = sourceDefinition.codec.serialize(ref20, new AbortController().signal)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
const beforeFollowUp20 = inserted.length
publish({ draft: '核验期间的追问 ', occurrences: [], attachmentIds: [], phase: 'plain' })
await tick()
assert.equal(ownedIds().includes(20), false, 'provisional handoff must not reattach before serialization succeeds')
assert.equal(inserted.length, beforeFollowUp20)
release20()
const sent20 = await flight20
publishPending([{ requestId: 'request-20', placement: 'transcript', time: 1, text: 'sent', attachments: [] }])
await tick()
assert.deepEqual(ownedIds(), [20], 'confirmation releases the retained object into the follow-up draft')
assert.ok(state.draft.startsWith('核验期间的追问 '))
assert.match(sent20, /"id":20/)
console.log('ok - provisional handoff waits for serialization confirmation')

const ref21 = await selectId(21)
const releases = new Map()
deferred = claimed => new Promise(resolve => {
  releases.set(claimed.target.id, () => {
    if (claimed.target.id === 21) deferred = null
    resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) })
  })
})
const flight21 = sourceDefinition.codec.serialize(ref21, new AbortController().signal)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
const select22 = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 22 } })
releases.get(21)()
const sent21 = await flight21
publishPending([{ requestId: 'request-21', placement: 'transcript', time: 1, text: 'sent', attachments: [] }])
assert.equal(ownedIds().includes(22), false, 'the post-clear selection is still being verified')
releases.get(22)()
assert.equal(await select22, true, 'a late submission echo cannot cancel a selection made after the optimistic reset')
publishAdmitted([{ kind: 'user', turn: 9 }])
await tick()
assert.deepEqual(ownedIds(), [22], 'the earlier request cannot reattach over the post-clear selection')
assert.match(sent21, /"id":21/)
console.log('ok - selection invalidation happens at optimistic reset, not late submission echo')

const ref23 = await selectId(23)
let rejectFirst23
deferred = () => new Promise((_, reject) => { rejectFirst23 = reject })
const flight23A = sourceDefinition.codec.serialize(ref23, new AbortController().signal)
const rejected23A = assert.rejects(flight23A, /旧序列化失败/)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
deferred = null
await selectId(23)
let resolveSecond23
deferred = claimed => new Promise(resolve => {
  resolveSecond23 = () => {
    deferred = null
    resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) })
  }
})
const flight23B = sourceDefinition.codec.serialize(ref23, new AbortController().signal)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
rejectFirst23(new Error('旧序列化失败'))
await rejected23A
publish({ draft: '第二个请求的追问 ', occurrences: [], attachmentIds: [], phase: 'plain' })
await tick()
assert.equal(ownedIds().includes(23), false, 'the newer serialization remains provisional')
resolveSecond23()
const sent23 = await flight23B
publishPending([{ requestId: 'request-23-b', placement: 'transcript', time: 1, text: 'sent', attachments: [] }])
await tick()
assert.deepEqual(ownedIds(), [23], 'an older failure cannot cancel the newer attempt with the same reference')
assert.ok(state.draft.startsWith('第二个请求的追问 '))
assert.match(sent23, /"id":23/)
console.log('ok - handoff settlement is isolated by serialization attempt')

const ref24 = await selectId(24)
let codec24 = true, release24
deferred = claimed => {
  if (claimed.target.id === 24 && codec24) {
    return new Promise(resolve => {
      release24 = () => {
        codec24 = false; deferred = null
        resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) })
      }
    })
  }
  return { ok: true, json: async () => ({ reference: claimed, targetContent: {} }) }
}
const flight24 = sourceDefinition.codec.serialize(ref24, new AbortController().signal)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
publish({ draft: '快速追问必须带上当前对象 ', occurrences: [], attachmentIds: [], phase: 'plain' })
input.submit('queue', 'click')
assert.equal(submitCalls.length, 0, 'rapid follow-up submit must wait for retained verification')
release24()
const sent24 = await flight24
publishPending([{ requestId: 'request-24', placement: 'transcript', time: 1, text: 'sent', attachments: [] }])
await tick()
assert.equal(submitCalls.length, 1)
assert.deepEqual(submitCalls[0].targets, [24], 'the deferred follow-up snapshot contains the verified retained object')
assert.match(sent24, /"id":24/)
console.log('ok - rapid follow-up submit waits for a verified reference')

const ref25 = await selectId(25)
await serializeAndClear(ref25, 'request-25')
let resolve25
deferred = claimed => new Promise(resolve => {
  resolve25 = () => {
    deferred = null
    resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) })
  }
})
publishAdmitted([{ kind: 'user', turn: 10 }])
deferred = null
const ref26 = await selectId(26)
await serializeAndClear(ref26, 'request-26')
publishAdmitted([{ kind: 'user', turn: 11 }])
publish({ draft: 'B 的追问 ', occurrences: [], attachmentIds: [], phase: 'plain' })
input.submit('queue', 'click')
assert.equal(submitCalls.length, 1, 'B cannot submit while an obsolete flight blocks its handoff')
resolve25()
await tick(); await tick()
assert.deepEqual(ownedIds(), [26], 'an obsolete flight retries the current handoff after settling')
assert.equal(submitCalls.length, 2)
assert.deepEqual(submitCalls.at(-1).targets, [26], 'the retried handoff is present in the follow-up submission')
console.log('ok - obsolete handoff completion retries the current reference before submit')

const ref27 = await selectId(27)
allow = false
const failed27 = sourceDefinition.codec.serialize(ref27, new AbortController().signal)
const rejected27 = assert.rejects(failed27, /失效/)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
publish({ draft: '核验失败时等待的追问 ', occurrences: [], attachmentIds: [], phase: 'plain' })
input.submit('queue', 'click')
await rejected27
allow = true
await tick()
assert.equal(submitCalls.length, 2, 'verification failure must reject rather than release a deferred submission')
console.log('ok - deferred submit is rejected on verification failure')

const ref28 = await selectId(28)
let codec28 = true, release28
deferred = claimed => {
  if (claimed.target.id === 28 && codec28) {
    return new Promise(resolve => {
      release28 = () => {
        codec28 = false; deferred = null
        resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) })
      }
    })
  }
  return { ok: true, json: async () => ({ reference: claimed, targetContent: {} }) }
}
const flight28 = sourceDefinition.codec.serialize(ref28, new AbortController().signal)
publish({ draft: '', occurrences: [], attachmentIds: [], phase: 'plain' })
publish({ draft: '提交时的原始问题 ', occurrences: [], attachmentIds: [], phase: 'plain' })
input.submit('queue', 'click')
publish({ draft: '等待期间被改写的问题 ', occurrences: [], attachmentIds: [], phase: 'plain' })
release28()
const sent28 = await flight28
publishPending([{ requestId: 'request-28', placement: 'transcript', time: 1, text: 'sent', attachments: [] }])
await tick()
assert.equal(submitCalls.length, 2, 'editing the draft after Enter cancels the deferred submission')
assert.deepEqual(ownedIds(), [28], 'handoff may finish, but the changed submission is not sent')
assert.match(sent28, /"id":28/)
console.log('ok - deferred submit is cancelled when its draft changes')

const ref31 = await selectId(31)
await serializeAndClear(ref31, 'request-31')
let resolve31
deferred = claimed => new Promise(resolve => {
  resolve31 = () => {
    deferred = null
    resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) })
  }
})
publishAdmitted([{ kind: 'user', turn: 12 }])
mounted = 's2'
resolve31()
await tick(); await tick()
mounted = 's1'
publish({ draft: '返回后的追问 ', occurrences: [], attachmentIds: [], phase: 'plain' })
const before31 = submitCalls.length
input.submit('queue', 'click')
await tick(); await tick()
assert.deepEqual(ownedIds(), [31], 'returning to the session restarts a skipped reattachment')
assert.equal(submitCalls.length, before31 + 1)
assert.deepEqual(submitCalls.at(-1).targets, [31])
console.log('ok - session reactivation restarts retained reattachment')

const otherReference = { ...reference, source: { ...reference.source, sha256: '9'.repeat(64) } }
await api.addPreviewReferenceToDraft('s1', otherReference)
deferred = claimed => new Promise(resolve => {
  pending.set(claimed.target.id, () => resolve({ ok: true, json: async () => ({ reference: claimed, targetContent: {} }) }))
})
const pending30 = api.addPreviewReferenceToDraft('s1', { ...reference, target: { type: 'entity', id: 30 } })
api.addPreviewReferenceToDraft('s1', null, reference)
pending.get(30)()
await pending30
assert.equal(ownedIds().includes(30), false, 'cleanup cancels only the pending selection from that preview identity')
assert.deepEqual(state.occurrences.filter(item => item.source === 'cam-drawing-ref').map(item => JSON.parse(item.ref).source.sha256), ['9'.repeat(64)], 'cleanup cannot remove a different active preview reference')
deferred = null
console.log('ok - preview cleanup is scoped to its source and pack identity')

api.addPreviewReferenceToDraft('s1', null, otherReference, 'dispose')
assert.equal(state.occurrences.filter(item => item.source === 'cam-drawing-ref').length, 1, 'ordinary preview disposal preserves the committed chip')
api.addPreviewReferenceToDraft('s1', null, otherReference, 'invalidate')
assert.equal(state.occurrences.filter(item => item.source === 'cam-drawing-ref').length, 0, 'source or pack invalidation consumes the old chip')
console.log('ok - disposal and invalidation have distinct reference semantics')

await api.addPreviewReferenceToDraft('s1', otherReference)
api.drawingReferenceController('s1').invalidateSource(otherReference.source)
assert.equal(state.occurrences.filter(item => item.source === 'cam-drawing-ref').length, 0, 'formal source changes invalidate by URI and SHA even without the old pack')
console.log('ok - formal source invalidation does not depend on a successful conversion')

// M5-01: the rollback pane reaches this same controller and /refs/verify path.
const legacyDescriptor = {
  session: 's1', source: reference.source, pack: reference.pack,
  packText: JSON.stringify({
    source_sha256: reference.source.sha256,
    dims: [{ id: 'dim-1', display_text: 'Ø10 ±0.1', entity_ids: [200] }],
    entities: [{ id: 7, type: 'mtext', text: '备注', handle: 'A' }],
  }),
}
const legacyPack = JSON.parse(legacyDescriptor.packText)
const legacyData = { source_sha256: reference.source.sha256, preview_sha256: '5'.repeat(64) }
const legacyDim = { id: 'd:0', kind: 'dimension', source_id: 'dim-1', text: 'Ø10 ±0.1', entity_ids: [200] }
const legacyEntity = { id: 't:7', kind: 'text', source_id: 'A', text: '备注', entity_ids: [7] }
publish({ draft: '旧面板问题 ', occurrences: [], attachmentIds: [], phase: 'plain' })
deferred = null; allow = true; mounted = 's1'
const legacySelected = await api.selectLegacyDrawingReference(api.drawingReferenceController('s1'), 's1', legacyData, legacyDescriptor, legacyPack, legacyDim)
assert.equal(legacySelected.ok, true)
assert.deepEqual(ownedIds(), ['dim-1'])
assert.equal(verifyCalls.at(-1).claimed.kind, 'camind-drawing-ref')
const beforeLegacyFailure = inserted.length
allow = false
await assert.rejects(api.selectLegacyDrawingReference(api.drawingReferenceController('s1'), 's1', legacyData, legacyDescriptor, legacyPack, legacyEntity), /失效/)
assert.equal(inserted.length, beforeLegacyFailure, 'legacy verify failure cannot insert or replace a chip')
assert.deepEqual(ownedIds(), ['dim-1'], 'legacy verify failure leaves the previously verified chip untouched')
allow = true
api.addPreviewReferenceToDraft('s1', null, legacyDescriptor, 'dispose')
assert.deepEqual(ownedIds(), ['dim-1'], 'leaving the legacy pane does not invalidate an unchanged reference')
api.addPreviewReferenceToDraft('s1', null, legacyDescriptor, 'invalidate')
assert.deepEqual(ownedIds(), [], 'legacy source/pack/identity replacement invalidates the old chip')
console.log('ok - legacy pane uses real verify-before-insert and pack invalidation semantics')

api.addPreviewReferenceToDraft('s1', null)
for (const dispose of disposers) dispose()
assert.equal(stateListeners.size, 0)
assert.equal(submissionListeners.size, 0)
assert.equal(admittedListeners.size, 0)
console.log('M4-04 drawing reference handoff selfcheck complete')
