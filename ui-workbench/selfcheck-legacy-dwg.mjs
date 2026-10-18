// M5-01 rollback config, Host audit events, and legacy SVG -> DrawingReference v1 mapping.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { Config, apply as applyHost } from './index.js'

const defaultConfig = Config({})
assert.equal(defaultConfig.useLegacyDwgPane.get(), false)
assert.equal(Config({ useLegacyDwgPane: true }).useLegacyDwgPane.get(), true)
assert.throws(() => Config({ useLegacyDwgPane: 'true' }), /expected boolean/)
console.log('ok - volatile rollback schema defaults to false and accepts only booleans')

const hostListeners = [], hostLogs = []
let hostValue = false
const hostContext = {
  logger: { info: message => hostLogs.push(message) },
  on(name, listener) { assert.equal(name, 'loader/volatile-update'); hostListeners.push(listener); return () => {} },
}
applyHost(hostContext, { useLegacyDwgPane: { get: () => hostValue } })
assert.equal(hostLogs.length, 0, 'the default renderer does not emit a rollback event')
hostValue = true
hostListeners[0]([['useLegacyDwgPane']])
assert.match(hostLogs[0], /event=drawing-renderer-rollback state=enabled origin=config/)
hostValue = false
hostListeners[0]([['useLegacyDwgPane']])
assert.match(hostLogs[1], /event=drawing-renderer-rollback state=disabled origin=config/)
hostListeners[0]([['anotherField']])
assert.equal(hostLogs.length, 2)
assert.ok(hostLogs.every(line => !/session|task-input|sha256|\.dwg/i.test(line)), 'Host events must not contain session or file details')
hostValue = true
applyHost(hostContext, { useLegacyDwgPane: { get: () => hostValue } })
assert.match(hostLogs[2], /state=enabled origin=startup/, 'an offline rollback edit is recorded at startup')
console.log('ok - Host records nonsensitive enable, restore, and startup rollback events')

function snapshotStore(initial) {
  let current = initial
  const listeners = new Set()
  return {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { current = next; for (const listener of listeners) listener() },
  }
}
const source = await fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
const code = source.replace('exports.apply = apply', 'exports.__legacyDwgTest = { LegacyDwgConfigController, legacyDescriptorPack, legacyDrawingTarget, legacyDrawingReference, selectLegacyDrawingReference, sameDrawingIdentity }; exports.apply = apply')
let plugin
vm.runInNewContext(code, {
  window: { __ModuleLoader__: { load: definition => {
    plugin = definition.factory(name => {
      if (name === 'react') return { createElement: () => ({}), Component: class {} }
      if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: snapshotStore }
      return {}
    })
  } } },
  URL, URLSearchParams, Blob, AbortController, setTimeout, clearTimeout,
})
const api = plugin.__legacyDwgTest
assert.ok(source.includes("name: 'plugins.bundle.config', key: BUNDLE_NAME"), 'the rollback card must use the official bundle config seat')
assert.ok(source.includes("configForms.whileServed([CONFIG_NS]"), 'the rollback card must use configForms')

let configSnapshot = { status: 'loading', writable: true, value: { useLegacyDwgPane: true }, user: { useLegacyDwgPane: true } }
const configListeners = new Set(), mutations = []
const publishConfig = () => { for (const listener of configListeners) listener() }
const scope = {
  getSnapshot: () => configSnapshot,
  subscribe(listener) { configListeners.add(listener); return () => configListeners.delete(listener) },
  async mutate(ops) {
    mutations.push(...ops)
    for (const op of ops) {
      const user = { ...(configSnapshot.user ?? {}) }
      if (op.op === 'set') user[op.path[0]] = op.value
      else if (op.op === 'unset') delete user[op.path[0]]
      configSnapshot = { ...configSnapshot, user, value: { useLegacyDwgPane: user.useLegacyDwgPane === true } }
    }
    publishConfig()
  },
}
const controller = new api.LegacyDwgConfigController(scope)
assert.equal(controller.store.getSnapshot().available, false)
assert.equal(controller.store.getSnapshot().enabled, false, 'not-ready config cannot roll back even if a stale value is true')
configSnapshot = { status: 'ready', writable: true, value: { useLegacyDwgPane: false }, user: undefined }
publishConfig()
assert.equal(controller.store.getSnapshot().enabled, false)
const card = controller.inject()
card.edit(true)
await card.save()
assert.equal(mutations[0].op, 'set')
assert.equal(mutations[0].path.length, 1)
assert.equal(mutations[0].path[0], 'useLegacyDwgPane')
assert.equal(controller.store.getSnapshot().enabled, true)
card.restore()
assert.equal(controller.store.getSnapshot().dirty, true)
await card.save()
assert.equal(mutations[1].op, 'unset')
assert.equal(controller.store.getSnapshot().enabled, false)
assert.equal(Object.hasOwn(configSnapshot.user, 'useLegacyDwgPane'), false, 'restore removes the user override and returns to the default')
controller.dispose()
assert.equal(configListeners.size, 0)
console.log('ok - configForms controller covers default false, explicit true, and restore-default unset')

