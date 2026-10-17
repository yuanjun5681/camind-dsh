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
console.log(`ok - mirror manifest ${manifest.files.length} files`)

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
