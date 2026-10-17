// M2-03 worker isolation: real parsing work is offloaded, abort/timeout terminate
// the worker and release it, and the host event loop remains responsive.
import assert from 'node:assert/strict'
import { convertDxfAsync } from './lib/worker.js'

const HEADER = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n`
const TABLES = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nContinuous\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0\n41\n1.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n`
function makeDxf(count) {
  const lines = Array.from({ length: count }, (_, i) => `0\nLINE\n5\n${100 + i}\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n${i}.0\n20\n0.0\n30\n0.0\n11\n${i + 1}.0\n21\n0.0\n31\n0.0\n`).join('')
  return `${HEADER}${TABLES}0\nSECTION\n2\nENTITIES\n${lines}0\nENDSEC\n0\nEOF\n`
}
const options = source => ({ sourceName: 'worker.dxf', sourceBytes: Buffer.from(source) })

const good = await convertDxfAsync(makeDxf(1), options(makeDxf(1)))
assert.equal(good.self_check.reconciles, true)
console.log('ok - DXF worker conversion succeeds')

const large = makeDxf(12000)
let ticks = 0
const timer = setInterval(() => { ticks++ }, 1)
const controller = new AbortController()
const pending = convertDxfAsync(large, { signal: controller.signal, ...options(large) })
controller.abort()
await assert.rejects(pending, /取消/)
await new Promise(resolve => setTimeout(resolve, 20))
assert.ok(ticks > 0, 'host event loop should continue ticking while worker parses')
assert.equal(process._getActiveHandles().some(handle => handle.constructor.name === 'Worker'), false, 'aborted worker must be terminated')
console.log('ok - AbortSignal terminates the actual worker without host starvation')

await assert.rejects(convertDxfAsync(large, { timeoutMs: 1, ...options(large) }), /超时/)
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(process._getActiveHandles().some(handle => handle.constructor.name === 'Worker'), false, 'timeout must terminate the actual worker')
clearInterval(timer)
console.log('ok - timeout terminates the actual worker and releases resources')
