// M3-05 可复现合成性能门：真实 loadDraft/DraftPane/DraftView + 固定种子的合成包。
// 数字只代表 Node.js CPU 与 WebGL2/Canvas2D 测试替身，不含 GPU 排空、合成器或 rAF，
// 不得表述为真机桌面结果。首帧 3000ms、交互 p95 21ms 沿用 M0-6 合成验收口径。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const MIB = 1024 * 1024
const thresholds = Object.freeze({
  entities: 6001,
  expandedSegments: 150000,
  strings: 3000,
  linetypes: 8,
  spatialIndexItems: 600000,
  spatialIndexBytes: 8 * MIB,
  segmentsPerFrame: 6000,
  textsPerFrame: 240,
  firstInteractiveMs: 3000,
  peakHeapUsedBytes: 384 * MIB,
  interactionCpuFrameP95Ms: 21,
  warmupFrames: 3,
  interactionFrames: 60,
})
const checks = []
const check = (name, ok, actual, expected) => {
  checks.push({ name, ok: Boolean(ok), actual, expected })
}
const round = value => Math.round(value * 1000) / 1000

const { outputFiles } = await build({
  stdin: {
    resolveDir: path.join(root, 'src'),
    contents: "export { DrawingPreview } from './client.ts'; export { DraftPane } from './draft/draft_pane.ts'; export { checkDraftPack } from './draft/packcheck.ts';",
  },
  bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react'],
})

let cursor = 0
const hooks = []
const cleanups = []
let container
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
const document = {
  createElement: () => makeEl(),
  createTextNode: text => ({ text }),
}
const window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} }
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => {
    if (name === 'react') return react
    throw new Error(name)
  },
  document, window,
  ResizeObserver: class { observe() {} disconnect() {} },
  performance, setTimeout, clearTimeout, console,
})
const { DrawingPreview, DraftPane, checkDraftPack } = module.exports

let pane
const originalHandle = DraftPane.prototype.handle
DraftPane.prototype.handle = function (message) {
  pane = this
  return originalHandle.call(this, message)
}

const TARGET_TEXT = 'SEARCH_TARGET_7F3A'
const TARGET_DIM = 'D_SEARCH'
let pack = makePerformancePack()
const reader = checkDraftPack(pack, 'reader')
assert.equal(reader.errors.length, 0, `合成性能包必须通过 reader 门禁：${reader.errors.join(';')}`)
assert.equal(reader.skipped.join(','), 'future_entity')
const declaredLinetypes = Object.keys(pack.linetypes).length
const packText = JSON.stringify(pack)
const packBytes = Buffer.byteLength(packText)
pack = null

let tree
const descriptor = { name: 'synthetic-performance.dwg', packText }
const renderPreview = () => { cursor = 0; tree = DrawingPreview({ descriptor }) }
container = makeEl()
const interactiveT0 = performance.now()
renderPreview()
const firstInteractiveMs = performance.now() - interactiveT0
assert.ok(pane?.view && pane?.draft, 'DrawingPreview 未创建 DraftPane/DraftView')

const memory0 = process.memoryUsage()
let peakHeapUsed = memory0.heapUsed
let peakRss = memory0.rss
let peakExternal = memory0.external
let peakArrayBuffers = memory0.arrayBuffers
const sampleMemory = () => {
  const memory = process.memoryUsage()
  peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed)
  peakRss = Math.max(peakRss, memory.rss)
  peakExternal = Math.max(peakExternal, memory.external)
  peakArrayBuffers = Math.max(peakArrayBuffers, memory.arrayBuffers)
}

const view = pane.view
const draft = pane.draft
const glMock = container.children[0].glMocks[0]
const c2dMock = container.children[1].c2dMocks[0]
renderPreview()
const visibleUiText = textOf(tree)
check('degradation.badges.visible',
  visibleUiText.includes('几何已抽稀') && visibleUiText.includes('文字有截断')
    && visibleUiText.includes('跳过未知类型：future_entity'),
  visibleUiText.match(/几何已抽稀|文字有截断|跳过未知类型：future_entity/g) ?? [],
  ['几何已抽稀', '文字有截断', '跳过未知类型：future_entity'])

