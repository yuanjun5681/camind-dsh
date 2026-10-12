// Regression contract for joint provenance, file boundaries, station inversion and playback/layers.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { createJointService, createJointManifest, validateJoint, digest } from './lib/joint.js'
import { createModelService, validatePackage, FILES } from './lib/models.js'
const src = fileURLToPath(new URL('./src/', import.meta.url))
const compiled = await build({ stdin: { contents: "export * from './scene.ts'", resolveDir: src }, bundle: true, write: false, platform: 'browser', format: 'cjs' })
const module = { exports: {} }; runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports })
const { makeProgram, atTime, buildScene, programBounds } = module.exports
const frame = { name: 'G54', part_to_nc: { r: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], t: [10, 20, 30] } }
const program = 'G21 G90 G54\nG0 X10 Y20 Z30\nG1 X11 Y20 Z30 F60\nG1 X11 Y21 Z30\n'
const op = { id: '0', name: 'first', file: 'first.nc', station: 'G54', content: program }
const a = makeProgram(op, frame), b = makeProgram({ ...op, id: '1', name: 'second', file: 'second.nc' }, frame)
const scene = buildScene([a, b], ['0', '1'], '0', true, true)
assert.equal(scene.activeStart, b.parsed.segments.length)
assert.deepEqual(Array.from(scene.geometry.positions.slice(scene.activeStart * 6 + 3, scene.activeStart * 6 + 6)), [0, 0, 0])
assert.equal(scene.ranges[0].id, '1')
assert.equal(scene.geometry.colors[scene.activeStart * 8], 242)
assert.notEqual(scene.geometry.colors[0], 242, 'Reference operation is dimmed')
assert.equal(buildScene([a], [], '0', true, true).geometry.lines.length, 0)
assert.equal(buildScene([a], ['0'], '0', false, true).geometry.lines.length, 2)
assert.equal(buildScene([a], ['0'], '0', true, false).geometry.lines.length, 1)
assert.equal(atTime(a, a.times[1] + 0.5).fraction, 0.5)
assert.equal(atTime(a, a.duration).fraction, 1)
assert.ok(programBounds(a).min.x <= programBounds(a).max.x)
assert.equal(makeProgram({ ...op, content: 'G1 X1 F60' }).parsed.segments[0].from[0], 0, 'Separate file must reset modal state')
const secondFrame = { name: 'G55', part_to_nc: { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [2, 3, 4] } }
const c = makeProgram({ ...op, id: '2', station: 'G55', content: 'G21 G90 G55\nG0 X2 Y3 Z4\nG1 X3 Y3 Z4 F60' }, secondFrame)
const mixed = buildScene([a, c], ['0', '2'], '0', true, true)
assert.deepEqual(Array.from(mixed.geometry.positions.slice(3, 6)), [0, 0, 0], 'Each operation uses its own station, not the first station')
assert.deepEqual(Array.from(mixed.geometry.positions.slice(9, 12)), [1, 0, 0])
for (const content of ['G20 G1 X1', 'G53 G0 X1', 'G55 G1 X1', 'G68 X0 Y0 R30', 'G68.2 X0 Y0', 'G51.1 X0', 'G10 L2 X0', 'G16 X1', 'G18 G2 X1 Z1 I1', 'G95 G1 X1 F1', 'G777 X1', 'G1 X1 A30', 'G1 X#1']) assert.throws(() => makeProgram({ ...op, content }, frame), /不能联合|三轴/)
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'joint-check-'))
try {
  const prt = path.join(tmp, 'source.prt'); await fs.writeFile(prt, 'joint fixture')
  const sha = digest(await fs.readFile(prt)), cache = path.join(tmp, 'model-previews/session', sha)
  await fs.cp(new URL('./fixtures/box/', import.meta.url), cache, { recursive: true })
  const raw = JSON.parse(await fs.readFile(path.join(cache, 'manifest.json'))); raw.part_sha256 = sha
  const manifestBytes = Buffer.from(JSON.stringify(raw)); await fs.writeFile(path.join(cache, 'manifest.json'), manifestBytes)
  await validatePackage(cache, sha)
  const programs = { 'first.nc': Buffer.from(program) }
  const result = { stations: [frame], operations: [{ name: op.name, nc_file: op.file, fid: 'F000001' }] }
  const doc = createJointManifest({ modelPath: 'source.prt', sourceSha: sha, manifestBytes, result, programs })
  assert.throws(() => createJointManifest({ modelPath: 'source.prt', sourceSha: sha, manifestBytes, result: { ...result, _diag: { mcs_orientation_err: 'unreadable' } }, programs }), /回读/)
  assert.throws(() => validateJoint({ ...doc, units: 'inch' }), /单位/)
  assert.throws(() => createJointManifest({ modelPath: 'source.prt', sourceSha: sha, manifestBytes, result: { ...result, stations: [frame, secondFrame] }, programs }), /工位关联/)
  assert.equal(createJointManifest({ modelPath: 'source.prt', sourceSha: sha, manifestBytes, result: { ...result, stations: [frame, secondFrame], operations: [{ ...result.operations[0], station: 'G55' }] }, programs }).operations[0].station, 'G55')
  assert.throws(() => validateJoint({ ...doc, stations: [{ name: 'G54', part_to_nc: { r: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] } }] }), /右手/)
  const dir = path.join(tmp, 'cam-runs/session/run1'); await fs.mkdir(path.join(dir, 'delivery'), { recursive: true })
  await fs.writeFile(path.join(dir, 'preview.json'), JSON.stringify(doc))
  const { zipSync } = createRequire(new URL('../ui-shell/package.json', import.meta.url))('fflate')
  await fs.writeFile(path.join(dir, 'delivery/nc_batch.zip'), zipSync(programs))
  const models = createModelService({ home: tmp, resolve: async (session, requested) => { assert.equal(session, 'session'); assert.equal(requested, 'source.prt'); return { file: prt } }, pipeline: {} })
  const joint = createJointService({ home: tmp, models })
  assert.equal((await joint.detail('session', 'run1')).operations[0].content, program)
  assert.equal((await joint.detail('session', 'old')).state, 'unavailable')
  await assert.rejects(joint.detail('session', '../run1'), /非法/)
  assert.equal((await joint.list('session', 'source.prt'))[0].run_id, 'run1')
  await fs.writeFile(path.join(dir, 'preview.json'), JSON.stringify({ ...doc, source_sha256: '0'.repeat(64) })); await assert.rejects(joint.detail('session', 'run1'), /源模型版本/)
  await fs.writeFile(path.join(dir, 'preview.json'), JSON.stringify({ ...doc, geometry_sha256: '0'.repeat(64) })); await assert.rejects(joint.detail('session', 'run1'), /几何版本/)
  await fs.writeFile(path.join(dir, 'preview.json'), JSON.stringify(doc)); await fs.writeFile(path.join(dir, 'delivery/nc_batch.zip'), zipSync({ 'first.nc': Buffer.from('changed') })); await assert.rejects(joint.detail('session', 'run1'), /NC 缺失或版本/)
  await fs.rename(path.join(dir, 'preview.json'), path.join(tmp, 'outside.json')); await fs.symlink(path.join(tmp, 'outside.json'), path.join(dir, 'preview.json')); await assert.rejects(joint.detail('session', 'run1'), /越界|符号链接/)
} finally { await fs.rm(tmp, { recursive: true, force: true }) }
console.log('joint selfcheck passed: independent files, inverse rotation/translation, timing/layers, source/geometry/NC identity, dirty-frame refusal, symlink boundary')
