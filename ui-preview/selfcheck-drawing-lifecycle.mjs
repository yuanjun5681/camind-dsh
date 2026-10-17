// M3-04 drawing-job lifecycle: stale A/B responses, session switching, React remount,
// and deterministic cleanup of slot subscriptions, polling timers and conversion jobs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
let factory
let cursor = 0, hooks = [], tree, currentProps, mounted = false
let activeSubscriptions = 0, subscriptionCount = 0, unsubscriptionCount = 0
let nextTimer = 1
const timers = new Map()

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
    getContext: kind => tag === 'canvas' && kind === 'webgl2' ? {} : null,
  }),
  head: { appendChild() {} },
}
const Viewer = props => ({ type: 'drawing-viewer', props })
const slots = {
  entriesOfSlot: name => name === 'cam.drawing.preview'
    ? [{ options: { key: 'drawing-viewer' }, component: Viewer }] : [],
  subscribe() {
    activeSubscriptions++
    subscriptionCount++
    let active = true
    return () => {
      if (!active) return
      active = false
      activeSubscriptions--
      unsubscriptionCount++
    }
  },
  inject: (_name, fn) => fn(),
  register() {},
}
const window = { __ModuleLoader__: { load: definition => { factory = definition.factory } } }

function setTimeoutFake(fn) {
  const id = nextTimer++
  timers.set(id, fn)
  return id
}
function clearTimeoutFake(id) {
  timers.delete(id)
}
function runTimers() {
  const pending = [...timers.values()]
  timers.clear()
  for (const fn of pending) fn()
}

const requests = []
const jobs = new Map()
const descriptorGates = new Map()
let jobSequence = 0
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function jobKey(url, suffix) {
  const match = String(url).match(/\/packs\/([^/?]+)(?:\/([^/?]+))?$/)
  return suffix === 'status' || suffix === 'cancel' ? match?.[1] : undefined
}
async function fetch(url, options = {}) {
  requests.push({ url, options })
  if (url.endsWith('/packs') && options.method === 'POST') {
    const session = decodeURIComponent(String(url).match(/sessions\/([^/]+)/)?.[1] ?? '')
    const path = JSON.parse(options.body).path
    const jobId = `job-${++jobSequence}`
    const key = `pack-${jobSequence}`
    jobs.set(jobId, { session, path, key })
    return response({ jobId, state: 'queued' })
  }
  const statusId = jobKey(url, 'status')
  if (statusId && url.endsWith('/status')) {
    const job = jobs.get(statusId)
    assert.ok(job, `unknown status job: ${statusId}`)
    if (job.path === 'running.dxf') return response({ state: 'running' })
    return response({ state: 'ready', result: { key: job.key } })
  }
  const cancelId = jobKey(url, 'cancel')
  if (cancelId && url.endsWith('/cancel')) {
    return response({ state: 'error', error: { code: 'cancelled', message: '图纸转换已取消' } })
  }
  const packMatch = String(url).match(/\/packs\/(pack-\d+)\?path=/)
  if (packMatch) {
    const session = decodeURIComponent(String(url).match(/sessions\/([^/]+)/)?.[1] ?? '')
    const path = new URL(url, 'http://preview.test').searchParams.get('path')
    const gate = descriptorGates.get(`${session}:${path}`)
    assert.ok(gate, `missing descriptor gate for ${session}:${path}`)
    return gate.promise
  }
  throw new Error(`unexpected fetch: ${url}`)
}

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
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake,
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

