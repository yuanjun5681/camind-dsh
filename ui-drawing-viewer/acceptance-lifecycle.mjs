// M3-04 deterministic adapter + DraftPane lifecycle acceptance. Real React hook order,
// public pane messages, DOM listeners, ResizeObserver and GL call sequences are exercised;
// this is deliberately not a claim of live dsh-app:// or real-GPU desktop coverage.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'

const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const goodText = fs.readFileSync(path.join(DESKTOP, 'tests/fixtures/draft/draft_good.json'), 'utf8')
const goodPack = JSON.parse(goodText)
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.join(root, 'src'),
    contents: `export { DrawingPreview } from './client.ts'; export { DraftPane } from './draft/draft_pane.ts'; export { fitView } from './draft/draft_camera.ts'; export { makeGlMock } from ${JSON.stringify(path.join(DESKTOP, 'packages/viewer/test/gl_mock.ts'))};`,
  },
  bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react'],
})

let cursor = 0, hooks = [], currentContainer = null, currentProps = null, tree, mounted = false
let nextTimer = 1, beforeCreateElement = null
const timers = new Map()
const observers = []
const windowListeners = new Map()

function addListener(map, type, fn) {
  if (!map.has(type)) map.set(type, new Set())
  map.get(type).add(fn)
}
function removeListener(map, type, fn) {
  map.get(type)?.delete(fn)
}
function dispatch(map, type, event = {}) {
  for (const fn of [...(map.get(type) ?? [])]) fn({ preventDefault() {}, ...event })
}
function listenerCount(map) {
  let count = 0
  for (const listeners of map.values()) count += listeners.size
  return count
}
function setTimeoutFake(fn) {
  const id = nextTimer++
  timers.set(id, fn)
  return id
}
function clearTimeoutFake(id) {
  timers.delete(id)
}
function advanceTimers() {
  const pending = [...timers.values()]
  timers.clear()
  for (const fn of pending) fn()
}
function activeObservers() {
  return observers.filter(observer => observer.active).length
}
function windowListenerCount() {
  return listenerCount(windowListeners)
}
function windowDispatch(type, event = {}) {
  dispatch(windowListeners, type, event)
}

const window = {
  devicePixelRatio: 1,
  addEventListener(type, fn) { addListener(windowListeners, type, fn) },
  removeEventListener(type, fn) { removeListener(windowListeners, type, fn) },
}
class ResizeObserverMock {
  constructor(callback) {
    this.callback = callback
    this.active = false
    this.target = null
    observers.push(this)
  }
  observe(target) {
    this.target = target
    this.active = true
  }
  disconnect() {
    this.active = false
    this.target = null
  }
  trigger() {
    if (this.active) this.callback([], this)
  }
}

function makeEl(tag = 'div') {
  const children = [], listeners = new Map(), attributes = new Map()
  let ownText = ''
  const el = {
    tag,
    style: {},
    dataset: {},
    children,
    listeners,
    glMocks: [],
    rect: { left: 0, top: 0, width: 800, height: 600 },
    parent: null,
    hidden: false,
    className: '',
    get clientWidth() { return el.rect.width },
    get clientHeight() { return el.rect.height },
    get textContent() { return ownText },
    set textContent(value) {
      ownText = String(value ?? '')
      for (const child of children) if (child && typeof child === 'object') child.parent = null
      children.length = 0
    },
    appendChild(child) {
      children.push(child)
      if (child && typeof child === 'object') child.parent = el
      return child
    },
    addEventListener(type, fn) { addListener(listeners, type, fn) },
    removeEventListener(type, fn) { removeListener(listeners, type, fn) },
    dispatch(type, event = {}) { dispatch(listeners, type, event) },
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.get(name) ?? null },
    querySelector() { return null },
    querySelectorAll() { return [] },
    getBoundingClientRect() { return { ...el.rect } },
    getContext(kind) {
      if (kind === 'webgl2') {
        const mock = makeGlMock()
        el.glMocks.push(mock)
        mock.gl.canvas = el
        return mock.gl
      }
      const target = { measureText: text => ({ width: String(text).length * 10 }) }
      return new Proxy(target, {
        get(object, key) { return key in object ? object[key] : () => undefined },
        set(object, key, value) { object[key] = value; return true },
      })
    },
    remove() {
      if (!el.parent) return
      const index = el.parent.children.indexOf(el)
      if (index >= 0) el.parent.children.splice(index, 1)
      el.parent = null
    },
  }
  el.classList = {
    add(...names) {
      const current = new Set(el.className.split(/\s+/).filter(Boolean))
      for (const name of names) current.add(name)
      el.className = [...current].join(' ')
    },
    remove(...names) {
      const removed = new Set(names)
      el.className = el.className.split(/\s+/).filter(name => name && !removed.has(name)).join(' ')
    },
    contains(name) { return el.className.split(/\s+/).includes(name) },
  }
  return el
}

