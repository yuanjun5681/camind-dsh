// Exercise the UI handlers against the real headless GeomView camera and selection.
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('./src/', import.meta.url))
const { outputFiles } = await build({
  stdin: { contents: "export { ModelControls } from './controls.ts'; export { GeomView } from './viewer/geom_view.ts'; export { Projection, StandardView } from './core/camera.ts'", resolveDir: root },
  bundle: true, write: false, platform: 'browser', format: 'cjs',
  alias: { '@camind/core': `${root}core/index.ts` }, external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
})
let cursor = 0, effects = [], hooks = []
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = initial
    return [hooks[index], value => { hooks[index] = value }]
  },
  useEffect(fn) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(fn()) } },
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: name => {
  if (name === 'react') return react
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'Button', Input: 'Input' }
  throw new Error(name)
} })
const { ModelControls, GeomView, Projection, StandardView } = module.exports
const view = new GeomView({ addEventListener() {}, removeEventListener() {}, clientWidth: 640, clientHeight: 480 }, null, { requestFrame() {} })
view.setPart('fixture', [
  { fid: 'F000001', surfaceType: 'plane', areaMm2: 12 },
  { fid: 'F000002', surfaceType: 'cylinder', areaMm2: 20 },
  { fid: 'F000003', surfaceType: 'plane', areaMm2: 10 },
])
let tree
function render() { cursor = 0; tree = ModelControls({ view }) }
function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [] }
function text(node) { return node && typeof node === 'object' ? node.children.map(text).join('') : String(node ?? '') }
function button(label) { return nodes().find(node => node.type === 'Button' && text(node) === label) }
function click(label) { button(label).props.onClick(); render() }
function submit(value) {
  nodes().find(node => node.type === 'Input').props.onChange({ target: { value } }); render()
  nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render()
}
function check(type, checked) {
  nodes().find(node => node.type === 'label' && text(node).trim() === type).children[0].props.onChange({ target: { checked } }); render()
}
const selected = () => Array.from(view.selectedFids())
render()
assert.equal(nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 2)
for (const [label, yaw, pitch] of [['等轴', -Math.PI / 4, 0.6154797086703873], ['俯视', -Math.PI / 2, Math.PI / 2], ['仰视', -Math.PI / 2, -Math.PI / 2], ['前视', -Math.PI / 2, 0], ['后视', Math.PI / 2, 0], ['右视', 0, 0], ['左视', Math.PI, 0]]) {
  const value = ['等轴', '俯视', '仰视', '前视', '后视', '右视', '左视'].indexOf(label)
  view.setStandardView(value)
  assert.equal(view.getCamera().distance() > 0, true)
  assert.equal(view.getCamera().yaw(), yaw)
  assert.equal(view.getCamera().pitch(), pitch)
}
for (const projection of [Projection.Perspective, Projection.Orthographic]) {
  view.setProjection(projection)
  assert.equal(view.getCamera().projection(), projection)
  assert.equal(Number.isFinite(view.getCamera().projectionMatrix(4 / 3).at(0, 0)), true)
}
view.setEdgesVisible(false); assert.equal(view.edgesVisible(), false)
view.setEdgesVisible(true); assert.equal(view.edgesVisible(), true)
submit('f000001，F000002 F000001'); assert.deepEqual(selected(), ['F000001', 'F000002'])
assert.match(text(tree), /F000002 · cylinder · 20.00 mm²/)
submit('F999999'); assert.deepEqual(selected(), ['F000001', 'F000002']); assert.match(text(tree), /面编号不存在/)
check('cylinder', false); assert.deepEqual(selected(), ['F000001'])
submit('F000002'); assert.deepEqual(selected(), ['F000001']); assert.match(text(tree), /筛选排除/)
check('plane', false); assert.deepEqual(selected(), [])
submit('F000003'); assert.match(text(tree), /筛选排除/)
click('全部'); submit('F000003'); assert.deepEqual(selected(), ['F000003'])
view.setSelectedFids(['F000001', 'F000003']); render(); assert.match(text(tree), /已选 2 面/)
click('全不选'); assert.deepEqual(selected(), [])
click('全部'); submit('F000001'); click('清空'); assert.deepEqual(selected(), [])
assert.equal(nodes().find(node => node.type === 'Input').props.value, '')
submit(''); assert.deepEqual(selected(), [])
for (const cleanup of effects) cleanup?.()
assert.equal(view.callbacks.selectionChanged, undefined)
view.dispose()
console.log('model controls selfcheck passed: seven views, projection, edges, FID validation, multi-selection, type filters, cleanup')