const initialStats = view.getStats()
check('scale.entities', draft.entityCount === thresholds.entities, draft.entityCount, thresholds.entities)
check('scale.expandedSegments', draft.segments.length === thresholds.expandedSegments,
  draft.segments.length, thresholds.expandedSegments)
check('scale.strings', draft.texts.length === thresholds.strings, draft.texts.length, thresholds.strings)
check('scale.linetypes', declaredLinetypes === thresholds.linetypes && draft.dashLut.length === thresholds.linetypes,
  { declared: declaredLinetypes, lutRows: draft.dashLut.length }, thresholds.linetypes)
check('draw.segments.limited', initialStats.lastDrawn === thresholds.segmentsPerFrame && initialStats.lastStep === 25,
  { drawn: initialStats.lastDrawn, step: initialStats.lastStep }, { drawn: 6000, step: 25 })
check('draw.texts.limited', initialStats.textsDrawn === thresholds.textsPerFrame
    && initialStats.textsOverflow === thresholds.strings - thresholds.textsPerFrame,
  { drawn: initialStats.textsDrawn, overflow: initialStats.textsOverflow }, { drawn: 240, overflow: 2760 })
check('data.cpu.retained', draft.segments.length === thresholds.expandedSegments
    && draft.texts.length === thresholds.strings,
  { segments: draft.segments.length, texts: draft.texts.length }, '抽稀后仍为全量')
const expectedVertexBytes = (draft.segments.length * 2 + draft.points.length) * 8 * 4
check('data.gpu.fullVertexBuffer', glMock.bufferDataBytes === expectedVertexBytes,
  glMock.bufferDataBytes, expectedVertexBytes)

const grid = view.grid
const indexBytes = grid.bboxes.byteLength + grid.starts.byteLength + grid.items.byteLength
check('scale.spatialIndex', grid.grid === 64 && grid.starts.length === 64 * 64 + 1
    && grid.items.length <= thresholds.spatialIndexItems && indexBytes <= thresholds.spatialIndexBytes,
  { grid: grid.grid, starts: grid.starts.length, items: grid.items.length, bytes: indexBytes },
  { grid: 64, starts: 4097, maxItems: thresholds.spatialIndexItems, maxBytes: thresholds.spatialIndexBytes })
const indexed = new Uint8Array(draft.segments.length)
for (const segmentIndex of grid.items) indexed[segmentIndex] = 1
let indexedSegments = 0
for (const flag of indexed) indexedSegments += flag
check('data.spatialIndex.retained', indexedSegments === thresholds.expandedSegments,
  indexedSegments, thresholds.expandedSegments)

const targetSegment = draft.segments[0]
assert.equal(targetSegment.entId, 0)
const targetMid = [(targetSegment.x1 + targetSegment.x2) / 2, (targetSegment.y1 + targetSegment.y2) / 2]
const targetScreen = view.worldToScreen(targetMid[0], targetMid[1])
const targetHit = view.pick(targetScreen[0], targetScreen[1])
check('data.spatialIndex.pickUndrawnTarget', targetHit?.entId === 0 && targetHit?.segIdx === 0,
  targetHit, { segIdx: 0, entId: 0 })

const initialTargetUpload = findTargetSegment(glMock.lastLineUpload, targetSegment)
const initialTargetText = c2dMock.texts.find(item => item.text === TARGET_TEXT)
check('search.fixture.geometryInitiallyDecimated', initialTargetUpload === null,
  initialTargetUpload, null)
check('search.fixture.textInitiallyTruncated', initialTargetText === undefined,
  initialTargetText ?? null, null)

// zoom=false 保持概览与降级状态，覆盖搜索/定位接口不能把目标留在抽稀或文字截断之外。
c2dMock.texts.length = 0
pane.handle({ type: 'locateTarget', messageVersion: 2, target: { type: 'dim', id: TARGET_DIM }, zoom: false })
const locatedStats = view.getStats()
const locatedTargetUpload = findTargetSegment(glMock.lastLineUpload, targetSegment)
const locatedTargetText = c2dMock.texts.find(item => item.text === TARGET_TEXT)
check('search.selection.resolved', view.selectedEntities().join(',') === '0,3000',
  view.selectedEntities(), [0, 3000])