const document = {
  createElement: tag => {
    beforeCreateElement?.(tag)
    return makeEl(tag)
  },
  createTextNode: text => ({ text: String(text), parent: null }),
}
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useRef(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = { current: index === 0 ? currentContainer : initial }
    return hooks[index]
  },
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useEffect(fn, deps) {
    const index = cursor++
    const previous = hooks[index]
    const changed = !previous || !Array.isArray(previous.deps) || !deps
      || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))
    if (changed) {
      if (typeof previous?.cleanup === 'function') previous.cleanup()
      const cleanup = fn()
      hooks[index] = { deps: deps ?? [], cleanup }
    }
  },
}

const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module,
  exports: module.exports,
  require: name => {
    if (name === 'react') return react
    throw new Error(name)
  },
  document,
  window,
  ResizeObserver: ResizeObserverMock,
  performance,
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake,
  console,
})
const { DrawingPreview, DraftPane, fitView, makeGlMock } = module.exports

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
function descriptor(name, session, packText = goodText) {
  return {
    name, packText, session,
    source: { uri: `upload://batch/${name}`, sha256: '1'.repeat(64), name },
    pack: { sha256: '2'.repeat(64), identity: '3'.repeat(64) },
  }
}
function renderPreview(props = currentProps) {
  currentProps = props
  cursor = 0
  tree = DrawingPreview(props)
}
function mountPreview(props) {
  assert.equal(mounted, false, 'test harness must unmount before a fresh mount')
  hooks = []
  currentContainer = makeEl()
  mounted = true
  renderPreview(props)
  renderPreview(props)
  return currentContainer
}
function unmountPreview() {
  if (mounted) for (const hook of hooks) if (typeof hook?.cleanup === 'function') hook.cleanup()
  mounted = false
  currentProps = null
  tree = undefined
}
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return text(node.children)
}
function domText(node) {
  if (!node) return ''
  return String(node.text ?? node.textContent ?? '') + (node.children ?? []).map(domText).join('')
}
function clickEntityZero(container, camera = null) {
  const canvas = container.children[0]
  const state = camera ?? fitView(goodPack.bbox, canvas.width, canvas.height)
  const scale = canvas.height / (state.halfH * 2)
  const sx = (210 - state.cx) * scale + canvas.width / 2
  const sy = -(0 - state.cy) * scale + canvas.height / 2
  const dpr = canvas.width / (container.clientWidth || 1)
  const rect = canvas.getBoundingClientRect()
  canvas.dispatch('click', {
    clientX: rect.left + sx / dpr,
    clientY: rect.top + sy / dpr,
    button: 0,
    detail: 1,
  })
  advanceTimers()
}
function lastCameraUniform(mock) {
  const call = mock.callsOf('uniform3f').at(-1)
  assert.ok(call, 'a rendered pane must set its camera uniform')
  return { cx: call.args[0], cy: call.args[1], halfH: call.args[2] }
}
function assertCamera(actual, expected) {
  assert.ok(Math.abs(actual.cx - expected.cx) < 1e-9, `camera cx: ${actual.cx} != ${expected.cx}`)
  assert.ok(Math.abs(actual.cy - expected.cy) < 1e-9, `camera cy: ${actual.cy} != ${expected.cy}`)
  assert.ok(Math.abs(actual.halfH - expected.halfH) < 1e-9, `camera halfH: ${actual.halfH} != ${expected.halfH}`)
}
function assertGpuDisposed(mock, label) {
  assert.equal(mock.callsOf('deleteTexture').length, 1, `${label}: texture must be deleted once`)
  assert.equal(mock.callsOf('deleteBuffer').length, 1, `${label}: buffer must be deleted once`)
  assert.equal(mock.callsOf('deleteProgram').length, 1, `${label}: program must be deleted once`)
}
function countHighlights(data) {
  let count = 0
  for (let i = 0; i + 7 < data.length; i += 8) {
    if (data[i + 2] === 1 && Math.abs(data[i + 3] - 0.82) < 1e-5 && Math.abs(data[i + 4] - 0.2) < 1e-5) count++
  }
  return count
}

