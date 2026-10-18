// M3-03 integrated 2D migration acceptance: real mirrored loader/renderer/pane/client,
// synthetic entities only, Desktop gl_mock calls plus DOM/CSR/ degradation assertions.
import assertBase from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'

const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? '')
const CAM_AGENT = path.resolve(process.env.CAM_AGENT_REPO ?? '')
assertBase.ok(process.env.DESKTOP_REPO && fs.statSync(DESKTOP, { throwIfNoEntry: false })?.isDirectory(), 'DESKTOP_REPO 必须指向隔离 Desktop 检出')
assertBase.ok(process.env.CAM_AGENT_REPO && fs.statSync(CAM_AGENT, { throwIfNoEntry: false })?.isDirectory(), 'CAM_AGENT_REPO 必须指向固定 CAM-Agent 检出')
const fixture = path.join(DESKTOP, 'tests/fixtures/draft/draft_good.json')
const goodRaw = JSON.parse(fs.readFileSync(fixture, 'utf8'))
const clone = value => JSON.parse(JSON.stringify(value))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let assertionCount = 0
const assert = {
  ok(...args) { assertionCount++; assertBase.ok(...args) },
  equal(...args) { assertionCount++; assertBase.equal(...args) },
  notEqual(...args) { assertionCount++; assertBase.notEqual(...args) },
  deepEqual(...args) { assertionCount++; assertBase.deepEqual(...args) },
  match(...args) { assertionCount++; assertBase.match(...args) },
  throws(...args) { assertionCount++; assertBase.throws(...args) },
}
function near(actual, expected, epsilon, message) {
  assertionCount++
  assertBase.ok(Math.abs(actual - expected) <= epsilon, `${message ?? '数值不符'}: actual=${actual}, expected=${expected}, epsilon=${epsilon}`)
}

const coverage = new Set()
let scenarioCount = 0
async function scenario(ids, name, fn) {
  await fn()
  for (const id of Array.isArray(ids) ? ids : [ids]) coverage.add(id)
  scenarioCount++
  console.log(`ok - ${name}`)
}

const glMockPath = path.join(DESKTOP, 'packages/viewer/test/gl_mock.ts')
const { outputFiles: coreOutput } = await build({
  stdin: {
    resolveDir: path.join(root, 'src'),
    contents: `
      export { loadDraft, patternToLut } from './draft/draft_loader.ts';
      export { checkDraftPack } from './draft/packcheck.ts';
      export { DraftView } from './draft/draft_view.ts';
      export { DraftPane } from './draft/draft_pane.ts';
      export { buildSegGrid, distToSeg } from './draft/draft_pick.ts';
      export { compareDim, formatTolerance, detailFor, originInfo } from './draft/draft_detail.ts';
      export { fitView, worldToScreen } from './draft/draft_camera.ts';
      export { makeGlMock } from ${JSON.stringify(glMockPath)};
    `,
  },
  bundle: true, write: false, platform: 'node', format: 'esm',
})
const core = await import(`data:text/javascript;base64,${Buffer.from(coreOutput[0].text).toString('base64')}`)
const loadGood = () => core.loadDraft(clone(goodRaw))

function makeC2dMock() {
  const texts = []
  const stack = []
  let widthScale = 1
  const ctx = {
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '',
    setTransform() { widthScale = 1 },
    clearRect() {}, beginPath() {}, rect() {}, clip() {}, translate() {}, rotate() {},
    save() { stack.push(widthScale) },
    restore() { widthScale = stack.length ? stack.pop() : 1 },
    scale(x) { widthScale *= x },
    measureText(text) { return { width: (parseFloat(ctx.font) || 10) * String(text).length * 0.6 } },
    fillText(text, x, y) {
      texts.push({ text: String(text), x, y, font: ctx.font, align: ctx.textAlign,
        baseline: ctx.textBaseline, fill: ctx.fillStyle, wf: widthScale })
    },
  }
  return { ctx, texts }
}

function descendants(root) {
  const out = []
  const visit = node => {
    for (const child of node.children ?? []) { out.push(child); visit(child) }
  }
  visit(root)
  return out
}