const drawingSource = { uri: 'task-input://1/dwg', sha256: '1'.repeat(64), name: 'part.dwg' }
const pack = {
  source_sha256: drawingSource.sha256,
  dims: [{ id: 'D1', display_text: 'Ø13', entity_ids: [200, 201] }],
  entities: [{ id: 7, type: 'mtext', text: '技术要求', handle: 'A' }],
}
const descriptor = {
  name: 'part.dwg', session: 's1', source: drawingSource,
  pack: { sha256: '2'.repeat(64), identity: '3'.repeat(64) }, packText: JSON.stringify(pack),
}
const data = { source_sha256: drawingSource.sha256, preview_sha256: '4'.repeat(64) }
const dim = { id: 'd:0', kind: 'dimension', source_id: 'D1', text: 'Ø13', entity_ids: [200, 201] }
const entity = { id: 't:7', kind: 'text', source_id: 'A', text: '技术要求', entity_ids: [7] }
assert.equal(api.legacyDescriptorPack('s1', drawingSource, descriptor).dims[0].id, 'D1')
assert.throws(() => api.legacyDescriptorPack('s2', drawingSource, descriptor), /冻结图纸/)
assert.throws(() => api.legacyDescriptorPack('s1', { ...drawingSource, sha256: '9'.repeat(64) }, descriptor), /冻结图纸/)
const normalize = value => JSON.parse(JSON.stringify(value))
const dimReference = api.legacyDrawingReference('s1', data, descriptor, pack, dim)
assert.deepEqual(normalize(dimReference), {
  kind: 'camind-drawing-ref', version: 1, session: 's1', source: drawingSource,
  pack: descriptor.pack, target: { type: 'dim', id: 'D1' },
})
const entityReference = api.legacyDrawingReference('s1', data, descriptor, pack, entity)
assert.deepEqual(normalize(entityReference.target), { type: 'entity', id: 7 })
assert.equal(api.legacyDrawingReference('s1', data, descriptor, pack, { ...dim, entity_ids: [200] }), null, 'partial dimension groups are not exact mappings')
assert.equal(api.legacyDrawingReference('s1', data, descriptor, pack, { ...dim, text: '14' }), null, 'text alone must not guess a dimension')
assert.equal(api.legacyDrawingReference('s1', data, descriptor, pack, { ...entity, source_id: 'B' }), null, 'entity handles must match exactly')
assert.equal(api.legacyDrawingReference('s1', { ...data, preview_sha256: null }, descriptor, pack, entity), null, 'fallback SVG annotations remain read-only')
assert.equal(api.legacyDrawingReference('s1', { ...data, source_sha256: '9'.repeat(64) }, descriptor, pack, entity), null, 'source changes invalidate mapping')
const changedPackDescriptor = { ...descriptor, pack: { ...descriptor.pack, identity: '5'.repeat(64) } }
assert.equal(api.sameDrawingIdentity(dimReference, changedPackDescriptor), false, 'pack identity changes invalidate the old reference')
console.log('ok - legacy targets map only by exact dim/entity identity and fail closed on source/pack changes')

let allow = false, verifyCalls = 0
const questionController = {
  async select() { verifyCalls++; if (!allow) throw new Error('图纸引用已失效'); return true },
}
await assert.rejects(api.selectLegacyDrawingReference(questionController, 's1', data, descriptor, pack, dim), /失效/)
assert.equal(verifyCalls, 1, 'a mapped legacy pick reaches the existing verification controller')
const beforeUnmapped = verifyCalls
const unmapped = await api.selectLegacyDrawingReference(questionController, 's1', data, descriptor, pack, { ...dim, entity_ids: [999] })
assert.equal(unmapped.ok, false)
assert.equal(unmapped.reason, 'unmapped')
assert.equal(verifyCalls, beforeUnmapped, 'an unmappable target never reaches reference verification or draft insertion')
allow = true
const verified = await api.selectLegacyDrawingReference(questionController, 's1', data, descriptor, pack, entity)
assert.equal(verified.ok, true)
assert.deepEqual(normalize(verified.reference), normalize(entityReference))
console.log('ok - legacy verification failure propagates without a fallback reference; unmappable targets stay read-only')
console.log('M5-01 legacy DwgPane rollback selfcheck complete')
