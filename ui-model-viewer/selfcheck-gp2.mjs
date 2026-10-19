// GP-2 read-contract checks: authoritative B/C fixtures from CAM-Agent, no gp-2 enablement or NX calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Package, clampDetail, excludedReasonLabel, excludedSummary, normalizeExcludedReason, parseManifest, zeroBodyLine } from './lib/host-core.js'

const root = fileURLToPath(new URL('./', import.meta.url))
const agent = path.resolve(process.env.CAM_AGENT_REPO ?? fileURLToPath(new URL('../../CAM-Agent', import.meta.url)))
const sourceRef = process.env.CAM_AGENT_REF ?? '4dc3e3d8725d612f111718dee5a003a0f2e65f69'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-gp2-check-'))
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { maxBuffer: 64 * 1024 * 1024, ...options })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}:\n${result.stderr || result.stdout}`)
  return result
}
try {
  const archive = run('git', ['-C', agent, 'archive', sourceRef,
    'nx_cam_mvp/geompack', 'nx_windows_agent/nx_worker/handlers/geompack_format.py'])
  run('tar', ['-x', '-C', tmp], { input: archive.stdout })
  fs.writeFileSync(path.join(tmp, 'nx_cam_mvp/__init__.py'), '')
  run('python3', ['-c', 'from nx_cam_mvp.geompack.gp2_fixtures import export_fixtures; import sys; export_fixtures(sys.argv[1])', path.join(tmp, 'out')], {
    env: { ...process.env, PYTHONPATH: tmp },
  })
  const fixtureRoot = path.join(tmp, 'out', 'gp2')
  const index = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'index.json'), 'utf8'))
  const resolvedRef = run('git', ['-C', agent, 'rev-parse', sourceRef]).stdout.toString().trim()
  console.log(`ok - fixture source ${resolvedRef}`)
  assert.deepEqual(new Set(Object.keys(index.B)), new Set([
    'body_count_negative', 'body_count_overflow', 'edge_count_negative', 'edge_count_overflow',
    'enumerated_body_count_negative', 'enumerated_body_count_overflow', 'enumerated_missing',
    'excluded_count_mismatch', 'excluded_key_empty', 'face_count_negative', 'face_count_overflow',
    'unknown_policy', 'unknown_reason', 'zero_body_bbox_nonzero',
  ]))

  for (const [name, item] of Object.entries(index.B)) {
    const dir = path.join(fixtureRoot, 'B', name)
    if (item.expected_code) {
      assert.throws(() => Package.open(dir), error => {
        assert.equal(error.code, item.expected_code, `${name}: ${error.code}: ${error.message}`)
        return true
      }, name)
      continue
    }
    const pkg = Package.open(dir)
    assert.equal(pkg.manifest.bodyCount, 0, `${name}: valid B package should open`)
    if (name === 'unknown_reason') {
      assert.equal(pkg.manifest.excludedBodies[0].reason, 'future-reason')
      assert.equal(normalizeExcludedReason(pkg.manifest.excludedBodies[0].reason), 'other')
    }
    if (name === 'unknown_policy') assert.equal(pkg.manifest.exclusionPolicy, 'future-policy')
  }
  console.log(`ok - B ${Object.keys(index.B).length} authoritative malformed/read-fallback cases`)

  const zero = Package.open(path.join(fixtureRoot, 'C', 'zero_enumerated'))
  assert.equal(zero.manifest.bodyCount, 0)
  assert.equal(zero.manifest.excludedBodies.length, 0)
  assert.equal(zero.loadMesh(0).faceCount(), 0)
  assert.equal(zero.loadMesh(1).faceCount(), 0)
  assert.equal(zero.loadEdges().edgeCount(), 0)
  assert.equal(zeroBodyLine(zero.manifest), '源文件没有可枚举的实体。')

  const filtered = Package.open(path.join(fixtureRoot, 'C', 'all_filtered'))
  assert.match(zeroBodyLine(filtered.manifest), /全部 1 个体未进入几何包:片体 1。/)
  const failed = Package.open(path.join(fixtureRoot, 'C', 'all_conversion_failed'))
  assert.match(zeroBodyLine(failed.manifest), /全部 1 个体未进入几何包:转换失败 1。/)
  const legacy = Package.open(path.join(fixtureRoot, 'C', 'legacy_no_new_fields'))
  assert.equal(legacy.manifest.excludedBodies, undefined)
  assert.equal(zeroBodyLine(legacy.manifest), '')
  console.log('ok - C zero-body packages, dual LOD, edges and legacy distinction')

  const manifestDoc = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'C', 'all_filtered', 'manifest.json'), 'utf8'))
  manifestDoc.bodies = [{ body: 0, n_faces: 1, blanked: true, stable_key: 'stable-fixture' }]
  manifestDoc.body_count = 1
  manifestDoc.enumerated_body_count = 2
  const enriched = parseManifest(JSON.stringify(manifestDoc))
  assert.equal(enriched.bodies[0].blanked, true)
  assert.equal(enriched.bodies[0].stableKey, 'stable-fixture')
  assert.equal(enriched.manifestRevision, 1)
  assert.equal(zeroBodyLine({ bodyCount: 2, enumeratedBodyCount: 2, excludedBodies: [] }), '')
  const baseManifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'C', 'all_filtered', 'manifest.json'), 'utf8'))
  for (const [name, mutate, expected] of [
    ['excluded_null', doc => { doc.excluded_bodies = null }, 'BadJson'],
    ['excluded_key_blank', doc => { doc.excluded_bodies[0].key = ' ' }, 'InvalidValue'],
    ['body_count_missing', doc => { delete doc.body_count }, 'CountMismatch'],
    ['body_count_empty_mismatch', doc => { doc.body_count = 5; doc.bodies = [] }, 'CountMismatch'],
    ['zero_count_nonempty', doc => { doc.body_count = 0; doc.bodies = [{ body: 0, n_faces: 1 }] }, 'CountMismatch'],
    ['excluded_body_count_mismatch', doc => { doc.body_count = 2; doc.bodies = []; doc.enumerated_body_count = 2 }, 'CountMismatch'],
    ['excluded_formula_mismatch', doc => { doc.body_count = 1; doc.bodies = [{ body: 0, n_faces: 1 }]; doc.enumerated_body_count = 3 }, 'CountMismatch'],
    ['stable_key_non_string', doc => {
      doc.bodies = [{ body: 0, n_faces: 1, stable_key: 1 }]; doc.body_count = 1; doc.enumerated_body_count = 2
    }, 'BadJson'],
    ['bodies_missing', doc => { delete doc.bodies }, 'CountMismatch'],
    ['excluded_element_array', doc => { doc.excluded_bodies = [[]] }, 'BadJson'],
    ['empty_bodies_nonzero_bbox', doc => {
      doc.bodies = []; doc.body_count = 0; doc.enumerated_body_count = 1; doc.bbox_relative.max[0] = 1
    }, 'InvalidValue'],
    ['zero_body_face_nonzero', doc => {
      doc.bodies = []; doc.body_count = 0; doc.face_count = 1; doc.edge_count = 0; doc.enumerated_body_count = 1
    }, 'InvalidValue'],
    ['blanked_non_boolean', doc => {
      doc.bodies = [{ body: 0, n_faces: 1, blanked: 'true' }]; doc.body_count = 1; doc.enumerated_body_count = 2
    }, 'BadJson'],
  ]) {
    const doc = structuredClone(baseManifest)
    mutate(doc)
    assert.throws(() => parseManifest(JSON.stringify(doc)), error => {
      assert.equal(error.code, expected, `${name}: ${error.code}`)
      return true
    }, name)
  }
  const integerValued = structuredClone(baseManifest)
  integerValued.body_count = 0.0
  integerValued.bodies = []
  integerValued.face_count = 0.0
  integerValued.edge_count = 0.0
  integerValued.enumerated_body_count = 1
  const withNumberLiterals = (doc, value) => {
    let text = JSON.stringify(doc)
    for (const key of ['body_count', 'face_count', 'edge_count', 'enumerated_body_count'])
      text = text.replace(`"${key}": ${value}`, `"${key}": ${value === 0 ? '0.0' : '3e2'}`)
    return text
  }
  assert.equal(parseManifest(withNumberLiterals(integerValued, 0)).bodyCount, 0)
  const largeIntegerValued = structuredClone(baseManifest)
  largeIntegerValued.body_count = 3e2
  largeIntegerValued.bodies = Array.from({ length: 300 }, (_, body) => ({ body, n_faces: 1 }))
  largeIntegerValued.face_count = 3e2
  largeIntegerValued.edge_count = 3e2
  largeIntegerValued.enumerated_body_count = 3e2
  largeIntegerValued.excluded_bodies = []
  assert.equal(parseManifest(withNumberLiterals(largeIntegerValued, 300)).bodyCount, 300)
  console.log('ok - excluded element forms, empty bodies, missing counts and integer-valued numbers')
  assert.equal(normalizeExcludedReason('toString'), 'other')
  assert.equal(excludedReasonLabel('future-reason'), '其他原因')
  assert.deepEqual(excludedSummary([
    { key: 'a', name: 'a', reason: 'sheet_body', detail: '' },
    { key: 'b', name: 'b', reason: 'future-reason', detail: '' },
    { key: 'c', name: 'c', reason: 'sheet_body', detail: '' },
  ]), [
    { reason: 'sheet_body', label: '片体', count: 2 },
    { reason: 'other', label: '其他原因', count: 1 },
  ])
  const clamped = clampDetail('😀'.repeat(201))
  assert.equal([...clamped].length, 201)
  assert.equal(clamped.endsWith('…'), true)
  console.log('ok - blanked/stableKey/revision, reason grouping and Unicode detail clamp')
  console.log('GP-2 read-contract selfcheck complete; production default remains gp-1 and no NX was contacted.')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