// Switching sessions disposes the whole old pane. A's delayed reference rejection cannot
// contaminate B, B starts at its own fit camera, and new references carry only B's identity.
const a = descriptor('a.dxf', 'session-a')
const b = descriptor('b.dxf', 'session-b')
const aReference = deferred()
const aRefs = [], bRefs = []
const sessionContainer = mountPreview({ descriptor: a, onReference: reference => { aRefs.push(reference); return aReference.promise } })
const aCanvas = sessionContainer.children[0]
const aGl = aCanvas.glMocks[0]
const aObserver = observers.at(-1)
clickEntityZero(sessionContainer)
assert.equal(aRefs.length, 1)
assert.equal(aRefs[0].session, 'session-a')
aCanvas.dispatch('pointerdown', { button: 0, clientX: 100, clientY: 100 })
windowDispatch('pointermove', { clientX: 155, clientY: 145 })
windowDispatch('pointerup', {})
const pannedA = lastCameraUniform(aGl)
assert.equal(aGl.callsOf('deleteBuffer').length, 0, 'A must be alive before the switch')

renderPreview({ descriptor: b, onReference: reference => { bRefs.push(reference) } })
renderPreview()
const bCanvas = sessionContainer.children[0]
const bGl = bCanvas.glMocks[0]
assert.notEqual(bCanvas, aCanvas)
assert.equal(aCanvas.parent, null, 'old A DOM must be detached on session switch')
assert.equal(listenerCount(aCanvas.listeners), 0, 'old A canvas listeners must be removed')
assert.equal(aObserver.active, false, 'old A ResizeObserver must be disconnected')
assertGpuDisposed(aGl, 'A session switch')
assert.equal(activeObservers(), 1, 'B must own exactly one ResizeObserver')
assert.equal(windowListenerCount(), 4, 'B must own pointermove/up/cancel/resize window listeners')
assertCamera(lastCameraUniform(bGl), fitView(goodPack.bbox, bCanvas.width, bCanvas.height))
assert.notDeepEqual(lastCameraUniform(bGl), pannedA, 'B must not inherit A\'s panned camera')

aReference.reject(new Error('stale-session-a-reference'))
await flush()
renderPreview()
assert.equal(text(tree).includes('stale-session-a-reference'), false, 'stale A reference failure must be isolated')
clickEntityZero(sessionContainer)
assert.equal(bRefs.filter(reference => reference !== null).length, 1)
assert.equal(bRefs.at(-1).session, 'session-b')
assert.equal(bRefs.at(-1).source.name, 'b.dxf')
assert.equal(aRefs.filter(reference => reference !== null).length, 1, 'old A canvas must not emit more references')
aCanvas.dispatch('click', { button: 0, detail: 1, clientX: 400, clientY: 300 })
advanceTimers()
assert.equal(aRefs.filter(reference => reference !== null).length, 1)
unmountPreview()
assertGpuDisposed(bGl, 'B unmount')
assert.equal(activeObservers(), 0)
assert.equal(windowListenerCount(), 0)
console.log('ok - session switch clears old DOM/camera/references and isolates stale callbacks')

// The upstream pane intentionally keeps A when a load B fails in-place. The React adapter
// must instead dispose and clear A before constructing/loading B, so failure never labels A as B.
const good = descriptor('good-a.dxf', 'session-good')
const bad = descriptor('bad-b.dxf', 'session-bad', JSON.stringify({ format: 'other' }))
const failureContainer = mountPreview({ descriptor: good })
const goodCanvas = failureContainer.children[0]
const goodGl = goodCanvas.glMocks[0]
let clearedBeforeBadLoad = false
beforeCreateElement = tag => {
  if (tag === 'canvas' && !clearedBeforeBadLoad) {
    clearedBeforeBadLoad = failureContainer.children.length === 0 && goodCanvas.parent === null
      && goodGl.callsOf('deleteBuffer').length === 1
  }
}
renderPreview({ descriptor: bad })
beforeCreateElement = null
assert.ok(clearedBeforeBadLoad, 'adapter must dispose and clear A before constructing/loading B')
renderPreview()
const badCanvas = failureContainer.children[0]
assert.notEqual(badCanvas, goodCanvas)
assert.equal(goodCanvas.parent, null)
assertGpuDisposed(goodGl, 'failed B replacement')
assert.equal(badCanvas.glMocks.length, 0, 'bad B must not render or retain A\'s GL view')
assert.match(text(tree), /bad-b\.dxf/)
assert.match(text(tree), /图纸包校验未过/)
assert.doesNotMatch(text(tree), /16 实体/)
assert.doesNotMatch(text(tree), /good-a\.dxf/)
unmountPreview()
assert.equal(activeObservers(), 0)
assert.equal(windowListenerCount(), 0)
console.log('ok - failed B load clears A instead of presenting retained A as B')

