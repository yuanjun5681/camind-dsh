// X-ray/translucency state and shader checks with synthetic GL data; real pixel evidence is in selfcheck-xray-gpu.mjs.
import assert from 'node:assert/strict'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { createPinnedFixturePlugin, loadPinnedFixtures } from './selfcheck-fixtures.mjs'

const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const pinned = loadPinnedFixtures(root, DESKTOP, ['packages/viewer/src/synthetic_pack.ts', 'packages/viewer/test/gl_mock.ts'])
const sourceCommit = pinned.sourceCommit
const fixturePlugin = createPinnedFixturePlugin(pinned)
const plugins = [fixturePlugin.plugin]
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.join(root, 'src'),
    contents: `
      export { GeomView } from './viewer/geom_view.ts';
      export { faceToPickId, segmentToPickId } from './core/pick.ts';
      export { makeSyntheticPackMulti, parseSyntheticMesh, parseSyntheticEdges } from ${JSON.stringify(path.join(DESKTOP, 'packages/viewer/src/synthetic_pack.ts'))};
      export { makeGlMock } from ${JSON.stringify(path.join(DESKTOP, 'packages/viewer/test/gl_mock.ts'))};
    `,
  },
  bundle: true, write: false, absWorkingDir: path.join(root, 'src'),
  alias: { '@camind/core': path.join(root, 'src/core/index.ts') },
  platform: 'browser', format: 'cjs', plugins,
})
fixturePlugin.assertAllLoadedOnce()
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, performance, setTimeout, clearTimeout, console })
const {
  GeomView, faceToPickId, segmentToPickId,
  makeSyntheticPackMulti, parseSyntheticMesh, parseSyntheticEdges, makeGlMock,
} = module.exports

const IDENTITY = { sourceSha256: 'source', geometrySha256: 'geometry' }
const alpha = color => color[3]
const deepEqual = (actual, expected, message) => assert.deepEqual(
  JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message)

