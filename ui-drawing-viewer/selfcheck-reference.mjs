// M2-07 DrawingReference verification: valid targets, session/source/pack/identity binding,
// target existence, authorization, content-mode rejection and snapshot cleanup on every outcome.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createDrawingReferenceVerifier } from './lib/reference.js'

const SESSION = 'session-1'
const URI = 'upload://batch/part.dwg'
const NAME = 'part.dwg'
const SOURCE_SHA = 'a'.repeat(64)
const IDENTITY = 'b'.repeat(64)
const PACK = {
  source_sha256: SOURCE_SHA,
  dims: [
    { id: 'dim-1', display_text: 'Ø10 ±0.1', measured: 10, tolerance: { upper: 0.1, lower: -0.1 }, dimlfac: 1, inferred: false, entity_ids: [0], rule_version: 'rules-1' },
    { id: 'dim-2' },
  ],
  entities: [
    { id: 0, type: 'line', layer: '0', a: [0, 0], b: [10, 0] },
    { id: 7, type: 'text', layer: 'annotation', text: '备注', handle: 'AB1', p: [2, 3], h: 2.5, rot: 0 },
    { id: 8, type: 'circle', layer: '0', c: [5, 5], r: 10 },
    { id: 9, type: 'polyline', layer: '0', closed: true, verts: Array.from({ length: 40 }, (_, i) => ({ x: i, y: 0 })) },
    { id: 10, type: 'tolerance', layer: 'annotation',
      cells: [
        { p: [0, 0], h: 4, text: 'POSITION', rot: 0, style: 'Standard' },
        { p: [0, 4], h: 4, text: '0.05', rot: 0, style: 'Standard' },
        { p: [0, 8], h: 4, text: 'A', rot: 0, style: 'Standard' },
      ],
      frame_segs: [[0, 0, 20, 0]] },
    { id: 11, type: 'text', layer: 'annotation', text: 'x'.repeat(1005), p: [0, 0], h: 2.5, rot: 0 },
    { id: 12, type: 'mtext', layer: 'annotation', text: '第一行\n第二行', p: [0, 0], h: 2.5, rot: 0,
      rows: [{ p: [0, 0], text: '第一行' }, { p: [0, 2.5], text: '第二行' }] },
    { id: 13, type: 'polyline', layer: '0', verts: [[[[1]]]] },
  ],
}
const PACK_TEXT = JSON.stringify(PACK)
const PACK_SHA = createHash('sha256').update(Buffer.from(PACK_TEXT, 'utf8')).digest('hex')
const DESCRIPTOR_DETAILS = {
  conversion: { tool: 'dwg2dxf', commit: 'converter-1' },
  degraded: { textTruncated: false },
  missing: ['view_rules'],
}

function makeInput(target = { type: 'dim', id: 'dim-1' }) {
  return {
    kind: 'camind-drawing-ref',
    version: 1,
    session: SESSION,
    source: { uri: URI, sha256: SOURCE_SHA, name: NAME },
    pack: { sha256: PACK_SHA, identity: IDENTITY },
    target,
  }
}

function makeHarness() {
  const state = {
    sourceSha256: SOURCE_SHA,
    sourceName: NAME,
    packText: PACK_TEXT,
    identity: IDENTITY,
    descriptor: DESCRIPTOR_DETAILS,
    snapshotError: null,
    readError: null,
    cleanups: 0,
    snapshotCalls: [],
    readCalls: [],
  }
  const verifier = createDrawingReferenceVerifier({
    async snapshotSource(sessionId, uri) {
      state.snapshotCalls.push([sessionId, uri])
      if (state.snapshotError) throw state.snapshotError
      return {
        sha256: state.sourceSha256,
        name: state.sourceName,
        async cleanup() { state.cleanups++ },
      }
    },
    async readPack(sessionId, identity, options) {
      state.readCalls.push([sessionId, identity, options])
      if (state.readError) throw state.readError
      return { packText: state.packText, identity: state.identity, descriptor: state.descriptor }
    },
  })
  return { state, verify: verifier.verify }
}

