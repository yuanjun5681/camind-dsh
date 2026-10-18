// Multi-body visibility/selection state-machine checks with synthetic GL/CPU data; no real NX or production evidence.
import assert from 'node:assert/strict'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'

const deepEqual = (actual, expected, message) => assert.deepEqual(
  JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message)

const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.join(root, 'src'),
    contents: `
      export { GeomView } from './viewer/geom_view.ts';
      export { SceneRenderer, viewParamsFromCamera, defaultRenderOptions } from './viewer/scene_renderer.ts';
      export { SelectionModel } from './core/select/selection.ts';
      export { cpuPick, rayThroughPixel, segmentToPickId } from './core/pick.ts';
      export { OrbitCamera } from './core/camera.ts';
      export { meshBounds } from './core/buffers.ts';
      export { makeSyntheticPackMulti, parseSyntheticMesh, parseSyntheticEdges } from ${JSON.stringify(path.join(DESKTOP, 'packages/viewer/src/synthetic_pack.ts'))};
      export { makeGlMock } from ${JSON.stringify(path.join(DESKTOP, 'packages/viewer/test/gl_mock.ts'))};
    `,
  },
  bundle: true, write: false, absWorkingDir: path.join(root, 'src'),
  alias: { '@camind/core': path.join(root, 'src/core/index.ts') },
  platform: 'browser', format: 'cjs',
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, performance, setTimeout, clearTimeout, console,
})
const {
  GeomView, SceneRenderer, viewParamsFromCamera, defaultRenderOptions, SelectionModel,
  cpuPick, rayThroughPixel, segmentToPickId, OrbitCamera, meshBounds,
  makeSyntheticPackMulti, parseSyntheticMesh, parseSyntheticEdges, makeGlMock,
} = module.exports

const FACE_FULL = 13824
const EDGE_FULL = 2304

class FakeCanvas {
  constructor() {
    this.listeners = new Map()
    this.width = 0; this.height = 0
    this.clientWidth = 300; this.clientHeight = 200
    this.style = {}
  }
  addEventListener(type, fn) { (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)).push(fn) }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)) }
  dispatch(type, ev = {}) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ preventDefault() {}, ...ev }) }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function makeView(identity = { sourceSha256: 'source', geometrySha256: 'geometry' }) {
  const mock = makeGlMock()
  const canvas = new FakeCanvas()
  let frames = [], consumed = 0
  const view = new GeomView(canvas, mock.gl, { requestFrame: fn => { frames.push(fn) } })
  const pack = makeSyntheticPackMulti(4000, 4, 8, 120.0)
  const mesh = parseSyntheticMesh(pack)
  view.setPart('prt@gp-1', pack.faces, pack.bodies, identity)
  view.setMesh(mesh)
  return {
    view, mock, canvas, pack, mesh,
    runFrame() {
      if (frames.length === 0) throw new Error('runFrame:无挂起帧')
      const fns = frames; frames = []
      for (const fn of fns) fn()
      const calls = mock.callsOf('drawElements')
      const slice = calls.slice(consumed).map(c => c.args[1])
      consumed = calls.length
      return slice
    },
    faceExpect(hidden) {
      const hide = new Set(hidden)
      let sum = 0
      for (let f = 0; f < pack.faces.length; ++f)
        if (!hide.has(pack.faces[f].body)) sum += mesh.faceRange(f).indexCount
      return sum
    },
    edgeExpect(hidden) {
      return EDGE_FULL * (4 - new Set(hidden).size) / 4
    },
  }
}

