// M4-02 workbench adapter: public DraftPane controls, search parity, selection details and viewport insets.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

let plugin
const source = await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
const code = source.replace('exports.apply = apply', 'exports.__drawingAdapterTest = { DrawingWorkbenchAdapter, drawingDimensionComparison, drawingToleranceText, drawingVerifiedSelection }; exports.apply = apply')

let hooks = [], cursor = 0, pendingEffects = [], annotationLeft = 800
const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
function domFor(className = '') {
  return {
    className,
    getBoundingClientRect: () => {
      if (className === 'wb-drawing-controls') return { left: 0, top: -48, right: 700, bottom: 0, width: 700, height: 48 }
      if (className === 'wb-drawing-annotations') return { left: annotationLeft, top: 0, right: annotationLeft + 300, bottom: 600, width: 300, height: 600 }
      return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }
    },
  }
}
const React = {
  Fragment: 'fragment',
  Component: class {},
  createElement(type, props, ...children) {
    if (props?.ref && typeof props.ref === 'object') props.ref.current = domFor(props.className)
    return { type, props: props ?? {}, children: children.flat(Infinity) }
  },
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
  },
  useRef(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = { current: initial }
    return hooks[index]
  },
  useEffect(fn, deps) {
    const index = cursor++, previous = hooks[index]
    if (!previous || !sameDeps(previous.deps, deps)) pendingEffects.push({ index, fn, deps, cleanup: previous?.cleanup })
    else hooks[index] = previous
  },
  useMemo(fn, deps) {
    const index = cursor++, previous = hooks[index]
    if (!previous || !sameDeps(previous.deps, deps)) hooks[index] = { value: fn(), deps }
    return hooks[index].value
  },
}
const windowListeners = new Map(), portalCalls = []
const window = {
  __ModuleLoader__: { load: definition => { plugin = definition.factory(name => {
    if (name === 'react') return React
    if (name === 'react-dom') return { createPortal: (node, container) => { portalCalls.push({ node, container }); return node } }
    return { Button: 'button', Tooltip: 'tooltip', MarkdownText: 'markdown', IconGaugeOutlineRegular: 'icon' }
  }) } },
  addEventListener(type, fn) { windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]) },
  removeEventListener(type, fn) { windowListeners.set(type, (windowListeners.get(type) ?? []).filter(item => item !== fn)) },
  dispatch(type, event) { for (const fn of windowListeners.get(type) ?? []) fn(event) },
}
class ResizeObserver {
  constructor(fn) { this.fn = fn }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const mutationObservers = []
class MutationObserver {
  constructor(fn) { this.fn = fn; mutationObservers.push(this) }
  observe() {}
  disconnect() {}
}
vm.runInNewContext(code, {
  window, document: { activeElement: null }, ResizeObserver, MutationObserver,
  Blob, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
})
const { DrawingWorkbenchAdapter, drawingDimensionComparison, drawingToleranceText, drawingVerifiedSelection } = plugin.__drawingAdapterTest

const composer = {
  classList: { contains: name => name === 'wb-composer-muted' ? false : false },
  getBoundingClientRect: () => ({ left: 100, top: 500, right: 700, bottom: 620, width: 600, height: 120 }),
}
let hasComposer = false
const conversation = { querySelector: selector => selector === '.wb-floating-composer' && hasComposer ? composer : null }
const main = { closest: selector => selector === '[data-conversation-content]' ? conversation : null }
const portalHost = {}
const viewport = {
  parentElement: portalHost,
  closest: selector => selector === '.wb-main' ? main : null,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
}
const calls = []
const publicMethods = new Set(['fit', 'zoom', 'locateTarget', 'setSelection', 'clearSelection', 'zoomToRect', 'setViewportInsets', 'setColorMode'])
const controller = new Proxy({}, {
  get(_target, key) {
    assert.ok(publicMethods.has(key), `adapter attempted to access non-public controller member ${String(key)}`)
    return (...args) => { calls.push([key, args]) }
  },
})
const entities = [
  ...Array.from({ length: 105 }, (_, index) => ({ id: index, type: 'mtext', layer: 'NOTES', text: `技术要求 ${index + 1}` })),
  { id: 200, type: 'mtext', layer: 'DIM', text: 'Ø13', dim_id: 'D1' },
  { id: 201, type: 'mleader', layer: 'DIM', text: { p: [100, -20], h: 3.5, text: '4×Ø8 通孔' } },
]
const descriptor = {
  name: 'part.dwg',
  packText: JSON.stringify({
    dims: [{ id: 'D1', display_text: 'Ø13', measured: 13, dimlfac: 1, tolerance: { upper: 0.05, lower: -0.05 }, entity_ids: [200] }],
    entities,
  }),
  conversion: { tool: 'camind-draft-pack', commit: 'converter-v1', libredwg: 'test', ezdxf: 'test' },
  degraded: { geometryDecimated: false, textTruncated: false, skippedTypes: [] },
  missing: ['2 个图片对象未显示'],
}
const viewportRef = { current: viewport }
let props = { descriptor, controller, selection: [], viewportRef, degraded: { geometryDecimated: true, textTruncated: true, skippedTypes: ['proxy'] } }
let tree
function render() {
  cursor = 0; pendingEffects = []
  tree = DrawingWorkbenchAdapter(props)
  const effects = pendingEffects
  pendingEffects = []
  for (const effect of effects) {
    if (typeof effect.cleanup === 'function') effect.cleanup()
    hooks[effect.index] = { deps: effect.deps, cleanup: effect.fn() }
  }
  return tree
}
function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    walk(node.type({ ...node.props, children: node.children }), visit)
    return
  }
  visit(node)
  walk(node.children, visit)
}
function nodes(predicate) {
  const found = []
  walk(tree, node => { if (predicate(node)) found.push(node) })
  return found
}
function one(predicate, label) {
  const found = nodes(predicate)
  assert.equal(found.length, 1, `expected one ${label}, got ${found.length}`)
  return found[0]
}
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node !== 'object') return String(node)
  if (typeof node.type === 'function') return text(node.type({ ...node.props, children: node.children }))
  return text(node.children)
}
const callsOf = name => JSON.parse(JSON.stringify(calls.filter(([method]) => method === name)))

