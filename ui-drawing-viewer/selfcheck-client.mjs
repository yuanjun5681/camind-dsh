// Runtime checks for degradation updates and reference callback isolation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const goodText = fs.readFileSync(path.join(DESKTOP, 'tests/fixtures/draft/draft_good.json'), 'utf8')
const { outputFiles } = await build({
  stdin: {
    resolveDir: path.join(root, 'src'),
    contents: `export { DrawingPreview } from './client.ts'; export { fitView } from './draft/draft_camera.ts'; export { makeGlMock } from ${JSON.stringify(path.join(DESKTOP, 'packages/viewer/test/gl_mock.ts'))};`,
  },
  bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react'],
})
const module = { exports: {} }
let cursor = 0, hooks = [], cleanups = [], container
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useRef(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = { current: index === 0 ? container : initial }
    return hooks[index]
  },
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = initial
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useEffect(fn) {
    const index = cursor++
    if (!(index in hooks)) { hooks[index] = true; cleanups[index] = fn() }
  },
}
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => {
    if (name === 'react') return react
    throw new Error(name)
  },
  document: { createElement: () => makeEl(), createTextNode: text => ({ text }) },
  window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  performance, setTimeout, clearTimeout, console,
})
const { DrawingPreview, fitView, makeGlMock } = module.exports

function makeEl() {
  const children = [], listeners = new Map()
  const el = {
    style: {}, children, clientWidth: 800, textContent: '', glMocks: [],
    appendChild(c) { children.push(c); return c },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]) },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter(f => f !== fn)) },
    dispatch(type, event) { for (const fn of listeners.get(type) ?? []) fn(event) },
    querySelector() { return null }, querySelectorAll() { return [] },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 } },
    getContext(kind) {
      if (kind === 'webgl2') {
        const mock = makeGlMock(); el.glMocks.push(mock); mock.gl.canvas = el
        return mock.gl
      }
      return new Proxy({ measureText: () => ({ width: 20 }) }, { get: (o, k) => k in o ? o[k] : () => {} })
    },
  }
  return el
}
globalThis.document = { createElement: () => makeEl(), createTextNode: text => ({ text }) }
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
container = makeEl()
let tree
function render(descriptor, onReference) { cursor = 0; tree = DrawingPreview({ descriptor, onReference }) }
function freshPreview() { hooks = []; cleanups = []; cursor = 0; container = makeEl(); tree = undefined }
function text(node) { return node && typeof node === 'object' ? node.children.map(text).join('') : String(node ?? '') }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const baseDescriptor = {
  name: 'part.dwg', packText: goodText, session: 's1',
  source: { uri: 'upload://batch/part.dwg', sha256: '1'.repeat(64), name: 'part.dwg' },
  pack: { sha256: '2'.repeat(64), identity: '3'.repeat(64) },
}
function clickEntity0() {
  const camera = fitView(JSON.parse(goodText).bbox, 800, 600)
  const scale = 600 / (camera.halfH * 2)
  const canvas = container.children[0]
  canvas.dispatch('click', {
    clientX: (210 - camera.cx) * scale + 400,
    clientY: -(0 - camera.cy) * scale + 300,
    button: 0, detail: 1, preventDefault() {},
  })
}

render(baseDescriptor, () => { throw new Error('sync-reference-failure') })
clickEntity0()
await sleep(250)
render(baseDescriptor, () => { throw new Error('sync-reference-failure') })
assert.match(text(tree), /sync-reference-failure/)
console.log('ok - synchronous reference failure is contained')

freshPreview()
let rejectReference
render(baseDescriptor, () => new Promise((_, reject) => { rejectReference = reject }))
clickEntity0()
await sleep(250)
for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
rejectReference(new Error('stale-reference-failure'))
await sleep(20)
render(baseDescriptor, () => new Promise(() => {}))
assert.equal(text(tree).includes('stale-reference-failure'), false)
console.log('ok - disposed preview ignores stale reference rejection')