class FakeCanvas {
  constructor() {
    this.listeners = new Map()
    this.width = 0; this.height = 0
    this.clientWidth = 300; this.clientHeight = 200
  }
  addEventListener(type, fn) { (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)).push(fn) }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)) }
  dispatch(type, ev = {}) {
    const base = { button: 0, offsetX: 50, offsetY: 50, shiftKey: false, ctrlKey: false, metaKey: false,
      deltaY: 0, deltaMode: 1, pointerId: 7, preventDefault() {}, ...ev }
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(base)
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function makeView() {
  const canvas = new FakeCanvas()
  const mock = makeGlMock()
  let frames = []
  const view = new GeomView(canvas, mock.gl, { dpr: () => 1, requestFrame: fn => { frames.push(fn) }, now: () => 1234.5 })
  const pack = makeSyntheticPackMulti(1024, 4, 4, 120)
  const mesh = parseSyntheticMesh(pack)
  view.setPart('part-1', pack.faces, pack.bodies, IDENTITY)
  view.setMesh(mesh)
  const flush = () => {
    view.requestRender()
    while (frames.length) {
      const pending = frames; frames = []
      for (const fn of pending) fn()
    }
  }
  flush()
  const facesOfBody = body => pack.faces.map((face, index) => ({ face, index }))
    .filter(({ face }) => face.body === body).map(({ index }) => index)
  return { view, pack, mesh, canvas, mock, flush, facesOfBody, pendingFrames: () => frames.length }
}

function testDefaultTranslucency() {
  const a = makeView()
  const b1 = a.facesOfBody(1), b0 = a.facesOfBody(0)
  assert.equal(alpha(a.view.faceDisplayColorAt(b1[0])), 255)
  a.view.setDefaultTranslucentBodies([1])
  for (const face of b1) {
    assert.equal(alpha(a.view.faceDisplayColorAt(face)), 128)
    assert.equal(a.view.facePhaseAt(face), 1)
  }
  assert.equal(alpha(a.view.faceDisplayColorAt(b0[0])), 255)
  assert.equal(a.view.facePhaseAt(b0[0]), 0)
  a.view.setDefaultTranslucentBodies([])
  assert.equal(alpha(a.view.faceDisplayColorAt(b1[0])), 255)
  assert.equal(a.view.facePhaseAt(b1[0]), 0)

  for (const face of b1) a.pack.faces[face].opacity = 200
  for (const face of a.facesOfBody(2)) a.pack.faces[face].opacity = 252
  for (const face of a.facesOfBody(3)) a.pack.faces[face].opacity = 250
  a.view.setMesh(parseSyntheticMesh(a.pack))
  a.view.setDefaultTranslucentBodies([1, 2, 3])
  for (const [body, opacity] of [[1, 200], [2, 252], [3, 250]]) {
    for (const face of a.facesOfBody(body)) {
      assert.equal(alpha(a.view.faceDisplayColorAt(face)), opacity)
      assert.equal(a.view.facePhaseAt(face), 1)
    }
  }
  a.view.setDefaultTranslucentBodies([])
  for (const [body, opacity] of [[1, 200], [2, 252], [3, 250]])
    assert.equal(alpha(a.view.faceDisplayColorAt(a.facesOfBody(body)[0])), opacity)

  a.view.setDefaultTranslucentBodies([1])
  a.view.setPartIdentity({ sourceSha256: 'source-2', geometrySha256: 'geometry-2' })
  assert.equal(alpha(a.view.faceDisplayColorAt(b1[0])), 200)
  assert.equal(a.view.facePhaseAt(b1[0]), 0)

  const b = makeView()
  b.view.setDefaultTranslucentBodies([1])
  const next = makeSyntheticPackMulti(1024, 4, 4, 120)
  b.view.setPart('part-2', next.faces, next.bodies, { sourceSha256: 'source-2', geometrySha256: 'geometry-2' })
  assert.equal(b.pendingFrames(), 1, 'setPart must schedule the redraw after its internal identity update')
  b.view.setMesh(parseSyntheticMesh(next))
  const nextFace = next.faces.findIndex(face => face.body === 1)
  assert.equal(alpha(b.view.faceDisplayColorAt(nextFace)), 255)
  assert.equal(b.view.facePhaseAt(nextFace), 0)
  console.log('ok - default translucency, source opacity priority, phase reset and part identity cleanup')
}

function testXrayVisibilityAndOrdering() {
  const a = makeView()
  a.view.setEdges(parseSyntheticEdges(a.pack))
  a.flush()
  const full = a.mesh.indexCount()
  const edgeFull = a.view.edgesOf().edgeCount() * 4 * 2
  const hiddenFace = a.facesOfBody(2)[0]
  a.view.setHiddenBodies([2])
  a.flush()
  const hiddenOnly = a.view.visibleIndexDrawCount()
  const edgeHidden = a.view.edgeVisibleIndexDrawCount()
  assert.ok(hiddenOnly < full)
  assert.ok(edgeHidden < edgeFull)
  assert.equal(a.view.faceDisplayColorAt(hiddenFace)[3], 255)
  a.view.setXrayMode(true)
  a.flush()
  assert.equal(a.view.visibleIndexDrawCount(), full)
  assert.equal(alpha(a.view.faceDisplayColorAt(hiddenFace)), 128)
  assert.equal(a.view.facePhaseAt(hiddenFace), 0)
  assert.equal(a.view.renderStats().edgeSegments * 2, edgeFull)
  assert.equal(a.view.edgeVisibleIndexDrawCount(), edgeHidden)
  a.view.setXrayMode(false)
  a.flush()
  assert.equal(a.view.visibleIndexDrawCount(), hiddenOnly)
  assert.equal(alpha(a.view.faceDisplayColorAt(hiddenFace)), 255)

  a.view.setXrayMode(true)
  a.view.setHiddenBodies([1])
  a.flush()
  assert.equal(a.view.visibleIndexDrawCount(), full)
  assert.equal(alpha(a.view.faceDisplayColorAt(a.facesOfBody(1)[0])), 128)
  assert.equal(alpha(a.view.faceDisplayColorAt(hiddenFace)), 255)
  a.view.setHiddenBodies([1, 2])
  assert.equal(alpha(a.view.faceDisplayColorAt(hiddenFace)), 128)
  a.view.setHiddenBodies([1])
  assert.equal(alpha(a.view.faceDisplayColorAt(hiddenFace)), 255)

  const selected = a.facesOfBody(1)[0]
  a.view.setSelectedFids([a.pack.faces[selected].fid])
  assert.equal(alpha(a.view.faceDisplayColorAt(selected)), 255)
  a.view.setSelectedFids([])
  assert.equal(alpha(a.view.faceDisplayColorAt(selected)), 128)

  a.view.setDefaultTranslucentBodies([1, 2])
  assert.equal(alpha(a.view.faceDisplayColorAt(selected)), 128)
  assert.equal(a.view.facePhaseAt(selected), 1)
  assert.equal(a.view.facePhaseAt(a.facesOfBody(0)[0]), 0)
  a.view.setDefaultTranslucentBodies([])

  for (const face of a.facesOfBody(1)) a.pack.faces[face].opacity = 200
  a.view.setMesh(parseSyntheticMesh(a.pack))
  a.view.setDefaultTranslucentBodies([1])
  a.view.setHiddenBodies([1])
  assert.equal(alpha(a.view.faceDisplayColorAt(selected)), 128)
  assert.equal(a.view.facePhaseAt(selected), 1)

  const fine = makeSyntheticPackMulti(4000, 4, 8, 120)
  deepEqual(fine.faces.map(face => face.body), a.pack.faces.map(face => face.body))
  const fineFacesOfBody = body => fine.faces.map((face, index) => ({ face, index }))
    .filter(({ face }) => face.body === body).map(({ index }) => index)
  const fineSelected = fineFacesOfBody(1)[0], fineTranslucent = fineFacesOfBody(2)[0]
  assert.equal(fine.faces[fineSelected].body, 1)
  const fineMesh = parseSyntheticMesh(fine)
  assert.notEqual(fineMesh.indexCount(), a.mesh.indexCount())
  a.view.setDefaultTranslucentBodies([2])
  a.view.setMesh(fineMesh)
  assert.equal(a.view.meshOf(), fineMesh)
  a.flush()
  assert.equal(a.view.visibleIndexDrawCount(), fineMesh.indexCount())
  assert.equal(alpha(a.view.faceDisplayColorAt(fineSelected)), 128)
  assert.equal(a.view.facePhaseAt(fineTranslucent), 1)
  a.view.setXrayMode(false)
  a.flush()
  assert.ok(a.view.visibleIndexDrawCount() < a.view.meshOf().indexCount())
  assert.equal(alpha(a.view.faceDisplayColorAt(fineSelected)), 200)

  const b = makeView()
  b.view.setHiddenBodies([1, 2, 3])
  b.view.setXrayMode(true)
  b.flush()
  assert.equal(b.view.visibleIndexDrawCount(), b.mesh.indexCount())
  b.view.setXrayMode(false)
  b.view.showAllBodies()
  b.view.setXrayMode(true)
  b.view.isolateBody(0)
  b.flush()
  assert.equal(b.view.visibleIndexDrawCount(), b.mesh.indexCount())
  assert.equal(alpha(b.view.faceDisplayColorAt(b.facesOfBody(1)[0])), 128)

  const next = makeSyntheticPackMulti(1024, 4, 4, 120)
  next.bodies[1].blanked = true
  const nextMesh = parseSyntheticMesh(next)
  b.view.setPart('part-with-blanked', next.faces, next.bodies, { sourceSha256: 'source-next', geometrySha256: 'geometry-next' })
  b.view.setMesh(nextMesh)
  b.flush()
  assert.equal(b.view.xrayModeOn(), true)
  deepEqual(b.view.hiddenBodiesOf(), [1])
  assert.equal(b.view.visibleIndexDrawCount(), nextMesh.indexCount())
  assert.equal(alpha(b.view.faceDisplayColorAt(next.faces.findIndex(face => face.body === 1))), 128)
  console.log('ok - X-ray visibility, both operation orders, isolation, LOD, setPart and source opacity override')
}

function testTypeFilterAndXray() {
  const a = makeView()
  const hiddenFace = a.facesOfBody(1)[0], otherFace = a.facesOfBody(0)[0]
  a.view.setXrayMode(true)
  a.view.setHiddenBodies([1])
  a.view.setSurfaceTypeFilter(['plane'])
  const filtered = a.view.faceDisplayColorAt(hiddenFace)
  const control = a.view.faceDisplayColorAt(otherFace)
  deepEqual(filtered.slice(0, 3), control.slice(0, 3), 'type-filter dimming must keep the same RGB under X-ray')
  assert.notDeepEqual(filtered.slice(0, 3), [175, 175, 175])
  assert.equal(alpha(filtered), 128)
  assert.equal(alpha(control), 255)
  a.view.setSurfaceTypeFilter([])
  deepEqual(a.view.faceDisplayColorAt(hiddenFace).slice(0, 3), [175, 175, 175])
  assert.equal(alpha(a.view.faceDisplayColorAt(hiddenFace)), 128)
  console.log('ok - type filter dims RGB while X-ray only changes alpha')
}

function testContextRestoreAndEdges() {
  const a = makeView()
  a.view.setEdges(parseSyntheticEdges(a.pack))
  a.view.setHiddenBodies([1])
  a.view.setDefaultTranslucentBodies([2])
  a.view.setXrayMode(true)
  a.flush()
  const edgeCount = a.view.renderStats().edgeSegments
  const full = a.mesh.indexCount()
  assert.equal(a.view.visibleIndexDrawCount(), full)
  const expectedPhase = new Uint8Array(a.mesh.vertexCount())
  for (const face of a.facesOfBody(2)) {
    const range = a.mesh.faceRange(face)
    expectedPhase.fill(255, range.vertexOffset, range.vertexOffset + range.vertexCount)
  }
  const phaseUploads = [], phaseBindings = []
  const phaseLocation = a.mock.gl.getAttribLocation(null, 'aPhase')
  let boundArrayBuffer = null
  const originalBind = a.mock.gl.bindBuffer
  a.mock.gl.bindBuffer = (target, buffer) => {
    if (target === 34962) boundArrayBuffer = buffer
    return originalBind(target, buffer)
  }
  const originalBufferData = a.mock.gl.bufferData
  a.mock.gl.bufferData = (target, data, usage) => {
    if (target === 34962 && data?.byteLength === expectedPhase.length)
      phaseUploads.push({ buffer: boundArrayBuffer, bytes: new Uint8Array(data) })
    return originalBufferData(target, data, usage)
  }
  const originalAttrib = a.mock.gl.vertexAttribPointer
  a.mock.gl.vertexAttribPointer = (location, size, type, normalized, stride, pointer) => {
    if (location === phaseLocation) phaseBindings.push({ buffer: boundArrayBuffer, size, type, normalized })
    return originalAttrib(location, size, type, normalized, stride, pointer)
  }
  a.mock.reset()
  a.canvas.dispatch('webglcontextlost')
  assert.ok(a.mock.callsOf('deleteProgram').length > 0)
  a.canvas.dispatch('webglcontextrestored')
  a.flush()
  assert.ok(a.mock.callsOf('attachShader').length > 0)
  assert.equal(phaseUploads.length, 1)
  deepEqual(Array.from(phaseUploads[0].bytes), Array.from(expectedPhase))
  assert.equal(phaseBindings.length, 1)
  assert.equal(phaseBindings[0].buffer, phaseUploads[0].buffer)
  deepEqual([phaseBindings[0].size, phaseBindings[0].type, phaseBindings[0].normalized], [1, 5121, true])
  assert.equal(a.view.xrayModeOn(), true)
  assert.equal(a.view.visibleIndexDrawCount(), full)
  assert.equal(alpha(a.view.faceDisplayColorAt(a.facesOfBody(1)[0])), 128)
  assert.equal(a.view.facePhaseAt(a.facesOfBody(2)[0]), 1)
  assert.equal(a.view.renderStats().edgeSegments, edgeCount)
  a.view.setXrayMode(false)
  a.flush()
  assert.ok(a.view.visibleIndexDrawCount() < full)
  console.log('ok - X-ray and phase restoration after GL-mock context restore; edge data remains independent')
}

function testMaskAndShaderContract() {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  const keeps = (a, phase) => {
    const result = new Set()
    for (let y = 0; y < 4; ++y) for (let x = 0; x < 4; ++x) {
      const px = phase ? ((y + 2) % 4) * 4 + ((x + 1) % 4) : y * 4 + x
      if (a / 255 > (bayer[px] + 0.5) / 16) result.add(y * 4 + x)
    }
    return result
  }
  const phase0 = keeps(128, false), phase1 = keeps(128, true)
  deepEqual([...phase0].sort((a, b) => a - b), [0, 2, 5, 7, 8, 10, 13, 15])
  deepEqual([...phase1].sort((a, b) => a - b), [1, 3, 4, 6, 9, 11, 12, 14])
  assert.equal([...phase0].filter(p => phase1.has(p)).length, 0)
  console.log('ok - A=128 phase masks are complementary')
}

function click(viewCanvas, mock, face) {
  mock.setPickId(faceToPickId(face))
  viewCanvas.dispatch('pointerdown', { offsetX: 100, offsetY: 80, pointerId: 3 })
  viewCanvas.dispatch('pointerup', { offsetX: 100, offsetY: 80, pointerId: 3 })
}

async function testPickingHoverAndNc() {
  const a = makeView()
  a.view.setXrayMode(true)
  a.view.setHiddenBodies([1])
  a.view.setSelectableBodies({ ...IDENTITY, bodies: [2] })
  a.view.setDefaultTranslucentBodies([2])
  a.flush()
  const face1 = a.facesOfBody(1)[0], face2 = a.facesOfBody(2)[0]
  click(a.canvas, a.mock, face1)
  deepEqual(a.view.selectedFaces(), [face1])
  a.view.setXrayMode(false)
  deepEqual(a.view.selectedFaces(), [face1], 'hiding a face does not silently discard its selection')
  a.view.setXrayMode(true)
  a.view.setSelectedFids([])
  click(a.canvas, a.mock, face2)
  deepEqual(a.view.selectedFaces(), [])

  const hiddenDeclared = makeView()
  const hiddenDeclaredFace = hiddenDeclared.facesOfBody(2)[0]
  hiddenDeclared.view.setXrayMode(true)
  hiddenDeclared.view.setHiddenBodies([2])
  hiddenDeclared.view.setSelectableBodies({ ...IDENTITY, bodies: [2] })
  hiddenDeclared.flush()
  click(hiddenDeclared.canvas, hiddenDeclared.mock, hiddenDeclaredFace)
  deepEqual(hiddenDeclared.view.selectedFaces(), [], 'declared bodies stay unselectable while X-ray reveals them')

  const hovers = []
  a.view.callbacks.hoverChanged = subject => hovers.push(subject.fid)
  a.canvas.dispatch('pointerenter')
  a.mock.setPickId(faceToPickId(face1))
  a.canvas.dispatch('pointermove', { offsetX: 50, offsetY: 50 })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(hovers.at(-1), a.pack.faces[face1].fid)
  assert.equal(alpha(a.view.faceDisplayColorAt(face1)), 255)
  a.view.setHiddenBodies(null)
  assert.equal(hovers.at(-1), a.pack.faces[face1].fid)
  a.view.setHiddenBodies([1])
  assert.equal(hovers.at(-1), a.pack.faces[face1].fid, 'X-ray keeps the still-visible hover target')
  a.view.setXrayMode(false)
  assert.equal(hovers.at(-1), '')

  const c = makeView()
  const cFace = c.facesOfBody(1)[0]
  c.view.setDefaultTranslucentBodies([1])
  const cHovers = []
  c.view.callbacks.hoverChanged = subject => cHovers.push(subject.fid)
  c.canvas.dispatch('pointerenter')
  c.mock.setPickId(faceToPickId(cFace))
  c.canvas.dispatch('pointermove', { offsetX: 50, offsetY: 50 })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(cHovers.at(-1), c.pack.faces[cFace].fid)
  assert.equal(c.view.facePhaseAt(cFace), 1)
  c.view.setDefaultTranslucentBodies([])
  assert.equal(cHovers.at(-1), c.pack.faces[cFace].fid)
  assert.equal(c.view.facePhaseAt(cFace), 0, 'fast color refresh must also reset the hovered face phase')

  const e = makeView()
  const eFace = e.facesOfBody(1)[0]
  for (const face of e.facesOfBody(1)) e.pack.faces[face].opacity = 200
  e.view.setMesh(parseSyntheticMesh(e.pack))
  e.view.setSelectedFids([e.pack.faces[eFace].fid])
  assert.equal(alpha(e.view.faceDisplayColorAt(eFace)), 255)
  e.canvas.dispatch('pointerenter')
  e.mock.setPickId(faceToPickId(eFace))
  e.canvas.dispatch('pointermove', { offsetX: 50, offsetY: 50 })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(alpha(e.view.faceDisplayColorAt(eFace)), 255)
  e.view.setSelectedFids([])
  assert.equal(alpha(e.view.faceDisplayColorAt(eFace)), 200)

  const d = makeView()
  const dVisible = d.facesOfBody(0)[0], dHidden = d.facesOfBody(1)[0]
  d.view.setXrayMode(true)
  d.view.setHiddenBodies([1])
  d.flush()
  d.canvas.dispatch('pointerenter')
  d.mock.setPickId(faceToPickId(dHidden))
  d.canvas.dispatch('pointermove', { offsetX: 50, offsetY: 50 })
  await new Promise(resolve => setTimeout(resolve, 40))
  d.flush()
  d.mock.reset()
  d.mock.setPickId(faceToPickId(dVisible))
  d.canvas.dispatch('pointermove', { offsetX: 50, offsetY: 50 })
  await new Promise(resolve => setTimeout(resolve, 40))
  d.flush()
  const hoverUploads = d.mock.callsOf('bufferSubData').filter(call => call.args[0] === 34962)
  assert.equal(hoverUploads.length, 2, 'hover must refresh only the previous and current faces')
  // gl_mock records bufferSubData as (target, offset, byteCount); a full phase upload is one
  // Uint8 per vertex, so its byte count equals the mesh vertex count.
  assert.equal(hoverUploads.filter(call => call.args[2] === d.mesh.vertexCount()).length, 0)

  const b = makeView()
  const path = {
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 20, 10, 0]),
    colors: new Uint8Array(16).fill(255), lines: [1, 2],
  }
  b.view.setToolpath(path)
  b.view.setPlaybackRange(0, 1)
  b.view.setPlayheadSegment(0)
  b.view.setFutureSegmentsVisible(false)
  b.view.setHiddenBodies([0, 1, 2, 3])
  b.view.setXrayMode(true)
  b.mock.reset()
  b.flush()
  assert.equal(b.mock.callsOf('drawElements').at(-1).args[1], b.mesh.indexCount())
  assert.equal(b.mock.callsOf('drawArrays').at(-1).args[2], 2)
  b.view.setPickMode('path')
  b.mock.setPickId(segmentToPickId(0))
  deepEqual(b.view.pickAt({ x: 150, y: 100 }), { kind: 2, index: 0 })
  assert.equal(b.view.ncLineOfSegment(0), 1)
  console.log('ok - X-ray picking, declared-body protection, hover cleanup and NC playback/path picking')
}