render()
assert.equal(callsOf('setColorMode')[0][1][0], 'readable')
assert.deepEqual(callsOf('setViewportInsets')[0][1][0], { top: 16, right: 0, bottom: 16, left: 0 })
hasComposer = true
for (const observer of mutationObservers) observer.fn()
assert.deepEqual(callsOf('setViewportInsets').at(-1)[1][0], { top: 16, right: 0, bottom: 116, left: 0 }, 'a late-mounted composer must be included in safe insets')
const stableInsetCalls = callsOf('setViewportInsets').length
for (const observer of mutationObservers) observer.fn()
assert.equal(callsOf('setViewportInsets').length, stableInsetCalls, 'unchanged insets must not redraw the drawing')
assert.equal(nodes(node => node.props['aria-label'] === '查找图纸文字').length, 1)
assert.equal(nodes(node => node.props['aria-label'] === '查找图纸文字' && node.type === 'aside').length, 0, 'search starts collapsed')
one(node => node.type === 'button' && node.props['aria-label'] === '查找图纸文字', 'search toggle').props.onClick()
render()
annotationLeft = 500
mutationObservers.at(-1).fn()
assert.deepEqual(callsOf('setViewportInsets').at(-1)[1][0], { top: 16, right: 312, bottom: 116, left: 0 }, 'an overlaid search panel must reserve target-safe space')
annotationLeft = 800
mutationObservers.at(-1).fn()
assert.deepEqual(callsOf('setViewportInsets').at(-1)[1][0], { top: 16, right: 0, bottom: 116, left: 0 })
const search = one(node => node.props['aria-label'] === '搜索图纸文字', 'search input')
search.props.onChange({ target: { value: '技术要求' } })
render()
assert.ok(text(tree).includes('找到 105 项'))
assert.equal(nodes(node => node.props['data-drawing-result']).length, 100, 'search results are incrementally limited')
one(node => node.type === 'button' && text(node) === '显示更多结果', 'show more').props.onClick()
render()
assert.equal(nodes(node => node.props['data-drawing-result']).length, 105)
const list = one(node => node.props.className === 'wb-drawing-annotation-list', 'result list')
let focused = 0, prevented = 0, beforeBrowse = callsOf('locateTarget').length
list.props.onKeyDown({
  key: 'ArrowDown', preventDefault: () => { prevented++ },
  currentTarget: { querySelectorAll: () => [{ focus: () => { focused++ } }] },
})
assert.equal(focused, 1)
assert.equal(prevented, 1)
assert.equal(callsOf('locateTarget').length, beforeBrowse, 'arrow keys only browse and never locate')
console.log('ok - search count, incremental results and keyboard browsing')