function testVisibilityStateMachine() {
  const a = makeView()
  a.view.setEdges(parseSyntheticEdges(a.pack))
  const initialDraws = a.runFrame()
  deepEqual(initialDraws, [FACE_FULL, EDGE_FULL], `${initialDraws.map(x => `${x}(${typeof x})`).join('、')}`)
  a.view.setHiddenBodies([1])
  deepEqual(a.runFrame(), [a.faceExpect([1]), a.edgeExpect([1])])
  a.view.setHiddenBodies([0, 1, 2, 3])
  deepEqual(a.runFrame(), [])
  a.view.setHiddenBodies(null)
  deepEqual(a.runFrame(), [FACE_FULL, EDGE_FULL])

  const finePack = makeSyntheticPackMulti(16000, 4, 16, 120.0)
  const fineMesh = parseSyntheticMesh(finePack)
  a.view.setHiddenBodies([1])
  a.view.setMesh(fineMesh)
  a.view.setEdges(parseSyntheticEdges(finePack))
  let fineFace = 0
  for (let f = 0; f < finePack.faces.length; ++f)
    if (finePack.faces[f].body !== 1) fineFace += fineMesh.faceRange(f).indexCount
  deepEqual(a.runFrame(), [fineFace, 3456])

  a.canvas.dispatch('webglcontextlost')
  a.view.setHiddenBodies([2])
  deepEqual(a.view.hiddenBodiesOf(), [2])
  let fineFace2 = 0
  for (let f = 0; f < finePack.faces.length; ++f)
    if (finePack.faces[f].body !== 2) fineFace2 += fineMesh.faceRange(f).indexCount
  a.canvas.dispatch('webglcontextrestored')
  deepEqual(a.runFrame(), [fineFace2, 3456])
  a.view.setPart('prt-2@gp-1', a.pack.faces, a.pack.bodies, { sourceSha256: 'source-2', geometrySha256: 'geometry-2' })
  deepEqual(a.view.hiddenBodiesOf(), [])
  a.view.setMesh(a.mesh)
  deepEqual(a.runFrame(), [FACE_FULL])

  const events = []
  a.view.callbacks.visibilityChanged = hidden => events.push(hidden)
  a.view.setHiddenBodies([3, 1])
  a.view.setHiddenBodies([3, 1])
  a.view.setHiddenBodies([2])
  deepEqual(events, [[1, 3], [2]])
  a.view.setPartIdentity({ sourceSha256: 'source-3', geometrySha256: 'geometry-3' })
  deepEqual(events, [[1, 3], [2], []])
  deepEqual(a.runFrame(), [FACE_FULL])

  const b = makeView()
  b.view.setEdges(parseSyntheticEdges(b.pack))
  b.runFrame()
  b.view.dispose()
  b.canvas.dispatch('webglcontextlost')
  b.canvas.dispatch('webglcontextrestored')
  assert.throws(() => b.runFrame(), /无挂起帧/)
  console.log('ok - visible indices, LOD swap, restore, reset and dispose')
}

function testBlankedAndSmallBuffers() {
  const a = makeView()
  for (const body of a.pack.bodies) body.blanked = true
  a.view.setPart('blanked@gp-1', a.pack.faces, a.pack.bodies, { sourceSha256: 'source', geometrySha256: 'geometry' })
  a.view.setMesh(a.mesh)
  a.view.setEdges(parseSyntheticEdges(a.pack))
  deepEqual(a.view.hiddenBodiesOf(), [0, 1, 2, 3])
  deepEqual(a.runFrame(), [])
  assert.equal(a.view.pickAt({ x: 150, y: 100 }).kind, 0)

  const mock = makeGlMock()
  const renderer = new SceneRenderer(mock.gl)
  const pack = makeSyntheticPackMulti(4000, 4, 8, 120.0)
  renderer.setMesh(parseSyntheticMesh(pack), pack.faces)
  renderer.setEdges(parseSyntheticEdges(pack))
  const params = viewParamsFromCamera(new OrbitCamera(), 1.5)
  const options = { ...defaultRenderOptions(), showToolpath: false }
  renderer.render(params, 300, 200, options)
  const original = mock.gl.bufferSubData
  mock.gl.bufferSubData = (target, offset, data, srcOffset, length) => {
    if (length === 0 && data.byteLength > 0) throw new Error('INVALID_VALUE')
    return original(target, offset, data, srcOffset, length)
  }
  renderer.setHiddenBodies([0, 1, 2, 3])
  const fine = makeSyntheticPackMulti(1024, 4, 4)
  renderer.setMesh(parseSyntheticMesh(fine), fine.faces)
  renderer.setEdges(parseSyntheticEdges(fine))
  renderer.render(params, 300, 200, options)
  assert.equal(renderer.visibleIndexDrawCount(), 0)
  assert.equal(renderer.edgeVisibleIndexDrawCount(), 0)
  console.log('ok - blanked initial hidden and zero-length edge upload')
}