function makeDom(makeGlMock) {
  const windowListeners = new Map()
  const addListener = (map, type, fn) => map.set(type, [...(map.get(type) ?? []), fn])
  const removeListener = (map, type, fn) => map.set(type, (map.get(type) ?? []).filter(item => item !== fn))
  function makeEl(tagName = 'div') {
    const children = []
    const listeners = new Map()
    let ownText = ''
    let c2d = null
    const el = {
      tagName: tagName.toUpperCase(), style: {}, dataset: {}, children, listeners, parentNode: null,
      clientWidth: 800, glMocks: [], c2dMocks: [],
      appendChild(child) {
        if (child.parentNode) {
          const old = child.parentNode.children
          const index = old.indexOf(child)
          if (index >= 0) old.splice(index, 1)
        }
        child.parentNode = el
        children.push(child)
        return child
      },
      addEventListener(type, fn) { addListener(listeners, type, fn) },
      removeEventListener(type, fn) { removeListener(listeners, type, fn) },
      dispatch(type, event = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn(event) },
      querySelector(selector) {
        if (selector === 'input[name=pane-ch]:checked') {
          return descendants(el).find(node => node.tagName === 'INPUT' && node.name === 'pane-ch' && node.checked) ?? null
        }
        return null
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 } },
      getContext(kind) {
        if (kind === 'webgl2') {
          const mock = makeGlMock()
          el.glMocks.push(mock)
          mock.gl.canvas = el
          return mock.gl
        }
        if (kind === '2d') {
          if (!c2d) { c2d = makeC2dMock(); el.c2dMocks.push(c2d) }
          return c2d.ctx
        }
        return null
      },
      remove() {
        if (!el.parentNode) return
        const siblings = el.parentNode.children
        const index = siblings.indexOf(el)
        if (index >= 0) siblings.splice(index, 1)
        el.parentNode = null
      },
    }
    Object.defineProperty(el, 'textContent', {
      get() { return ownText + children.map(child => child.textContent ?? child.text ?? '').join('') },
      set(value) {
        ownText = String(value)
        for (const child of children) child.parentNode = null
        children.length = 0
      },
    })
    return el
  }
  const document = {
    createElement: tag => makeEl(tag),
    createTextNode: text => ({ tagName: '#text', text, textContent: text, children: [], parentNode: null }),
  }
  const window = {
    devicePixelRatio: 1,
    addEventListener(type, fn) { addListener(windowListeners, type, fn) },
    removeEventListener(type, fn) { removeListener(windowListeners, type, fn) },
  }
  const ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }
  return { document, window, ResizeObserver, makeEl }
}

function installDom(env) {
  globalThis.document = env.document
  globalThis.window = env.window
  globalThis.ResizeObserver = env.ResizeObserver
}

function instrumentGl(mock) {
  const shaders = [], textures = [], buffers = []
  const shaderSource = mock.gl.shaderSource
  mock.gl.shaderSource = (shader, source) => { shaders.push(source); shaderSource(shader, source) }
  const texImage2D = mock.gl.texImage2D
  mock.gl.texImage2D = (target, level, internal, width, height, border, format, type, data) => {
    textures.push({ target, level, internal, width, height, border, format, type,
      data: data ? new Uint8Array(data) : data })
    texImage2D(target, level, internal, width, height, border, format, type, data)
  }
  const bufferData = mock.gl.bufferData
  mock.gl.bufferData = (target, data, usage) => {
    buffers.push({ target, data: data ? new Float32Array(data) : data, usage,
      byteLength: data?.byteLength ?? 0 })
    bufferData(target, data, usage)
  }
  return { mock, shaders, textures, buffers }
}

function openPane(raw = goodRaw) {
  const env = makeDom(core.makeGlMock)
  installDom(env)
  const messages = []
  const container = env.makeEl('div')
  const pane = new core.DraftPane(container, message => messages.push(message))
  pane.handle({ type: 'load', messageVersion: 2, packText: JSON.stringify(raw), name: 'synthetic.dwg', provenance: null })
  return { env, container, pane, messages }
}

