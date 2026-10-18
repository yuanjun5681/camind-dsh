// M4-03/04 DrawingReference adaptation: real task snapshots and the real v1 verifier for frozen
// task-input and generic upload references. Bounded in-memory packs; no production drawing evidence.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDrawingReferenceVerifier } from '../ui-drawing-viewer/lib/reference.js'
import { createCamTasks, digest } from './lib/tasks.js'
import { adaptDrawingReference, validateTaskReferences } from './lib/task-references.js'

const SESSION = 'session-a'
const IDENTITY = 'b'.repeat(64)
const UPLOAD_URI = 'upload://batch/part.dwg'
const UPLOAD_SOURCE = 'synthetic DWG fixture'
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-drawing-reference-'))
try {
  const prt = path.join(home, 'source.prt'), dwg = path.join(home, 'source.dwg'), upload = path.join(home, 'upload.dwg')
  await fs.writeFile(prt, 'synthetic PRT fixture')
  await fs.writeFile(dwg, UPLOAD_SOURCE)
  await fs.writeFile(upload, UPLOAD_SOURCE)
  let task, packText, identity = IDENTITY, serviceAvailable = false
  const rawResolutions = [], snapshotUris = [], verificationCalls = []
  const pack = {
    source_sha256: '',
    dims: [{ id: 'dim-1', display_text: 'Ø10 ±0.1', measured: 10, entity_ids: [7] }],
    entities: [{ id: 7, type: 'line', layer: '0', a: [0, 0], b: [10, 0] }],
  }
  let tasks
  const verifier = createDrawingReferenceVerifier({
    async snapshotSource(sessionId, uri) {
      snapshotUris.push(uri)
      if (uri === UPLOAD_URI) {
        const bytes = await fs.readFile(upload)
        return { sha256: digest(bytes), name: 'part.dwg', async cleanup() {} }
      }
      const input = await tasks.resolveInput(sessionId, uri)
      const bytes = await fs.readFile(input.file)
      return { sha256: digest(bytes), name: input.name, async cleanup() {} }
    },
    async readPack(sessionId, claimedIdentity, { sourceUri }) {
      assert.equal(sessionId, SESSION)
      assert.equal(claimedIdentity.length, 64)
      assert.ok([task.inputs.dwg.uri, UPLOAD_URI].includes(sourceUri))
      return { packText, identity }
    },
  })
  const drawingReferenceService = {
    verifyReference: async (sessionId, reference) => {
      verificationCalls.push({ sessionId, uri: reference.source?.uri })
      return verifier.verify(sessionId, reference)
    },
  }
  tasks = createCamTasks({
    home,
    resolve: async (sessionId, reference) => {
      assert.equal(sessionId, SESSION)
      rawResolutions.push(reference)
      if (!['prt', 'dwg'].includes(reference)) throw new Error('unexpected original-path lookup')
      return { file: reference === 'prt' ? prt : dwg }
    },
    machineRegistry: { snapshot: () => { throw new Error('machine fixture is not needed') } },
    drawingReader: async () => ({ readable: true, units: 'mm', annotations: [] }),
    drawingPreview: async () => { throw new Error('SVG preview must not validate DrawingReference v1') },
    getDrawingPreview: () => serviceAvailable ? drawingReferenceService : undefined,
  })
  task = await tasks.collect(SESSION, 0, { prt: 'prt', dwg: 'dwg' })
  pack.source_sha256 = task.inputs.dwg.sha256
  packText = JSON.stringify(pack)
  serviceAvailable = true

  const makeReference = (target = { type: 'dim', id: 'dim-1' }) => ({
    kind: 'camind-drawing-ref', version: 1, session: SESSION,
    source: { uri: task.inputs.dwg.uri, sha256: task.inputs.dwg.sha256, name: task.inputs.dwg.name },
    pack: { sha256: digest(Buffer.from(packText, 'utf8')), identity },
    target,
  })
  const makeUploadReference = (target = { type: 'dim', id: 'dim-1' }) => ({
    kind: 'camind-drawing-ref', version: 1, session: SESSION,
    source: { uri: UPLOAD_URI, sha256: digest(UPLOAD_SOURCE), name: 'part.dwg' },
    pack: { sha256: digest(Buffer.from(packText, 'utf8')), identity },
    target,
  })
  const drawingMarker = reference => `[CAM_DRAWING_REFERENCE]\n${JSON.stringify(reference)}\n[/CAM_DRAWING_REFERENCE]`
  const objectMarker = reference => `[CAM_OBJECT]\n${JSON.stringify(reference)}\n[/CAM_OBJECT]`
  const request = text => [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }]

  const reference = makeReference()
  assert.deepEqual(adaptDrawingReference(reference), {
    kind: 'drawing-target', session_id: SESSION, source_sha256: reference.source.sha256,
    pack_sha256: reference.pack.sha256, conversion_identity: IDENTITY,
    ids: ['dim:dim-1'], drawing_reference: reference,
  })
  const rawCallsBeforeValidation = rawResolutions.length
  const checked = await tasks.validateReference(SESSION, reference)
  assert.equal(checked.kind, 'drawing-target')
  assert.equal(checked.session_id, SESSION)
  assert.deepEqual(checked.ids, ['dim:dim-1'])
  assert.equal(checked.pack_sha256, reference.pack.sha256)
  assert.equal(checked.conversion_identity, IDENTITY)
  assert.equal(checked.preview_sha256, undefined, 'pack SHA + conversion identity replace the SVG preview fingerprint')
  assert.equal(checked.entities[0].displayText, 'Ø10 ±0.1')
  assert.equal(snapshotUris.at(-1), task.inputs.dwg.uri)
  assert.equal(rawResolutions.length, rawCallsBeforeValidation, 'validation must not resolve the original DWG path')
  const entity = await tasks.validateReference(SESSION, makeReference({ type: 'entity', id: 7 }))
  assert.deepEqual(entity.ids, ['entity:7'])
  assert.deepEqual(entity.entities[0].geometry, { a: [0, 0], b: [10, 0] })
  console.log('ok - valid dim/entity references expand to session_id + ids with pack fingerprints')

  await assert.rejects(tasks.validateReference(SESSION, { ...reference, session: 'session-b' }), /归属/)
  await assert.rejects(tasks.validateReference(SESSION, { ...reference, source: { ...reference.source, sha256: 'f'.repeat(64) } }), /源 SHA/)
  await assert.rejects(tasks.validateReference(SESSION, { ...reference, pack: { ...reference.pack, sha256: 'f'.repeat(64) } }), /图纸包 SHA/)
  await assert.rejects(tasks.validateReference(SESSION, { ...reference, pack: { ...reference.pack, identity: 'f'.repeat(64) } }), /identity/)
  await assert.rejects(tasks.validateReference(SESSION, makeReference({ type: 'dim', id: 'missing' })), /不存在/)
  await assert.rejects(tasks.validateReference(SESSION, makeReference({ type: 'entity', id: 99 })), /不存在/)
  console.log('ok - wrong session/source SHA/pack SHA/identity and missing targets are rejected')

  const stablePackText = packText
  packText = JSON.stringify({ ...pack, dims: [{ ...pack.dims[0], display_text: 'Ø11' }] })
  await assert.rejects(tasks.validateReference(SESSION, reference), /图纸包 SHA/)
  packText = stablePackText
  identity = 'c'.repeat(64)
  await assert.rejects(tasks.validateReference(SESSION, reference), /identity/)
  identity = IDENTITY
  console.log('ok - pack bytes or conversion identity changes invalidate old references')

  const snapshotsBeforeRawPath = snapshotUris.length
  await assert.rejects(tasks.validateReference(SESSION, {
    ...reference, source: { ...reference.source, uri: dwg },
  }), /task-input:\/\//)
  await assert.rejects(tasks.validateReference(SESSION, {
    ...reference, source: { ...reference.source, uri: 'task-input://99/dwg' },
  }), /task-input:\/\//)
  assert.equal(snapshotUris.length, snapshotsBeforeRawPath, 'raw or non-current URIs fail before source access')
  await assert.rejects(tasks.validateReference(SESSION, {
    kind: 'camind-drawing-ref', version: 1, session: SESSION, packText,
    target: { type: 'dim', id: 'dim-1' },
  }), /task-input:\/\//)
  serviceAvailable = false
  await assert.rejects(tasks.validateReference(SESSION, reference), /核验服务/)
  serviceAvailable = true
  console.log('ok - only frozen task-input URIs pass; content mode and missing verifier fail closed')

  const validations = []
  const validatingTasks = {
    validateReference: async (sessionId, value) => {
      validations.push(value)
      return tasks.validateReference(sessionId, value)
    },
  }
  const validateReferences = messages => validateTaskReferences(messages, SESSION, validatingTasks,
    () => serviceAvailable ? drawingReferenceService : undefined)
  await validateReferences(request(drawingMarker(reference)))
  assert.equal(validations.at(-1).session_id, SESSION)
  assert.deepEqual(validations.at(-1).ids, ['dim:dim-1'])
  await validateReferences(request(objectMarker(reference)))
  assert.equal(validations.at(-1).drawing_reference.kind, 'camind-drawing-ref', 'CAM_OBJECT cannot bypass DrawingReference verification')
  await assert.rejects(validateReferences(request(drawingMarker({ kind: 'operation', session_id: SESSION, ids: ['op'] }))), /格式错误/)
  await assert.rejects(validateReferences(request('[CAM_DRAWING_REFERENCE]\n{}')), /不完整/)
  console.log('ok - frozen task-input references still use camTasks before model dispatch')

  const uploadReference = makeUploadReference()
  const taskCallsBeforeUpload = validations.length
  const uploadVerifications = () => verificationCalls.filter(call => call.uri === UPLOAD_URI).length
  await validateReferences(request(drawingMarker(uploadReference)))
  assert.equal(validations.length, taskCallsBeforeUpload, 'generic upload references must not enter frozen-task validation')
  assert.equal(uploadVerifications(), 1)
  assert.equal(snapshotUris.at(-1), UPLOAD_URI)
  await validateReferences(request(drawingMarker(uploadReference)))
  assert.equal(uploadVerifications(), 2, 'a retained reference must be verified again on the next question')
  assert.equal(validations.length, taskCallsBeforeUpload)
  console.log('ok - generic upload references use drawingPreview and consecutive questions re-verify')

  await assert.rejects(validateReferences(request(drawingMarker({ ...uploadReference, session: 'session-b' }))), /会话/)
  await assert.rejects(validateReferences(request(drawingMarker({
    ...uploadReference, source: { ...uploadReference.source, sha256: 'f'.repeat(64) },
  }))), /源 SHA/)
  await fs.writeFile(upload, 'changed upload fixture')
  await assert.rejects(validateReferences(request(drawingMarker(uploadReference))), /源 SHA/)
  await fs.writeFile(upload, UPLOAD_SOURCE)
  const stableUploadPackText = packText
  packText = JSON.stringify({ ...pack, dims: [{ ...pack.dims[0], display_text: 'Ø12' }] })
  await assert.rejects(validateReferences(request(drawingMarker(uploadReference))), /图纸包 SHA/)
  packText = stableUploadPackText
  identity = 'c'.repeat(64)
  await assert.rejects(validateReferences(request(drawingMarker(uploadReference))), /identity/)
  identity = IDENTITY
  await assert.rejects(validateReferences(request(drawingMarker(makeUploadReference({ type: 'dim', id: 'missing' })))), /不存在/)
  serviceAvailable = false
  const callsBeforeMissingService = uploadVerifications()
  await assert.rejects(validateReferences(request(drawingMarker(uploadReference))), /核验服务/)
  assert.equal(uploadVerifications(), callsBeforeMissingService)
  serviceAvailable = true
  assert.equal(validations.length, taskCallsBeforeUpload)
  console.log('ok - stale/cross-session/changed upload references and missing service fail closed')

  const legacyTarget = {
    kind: 'drawing-target', session_id: SESSION, source_sha256: task.inputs.dwg.sha256,
    preview_sha256: 'd'.repeat(64), ids: ['d:0'],
  }
  await assert.rejects(tasks.validateReference(SESSION, legacyTarget), /\/refs\/verify/)
  await assert.rejects(tasks.validateReference(SESSION, {
    kind: 'drawing', session_id: SESSION, source_sha256: task.inputs.dwg.sha256, ids: ['a1'],
  }), /\/refs\/verify/)
  const op = { id: 'op-a', new_name: 'OP_{suffix}', station: 'station-a', depends_on: [], execution: 'nc', inspection: ['fixture check'] }
  task = await tasks.update(SESSION, task.version, { operations: [op] })
  const operationReference = {
    kind: 'operation', session_id: SESSION, revision: task.revision,
    plan_sha256: task.operation_fingerprint, ids: ['op-a'],
  }
  const checkedOperation = await tasks.validateReference(SESSION, operationReference)
  assert.equal(checkedOperation.operations[0].id, 'op-a')
  await validateReferences(request(objectMarker(operationReference)))
  assert.equal(validations.at(-1).kind, 'operation')
  const countBeforeHistorical = validations.length
  const verificationsBeforeHistorical = verificationCalls.length
  await validateReferences([
    ...request(drawingMarker({ ...uploadReference, pack: { ...uploadReference.pack, sha256: 'f'.repeat(64) } })),
    { source: { kind: 'assistant' }, content: [] },
    ...request('plain current request'),
  ])
  assert.equal(validations.length, countBeforeHistorical, 'historical references do not block a new plain request')
  assert.equal(verificationCalls.length, verificationsBeforeHistorical)
  console.log('ok - unverified legacy drawing refs fail; legacy operation and current-request boundaries remain')

  console.log('drawing reference task adaptation selfcheck: PASS')
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