// Full unmount/remount cycles must not accumulate listeners, observers or GPU objects.
for (let attempt = 0; attempt < 3; attempt++) {
  const container = mountPreview({ descriptor: a })
  const canvas = container.children[0]
  const mock = canvas.glMocks[0]
  assert.equal(activeObservers(), 1)
  assert.equal(windowListenerCount(), 4)
  unmountPreview()
  assertGpuDisposed(mock, `React remount ${attempt + 1}`)
  assert.equal(listenerCount(canvas.listeners), 0)
  assert.equal(container.children.length, 0)
  assert.equal(activeObservers(), 0)
  assert.equal(windowListenerCount(), 0)
}
assert.equal(timers.size, 0)
console.log('ok - React remount releases listeners, observers and GPU resources every time')

// Public DraftPane messages exercise deterministic hidden/zero-size, DPR, pointercancel,
// WebGL loss/restoration and final dispose behavior without touching private pane members.
const paneContainer = makeEl()
const messages = []
const pane = new DraftPane(paneContainer, message => messages.push(message))
const paneObserver = observers.at(-1)
const paneCanvas = paneContainer.children[0]
pane.handle({ type: 'load', messageVersion: 2, packText: goodText, name: 'lifecycle.dxf', provenance: null })
assert.equal(messages.filter(message => message.type === 'loaded').length, 1)
const firstGl = paneCanvas.glMocks[0]
const camera = () => {
  pane.handle({ type: 'getCamera', messageVersion: 2 })
  const message = messages.at(-1)
  assert.equal(message.type, 'camera')
  return message.state
}

paneContainer.hidden = true
paneContainer.rect = { left: 0, top: 0, width: 0, height: 0 }
paneObserver.trigger()
assert.equal(paneCanvas.width, 1)
assert.equal(paneCanvas.height, 1)
assert.equal(firstGl.callsOf('deleteBuffer').length, 0, 'hidden viewport must not dispose the drawing')
paneContainer.hidden = false
paneContainer.rect = { left: 0, top: 0, width: 800, height: 600 }
paneObserver.trigger()
assert.equal(paneCanvas.width, 800)
assert.equal(paneCanvas.height, 600)

window.devicePixelRatio = 2
paneContainer.rect = { left: 0, top: 0, width: 0, height: 600 }
paneObserver.trigger()
assert.equal(paneCanvas.width, 1, 'zero CSS width still gets one physical pixel')
assert.equal(paneCanvas.height, 1200)
window.devicePixelRatio = 3
paneContainer.rect = { left: 0, top: 0, width: 320, height: 200 }
pane.handle({ type: 'resize', messageVersion: 2 })
assert.equal(paneCanvas.width, 640, 'DPR must be clamped to two')
assert.equal(paneCanvas.height, 400)
window.devicePixelRatio = 1.5
paneContainer.rect = { left: 0, top: 0, width: 800, height: 600 }
pane.handle({ type: 'resize', messageVersion: 2 })
assert.equal(paneCanvas.width, 1200)
assert.equal(paneCanvas.height, 900)
window.devicePixelRatio = 1
pane.handle({ type: 'resize', messageVersion: 2 })
pane.handle({ type: 'fit', messageVersion: 2 })
assert.equal(messages.filter(message => message.type === 'error').length, 0)
console.log('ok - hidden/zero viewport and DPR changes keep bounded physical canvases')

const initialCamera = camera()
paneCanvas.dispatch('pointerdown', { button: 0, clientX: 100, clientY: 100 })
windowDispatch('pointermove', { clientX: 150, clientY: 140 })
windowDispatch('pointercancel', {})
const cancelledCamera = camera()
assert.notDeepEqual(cancelledCamera, initialCamera, 'drag before cancel must have moved the camera')
windowDispatch('pointermove', { clientX: 240, clientY: 250 })
assert.deepEqual(camera(), cancelledCamera, 'pointermove after pointercancel must not keep dragging')
let selectionCount = messages.filter(message => message.type === 'selectionChanged').length
paneCanvas.dispatch('click', { button: 0, detail: 1, clientX: 0, clientY: 0 })
advanceTimers()
assert.equal(messages.filter(message => message.type === 'selectionChanged').length, selectionCount,
  'click following pointercancel must not pick')