function render(props = currentProps) {
  currentProps = props
  cursor = 0
  tree = DrawingBody(props)
}
function mount(props) {
  assert.equal(mounted, false, 'test harness must unmount before a fresh mount')
  hooks = []
  mounted = true
  render(props)
  render(props)
}
function unmount() {
  if (mounted) for (const hook of hooks) if (typeof hook?.cleanup === 'function') hook.cleanup()
  mounted = false
  tree = undefined
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
function currentDescriptor() {
  return find(tree, node => node.type === Viewer)?.props.descriptor
}
async function flush(rounds = 30) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
function makeDescriptor(session, path) {
  return {
    name: path,
    packText: `{"session":${JSON.stringify(session)},"path":${JSON.stringify(path)}}`,
    session,
    source: { uri: `upload://batch/${path}`, sha256: '1'.repeat(64), name: path },
    pack: { sha256: '2'.repeat(64), identity: '3'.repeat(64) },
  }
}
function cancellations() {
  return requests.filter(call => call.url.endsWith('/cancel') && call.options.method === 'POST')
}

// A is already waiting for its pack descriptor when the session switches to B.
// B becomes ready first; A's later descriptor and cancel reconciliation must be inert.
const aGate = deferred(), bGate = deferred()
const aDescriptor = makeDescriptor('session-a', 'a.dxf')
const bDescriptor = makeDescriptor('session-b', 'b.dxf')
descriptorGates.set('session-a:a.dxf', aGate)
descriptorGates.set('session-b:b.dxf', bGate)
mount({ sessionId: 'session-a', preview: { name: 'a.dxf', path: 'a.dxf' }, onReference() {} })
await flush()
assert.ok(requests.some(call => call.url.includes('/packs/pack-1?path=a.dxf')),
  `A must reach descriptor fetch: ${JSON.stringify(requests.map(call => call.url))}`)
assert.equal(activeSubscriptions, 1)

render({ sessionId: 'session-b', preview: { name: 'b.dxf', path: 'b.dxf' }, onReference() {} })
await flush()
assert.ok(requests.some(call => call.url.includes('/packs/pack-2?path=b.dxf')), 'B must reach descriptor fetch')
assert.equal(cancellations().length, 1, 'switching sessions must cancel A exactly once')
bGate.resolve(response(bDescriptor))
await flush()
render()
assert.equal(currentDescriptor(), bDescriptor, 'B must become the visible ready descriptor')

aGate.resolve(response(aDescriptor))
await flush()
render()
assert.equal(currentDescriptor(), bDescriptor, 'late A descriptor must not replace ready B')
assert.equal(activeSubscriptions, 1, 'session switch must not duplicate the slot subscription')
unmount()
await flush()
assert.equal(cancellations().length, 2, 'unmount must cancel the current B job')
assert.equal(activeSubscriptions, 0)
assert.equal(timers.size, 0)
console.log('ok - late A response cannot overwrite B; session switch and unmount cancel jobs')

// Remount repeatedly with a non-terminal job. Every cleanup must cancel the job,
// clear its pending poll and release the slot subscription; no late poll may restart.
for (let attempt = 0; attempt < 3; attempt++) {
  mount({ sessionId: 'session-r', preview: { name: 'running.dxf', path: 'running.dxf' }, onReference() {} })
  await flush()
  assert.equal(activeSubscriptions, 1, `mount ${attempt + 1} must have one subscription`)
  assert.equal(timers.size, 1, `mount ${attempt + 1} must have one pending poll`)
  const statusBefore = requests.filter(call => call.url.endsWith('/status')).length
  unmount()
  await flush()
  assert.equal(activeSubscriptions, 0, `unmount ${attempt + 1} must release its subscription`)
  assert.equal(timers.size, 0, `unmount ${attempt + 1} must clear its poll timer`)
  runTimers()
  await flush()
  assert.equal(requests.filter(call => call.url.endsWith('/status')).length, statusBefore,
    `unmount ${attempt + 1} must prevent further status polling`)
}
assert.ok(subscriptionCount >= 4, 'every mount must establish its slot subscription')
assert.equal(unsubscriptionCount, subscriptionCount, 'every subscription must eventually be released')
assert.equal(activeSubscriptions, 0)
assert.equal(cancellations().length, 5, 'each of the three remount jobs must be cancelled')
assert.equal(timers.size, 0)
console.log('ok - React remount leaves no slot subscription, polling timer or job request behind')
console.log('ui-preview drawing lifecycle selfcheck passed')