async function clickWorld(paneContext, raw, wx, wy) {
  const camera = core.fitView(raw.bbox, 800, 600)
  const [clientX, clientY] = core.worldToScreen(camera, 800, 600, wx, wy)
  paneContext.container.children[0].dispatch('click', {
    clientX, clientY, button: 0, detail: 1, preventDefault() {},
  })
  await sleep(250)
}

function detailBody(container) {
  return container.children[4].children[1]
}

await scenario('entities', 'line/circle/arc/polyline 凸度/point/hatch/solid/text/mtext/leader/mleader/tolerance 全类型展开', () => {
  assert.deepEqual(core.checkDraftPack(clone(goodRaw), 'writer').errors, [])
  const requiredTypes = ['line', 'circle', 'arc', 'polyline', 'point', 'hatch', 'solid', 'text', 'mtext', 'leader', 'mleader', 'tolerance']
  const actualTypes = new Set(goodRaw.entities.map(entity => entity.type))
  for (const type of requiredTypes) assert.ok(actualTypes.has(type), `合成夹具缺少 ${type}`)
  const draft = loadGood()
  const segments = id => draft.segments.filter(segment => segment.entId === id)
  assert.equal(draft.entityCount, 16)

  const line = segments(0)
  assert.equal(line.length, 1)
  assert.deepEqual([line[0].x1, line[0].y1, line[0].x2, line[0].y2], [0, 0, 420, 0])

  const circle = segments(1)
  assert.equal(circle.length, 48)
  assert.ok(circle.every(segment => [[segment.x1, segment.y1], [segment.x2, segment.y2]].every(([x, y]) => Math.abs(Math.hypot(x - 50, y + 30) - 4) < 1e-9)))
  near(circle[0].x1, circle.at(-1).x2, 1e-9, '圆未闭合')
  near(circle[0].y1, circle.at(-1).y2, 1e-9, '圆未闭合')

  const arc = segments(2)
  assert.equal(arc.length, 12)
  near(arc[0].x1, 56.5, 1e-9, '弧起点')
  near(arc[0].y1, -30, 1e-9, '弧起点')
  near(arc.at(-1).x2, 50, 1e-6, '弧终点')
  near(arc.at(-1).y2, -23.5, 1e-6, '弧终点')

  const bulge = segments(3)
  assert.equal(bulge.length, 13)
  const bulgeY = bulge.slice(0, 12).flatMap(segment => [segment.y1, segment.y2])
  near(-10 - Math.min(...bulgeY), 0.4142 * 30 / 2, 1e-3, '正凸度弓高')
  assert.ok(bulge.every((segment, index) => index === 0 ? segment.dist0 === 0 :
    Math.abs(segment.dist0 - bulge[index - 1].dist0 - Math.hypot(bulge[index - 1].x2 - bulge[index - 1].x1, bulge[index - 1].y2 - bulge[index - 1].y1)) < 1e-9), 'polyline 虚线相位不连续')
  assert.deepEqual([bulge.at(-1).x2, bulge.at(-1).y2], [40, -40])
  const reverseBulge = segments(15)
  assert.equal(reverseBulge.length, 12)
  assert.ok(reverseBulge.some(segment => Math.max(segment.y1, segment.y2) > -8), '负凸度未向反向弯曲')
  assert.equal(segments(4).length, 2)

  assert.equal(draft.points.length, 1)
  assert.deepEqual([draft.points[0].x, draft.points[0].y, draft.points[0].entId], [210, -100, 14])
  assert.equal(segments(14).length, 0)
  const hatch = segments(5)
  assert.equal(hatch.length, 3)
  assert.ok(hatch.every(segment => !segment.pickable))
  assert.deepEqual([hatch[2].x1, hatch[2].y1, hatch[2].x2, hatch[2].y2], [45.2, -25.1, 55.1, -34.9])
  const solid = segments(6)
  assert.equal(solid.length, 4)
  assert.deepEqual([solid.at(-1).x2, solid.at(-1).y2], [200, -290])

  const text = draft.texts.find(item => item.entId === 7)
  assert.deepEqual([text.text, text.x, text.y, text.h, text.halign], ['Ø8.000', 52, -18, 3.5, 1])
  const rows = draft.texts.filter(item => item.entId === 8)
  assert.deepEqual(rows.map(item => item.text), ['热处理硬度 HRC48-52', '去应力退火'])
  assert.ok(rows.every(item => item.entId === 8))
  assert.equal(segments(11).length, 2)
  assert.equal(segments(12).length, 1)
  assert.equal(draft.texts.find(item => item.entId === 12).text, '4×Ø8 通孔')
  assert.equal(segments(13).length, 2)
  assert.equal(draft.texts.find(item => item.entId === 13).text, '⌖')
})