{
  const { state, verify } = makeHarness()
  const result = await verify(SESSION, makeInput())
  assert.deepEqual(result, {
    reference: makeInput(),
    descriptor: {
      name: NAME,
      session: SESSION,
      source: { uri: URI, sha256: SOURCE_SHA, name: NAME },
      pack: { sha256: PACK_SHA, identity: IDENTITY },
      ...DESCRIPTOR_DETAILS,
    },
    targetContent: {
      type: 'dim', id: 'dim-1', displayText: 'Ø10 ±0.1', measured: 10,
      tolerance: { upper: 0.1, lower: -0.1 }, dimlfac: 1, inferred: false,
      ruleVersion: 'rules-1', entityIds: [0],
    },
  })
  assert.deepEqual(state.snapshotCalls, [[SESSION, URI]])
  assert.deepEqual(state.readCalls, [[SESSION, IDENTITY, { sourceUri: URI, name: NAME }]])
  assert.equal(state.cleanups, 1)
  console.log('ok - valid dim reference and verified descriptor')
}

{
  const { state, verify } = makeHarness()
  const result = await verify(SESSION, makeInput({ type: 'entity', id: 0 }))
  assert.deepEqual(result.reference.target, { type: 'entity', id: 0 })
  assert.deepEqual(result.targetContent.geometry, { a: [0, 0], b: [10, 0] })
  assert.equal(state.cleanups, 1)
  console.log('ok - valid non-negative integer entity reference')
}

{
  const { verify } = makeHarness()
  const result = await verify(SESSION, makeInput({ type: 'entity', id: 7 }))
  assert.equal(result.targetContent.text, '备注')
  assert.equal(result.targetContent.entityType, 'text')
  assert.deepEqual(result.targetContent.geometry, { p: [2, 3], h: 2.5, rot: 0 })
  const circle = await verify(SESSION, makeInput({ type: 'entity', id: 8 }))
  assert.deepEqual(circle.targetContent.geometry, { c: [5, 5], r: 10 })
  console.log('ok - verified target content includes annotation text and converter-shaped geometry')
}

{
  const { verify } = makeHarness()
  const polyline = await verify(SESSION, makeInput({ type: 'entity', id: 9 }))
  assert.equal(polyline.targetContent.geometry.verts.length, 32)
  assert.deepEqual(polyline.targetContent.truncated.fields, [{ path: 'geometry.verts', originalLength: 40, returnedLength: 32 }])
  const tolerance = await verify(SESSION, makeInput({ type: 'entity', id: 10 }))
  assert.deepEqual(tolerance.targetContent.geometry.cells.map(cell => cell.text), ['POSITION', '0.05', 'A'])
  assert.deepEqual(tolerance.targetContent.geometry.cells[0].p, [0, 0])
  assert.deepEqual(tolerance.targetContent.geometry.frame_segs, [[0, 0, 20, 0]])
  const longText = await verify(SESSION, makeInput({ type: 'entity', id: 11 }))
  assert.equal(longText.targetContent.text.length, 1000)
  assert.deepEqual(longText.targetContent.truncated.fields, [{ path: 'text', originalLength: 1005, returnedLength: 1000 }])
  const mtext = await verify(SESSION, makeInput({ type: 'entity', id: 12 }))
  assert.deepEqual(mtext.targetContent.geometry.rows[0].p, [0, 0])
  const deep = await verify(SESSION, makeInput({ type: 'entity', id: 13 }))
  assert.ok(deep.targetContent.truncated.fields.some(field => field.reason === 'depth'))
  console.log('ok - tolerance payloads and explicit truncation metadata are preserved')
}

{
  const { verify } = makeHarness()
  const input = makeInput({ type: 'entity', id: 7 })
  input.source.sha256 = SOURCE_SHA.toUpperCase()
  input.pack.sha256 = PACK_SHA.toUpperCase()
  input.pack.identity = IDENTITY.toUpperCase()
  input.source.name = 'caller-supplied-alias.dwg'
  const result = await verify(SESSION, input)
  assert.equal(result.reference.source.sha256, SOURCE_SHA)
  assert.equal(result.reference.source.name, NAME)
  assert.deepEqual(result.reference.pack, { sha256: PACK_SHA, identity: IDENTITY })
  console.log('ok - hashes and source display name are normalized from trusted results')
}

{
  const { state, verify } = makeHarness()
  await assert.rejects(verify('session-2', makeInput()), /会话/)
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.cleanups, 0)
  console.log('ok - wrong session rejected before source access')
}

{
  const { state, verify } = makeHarness()
  state.sourceSha256 = 'c'.repeat(64)
  await assert.rejects(verify(SESSION, makeInput()), /源 SHA/)
  assert.equal(state.readCalls.length, 0)
  assert.equal(state.cleanups, 1)
  console.log('ok - source SHA mismatch rejected and snapshot cleaned')
}

