// M1-04 offline gate: mirror integrity, converter + writer, loader/pick/camera,
// reproducible client bundle, adapter registration and Python/JS/TS differential replay.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { convertDxfText } from '../service-draft-converter/lib/convert.js'

const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const CAM_AGENT = path.resolve(process.env.CAM_AGENT_REPO ?? fileURLToPath(new URL('../../CAM-Agent', import.meta.url)))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mirror-manifest.json'), 'utf8'))
for (const file of manifest.files) {
  const bytes = fs.readFileSync(path.join(root, 'src/draft', file.path))
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, `镜像哈希不符：${file.path}`)
}
for (const file of manifest.files.filter(item => item.status === 'identical')) {
  const source = spawnSync('git', ['-C', DESKTOP, 'show', `${manifest.sourceCommit}:${manifest.sourceRoot}/${file.path}`], { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(source.status, 0, `无法读取上游 ${manifest.sourceCommit}:${file.path}: ${source.stderr}`)
  assert.equal(crypto.createHash('sha256').update(source.stdout).digest('hex'), file.sha256, `上游 ${manifest.sourceCommit} 哈希不符：${file.path}`)
}
console.log(`ok - mirror manifest ${manifest.files.length} files；identical 文件与 ${manifest.sourceCommit} 逐字一致`)

const { outputFiles: coreOutput } = await build({
  stdin: {
    resolveDir: path.join(root, 'src'),
    contents: "export { loadDraft } from './draft/draft_loader.ts'; export { checkDraftPack } from './draft/packcheck.ts'; export { fitView, worldToScreen, screenToWorld } from './draft/draft_camera.ts'; export { buildSegGrid } from './draft/draft_pick.ts'",
  },
  bundle: true, write: false, platform: 'node', format: 'esm',
})
const core = await import(`data:text/javascript;base64,${Buffer.from(coreOutput[0].text).toString('base64')}`)
const fixtureText = fs.readFileSync(path.join(DESKTOP, 'tests/fixtures/draft/draft_good.json'), 'utf8')
const pack = core.loadDraft(JSON.parse(fixtureText))
assert.deepEqual(core.checkDraftPack(JSON.parse(fixtureText), 'writer').errors, [])
assert.equal(pack.units, 'mm')
assert.equal(pack.sourceUnits, 'mm')
assert.equal(pack.unitFactor, 1)
assert.deepEqual(pack.originOffset, [2478.271, -1297.387])
assert.equal(pack.layers.get('0')?.plot, true)
assert.equal(pack.layers.get('NOTES')?.plot, false)
assert.equal(pack.titleBlock?.found, false)
assert.ok(Array.isArray(pack.techRequirements) && pack.techRequirements.length > 0)
assert.equal(pack.views[0]?.id, 1)
assert.equal(pack.views[0]?.name, '主视图')
const weighted = JSON.parse(fixtureText)
weighted.layers['0'].lineweight = { value: 35 }
assert.equal(core.loadDraft(weighted).segments.find(s => s.entId === 0).lineWidthMm, 0.35)
weighted.entities[0].lineweight = { value: 50 }
assert.equal(core.loadDraft(weighted).segments.find(s => s.entId === 0).lineWidthMm, 0.5)
weighted.entities[0].lineweight = { value: -1 }
assert.equal(core.loadDraft(weighted).segments.find(s => s.entId === 0).lineWidthMm, 0.35)
weighted.layers['0'].lineweight = { value: -3 }
assert.equal(core.loadDraft(weighted).segments.find(s => s.entId === 0).lineWidthMm, undefined)
const view = (id, bbox = [0, 0, 0, 0]) => ({ id, bbox })
const titleBase = { attributes: [], found: false, inferred: false, rule_version: 'sem-rules-0/title' }
const techBase = { text: '去毛刺', source_handle: '2A/1', inferred: false, rule_version: 'sem-rules-0/tech' }
for (const profile of ['writer', 'reader']) {
  for (const [key, value, expected] of [
    ['origin_offset', [0], 'origin_offset'],
    ['title_block', [], 'title_block 应为对象'],
    ['title_block', { ...titleBase, attributes: [null] }, 'title_block.attributes 元素'],
    ['title_block', { attributes: [], found: false, rule_version: 'x' }, 'title_block.inferred'],
    ['title_block', { attributes: [], found: false, inferred: false }, 'title_block.rule_version'],
    ['views', {}, 'views 应为数组'],
    ['views', [null], 'views 元素应为对象'],
    ['views', [view(0)], 'views 元素 id 应为正整数'],
    ['views', [view(-1)], 'views 元素 id 应为正整数'],
    ['views', [view(null)], 'views 元素 id 应为正整数'],
    ['views', [view('')], 'views 元素 id 应为正整数'],
    ['views', [view('1')], 'views 元素 id 应为正整数'],
    ['views', [view(false)], 'views 元素 id 应为正整数'],
    ['views', [view(1), view(1)], 'views 元素 id 应唯一'],
    ['views', [view(1, ['x', 0, 0, 0])], 'views 元素 bbox'],
    ['views', [view(1, [0, 0])], 'views 元素 bbox'],
    ['views', [view(1, {})], 'views 元素 bbox'],
    ['views', [view(1, null)], 'views 元素 bbox'],
    ['views', [{ id: 1 }], 'views 元素 bbox'],
    ['tech_requirements', [null], 'tech_requirements 元素应为对象'],
    ['tech_requirements', [{ ...techBase, text: {} }], 'tech_requirements.text/source_handle'],
    ['tech_requirements', [{ ...techBase, source_handle: {} }], 'tech_requirements.text/source_handle'],
    ['tech_requirements', [{ text: 'x', source_handle: 'h', rule_version: 'r' }], 'tech_requirements.inferred'],
    ['tech_requirements', [{ text: 'x', source_handle: 'h', inferred: false }], 'tech_requirements.rule_version'],
    ['dims', {}, 'dims 应为数组'],
  ]) {
    const bad = JSON.parse(fixtureText)
    bad[key] = value
    const errors = core.checkDraftPack(bad, profile).errors
    assert.ok(errors.some(error => error.includes(expected)), `${profile} ${key}: ${errors.join(';')}`)
  }
  for (const key of ['origin_offset', 'views', 'tech_requirements', 'title_block']) {
    const bad = JSON.parse(fixtureText)
    delete bad[key]
    const errors = core.checkDraftPack(bad, profile).errors
    assert.ok(errors.includes(`DRAFT_E_SCHEMA:${key}`), `${profile} missing ${key}: ${errors.join(';')}`)
    assert.throws(() => core.loadDraft(bad), /DRAFT_E/)
  }
  const badTitle = JSON.parse(fixtureText)
  badTitle.title_block = { ...titleBase, attributes: [null] }
  assert.throws(() => core.loadDraft(badTitle), /DRAFT_E/)
}
console.log('ok - semantic loader + writer/reader malformed guards')
const camera = core.fitView(pack.bbox, 800, 600)
const segment = pack.segments.find(s => s.entId === 0)
const wx = (segment.x1 + segment.x2) / 2, wy = (segment.y1 + segment.y2) / 2
const [sx, sy] = core.worldToScreen(camera, 800, 600, wx, wy)
const [rx, ry] = core.screenToWorld(camera, 800, 600, sx, sy)
assert.ok(Math.abs(rx - wx) < 1e-9 && Math.abs(ry - wy) < 1e-9)
const grid = core.buildSegGrid(pack.segments)
assert.ok(grid.pick(wx, wy, 1e-3) >= 0)
console.log('ok - writer + loader/pick/camera pure functions')

const HEADER = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n9\n$LTSCALE\n40\n1.0\n0\nENDSEC\n`
const TABLES = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nContinuous\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0\n41\n1.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n`
const line = `0\nLINE\n5\n100\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n0.0\n31\n0.0\n`
const dxf = `${HEADER}${TABLES}0\nSECTION\n2\nENTITIES\n${line}0\nENDSEC\n0\nEOF\n`
const converted = convertDxfText(dxf, { sourceName: 'selfcheck.dxf', sourceBytes: Buffer.from(dxf) })
assert.deepEqual(core.checkDraftPack(converted, 'writer').errors, [])
assert.equal(core.loadDraft(converted).entityCount > 0, true)
console.log('ok - converter synthetic pack -> writer + loader')

const { outputFiles } = await build({
  entryPoints: [path.join(root, 'src/client.ts')], bundle: true, write: false,
  absWorkingDir: path.dirname(root),
  platform: 'browser', format: 'cjs', external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  banner: { js: "// Generated from ui-drawing-viewer/src; run node ui-drawing-viewer/build.mjs.\nwindow.__ModuleLoader__.load({ id: 'camind-ui-drawing-viewer', factory: (require) => { var module = { exports: {} }; var exports = module.exports;" },
  footer: { js: 'return module.exports; } });' },
})
assert.equal(outputFiles[0].text, fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8'), 'client bundle 不是最新构建产物')
console.log('ok - client bundle reproducible')

for (const [name, command, args] of [
  ['adapter', process.execPath, [path.join(root, 'selfcheck-adapter.mjs')]],
  ['client', process.execPath, [path.join(root, 'selfcheck-client.mjs')]],
  ['three-way', process.execPath, [path.join(root, '../service-draft-converter/selfcheck-three-way.mjs')]],
]) {
  const run = spawnSync(command, args, { cwd: path.join(root, '..'), env: { ...process.env, DESKTOP_REPO: DESKTOP, CAM_AGENT_REPO: CAM_AGENT }, stdio: 'inherit' })
  assert.equal(run.status, 0, `${name} 失败`)
}
console.log('M1-04 offline selfcheck complete; I1–I9 checks do not mean the drawing is reviewed or dimensionally correct.')