pane.handle({ type: 'fit', messageVersion: 2 })
const fitted = camera()
const canvasForClick = paneCanvas
const scale = canvasForClick.height / (fitted.halfH * 2)
canvasForClick.dispatch('click', {
  clientX: (210 - fitted.cx) * scale + canvasForClick.width / 2,
  clientY: -(0 - fitted.cy) * scale + canvasForClick.height / 2,
  button: 0,
  detail: 1,
})
windowDispatch('pointercancel', {})
advanceTimers()
assert.equal(messages.filter(message => message.type === 'selectionChanged').length, selectionCount,
  'pointercancel must cancel a pending click selection')
console.log('ok - pointercancel stops dragging and suppresses pending/subsequent picking')

pane.handle({ type: 'setViewportInsets', messageVersion: 2, top: 10, right: 20, bottom: 30, left: 40 })
pane.handle({ type: 'setCamera', messageVersion: 2, state: { cx: 12, cy: -4, halfH: 9 } })
pane.handle({ type: 'setSelection', messageVersion: 2, targets: [{ type: 'entity', id: 0 }] })
pane.handle({ type: 'setLayerVisible', messageVersion: 2, layer: 'DIM', visible: false })
firstGl.reset()
let prevented = 0
paneCanvas.dispatch('webglcontextlost', { preventDefault() { prevented++ } })
assert.equal(prevented, 1)
assertGpuDisposed(firstGl, 'context lost')
paneCanvas.dispatch('webglcontextrestored', {})
assert.equal(paneCanvas.glMocks.length, 2, 'restore must construct one replacement GL view')
const restoredGl = paneCanvas.glMocks[1]
assert.ok(restoredGl.callsOf('bufferData').length > 0)
assert.equal(messages.filter(message => message.type === 'loaded').length, 1, 'restore is not a new drawing load')
assertCamera(camera(), { cx: 12, cy: -4, halfH: 9 })
assert.deepEqual([...restoredGl.callsOf('viewport').at(-1).args], [40, 30, 740, 560], 'insets must survive restore')
const layers = paneContainer.children[3]
const dimLabel = layers.children.find(label => domText(label).includes('DXF 图层: DIM'))
assert.ok(dimLabel)
assert.equal(dimLabel.children[0].checked, false, 'layer visibility must survive restore')

let lineUpload = null
const originalBufferSubData = restoredGl.gl.bufferSubData
restoredGl.gl.bufferSubData = (target, offset, data, srcOffset, length) => {
  if (offset === 0 && data?.subarray) {
    const start = srcOffset ?? 0
    const count = length ?? data.length - start
    lineUpload = Float32Array.from(data.subarray(start, start + count))
  }
  return originalBufferSubData(target, offset, data, srcOffset, length)
}
pane.handle({ type: 'fit', messageVersion: 2 })
assert.ok(lineUpload)
const restoredHighlights = countHighlights(lineUpload)
assert.ok(restoredHighlights > 0, 'selected entity highlight must survive context restore')
pane.handle({ type: 'clearSelection', messageVersion: 2 })
assert.ok(countHighlights(lineUpload) < restoredHighlights, 'clearSelection must remove the restored highlight')
assert.equal(messages.filter(message => message.type === 'selectionChanged').at(-1).targets.length, 0)
console.log('ok - WebGL context restore preserves camera, selection, layers and insets')

pane.dispose()
assertGpuDisposed(restoredGl, 'final dispose')
assertGpuDisposed(firstGl, 'context-lost view remains singly disposed')
assert.equal(listenerCount(paneCanvas.listeners), 0)
assert.equal(windowListenerCount(), 0)
assert.equal(activeObservers(), 0)
assert.equal(paneContainer.children.length, 0)
const messageCount = messages.length
paneCanvas.dispatch('webglcontextrestored', {})
paneCanvas.dispatch('click', { button: 0, detail: 1, clientX: 10, clientY: 10 })
windowDispatch('pointermove', { clientX: 20, clientY: 20 })
paneObserver.trigger()
pane.handle({ type: 'load', messageVersion: 2, packText: goodText, name: 'after-dispose.dxf' })
advanceTimers()
assert.equal(messages.length, messageCount, 'disposed pane must stay inert')
assert.equal(paneCanvas.glMocks.length, 2, 'disposed pane must not resurrect GL resources')
assert.equal(timers.size, 0)
pane.dispose()
assertGpuDisposed(restoredGl, 'idempotent dispose')
console.log('ok - dispose leaves no listeners, observers, GPU resources or resurrecting work')
console.log('ui-drawing-viewer lifecycle acceptance passed (deterministic mocks; live desktop not exercised)')