await scenario('stipple', '256 列 R8 stipple LUT 与像素周期 clamp [4,16]', () => {
  const center = core.patternToLut([8, -2, 2, -2])
  assert.equal(center.length, 256)
  assert.ok([...center].every(value => value === 0 || value === 255))
  let runs = 0
  for (let i = 0; i < center.length; i++) if (center[i] === 255 && (i === 0 || center[i - 1] === 0)) runs++
  assert.equal(runs, 2)
  assert.equal(center[Math.floor(9 / 14 * 255)], 0)
  assert.equal(center[Math.floor(11 / 14 * 255)], 255)

  const draft = loadGood()
  assert.ok(draft.dashLut.every(row => row.length === 256))
  assert.ok(draft.dashLut[0].every(value => value === 255))
  const dashed = draft.segments.filter(segment => segment.entId === 2)
  assert.ok(dashed.length > 0)
  assert.ok(dashed.every(segment => segment.dashPeriod === 4.5 && segment.dashRow === 1))
  assert.equal([...draft.dashLut[1]].filter(value => value === 255).length, 171)

  const gl = instrumentGl(core.makeGlMock())
  const c2d = makeC2dMock()
  const view = new core.DraftView(gl.mock.gl, c2d.ctx, draft)
  const upload = gl.textures[0]
  assert.equal(upload.internal, gl.mock.gl.R8)
  assert.equal(upload.width, 256)
  assert.equal(upload.height, draft.dashLut.length)
  assert.equal(upload.format, gl.mock.gl.RED)
  assert.equal(upload.type, gl.mock.gl.UNSIGNED_BYTE)
  assert.equal(upload.data.length, draft.dashLut.length * 256)
  assert.deepEqual([...upload.data.slice(256, 512)], [...draft.dashLut[1]])
  const params = gl.mock.callsOf('texParameteri').map(call => call.args)
  assert.ok(params.some(args => args[1] === gl.mock.gl.TEXTURE_MIN_FILTER && args[2] === gl.mock.gl.NEAREST))
  assert.ok(params.some(args => args[1] === gl.mock.gl.TEXTURE_MAG_FILTER && args[2] === gl.mock.gl.NEAREST))
  assert.ok(params.some(args => args[1] === gl.mock.gl.TEXTURE_WRAP_S && args[2] === gl.mock.gl.CLAMP_TO_EDGE))
  const fragment = gl.shaders.find(source => source.includes('discard'))
  assert.match(fragment, /clamp\(vPeriod \* uPix, 4\.0, 16\.0\)/)
  assert.match(fragment, /texture\(uPat, vec2\(s, \(vRow \+ 0\.5\) \/ uRows\)\)\.r/)
  view.dispose()
})