one(node => node.props['aria-label'] === '搜索图纸文字', 'search input').props.onChange({ target: { value: 'Ø13' } })
render()
assert.equal(nodes(node => node.props['data-drawing-result']).length, 1, 'dimension child text must collapse into its canonical dimension target')
one(node => node.props['data-drawing-result'] === 'dim:D1', 'dimension result').props.onClick()
assert.deepEqual(callsOf('locateTarget').at(-1)[1], [{ type: 'dim', id: 'D1' }, true])
props = { ...props, selection: [{ type: 'dim', id: 'D1' }] }
render()
const compare = one(node => node.props['data-compare'], 'dimension comparison')
assert.equal(compare.props['data-compare'], 'match')
assert.ok(text(tree).includes('Ø13'))
assert.ok(text(tree).includes('±0.05'))
one(node => node.type === 'button' && text(node) === '清除当前提问对象', 'clear selection').props.onClick()
assert.equal(callsOf('clearSelection').length, 1)
assert.equal(drawingDimensionComparison({ display_text: '50', measured: 51, dimlfac: 1 }), 'mismatch')
assert.equal(drawingDimensionComparison({ display_text: '10.12', measured: 10.123456, dimlfac: 1 }), 'match', 'converter rounding must not become a false mismatch')
assert.equal(drawingDimensionComparison({ display_text: '10.123456', measured: 10.1234564995, dimlfac: 1 }), 'match')
assert.equal(drawingDimensionComparison({ display_text: '10000.13', measured: 10000.125, dimlfac: 1 }), 'match')
assert.equal(drawingDimensionComparison({ display_text: '10.12', measured: 10.125, dimlfac: 1 }), 'mismatch')
assert.equal(drawingDimensionComparison({ display_text: '50' }), 'no-measured')
assert.equal(drawingToleranceText({ tolerance: { upper: 0.02, lower: -0.01 } }), '+0.02/−0.01')
props = { ...props, selection: [] }
one(node => node.props['aria-label'] === '搜索图纸文字', 'search input').props.onChange({ target: { value: '4×Ø8' } })
render()
const leader = one(node => node.props['data-drawing-result'] === 'entity:201', 'nested leader text')
assert.ok(text(leader).includes('4×Ø8 通孔'))
console.log('ok - locateTarget, canonical dimensions, nested leader text and native selection clearing')

const color = one(node => node.type === 'input' && node.props.type === 'checkbox', 'original color checkbox')
color.props.onChange({ target: { checked: true } })
render()
assert.equal(callsOf('setColorMode').at(-1)[1][0], 'original')
const diagnostics = one(node => node.props['aria-label'] === '转换诊断信息，可复制', 'conversion diagnostics')
assert.ok(diagnostics.props.value.includes('converter-v1'))
assert.ok(diagnostics.props.value.includes('geometryDecimated'))
assert.ok(diagnostics.props.value.includes('"textTruncated": true'), 'diagnostics must use live rendering degradation rather than the initial descriptor')
assert.ok(text(tree).includes('文字已按帧预算截断'))
assert.ok(text(tree).includes('2 个图片对象未显示'))
assert.ok(text(tree).includes('proxy'))
console.log('ok - readable/original colors and copyable conversion diagnostics')

const options = one(node => node.type === 'details' && text(node).includes('原始配色'), 'drawing options')
let summaryFocus = 0, escapePrevented = 0
const optionsEvent = { open: true, querySelector: () => ({ focus: () => { summaryFocus++ } }), preventDefault: () => { escapePrevented++ } }
options.props.onKeyDown({ key: 'Escape', currentTarget: optionsEvent, preventDefault: optionsEvent.preventDefault })
assert.equal(optionsEvent.open, false, 'Escape closes the drawing options menu')
assert.equal(summaryFocus, 1, 'Escape returns focus to the options summary')
assert.equal(escapePrevented, 1)
console.log('ok - options menu Escape dismissal and focus restoration')