{
  const { state, verify } = makeHarness()
  state.packText = JSON.stringify({ ...PACK, changed: true })
  await assert.rejects(verify(SESSION, makeInput()), /图纸包 SHA/)
  assert.equal(state.cleanups, 1)
  console.log('ok - pack SHA recomputed from actual packText bytes')
}

{
  const { state, verify } = makeHarness()
  state.packText = JSON.stringify({ ...PACK, source_sha256: 'c'.repeat(64) })
  const input = makeInput()
  input.pack.sha256 = createHash('sha256').update(Buffer.from(state.packText, 'utf8')).digest('hex')
  await assert.rejects(verify(SESSION, input), /图纸包源 SHA/)
  assert.equal(state.cleanups, 1)
  console.log('ok - pack source SHA is bound to the authorized drawing')
}

{
  const { state, verify } = makeHarness()
  state.identity = 'c'.repeat(64)
  await assert.rejects(verify(SESSION, makeInput()), /identity/)
  assert.equal(state.cleanups, 1)
  console.log('ok - conversion identity mismatch rejected')
}

{
  const { state, verify } = makeHarness()
  await assert.rejects(verify(SESSION, makeInput({ type: 'dim', id: 'missing' })), /不存在/)
  await assert.rejects(verify(SESSION, makeInput({ type: 'entity', id: 99 })), /不存在/)
  assert.equal(state.cleanups, 2)
  console.log('ok - missing dim and entity targets rejected with cleanup')
}

{
  const deniedAtSource = makeHarness()
  deniedAtSource.state.snapshotError = new Error('未授权图纸来源')
  await assert.rejects(deniedAtSource.verify(SESSION, makeInput()), /未授权/)
  assert.equal(deniedAtSource.state.readCalls.length, 0)
  assert.equal(deniedAtSource.state.cleanups, 0)

  const deniedAtCache = makeHarness()
  deniedAtCache.state.readError = new Error('缓存命中重新授权失败：未授权图纸来源')
  await assert.rejects(deniedAtCache.verify(SESSION, makeInput()), /未授权/)
  assert.equal(deniedAtCache.state.cleanups, 1)
  console.log('ok - unauthorized source and cache re-authorization rejected')
}

{
  const { state, verify } = makeHarness()
  await assert.rejects(verify(SESSION, {
    kind: 'camind-drawing-ref', version: 1, session: SESSION,
    packText: PACK_TEXT, target: { type: 'dim', id: 'dim-1' },
  }), /可信来源|内容模式/)
  const missingPack = makeInput()
  delete missingPack.pack
  await assert.rejects(verify(SESSION, missingPack), /图纸包身份/)
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.cleanups, 0)
  console.log('ok - content mode and incomplete trusted provenance cannot issue references')
}

const invalidCases = [
  ['kind', input => { input.kind = 'other' }, /kind/],
  ['version', input => { input.version = 2 }, /version/],
  ['source uri', input => { input.source.uri = '' }, /可信图纸来源/],
  ['source name', input => { input.source.name = '' }, /可信图纸来源/],
  ['source hash', input => { input.source.sha256 = 'x'.repeat(64) }, /源 SHA/],
  ['pack hash', input => { input.pack.sha256 = '0'.repeat(63) }, /图纸包 SHA/],
  ['identity hash', input => { input.pack.identity = 'z'.repeat(64) }, /identity/],
  ['target type', input => { input.target.type = 'face' }, /target.type/],
  ['dim id type', input => { input.target = { type: 'dim', id: 1 } }, /dim 目标 id/],
  ['entity id type', () => makeInput({ type: 'entity', id: '0' }), /entity 目标 id/],
  ['negative entity id', () => makeInput({ type: 'entity', id: -1 }), /entity 目标 id/],
  ['fractional entity id', () => makeInput({ type: 'entity', id: 1.5 }), /entity 目标 id/],
]
for (const [, change, expected] of invalidCases) {
  const { state, verify } = makeHarness()
  const input = makeInput()
  const replacement = change(input)
  await assert.rejects(verify(SESSION, replacement ?? input), expected)
  assert.equal(state.snapshotCalls.length, 0)
  assert.equal(state.cleanups, 0)
}
console.log('ok - malformed fields, hashes and target ids rejected before snapshotting')