check('search.geometry.highlighted', locatedTargetUpload !== null && isHighlightedSegment(locatedTargetUpload),
  locatedTargetUpload, '目标段保留且两个顶点均为 rgb(1,0.82,0.2)')
check('search.text.highlighted', locatedTargetText?.fill === 'rgb(255,209,51)',
  locatedTargetText ?? null, { text: TARGET_TEXT, fill: 'rgb(255,209,51)' })
check('search.locate.keepsFrameBudgetsAndDegradation',
  locatedStats.lastDrawn <= thresholds.segmentsPerFrame && locatedStats.textsDrawn <= thresholds.textsPerFrame
    && locatedStats.lastStep > 1 && locatedStats.textsOverflow > 0,
  locatedStats, '目标优先但每帧上限与降级状态不变')
sampleMemory()

pane.handle({ type: 'clearSelection', messageVersion: 2 })
view.fit()
glMock.capture = false
c2dMock.capture = false
const frameTimes = []
for (let frame = 0; frame < thresholds.warmupFrames + thresholds.interactionFrames; ++frame) {
  const t0 = performance.now()
  view.zoomAt(800, 500, frame % 2 === 0 ? 1.02 : 0.98)
  view.render()
  frameTimes.push(performance.now() - t0)
  view.fit()
  sampleMemory()
}
const sampledFrames = frameTimes.slice(thresholds.warmupFrames)
const sortedFrames = [...sampledFrames].sort((a, b) => a - b)
const frameP95 = sortedFrames[Math.min(sortedFrames.length - 1, Math.floor(sortedFrames.length * 0.95))]
const frameAverage = sampledFrames.reduce((sum, value) => sum + value, 0) / sampledFrames.length
const frameMax = sortedFrames[sortedFrames.length - 1]
check('performance.firstInteractive', firstInteractiveMs <= thresholds.firstInteractiveMs,
  round(firstInteractiveMs), thresholds.firstInteractiveMs)
check('performance.interactionCpuFrameP95', frameP95 <= thresholds.interactionCpuFrameP95Ms,
  round(frameP95), thresholds.interactionCpuFrameP95Ms)
check('performance.peakHeapUsed', peakHeapUsed <= thresholds.peakHeapUsedBytes,
  Math.round(peakHeapUsed), thresholds.peakHeapUsedBytes)

for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
const report = {
  ok: checks.every(item => item.ok),
  scope: 'Node.js synthetic CPU benchmark with WebGL2/Canvas2D mocks; not a desktop GPU/rAF measurement',
  fixture: 'deterministic synthetic camind-draft-pack; no drawing files or sensitive data',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  thresholds,
  metrics: {
    packBytes,
    firstInteractiveMs: round(firstInteractiveMs),
    peakMemoryMiB: {
      heapUsed: round(peakHeapUsed / MIB), rss: round(peakRss / MIB),
      external: round(peakExternal / MIB), arrayBuffers: round(peakArrayBuffers / MIB),
    },
    interactionCpuFramesMs: { average: round(frameAverage), p95: round(frameP95), max: round(frameMax) },
    spatialIndex: { items: grid.items.length, bytes: indexBytes, indexedSegments },
    initialDraw: initialStats,
    locatedDraw: locatedStats,
  },
  checks,
}
console.log(JSON.stringify(report, null, 2))
const failed = checks.filter(item => !item.ok)
assert.equal(failed.length, 0, `M3-05 性能验收失败：${failed.map(item => item.name).join(', ')}`)
console.log('M3-05 synthetic performance selfcheck complete (not a real-desktop performance result).')