one(node => node.type === 'button' && node.props['aria-label'] === '放大图纸', 'zoom in').props.onClick()
one(node => node.type === 'button' && node.props['aria-label'] === '缩小图纸', 'zoom out').props.onClick()
one(node => node.type === 'button' && node.props['aria-label'] === '适配全图 (F)', 'fit').props.onClick()
assert.equal(callsOf('zoom')[0][1][0], 1.3)
assert.equal(callsOf('zoom')[1][1][0], 1 / 1.3)
assert.equal(callsOf('fit').length, 1)
one(node => node.type === 'button' && node.props['aria-label'] === '框选放大', 'box mode').props.onClick()
render()
let surface = one(node => node.props.className === 'wb-drawing-box-surface', 'box surface')
assert.equal(portalCalls.at(-1).container, portalHost, 'box overlay must be mounted in the React-owned grid body')
assert.notEqual(portalCalls.at(-1).container, viewport, 'box overlay must not be deleted by DraftPane container cleanup')
const pointer = (type, x, y) => surface.props[type]({
  button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, currentTarget: viewport,
})
pointer('onPointerDown', 10, 10)
pointer('onPointerMove', 110, 90)
pointer('onPointerUp', 110, 90)
assert.deepEqual(callsOf('zoomToRect').at(-1)[1][0], { x: 10, y: 10, width: 100, height: 80 })
render()
assert.equal(nodes(node => node.props.className === 'wb-drawing-box-surface').length, 0)
one(node => node.type === 'button' && node.props['aria-label'] === '框选放大', 'box mode').props.onClick()
render()
surface = one(node => node.props.className === 'wb-drawing-box-surface', 'box surface')
window.dispatch('keydown', { key: 'Escape', preventDefault() {} })
render()
assert.equal(nodes(node => node.props.className === 'wb-drawing-box-surface').length, 0, 'Escape cancels box zoom')
console.log('ok - fit, zoom, rubber-band zoomToRect and Escape')

const normalize = value => JSON.parse(JSON.stringify(value)), verifiedTarget = { type: 'dim', id: 'D1' }
const verifiedDescriptor = {
  session: 's1', source: { uri: 'upload://batch/part.dxf', sha256: '1'.repeat(64), name: 'part.dxf' },
  pack: { sha256: '2'.repeat(64), identity: '3'.repeat(64) },
}
const verifiedReference = { ...verifiedDescriptor, target: verifiedTarget }
assert.equal(drawingVerifiedSelection(verifiedDescriptor, null, [verifiedTarget]), null)
assert.deepEqual(normalize(drawingVerifiedSelection(verifiedDescriptor, { active: null, hasChip: false, pending: false }, [verifiedTarget])), [])
assert.equal(drawingVerifiedSelection(verifiedDescriptor, { active: null, hasChip: false, pending: true }, [verifiedTarget]), null, 'a pending pick is not cleared before verification settles')
assert.equal(drawingVerifiedSelection(verifiedDescriptor, { active: { reference: verifiedReference }, hasChip: false, pending: false }, [verifiedTarget]), null, 'retained handoff selection is not cleared')
assert.equal(drawingVerifiedSelection(verifiedDescriptor, { active: { reference: verifiedReference }, hasChip: true, pending: false }, [verifiedTarget]), null)
assert.deepEqual(normalize(drawingVerifiedSelection(verifiedDescriptor, { active: { reference: verifiedReference }, hasChip: true, pending: false }, [{ type: 'entity', id: 99 }])), [verifiedTarget], 'a stale highlight is restored to the verified chip target')
const otherDescriptor = { ...verifiedDescriptor, source: { ...verifiedDescriptor.source, sha256: '9'.repeat(64) } }
assert.equal(drawingVerifiedSelection(otherDescriptor, { active: { reference: verifiedReference }, hasChip: true, pending: false }, [{ type: 'entity', id: 99 }]), null, 'a chip from another source or pack is not replayed')
const changedPackDescriptor = { ...verifiedDescriptor, pack: { ...verifiedDescriptor.pack, sha256: '4'.repeat(64) } }
assert.equal(drawingVerifiedSelection(changedPackDescriptor, { active: { reference: verifiedReference }, hasChip: false, pending: false }, [verifiedTarget]), 'invalidate', 'same-source pack changes invalidate the retained chip')
console.log('ok - pane selection follows the verified native reference state')

const adapterSource = DrawingWorkbenchAdapter.toString()
assert.ok(source.includes('.cdv-body-adapted > .wb-drawing-controls'), 'adapter toolbar must occupy its own grid row outside pane chrome')
for (const forbidden of ['DraftPane', 'currentPane', 'glCanvas', 'detailBody', 'contextSnapshot', 'dangerouslySetInnerHTML', 'wb-drawing-selected']) {
  assert.equal(adapterSource.includes(forbidden), false, `adapter must not access or reimplement private renderer detail: ${forbidden}`)
}
console.log('ok - adapter uses only public controls and does not draw entity highlights')
console.log('M4-02 drawing adapter selfcheck complete; rendering correctness still requires the core acceptance checks.')
