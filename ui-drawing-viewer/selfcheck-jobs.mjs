// M2-04 bounded job governance: concurrency, memory, cancellation, retry and session isolation.
import assert from 'node:assert/strict'
import { createJobQueue, classifyConversionError } from './lib/jobs.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(queue, id, sessionId) {
  for (let i = 0; i < 100; i++) {
    const status = queue.status(id, sessionId)
    if (status && !['queued', 'running'].includes(status.state)) return status
    await sleep(2)
  }
  throw new Error(`作业未进入终态：${id}`)
}
const queue = createJobQueue({ maxGlobal: 2, maxPerSession: 1, maxMemoryMb: 600 })
let active = 0, maxActive = 0, memoryPeak = 0
const run = (id, delay = 20) => async () => {
  active++; maxActive = Math.max(maxActive, active)
  memoryPeak = Math.max(memoryPeak, queue.activeMemoryMb)
  try { await sleep(delay); return { id } } finally { active-- }
}
const first = queue.submit({ sessionId: 's1', estimatedMemoryMb: 200, run: () => run('a') })
const second = queue.submit({ sessionId: 's1', estimatedMemoryMb: 200, run: () => run('b') })
const third = queue.submit({ sessionId: 's2', estimatedMemoryMb: 200, run: () => run('c') })
const sessions = new Map([[first.id, 's1'], [second.id, 's1'], [third.id, 's2']])
for (const job of [first, second, third]) {
  const ready = await waitFor(queue, job.id, sessions.get(job.id))
  assert.equal(ready.state, 'ready')
}
assert.ok(maxActive <= 2, `全局并发不得超过 2：${maxActive}`)
assert.ok(memoryPeak <= 600, `内存不得超过预算：${memoryPeak}`)
assert.equal(queue.status('missing', 's1'), null)
console.log('ok - bounded concurrency and session-isolated status')

let aborted = false
const cancellable = queue.submit({ sessionId: 's1', estimatedMemoryMb: 100, run: async ({ signal }) => {
  signal.addEventListener('abort', () => { aborted = true })
  await sleep(80)
} })
await sleep(5)
const cancelled = queue.cancel(cancellable.id, 's1')
assert.equal(cancelled.error.code, 'cancelled')
await sleep(100)
assert.equal(aborted, true)
assert.equal(queue.status(cancellable.id, 's1').retryable, false)
assert.throws(() => queue.retry(cancellable.id, 's1'), /不可重试/)
console.log('ok - cancellation aborts actual work and is not retryable')

let attempts = 0
const timedOut = queue.submit({ sessionId: 's1', estimatedMemoryMb: 100, run: async () => {
  attempts++
  if (attempts === 1) throw new Error('图纸转换超时')
  return { recovered: true }
} })
await sleep(5)
assert.equal(queue.status(timedOut.id, 's1').retryable, true)
const retried = queue.retry(timedOut.id, 's1')
assert.equal(retried.retryOf, timedOut.id)
await waitFor(queue, retried.id, 's1')
assert.equal(queue.status(retried.id, 's1').state, 'ready')
assert.throws(() => queue.submit({ sessionId: 's1', estimatedMemoryMb: 601, run: async () => {} }), /内存预算/)
console.log('ok - retry classification and memory budget')

const pendingQueue = createJobQueue({ maxGlobal: 1, maxPerSession: 1, maxMemoryMb: 100 })
const slow = pendingQueue.submit({ sessionId: 's1', estimatedMemoryMb: 100, run: async () => { await sleep(50) } })
const queued = pendingQueue.submit({ sessionId: 's1', estimatedMemoryMb: 100, run: async () => {} })
await sleep(1)
assert.equal(pendingQueue.cancel(queued.id, 's1').error.code, 'cancelled')
await waitFor(pendingQueue, slow.id, 's1')
assert.equal(pendingQueue.status(slow.id, 's1').state, 'ready')
pendingQueue.deleteSession('s1')
assert.equal(pendingQueue.status(slow.id, 's1'), null)
assert.equal(classifyConversionError(new Error('dwg2dxf 未找到(x)')).code, 'tool_missing')
console.log('ok - queued cancellation, cleanup and error classification')
