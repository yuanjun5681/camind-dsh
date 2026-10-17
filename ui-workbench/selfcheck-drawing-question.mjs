// Native span/occurrence regression for the single drawing-question owner.
// Models the upstream clipboard offsets versus one-character detect spans, without replacing drafts.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
let createController
const code = (await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8')).replace('exports.apply = apply', 'exports.createDrawingQuestionController = createDrawingQuestionController; exports.apply = apply')
vm.runInNewContext(code, { window: { __ModuleLoader__: { load: definition => {
  createController = definition.factory(name => name === 'react' ? { Component: class {} } : {}).createDrawingQuestionController
} } } })

function harness(validate = async reference => ({ ...reference, entities: [{ id: reference.ids[0], text: reference.ids[0] }] })) {
  let atoms = [], phase = 'plain', revision = 0, current = true, nodes = [], snapshot
  const listeners = new Set(), admittedListeners = new Set(), attachments = ['keep-attachment'], notices = []
  const emit = () => {
    let offset = 0; const occurrences = []
    for (const atom of atoms) {
      if (typeof atom !== 'string') occurrences.push({ ...atom, offset, length: atom.clipboardText.length })
      offset += typeof atom === 'string' ? atom.length : atom.clipboardText.length
    }
    snapshot = { draft: atoms.map(atom => typeof atom === 'string' ? atom : atom.clipboardText).join(''), occurrences, phase, draftRev: ++revision, attachmentIds: attachments }
    for (const listener of listeners) listener()
  }
  const input = { state: { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }, focus: () => {}, notify: (_level, text) => notices.push(text),
    insertReference(ref, span) {
      assert.equal(span.draftRev, snapshot.draftRev)
      assert.equal(phase, 'plain')
      const tail = atoms[span.end]
      atoms.splice(span.start, span.end - span.start, ref, ...(tail === ' ' ? [] : [' ']))
      emit(); return true
    },
  }
  emit()
  const controller = createController({ input, validate, isCurrent: () => current,
    consume: span => { assert.equal(span.draftRev, snapshot.draftRev); atoms.splice(span.start, span.end - span.start); emit(); return true },
    admitted: { getSnapshot: () => ({ legacy: { nodes } }), subscribe: fn => { admittedListeners.add(fn); return () => admittedListeners.delete(fn) } },
  })
  return { controller, input, attachments, notices, snapshot: () => snapshot, atoms: () => [...atoms],
    draft: next => { atoms = typeof next === 'string' ? next.split('') : [...next]; emit() },
    phase: next => { phase = next; emit() }, current: next => { current = next },
    admit: turn => { nodes = [{ kind: 'user', turn }]; for (const listener of admittedListeners) listener() },
  }
}
const ref = id => ({ kind: 'drawing-target', session_id: 's1', source_sha256: 'source', preview_sha256: 'preview', ids: [id] })
const h = harness(), manual = { source: 'file', ref: 'file', label: 'keep file', clipboardText: '[FILE keep]' }
h.draft(['问', '题', manual, ' '])
await h.controller.select(ref('A'))
assert.equal(h.snapshot().occurrences.filter(o => o.source === 'cam-drawing').length, 1)
const firstRef = h.controller.getSnapshot().active.ref
// User moves another chip ahead of the owned reference: clipboard and detect offsets differ.
const owned = h.atoms().find(atom => atom.source === 'cam-drawing')
h.draft([manual, '前', owned, ' ', '问', '题'])
await h.controller.select(ref('B'))
assert.equal(h.snapshot().occurrences.length, 2)
assert.equal(h.snapshot().occurrences[0].source, 'file')
assert.equal(h.controller.getSnapshot().active.reference.ids[0], 'B')
assert(h.snapshot().draft.endsWith(' 问题')); assert.deepEqual(h.attachments, ['keep-attachment'])
const revision = h.snapshot().draftRev
await h.controller.select(ref('B')); assert.equal(h.snapshot().draftRev, revision, 'Selecting the same object is a no-op')
h.controller.clear(); assert.equal(h.snapshot().occurrences.length, 1); assert.equal(h.controller.getSnapshot().active, null)

await h.controller.select(ref('A'))
h.attachments.length = 0 // The native send consumes its attachment snapshot before clearing the editor.
const sent = h.atoms(), captured = h.controller.getSnapshot().active.ref
h.controller.beginSend(captured); h.draft('')
assert.equal(h.controller.getSnapshot().active.ref, captured, 'Optimistic clear retains the question target')
h.draft(sent) // Native serialization/admission failure restores its own snapshot.
assert.equal(h.controller.getSnapshot().active.ref, captured)
h.draft(h.atoms().filter(atom => atom.source !== 'cam-drawing'))
assert.equal(h.controller.getSnapshot().active, null, 'Manual chip removal after a failed send clears the target')

await h.controller.select(ref('A')); h.controller.beginSend(h.controller.getSnapshot().active.ref); h.draft('')
h.admit(1)
assert.equal(h.snapshot().occurrences.filter(o => o.source === 'cam-drawing').length, 1, 'Accepted sends re-arm the same target')
h.controller.beginSend(h.controller.getSnapshot().active.ref); h.draft('')
await h.controller.select(ref('B')); h.admit(2)
assert.equal(h.controller.getSnapshot().active.reference.ids[0], 'B', 'An earlier request cannot restore A over a newer selection')
assert.equal(JSON.parse(captured).ids[0], 'A', 'Sent references are immutable snapshots')
h.controller.beginSend(h.controller.getSnapshot().active.ref); h.draft(''); h.draft('追问')
assert.equal(h.snapshot().occurrences.filter(o => o.source === 'cam-drawing').length, 1, 'Fast follow-up typing keeps the target before admission')
assert(h.snapshot().draft.endsWith('追问'))
h.controller.setVersion('new-source')
assert.equal(h.controller.getSnapshot().active, null); assert(h.snapshot().draft.includes('追问')); assert.equal(h.snapshot().occurrences.length, 0)
assert.equal(h.notices.length, 1)

h.controller.setVersion('source', 'preview')
await h.controller.select(ref('A')); h.phase('submitting')
await assert.rejects(h.controller.select(ref('B')), /正在提交/)
h.phase('plain'); h.controller.clear(); h.controller.dispose()

const pending = new Map(), race = harness(reference => new Promise(resolve => pending.set(reference.ids[0], () => resolve({ ...reference, entities: [{ text: reference.ids[0] }] }))))
const a = race.controller.select(ref('A')), b = race.controller.select(ref('B'))
pending.get('B')(); assert.equal(await b, true); pending.get('A')(); assert.equal(await a, false)
assert.equal(race.controller.getSnapshot().active.reference.ids[0], 'B')
const c = race.controller.select(ref('C')); race.current(false); pending.get('C')(); assert.equal(await c, false)
race.controller.dispose()
const retained = harness()
await retained.controller.select(ref('A')); retained.attachments.length = 0
retained.controller.beginSend(retained.controller.getSnapshot().active.ref); retained.draft('')
retained.controller.setVersion('source', 'new-preview')
assert.equal(retained.controller.getSnapshot().active, null, 'Preview changes also clear a retained target whose send already cleared the chip')
retained.admit(1); assert.equal(retained.snapshot().occurrences.length, 0)
retained.controller.dispose()
assert.notEqual(firstRef, h.controller.getSnapshot().active?.ref)
console.log('drawing question selfcheck: PASS (replacement, draft/attachment preservation, send snapshots, failure restore, races, versions, session isolation)')