function makePerformancePack() {
  const linetypes = { Continuous: { pattern: [], kind: 'simple' } }
  const patterns = [
    [6, -3], [8, -2, 2, -2], [4, -2, 1, -2], [10, -2],
    [3, -1, 3, -2], [12, -3, 2, -3], [5, -1, 1, -1, 1, -2],
  ]
  patterns.forEach((pattern, index) => { linetypes[`DASH${index + 1}`] = { pattern, kind: 'simple' } })
  const linetypeNames = Object.keys(linetypes)
  const entities = []
  const appearance = id => ({
    id, layer: 'SYNTH', view_id: 0,
    color: { aci: 7, raw: 7 },
    linetype: { name: linetypeNames[id % linetypeNames.length], scale: 1 },
    lineweight: { sentinel: -1 }, handle: `PERF/${id}`,
  })
  const cell = id => ({ x: (id % 60) * 20, y: Math.floor(id / 60) * 16 })
  const vertices = (id, count) => {
    const base = cell(id)
    return Array.from({ length: count }, (_, k) => ({
      x: base.x + 1 + (k % 10) * 0.8,
      y: base.y + 1 + (k % 2) * 4 + (Math.floor(k / 10) % 2) * 4,
    }))
  }

  const targetBase = cell(0)
  entities.push({
    ...appearance(0), type: 'line', dim_id: TARGET_DIM,
    a: [targetBase.x + 2, targetBase.y + 2], b: [targetBase.x + 8, targetBase.y + 8],
  })
  entities.push({ ...appearance(1), type: 'polyline', verts: vertices(1, 100), closed: false })
  for (let id = 2; id < 3000; ++id)
    entities.push({ ...appearance(id), type: 'polyline', verts: vertices(id, 51), closed: false })

  for (let index = 0; index < 3000; ++index) {
    const id = 3000 + index
    const base = cell(index)
    const text = index === 0 ? TARGET_TEXT : `SYNTHETIC_NOTE_${index}`
    entities.push({
      ...appearance(id), type: 'text', dim_id: index === 0 ? TARGET_DIM : undefined,
      p: [base.x + 5, base.y + 12], h: index === 0 ? 3 : 4 + (index % 5),
      text, rot: 0, style: 'Standard', halign: 0, valign: 0,
    })
  }
  entities.push({ id: 6000, type: 'future_entity', view_id: 0 })
  const histogram = { line: 1, polyline: 2999, text: 3000, future_entity: 1 }
  return {
    format: 'camind-draft-pack', format_version: 1, pipeline_version: 'm3-05-synthetic-1',
    source_file: 'synthetic-performance.dwg', source_sha256: '0'.repeat(64),
    origin: { channel: 'unknown', evidence: ['deterministic synthetic'], rule_version: 'm3-05', method: 'auto' },
    conversion: { tool: 'selfcheck-performance', commit: 'synthetic', libredwg: 'n/a', ezdxf: 'n/a' },
    rules_version: 'm3-05', view_rule_version: 'm3-05', units: 'mm', source_units: 'mm', unit_factor: 1,
    ltscale: 1, origin_offset: [0, 0], bbox: [0, 0, 1200, 800],
    layers: { SYNTH: { aci: 7, off: false, frozen: false, plot: true, linetype: 'Continuous' } },
    linetypes,
    text_styles: { Standard: { font: '', width_factor: 1, kind: 'empty' } },
    self_check: {
      input_entities: 6001, drawn_entities: 6001, insert_exploded: 0, star_d_exploded: 0,
      dropped: { by_type: {}, by_reason: {} }, reconciles: true,
      byblock_fallback: 0, truecolor_count: 0, extra_colors: {},
    },
    coverage: {
      entities_by_type: histogram,
      semantic: { dims: { found: 1, parsed: 1 }, tech_requirements: { found: 0, parsed: 0 }, title_block: { counted: 0, parsed: 0 } },
    },
    missing: {}, views: [], layouts: [], entities,
    dims: [{
      id: TARGET_DIM, display_text: TARGET_TEXT, measured: 7.3, tolerance: {}, type: 0,
      def_points: [[2, 2], [8, 8]], dimlfac: 1, view_id: 0,
      entity_ids: [0, 3000], inferred: false, rule_version: 'm3-05',
    }],
    tech_requirements: [], title_block: {},
  }
}