await scenario(['render', 'color'], 'WebGL2 线段 + Canvas2D 文字及 ACI/真彩顶点颜色', () => {
  const draft = loadGood()
  const gl = instrumentGl(core.makeGlMock())
  gl.mock.gl.canvas = { width: 800, height: 600 }
  const c2d = makeC2dMock()
  const view = new core.DraftView(gl.mock.gl, c2d.ctx, draft, { checkErrors: true })
  assert.equal(gl.buffers[0].byteLength, (draft.segments.length * 2 + draft.points.length) * 8 * 4)
  const vertices = gl.buffers[0].data
  const assertVertexColor = (entId, expected) => {
    const index = draft.segments.findIndex(segment => segment.entId === entId)
    assert.ok(index >= 0)
    const offset = index * 16 + 2
    for (let channel = 0; channel < 3; channel++) near(vertices[offset + channel], expected[channel], 1e-7, `实体 ${entId} 顶点颜色通道 ${channel}`)
  }
  assertVertexColor(0, [1, 1, 1])
  assertVertexColor(1, [1, 0, 0])
  assertVertexColor(3, [0, 1, 0])
  assertVertexColor(13, [0, 128 / 255, 0])
  const yellowText = draft.texts.find(item => item.entId === 7)
  assert.deepEqual([yellowText.r, yellowText.g, yellowText.b], [1, 1, 0])

  gl.mock.reset()
  view.render()
  const lines = gl.mock.callsOf('drawArrays').find(call => call.args[0] === gl.mock.gl.LINES)
  const points = gl.mock.callsOf('drawArrays').find(call => call.args[0] === gl.mock.gl.POINTS)
  assert.ok(lines && lines.args[2] > 0)
  assert.equal(lines.args[2], view.getStats().lastDrawn * 2)
  assert.equal(points.args[1], draft.segments.length * 2)
  assert.equal(points.args[2], 1)
  assert.equal(view.getStats().glError, 0)
  for (const text of ['Ø8.000', 'Ø13', '4×Ø8 通孔', '⌖']) assert.ok(c2d.texts.some(item => item.text === text), `Canvas2D 未绘制 ${text}`)
  const canvasText = c2d.texts.find(item => item.text === 'Ø8.000')
  assert.match(canvasText.font, /sans-serif/)
  assert.equal(canvasText.align, 'center')
  near(canvasText.wf, 0.7, 1e-12, '文字宽度因子')
  assert.equal(canvasText.fill, 'rgb(255,255,0)')
  view.dispose()
})

await scenario('layers', '图层初始 off/frozen 与线段、点、文字显隐', () => {
  const draft = loadGood()
  const gl = core.makeGlMock()
  gl.gl.canvas = { width: 800, height: 600 }
  const c2d = makeC2dMock()
  const view = new core.DraftView(gl.gl, c2d.ctx, draft)
  assert.equal(view.isLayerVisible('NOTES'), false)
  assert.equal(view.isLayerVisible('DIM'), true)
  view.render()
  const baseline = view.getStats().lastDrawn
  assert.equal(baseline, draft.segments.length)
  assert.ok(!c2d.texts.some(item => item.text.includes('热处理')))

  view.setLayerVisible('DIM', false)
  c2d.texts.length = 0
  view.render()
  assert.equal(view.getStats().lastDrawn, baseline - draft.segsByLayer.get('DIM'))
  assert.ok(!c2d.texts.some(item => ['Ø8.000', 'Ø13', '4×Ø8 通孔'].includes(item.text)))
  view.setLayerVisible('DIM', true)
  view.render()
  assert.equal(view.getStats().lastDrawn, baseline)

  view.setLayerVisible('NOTES', true)
  c2d.texts.length = 0
  view.render()
  assert.ok(c2d.texts.some(item => item.text === '热处理硬度 HRC48-52'))
  assert.ok(c2d.texts.some(item => item.text === '去应力退火'))
  view.setLayerVisible('NOTES', false)

  view.setLayerVisible('0', false)
  gl.reset()
  view.render()
  assert.equal(view.getStats().lastDrawn, baseline - draft.segsByLayer.get('0'))
  assert.equal(gl.callsOf('drawArrays').some(call => call.args[0] === gl.gl.POINTS), false)
  view.setLayerVisible('0', true)
  view.render()
  assert.equal(view.getStats().lastDrawn, baseline)
  view.dispose()
})