function testPhaseUploadDiscipline() {
  const a = makeView()
  const face = a.facesOfBody(2)[0]
  // gl_mock records bufferSubData as (target, offset, byteCount); a full phase upload is one
  // Uint8 per vertex, so its byte count equals the mesh vertex count.
  const fullPhaseBytes = a.mesh.vertexCount()
  a.mock.reset()
  a.view.setSelectedFids([a.pack.faces[face].fid])
  a.view.setSelectedFids([])
  a.flush()
  let uploads = a.mock.callsOf('bufferSubData').filter(call => call.args[0] === 34962)
  assert.ok(uploads.length > 0)
  assert.equal(uploads.filter(call => call.args[2] === fullPhaseBytes).length, 0)

  a.mock.reset()
  a.view.setDefaultTranslucentBodies([2])
  a.flush()
  uploads = a.mock.callsOf('bufferSubData').filter(call => call.args[0] === 34962)
  assert.equal(uploads.filter(call => call.args[2] === fullPhaseBytes).length, 1)
  assert.equal(a.view.facePhaseAt(face), 1)
  // facePhaseAt reads the first vertex of the face range; setFacePhase must keep the whole
  // face uniform, so verify every vertex here (TS-private fields are runtime-accessible).
  const range = a.mesh.faceRange(face)
  const vertexPhases = Array.from(a.view.renderer.phases.slice(range.vertexOffset, range.vertexOffset + range.vertexCount))
  assert.deepEqual(vertexPhases, new Array(range.vertexCount).fill(255), 'phase must be uniform across the whole face')
  a.mock.reset()
  a.view.setDefaultTranslucentBodies([2])
  a.flush()
  assert.equal(a.mock.callsOf('bufferSubData').filter(call => call.args[0] === 34962).length, 0)
  a.view.setDefaultTranslucentBodies([])
  a.flush()
  assert.equal(a.view.facePhaseAt(face), 0)
  const clearedPhases = Array.from(a.view.renderer.phases.slice(range.vertexOffset, range.vertexOffset + range.vertexCount))
  assert.deepEqual(clearedPhases, new Array(range.vertexCount).fill(0), 'cleared phase must be uniform across the whole face')
  console.log('ok - unchanged phase avoids full uploads; real phase changes upload once')
}

async function testHoverPhaseReset() {
  const a = makeView()
  const face = a.facesOfBody(1)[0]
  a.view.setDefaultTranslucentBodies([1])
  const hovers = []
  a.view.callbacks.hoverChanged = subject => hovers.push(subject.fid)
  a.canvas.dispatch('pointerenter')
  a.mock.setPickId(faceToPickId(face))
  a.canvas.dispatch('pointermove', { offsetX: 50, offsetY: 50 })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(hovers.at(-1), a.pack.faces[face].fid)
  assert.equal(a.view.facePhaseAt(face), 1)
  a.view.setDefaultTranslucentBodies([])
  assert.equal(a.view.facePhaseAt(face), 0, 'fast refresh must reset the hovered face phase')
  console.log('ok - hovered face phase resets when default translucency is cleared')
}

testDefaultTranslucency()
testXrayVisibilityAndOrdering()
testTypeFilterAndXray()
testContextRestoreAndEdges()
testMaskAndShaderContract()
await testPickingHoverAndNc()
await testHoverPhaseReset()
testPhaseUploadDiscipline()
console.log(`X-ray/translucency selfcheck complete; fixtures=${sourceCommit}; no real-NX or production-role evidence is implied.`)
