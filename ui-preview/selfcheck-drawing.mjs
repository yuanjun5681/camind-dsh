// M3-01 browser drawing dispatch: start/poll/read/cancel, conversion failure and WebGL-only degradation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
assert.ok(source.includes('/\\.(?:dwg|dxf)$/i'), 'DWG and DXF must share the drawing dispatch')
let factory
let cursor = 0, hooks = [], webgl = true
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
  },
  useRef(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = { current: initial }
    return hooks[index]
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
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
const document = {
  createElement: tag => ({
    tag,
    setAttribute() {},
    remove() {},
    getContext: kind => tag === 'canvas' && kind === 'webgl2' ? (webgl ? {} : null) : {},
  }),
  head: { appendChild() {} },
}
const Viewer = props => ({ type: 'drawing-viewer', props })
const slots = {
  entriesOfSlot: name => name === 'cam.drawing.preview' ? [{ options: { key: 'drawing-viewer' }, component: Viewer }] : [],
  subscribe: () => () => {},
  inject: (_name, fn) => fn(),
  register: () => {},
}
const window = { __ModuleLoader__: { load: definition => { factory = definition.factory } } }
runInNewContext(source, {
  window,
  document,
  fetch,
  require: name => {
    if (name === 'react') return react
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null }
    throw new Error(name)
  },
  console,
  setTimeout,
  clearTimeout,
  Blob,
  URL,
})
const loaded = factory(name => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null }
  throw new Error(name)
})
loaded.apply({
  slots,
  get: () => null,
  effect: fn => { fn() },
  provide: () => {},
})
const { DrawingBody } = loaded.__drawingTest

const calls = []
const identity = '4'.repeat(64)
async function fetch(url, options = {}) {
  calls.push({ url, options })
  let body
  if (url.endsWith('/packs') && options.method === 'POST') {
    const requested = JSON.parse(options.body).path
    body = { jobId: `${requested}-job`, state: 'queued' }
  } else if (url.endsWith('/status')) {
    if (url.includes('bad.dxf')) body = { state: 'error', error: { message: '坏包' } }
    else if (url.includes('cancel.dxf')) body = { state: 'running' }
    else body = { state: 'ready', result: { key: identity } }
  } else if (url.endsWith('/cancel')) {
    body = { state: 'error', error: { code: 'cancelled', message: '图纸转换已取消' } }
  } else if (url.includes(`/packs/${identity}`)) {
    body = {
      name: 'part.dxf', packText: '{"ok":true}',
      source: { uri: 'part.dxf', sha256: '1'.repeat(64), name: 'part.dxf' },
      pack: { identity, sha256: '2'.repeat(64) },
    }
  } else {
    throw new Error(`unexpected fetch: ${url}`)
  }
  return { ok: true, status: 200, json: async () => body }
}
let tree, currentPreview
function render(preview = currentPreview) {
  currentPreview = preview
  cursor = 0
  tree = DrawingBody({ sessionId: 's1', preview, onReference: () => {} })
}
function fresh() {
  for (const hook of hooks) if (typeof hook?.cleanup === 'function') hook.cleanup()
  hooks = []
  cursor = 0
  tree = undefined
}
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return text(node.children)
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

render({ name: 'part.dxf', path: 'part.dxf' })
await sleep(30)
render()
await sleep(20)
render()
const ready = find(tree, node => node.type === Viewer)
assert.ok(ready, `ready descriptor must reach the keyed drawing viewer: ${text(tree)} ${JSON.stringify(calls)}`)
assert.equal(ready.props.descriptor.packText, '{"ok":true}')
console.log('ok - start, status polling and ready pack dispatch')

fresh()
render({ name: 'bad.dxf', path: 'bad.dxf' })
await sleep(30)
render()
await sleep(20)
render()
assert.match(text(tree), /图纸转换失败：坏包/)
console.log('ok - conversion failure is a distinct error state')

fresh()
render({ name: 'cancel.dxf', path: 'cancel.dxf' })
await sleep(20)
render()
await sleep(20)
render()
const cancelButton = find(tree, node => node.type === 'button' && text(node) === '取消转换')
assert.ok(cancelButton)
await cancelButton.props.onClick()
await sleep(10)
render()
assert.match(text(tree), /图纸转换已取消/)
assert.ok(calls.some(call => call.url.endsWith('/cancel') && call.options.method === 'POST'))
console.log('ok - user cancellation calls the job cancel route')

fresh()
webgl = false
const before = calls.length
render({ name: 'unsupported.dxf', path: 'unsupported.dxf' })
await sleep(20)
render()
assert.match(text(tree), /WebGL2/)
assert.match(text(tree), /这不是转换失败/)
assert.equal(calls.length, before, 'WebGL2 unavailable must not start conversion')
assert.ok(find(tree, node => node.type === 'a' && text(node) === '下载原始图纸'))
console.log('ok - WebGL2 unavailable degrades separately with download and no conversion')