function testSelectionAndRoles() {
  const selection = new SelectionModel()
  selection.reset(['a', 'b'], [0, 1])
  deepEqual(selection.click(0, 'replace').added, [0])
  selection.setDeclaredBodies([0])
  deepEqual(selection.click(0, 'replace'), { added: [], removed: [] })
  deepEqual(selection.selection(), [0])
  deepEqual(selection.setSelection([0, 1]).added, [1])
  deepEqual(selection.selection(), [0, 1])
  selection.setSelection([1])
  deepEqual(selection.selection(), [1])
  selection.setSelection([0])
  deepEqual(selection.selection(), [])
  selection.reset(['a', 'b'], [0, 1])
  assert.equal(selection.isDeclaredFace(0), false)
  const filtered = new SelectionModel()
  filtered.reset(['a', 'b'], [0, 1])
  filtered.click(1, 'replace')
  deepEqual(filtered.setTypeFilter(new Set(['a'])).removed, [1])
  deepEqual(filtered.click(1, 'replace').removed, [])
  deepEqual(filtered.selection(), [])

  const a = makeView()
  a.view.setSelectedFids(['F000001'])
  deepEqual(a.view.selectedFids(), ['F000001'])
  a.view.setHiddenBodies([0])
  deepEqual(a.view.selectedFids(), ['F000001'])
  a.view.setHiddenBodies([0, 1, 2, 3])
  assert.equal(a.view.pickAt({ x: 150, y: 100 }).kind, 0)

  a.view.setSelectedFids([])
  a.view.setSelectableBodies([0])
  assert.equal(a.view.isDeclaredFace(0), true)
  assert.equal(a.view.isDeclaredFace(1), false)
  a.view.setSelectedFids(['F000001'])
  deepEqual(a.view.selectedFids(), [])
  a.view.setSelectedFids(['F000002'])
  a.view.setSelectableBodies([0])
  deepEqual(a.view.selectedFids(), ['F000002'])
  a.view.setPartIdentity({ sourceSha256: 'source-2', geometrySha256: 'geometry' })
  assert.equal(a.view.isDeclaredFace(0), false)
  a.view.setSelectableBodies([0])
  a.view.setPartIdentity({ sourceSha256: 'source-2', geometrySha256: 'geometry-2' })
  assert.equal(a.view.isDeclaredFace(0), false)
  a.view.setPartIdentity({ sourceSha256: '', geometrySha256: '' })
  a.view.setSelectableBodies([0])
  assert.equal(a.view.isDeclaredFace(0), false)
  a.pack.bodies[0].name = '电极'
  assert.equal(a.view.isDeclaredFace(0), false)

  a.view.setPartIdentity({ sourceSha256: 'source', geometrySha256: 'geometry' })
  a.view.setHiddenBodies([1])
  a.view.isolateBody(2)
  deepEqual(a.view.hiddenBodiesOf(), [0, 1, 3])
  assert.equal(a.view.isolationBody(), 2)
  a.view.clearIsolation()
  deepEqual(a.view.hiddenBodiesOf(), [1])
  assert.equal(a.view.isolationBody(), null)
  a.view.isolateBody(2)
  a.view.setPartIdentity({ sourceSha256: 'source-2', geometrySha256: 'geometry-2' })
  assert.equal(a.view.isolationBody(), null)
  const bounds = a.view.getCamera().sceneBounds()
  a.view.fitToBody(1)
  deepEqual(a.view.getCamera().sceneBounds(), bounds)
  console.log('ok - selection predicates, declared identities, isolation and fitToBody')
}