const dense = JSON.parse(goodText)
const line = dense.entities[0], mtext = dense.entities[8]
dense.entities = [
  ...Array.from({ length: 7000 }, (_, i) => ({ ...line, id: i, layer: 'dense', view_id: 0 })),
  ...Array.from({ length: 300 }, (_, i) => ({ ...mtext, id: 7000 + i, layer: 'dense', view_id: 0, dim_id: undefined })),
]
dense.dims = []
dense.layers = { dense: { aci: 7, off: true, frozen: false, plot: true } }
dense.coverage.entities_by_type = { line: 7000, mtext: 300 }
dense.coverage.semantic.dims = { found: 0, parsed: 0 }
Object.assign(dense.self_check, { input_entities: 7300, drawn_entities: 7300, insert_exploded: 0, star_d_exploded: 0, truecolor_count: 0 })
dense.self_check.dropped = { by_type: {}, by_reason: {} }
const denseDescriptor = { name: 'dense.dwg', packText: JSON.stringify(dense) }
freshPreview()
render(denseDescriptor)
assert.equal(text(tree).includes('几何已抽稀'), false)
assert.equal(text(tree).includes('文字有截断'), false)
const layers = container.children[3]
const denseLabel = layers.children.find(label => label.children?.[1]?.text?.includes('DXF 图层: dense'))
denseLabel.children[0].checked = true
denseLabel.children[0].dispatch('change', {})
await sleep(20)
render(denseDescriptor)
assert.match(text(tree), /几何已抽稀/)
assert.match(text(tree), /文字有截断/)
console.log('ok - degradation badges follow subsequent stats')

freshPreview()
const invalidations = []
render(baseDescriptor, reference => { invalidations.push(reference) })
clickEntity0()
await sleep(250)
for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
assert.ok(invalidations.some(reference => reference?.kind === 'camind-drawing-ref'))
assert.equal(invalidations.at(-1), null, 'unmount must invalidate pending references')
console.log('ok - deselection and disposal invalidate pending drawing references')

freshPreview()
const controllerReferences = []
const adapter = () => null
const renderAdapter = () => { cursor = 0; tree = DrawingPreview({ descriptor: baseDescriptor, onReference: reference => { controllerReferences.push(reference) }, adapter }) }
const findNode = (root, predicate) => {
  if (predicate(root)) return root
  for (const child of root?.children ?? []) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}
const adapterNode = root => findNode(root, node => node?.type === adapter)
renderAdapter()
renderAdapter()
assert.ok(findNode(tree, node => node?.props?.className?.includes('cdv-body-adapted')), 'adapter controls must use the separate grid row rather than covering pane chrome')
let controls = adapterNode(tree).props
assert.ok(controls.controller)
assert.equal(controls.viewportRef.current, container)
controls.controller.setViewportInsets({ top: 10, right: 20, bottom: 30, left: 40 })
assert.deepEqual(Array.from(container.children[0].glMocks[0].callsOf('viewport').at(-1).args), [40, 30, 740, 560])
controls.controller.zoomToRect({ x: 10, y: 20, width: 100, height: 50 })
controls.controller.zoom(1.3)
controls.controller.fit()
controls.controller.setColorMode('original')
controls.controller.setColorMode('readable')
controls.controller.setSelection([{ type: 'entity', id: 0 }])
assert.equal(controllerReferences.at(-1).target.id, 0)
renderAdapter()
controls = adapterNode(tree).props
assert.deepEqual(JSON.parse(JSON.stringify(controls.selection)), [{ type: 'entity', id: 0 }])
controls.controller.locateTarget({ type: 'dim', id: 'D2A/30' }, true)
assert.equal(controllerReferences.at(-1).target.id, 'D2A/30')
controls.controller.clearSelection()
assert.equal(controllerReferences.at(-1), null)
console.log('ok - public controller maps CSS controls to pane v2 and restores native selection')