function lcg(seed) {
  let state = seed >>> 0
  return () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

await scenario(['csr', 'text-priority'], '64×64 CSR 拾取对账、容差/显隐与标注文字优先', () => {
  const rand = lcg(20261018)
  const segments = Array.from({ length: 400 }, () => {
    const x = rand() * 400, y = rand() * 300
    const angle = rand() * Math.PI * 2, length = 5 + rand() * 40
    return { x1: x, y1: y, x2: x + length * Math.cos(angle), y2: y + length * Math.sin(angle) }
  })
  const grid = core.buildSegGrid(segments)
  assert.equal(grid.grid, 64)
  assert.equal(grid.starts.length, 64 * 64 + 1)
  assert.equal(grid.starts[64 * 64], grid.items.length)
  assert.ok([...grid.items].every(index => index < segments.length))
  assert.equal(new Set(grid.items).size, segments.length)
  for (let query = 0; query < 64; query++) {
    const target = Math.floor(rand() * segments.length)
    const t = rand()
    const qx = segments[target].x1 + (segments[target].x2 - segments[target].x1) * t + (rand() - 0.5) * 12
    const qy = segments[target].y1 + (segments[target].y2 - segments[target].y1) * t + (rand() - 0.5) * 12
    const got = grid.pick(qx, qy, 3)
    let want = -1, wantDistance = 3
    for (let i = 0; i < segments.length; i++) {
      const distance = core.distToSeg(segments[i], qx, qy)
      if (distance < wantDistance) { want = i; wantDistance = distance }
    }
    assert.ok(got === want || (got >= 0 && want >= 0 && Math.abs(core.distToSeg(segments[got], qx, qy) - wantDistance) < 1e-6), `CSR 与暴力拾取不一致：${query}`)
  }
  const isolated = core.buildSegGrid([{ x1: 0, y1: 0, x2: 100, y2: 0 }])
  assert.equal(isolated.pick(50, 1.8, 2), 0)
  assert.equal(isolated.pick(50, 3, 2), -1)
  assert.equal(isolated.pick(50, 0, 2, () => false), -1)

  const draft = loadGood()
  const gl = core.makeGlMock()
  gl.gl.canvas = { width: 800, height: 600 }
  const c2d = makeC2dMock()
  const view = new core.DraftView(gl.gl, c2d.ctx, draft)
  view.render()
  const first = draft.segments.find(segment => segment.entId === 0)
  const [sx, sy] = view.worldToScreen((first.x1 + first.x2) / 2, (first.y1 + first.y2) / 2)
  assert.equal(view.pick(sx, sy).entId, 0)
  view.setLayerVisible('0', false)
  assert.equal(view.pick(sx, sy), null)
  view.setLayerVisible('0', true)
  const [tx, ty] = view.worldToScreen(50, -42)
  assert.equal(view.pickText(tx, ty), 10)
  assert.equal(view.pick(tx, ty)?.entId, 9)
  view.dispose()
})

await scenario('dims', 'dims display_text/measured 比对标红、归组与公差文案', async () => {
  const draft = loadGood()
  const dim = draft.dims.find(item => item.id === 'D2A/30')
  const inferred = draft.dims.find(item => item.id === 'D2A/44')
  assert.equal(core.compareDim(dim), 'match')
  assert.equal(core.compareDim({ ...dim, displayText: 'Ø14' }), 'mismatch')
  assert.equal(core.compareDim(inferred), 'no-measured')
  assert.equal(core.formatTolerance(dim), '±0.05')
  assert.equal(core.formatTolerance(inferred), '±0.02')
  assert.equal(core.formatTolerance({ ...dim, tolerance: { upper: 0.005, lower: -0.01 } }), '+0.005/−0.01')
  assert.equal(core.formatTolerance({ ...dim, tolerance: { fit: 'H7' } }), 'H7')
  const dims = new Map(draft.dims.map(item => [item.id, item]))
  const detail = core.detailFor(9, 'DIM', draft.dimIdByEnt.get(9), dims,
    id => [...draft.dimIdByEnt.values()].filter(value => value === id).length)
  assert.equal(detail.kind, 'dim')
  assert.equal(detail.entityCount, 2)
  assert.equal(detail.typeLabel, '直径')

  const matched = openPane()
  await clickWorld(matched, goodRaw, 50, -42)
  const matchedDetail = matched.messages.filter(message => message.type === 'pickDetail').at(-1)?.detail
  assert.equal(matchedDetail.kind, 'dim')
  assert.equal(matchedDetail.compare, 'match')
  const selected = matched.messages.filter(message => message.type === 'selectionChanged').at(-1)
  assert.equal(selected.targets[0].type, 'dim')
  assert.equal(selected.targets[0].id, 'D2A/30')
  assert.notEqual(detailBody(matched.container).children[0].style.color, '#e06060')
  assert.match(detailBody(matched.container).textContent, /公差±0\.05/)
  matched.pane.dispose()

  const mismatchRaw = clone(goodRaw)
  mismatchRaw.dims.find(item => item.id === 'D2A/30').display_text = 'Ø14'
  const mismatch = openPane(mismatchRaw)
  await clickWorld(mismatch, mismatchRaw, 50, -42)
  const mismatchDetail = mismatch.messages.filter(message => message.type === 'pickDetail').at(-1)?.detail
  assert.equal(mismatchDetail.displayText, 'Ø14')
  assert.equal(mismatchDetail.measured, 13)
  assert.equal(mismatchDetail.compare, 'mismatch')
  assert.equal(mismatchDetail.toleranceText, '±0.05')
  const body = detailBody(mismatch.container)
  assert.equal(body.children[0].textContent, 'Ø14')
  assert.equal(body.children[0].style.color, '#e06060')
  assert.match(body.textContent, /⚠ 显示与测量不一致/)
  assert.match(body.textContent, /公差±0\.05/)
  mismatch.pane.dispose()
})

await scenario('origin', '出身徽标、NX 提示与手动改判 UI 闭环', () => {
  const automatic = core.originInfo({ channel: 'autocad', evidence: ['synthetic'], method: 'auto', ruleVersion: 'r' }, 'a.dwg')
  assert.equal(automatic.tone, 'ok')
  assert.match(automatic.badge, /AutoCAD 出身\(自动\)/)
  const unknown = core.originInfo({ channel: 'unknown', evidence: [], method: 'auto', ruleVersion: 'r' }, 'b.dwg')
  assert.equal(unknown.tone, 'unknown')

  const context = openPane()
  const originDiv = context.container.children[2]
  assert.match(originDiv.textContent, /AutoCAD 出身\(自动\)/)
  assert.equal(originDiv.children[0].style.color, '#7ec97e')
  const open = descendants(originDiv).find(node => node.textContent === '出身改判…')
  assert.ok(open)
  open.dispatch('click')
  const chooser = context.container.children[5]
  assert.equal(chooser.style.display, 'block')
  const radios = descendants(chooser).filter(node => node.tagName === 'INPUT' && node.type === 'radio')
  assert.equal(radios.length, 3)
  for (const radio of radios) radio.checked = radio.value === 'nx'
  const confirm = descendants(chooser).find(node => node.textContent === '确认改判')
  confirm.dispatch('click')
  const changed = context.messages.filter(message => message.type === 'originChanged').at(-1)
  assert.equal(changed.origin.channel, 'nx')
  assert.equal(changed.origin.method, 'manual')
  assert.match(changed.origin.evidence[0], /人工指认/)
  assert.match(originDiv.textContent, /NX 出身\(手动\)/)
  assert.match(originDiv.textContent, /补传对应 prt/)
  assert.equal(originDiv.children[0].style.color, '#e0b050')
  assert.equal(chooser.style.display, 'none')
  context.pane.dispose()
})

function makeDegradedRaw() {
  const raw = clone(goodRaw)
  const line = clone(goodRaw.entities[0])
  const mtext = clone(goodRaw.entities[10])
  const entities = []
  for (let i = 0; i < 7000; i++) entities.push({ ...clone(line), id: i, layer: 'dense', view_id: 0 })
  for (let i = 0; i < 300; i++) {
    const entity = { ...clone(mtext), id: 7000 + i, layer: 'dense', view_id: 0 }
    delete entity.dim_id
    entities.push(entity)
  }
  entities.push({ ...clone(line), id: 7300, type: 'future_entity', layer: 'dense', view_id: 0 })
  raw.entities = entities
  raw.dims = []
  raw.tech_requirements = []
  raw.layers = { dense: { aci: 7, off: false, frozen: false, plot: true } }
  raw.coverage.entities_by_type = { line: 7000, mtext: 300, future_entity: 1 }
  raw.coverage.semantic.dims = { found: 0, parsed: 0 }
  raw.coverage.semantic.tech_requirements = { found: 0, parsed: 0 }
  Object.assign(raw.self_check, {
    input_entities: 7301, drawn_entities: 7301, insert_exploded: 0, star_d_exploded: 0,
    truecolor_count: 0, reconciles: true,
  })
  raw.self_check.dropped = { by_type: {}, by_reason: {} }
  return raw
}

const degradedRaw = makeDegradedRaw()
await scenario('budget', '默认每帧 6000 段/240 字预算且全量数据与 CSR 索引保留', () => {
  const draft = core.loadDraft(clone(degradedRaw))
  assert.equal(draft.entityCount, 7301)
  assert.equal(draft.segments.length, 7000)
  assert.equal(draft.texts.length, 300)
  assert.deepEqual(draft.skippedTypes, ['future_entity'])
  const fullGrid = core.buildSegGrid(draft.segments)
  assert.equal(new Set(fullGrid.items).size, 7000)

  const gl = instrumentGl(core.makeGlMock())
  gl.mock.gl.canvas = { width: 800, height: 600 }
  const c2d = makeC2dMock()
  const view = new core.DraftView(gl.mock.gl, c2d.ctx, draft)
  assert.equal(gl.buffers[0].byteLength, 7000 * 2 * 8 * 4)
  view.render()
  const stats = view.getStats()
  assert.equal(view.countVisibleTexts(), 300)
  assert.equal(stats.lastStep, 2)
  assert.equal(stats.lastDrawn, 3500)
  assert.equal(stats.textsDrawn, 240)
  assert.equal(stats.textsOverflow, 60)
  assert.equal(c2d.texts.length, 240)
  const lines = gl.mock.callsOf('drawArrays').find(call => call.args[0] === gl.mock.gl.LINES)
  assert.equal(lines.args[2], 7000)
  assert.equal(draft.segments.length, 7000)
  assert.equal(draft.texts.length, 300)
  view.dispose()
})

await scenario('degradation', 'DrawingPreview 实际显示抽稀、文字截断与未知类型降级徽标', async () => {
  const { outputFiles } = await build({
    stdin: {
      resolveDir: path.join(root, 'src'),
      contents: `export { DrawingPreview } from './client.ts'; export { makeGlMock } from ${JSON.stringify(glMockPath)};`,
    },
    bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react'],
  })
  const module = { exports: {} }
  let cursor = 0, hooks = [], cleanups = [], tree
  let clientMakeGlMock
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
  const env = makeDom(() => clientMakeGlMock())
  const container = env.makeEl('div')
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports,
    require: name => {
      if (name === 'react') return react
      throw new Error(name)
    },
    document: env.document, window: env.window, ResizeObserver: env.ResizeObserver,
    performance, setTimeout, clearTimeout, console,
  })
  clientMakeGlMock = module.exports.makeGlMock
  const descriptor = { name: 'degraded.dwg', packText: JSON.stringify(degradedRaw) }
  const render = () => { cursor = 0; tree = module.exports.DrawingPreview({ descriptor }) }
  render()
  render()

  const reactText = node => node && typeof node === 'object' ? (node.children ?? []).map(reactText).join('') : String(node ?? '')
  const reactNodes = rootNode => {
    const out = []
    const visit = node => {
      if (!node || typeof node !== 'object') return
      out.push(node)
      for (const child of node.children ?? []) visit(child)
    }
    visit(rootNode)
    return out
  }
  const badges = reactNodes(tree).filter(node => node.props?.className === 'cdv-badge').map(reactText)
  assert.deepEqual(badges, ['几何已抽稀', '文字有截断', '跳过未知类型：future_entity'])
  assert.match(reactText(tree), /7301 实体 · 0 尺寸/)
  const gl = container.children[0].glMocks[0]
  const lines = gl.callsOf('drawArrays').find(call => call.args[0] === gl.gl.LINES)
  assert.equal(lines.args[2], 7000)
  assert.equal(container.children[1].c2dMocks[0].texts.length, 240)
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
})

const requiredCoverage = ['entities', 'stipple', 'render', 'color', 'layers', 'csr', 'text-priority', 'dims', 'origin', 'budget', 'degradation']
for (const id of requiredCoverage) assert.ok(coverage.has(id), `综合入口未执行覆盖项：${id}`)
console.log(`M3-03 2D 功能迁移验收通过：${scenarioCount} 个综合场景，${assertionCount} 项断言（合成概览，不代表完整审图）。`)