function peel(mesh, ray, visible) {
  let origin = ray.origin, travelled = 0
  for (let guard = 0; guard < 64; ++guard) {
    const hit = cpuPick(mesh, { origin, direction: ray.direction })
    if (!hit.hit) return { hit: false, face: 0, t: Infinity }
    if (visible(hit.face)) return { hit: true, face: hit.face, t: travelled + hit.t }
    const step = hit.t + 1e-4
    origin = { x: origin.x + ray.direction.x * step, y: origin.y + ray.direction.y * step, z: origin.z + ray.direction.z * step }
    travelled += step
  }
  throw new Error('剥层未收敛')
}

function testCpuAndPath() {
  const a = makeView()
  const cpuPack = makeSyntheticPackMulti(4000, 4, 8)
  const cpuMesh = parseSyntheticMesh(cpuPack)
  const hidden = new Set([2, 3])
  const visible = f => !hidden.has(cpuPack.faces[f].body)
  const camera = new OrbitCamera()
  camera.setAngles(-Math.PI / 4, 0.6154797086703873)
  camera.setSceneBounds(meshBounds(cpuMesh))
  camera.fit(800 / 600)
  const inv = camera.viewProjection(800 / 600).inverted()
  let revealed = 0, onVisible = 0
  for (let px = 10; px < 800; px += 20) {
    for (let py = 10; py < 600; py += 20) {
      const ray = rayThroughPixel(inv, 800, 600, px, py)
      const all = cpuPick(cpuMesh, ray)
      const got = cpuPick(cpuMesh, ray, visible)
      const want = peel(cpuMesh, ray, visible)
      assert.equal(got.hit, want.hit, `(${px},${py})`)
      if (got.hit) {
        assert.equal(got.face, want.face)
        assert.ok(Math.abs(got.t - want.t) < 1e-3)
        assert.equal(visible(got.face), true)
      }
      if (all.hit && visible(all.face)) {
        ++onVisible
        assert.equal(got.face, all.face)
        assert.equal(got.t, all.t)
      } else if (all.hit && got.hit) {
        ++revealed
        assert.ok(got.t > all.t)
      }
    }
  }
  assert.ok(onVisible > 0 && revealed > 0, `onVisible=${onVisible} revealed=${revealed}`)

  const path = {
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 20, 10, 0]),
    colors: new Uint8Array(16).fill(255),
    lines: [1, 2],
  }
  a.view.setToolpath(path)
  a.view.setPlaybackRange(0, 1)
  a.view.setPlayheadSegment(0)
  a.view.setFutureSegmentsVisible(false)
  a.view.setHiddenBodies([0, 1, 2, 3])
  a.runFrame()
  deepEqual(a.mock.callsOf('drawElements'), [])
  const arrays = a.mock.callsOf('drawArrays')
  assert.equal(arrays.at(-1).args[2], 2)
  a.view.setPickMode('path')
  a.mock.setPickId(segmentToPickId(0))
  deepEqual(a.view.pickAt({ x: 150, y: 100 }), { kind: 2, index: 0 })
  assert.equal(a.view.ncLineOfSegment(0), 1)

  for (const [type, pointerId] of [['pointercancel', 1], ['lostpointercapture', 2]]) {
    const before = a.mock.callsOf('readPixels').length
    a.canvas.dispatch('pointerdown', { button: 0, offsetX: 150, offsetY: 100, pointerId })
    a.canvas.dispatch(type, { pointerId })
    a.canvas.dispatch('pointerup', { button: 0, offsetX: 150, offsetY: 100, pointerId })
    assert.equal(a.mock.callsOf('readPixels').length, before, type)
  }
  console.log('ok - CPU/GPU visibility, NC playback/path pick and pointer cancellation')
}

testVisibilityStateMachine()
testBlankedAndSmallBuffers()
testSelectionAndRoles()
testCpuAndPath()
console.log('multi-body visibility selfcheck complete; hidden bodies never remain pickable by visible-index or CPU paths.')