function makeEl() {
  const children = []
  const listeners = new Map()
  const attributes = new Map()
  const el = {
    style: {}, dataset: {}, children, clientWidth: 1600, textContent: '', glMocks: [], c2dMocks: [], className: '',
    appendChild(child) { children.push(child); return child },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]) },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== fn)) },
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.get(name) ?? null },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1600, height: 1000 } },
    querySelector() { return null },
    getContext(kind) {
      if (kind === 'webgl2') {
        const mock = makeGlMock(el)
        el.glMocks.push(mock)
        return mock.gl
      }
      const mock = makeC2dMock()
      el.c2dMocks.push(mock)
      return mock.ctx
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

function makeGlMock(canvas) {
  const mock = {
    capture: true, bufferDataBytes: 0, lastLineUpload: null,
  }
  const handle = () => ({})
  const gl = {
    canvas,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, UNSIGNED_BYTE: 5121,
    LINES: 1, POINTS: 0, SCISSOR_TEST: 3089, COLOR_BUFFER_BIT: 16384,
    TEXTURE_2D: 3553, NEAREST: 9728, R8: 33321, RED: 6403, TEXTURE0: 33984,
    CLAMP_TO_EDGE: 33071, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    createBuffer: handle, createTexture: handle, createShader: handle, createProgram: handle,
    deleteBuffer() {}, deleteTexture() {}, deleteProgram() {},
    shaderSource() {}, compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => '',
    attachShader() {}, linkProgram() {}, getProgramParameter: () => true, getProgramInfoLog: () => '',
    useProgram() {}, getUniformLocation: handle, getAttribLocation: () => 0,
    uniform3f() {}, uniform1f() {}, uniform1i() {}, activeTexture() {},
    bindBuffer() {},
    bufferData(target, data) { mock.bufferDataBytes = data.byteLength },
    bufferSubData(target, offset, data, srcOffset = 0, srcLength) {
      if (mock.capture && offset === 0)
        mock.lastLineUpload = data.slice(srcOffset, srcLength === undefined ? undefined : srcOffset + srcLength)
    },
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    bindTexture() {}, texImage2D() {}, texParameteri() {},
    enable() {}, disable() {}, viewport() {}, scissor() {}, clearColor() {}, clear() {}, drawArrays() {},
    getError: () => 0,
  }
  mock.gl = gl
  return mock
}

function makeC2dMock() {
  const mock = { capture: true, texts: [] }
  let tx = 0, ty = 0
  const ctx = {
    font: '', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '',
    setTransform() {}, clearRect() {}, beginPath() {}, rect() {}, clip() {}, save() {}, restore() {},
    translate(x, y) { tx = x; ty = y }, rotate() {}, scale() {},
    measureText(text) { return { width: Number.parseFloat(ctx.font) * text.length * 0.6 } },
    fillText(text) {
      if (mock.capture) mock.texts.push({ text, fill: ctx.fillStyle, x: tx, y: ty })
    },
  }
  mock.ctx = ctx
  return mock
}

function textOf(node) {
  return node && typeof node === 'object'
    ? (node.children ?? []).map(textOf).join('')
    : String(node ?? '')
}

function findTargetSegment(upload, segment) {
  if (!upload) return null
  for (let offset = 0; offset + 15 < upload.length; offset += 16) {
    if (upload[offset] === segment.x1 && upload[offset + 1] === segment.y1
      && upload[offset + 8] === segment.x2 && upload[offset + 9] === segment.y2) {
      return {
        offset,
        colors: [upload[offset + 2], upload[offset + 3], upload[offset + 4],
          upload[offset + 10], upload[offset + 11], upload[offset + 12]],
      }
    }
  }
  return null
}

function isHighlightedSegment(found) {
  const expected = [1, 0.82, 0.2, 1, 0.82, 0.2]
  return found.colors.every((value, index) => Math.abs(value - expected[index]) < 1e-6)
}
