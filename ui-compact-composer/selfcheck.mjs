import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
let plugin, service
const h = (type, props, ...children) => ({ type, props, children })
vm.runInNewContext(fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: spec => { plugin = spec.factory(() => ({ createElement:h })) } } }
})
plugin.apply({ provide: (name, value) => { assert.equal(name, 'compactComposer'); service = value }, effect: () => {} })
const render = state => service.renderResponse({ state, dock: { left:12, width:600, bottom:16 } })
assert.equal(render({ streaming:false, text:'' }), null)
assert.equal(render({ submitting:true, streaming:false, text:'' }), null)
const response = render({ streaming:true, text:'第一条\n\n最新公开输出' })
assert.equal(response.children[1].children[0], '最新公开输出')
assert.ok(!JSON.stringify(response).includes('第一条'))
assert.equal(response.props.style.width, 600)
assert.equal(plugin.latestLine('一\r\n二\r\n  '), '二')
assert.equal(plugin.latestLine(undefined), '')
assert.equal(plugin.latestLine('完整句子含 @引用 /命令'), '完整句子含 @引用 /命令')
console.log('compact response selfcheck passed: waiting, latest public line, CRLF, empty output, unchanged text and docking')

const activity = service.latestActivity
assert.equal(activity({ nodes:[{kind:'user',turn:2},{kind:'assistant',blocks:[{kind:'reasoning',text:'SECRET'}]}] }), '')
assert.equal(activity({ nodes:[{kind:'assistant',blocks:[{kind:'text',text:'OLD'}]},{kind:'user',turn:2}], runningCalls:[{name:'old_tool',turn:1}] }), '')
assert.equal(activity({ nodes:[{kind:'user',turn:2}], runningCalls:[{name:'cam_survey',turn:2,step:1,argsRaw:'SECRET_ARGS'}] }), '调用 cam_survey')
assert.equal(activity({ nodes:[{kind:'user'},{kind:'assistant',blocks:[{kind:'text',text:'旧回复'},{kind:'tool-call',name:'read_file'}]},{kind:'tool-result',call:{name:'read_file'},isError:true,content:[{type:'text',text:'SECRET_RESULT'}]}], partial:{blocks:[{kind:'reasoning',text:'SECRET'}]} }), 'read_file · 失败')
assert.equal(activity({ nodes:[{kind:'user'},{kind:'tool-result',call:{name:'read_file'}}], partial:{step:3,blocks:[{kind:'text',text:'最终回复'}]},runningCalls:[{name:'read_file',step:2}] }), '最终回复')
assert.equal(render({ activity:'调用 cam_survey', text:'旧回复' }).children[1].children[0], '调用 cam_survey')
console.log('activity projection passed: current turn only, tool start/result, public reply, reasoning/args/results excluded')
