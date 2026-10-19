// Real React/WebGL UI smoke for the X-ray layer control and short-viewport menu; semantic reveal evidence lives in the Node/GPU checks. No NX calls.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'

const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const root = fileURLToPath(new URL('./', import.meta.url))
const fixture = path.join(root, 'fixtures/box')
const expectedFixtureHashes = {
  'manifest.json': '7bc033b14ead0e4fe303a61d9b77f5ce49bafa1a71064d6886bb41735641ed3c',
  'faces.json': '61c0569829b568132423ff536ad5e3380faaf468460e918e236f392c72194df1',
  'mesh_coarse.bin': '56398735bb1fb4aa2bcbc58aa84770a43e6ffde4980113987199cc341faf2830',
  'mesh_fine.bin': 'f8a36496f2f4c0e44a27b70fc49df114072a62e102f6143c129efecf9b0a86cf',
  'edges.bin': '6b1861f6aa3d0e69946e7706f1d605575f4088254077a179a00f2f31a3d1d07a',
}
const actualFixtureHashes = {}
for (const name of Object.keys(expectedFixtureHashes))
  actualFixtureHashes[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(fixture, name))).digest('hex')
assert.deepEqual(actualFixtureHashes, expectedFixtureHashes)
const manifestBytes = await fs.readFile(path.join(fixture, 'manifest.json'))
const manifest = JSON.parse(manifestBytes.toString('utf8'))
manifest.bodies[0].blanked = true
const state = {
  state: 'ready', sha: manifest.part_sha256,
  geometry_sha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  manifest, faces: JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(fixture, 'faces.json'))).toString('utf8')),
  triangles: 12, vertices: 24, edges: 12,
}
const entries = {}
for (const name of ['mesh_fine.bin', 'edges.bin'])
  entries[name] = (await fs.readFile(path.join(fixture, name))).toString('base64')

const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ModelViewer,apply} from './src/client.ts'; apply({effect:fn=>fn(),slots:{inject(){}}}); createRoot(document.getElementById('viewer')).render(React.createElement(ModelViewer,{sessionId:'xray-ui',path:'fixture.prt'}));`,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  alias: { react: `${root}../ui-shell/node_modules/react`, 'react-dom': `${root}../ui-shell/node_modules/react-dom`, '@camind/core': `${root}src/core/index.ts` },
  plugins: [{ name: 'native-controls', setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'controls', namespace: 'test-controls' }))
    b.onLoad({ filter: /.*/, namespace: 'test-controls' }, () => ({ contents: `import React from 'react'; export const Button=({variant,...props})=>React.createElement('button',props); export const Input=props=>React.createElement('input',props);`, resolveDir: root }))
  } }],
})

const browser = await chromium.launch({
  ...(process.env.CAMIND_CHROMIUM_PATH ? { executablePath: process.env.CAMIND_CHROMIUM_PATH } : {}),
  args: ['--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://fixture.local/', route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<div id="viewer" class="campv-embedded" style="width:800px;height:600px;display:flex"></div>',
  }))
  await page.goto('https://fixture.local/')
  const uiRenderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const debug = gl?.getExtension('WEBGL_debug_renderer_info') ?? null
    return { debugAvailable: debug !== null, renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl?.getParameter(gl.RENDERER)) }
  })
  console.log(`UI Chromium renderer: ${uiRenderer.renderer} (debug=${uiRenderer.debugAvailable}; UI smoke only, backend not asserted)`)
  await page.evaluate(({ state, entries }) => {
    const bytes = name => Uint8Array.from(atob(entries[name]), c => c.charCodeAt(0))
    window.fetch = async input => {
      const url = new URL(String(input), 'https://fixture.local')
      if (url.pathname.endsWith('/runs')) return new Response(JSON.stringify({ runs: [] }), { status: 200 })
      if (url.pathname.endsWith('/model')) return new Response(JSON.stringify(state), { status: 200 })
      for (const name of Object.keys(entries)) {
        if (url.pathname.endsWith(`/model/${name}`)) return new Response(bytes(name), { status: 200 })
      }
      return new Response(JSON.stringify({ message: `unexpected fixture URL: ${url.pathname}` }), { status: 404 })
    }
  }, { state, entries })
  await page.addScriptTag({ content: outputFiles[0].text })
  const show = page.getByRole('button', { name: '显示', exact: true })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent === '显示')
    return button && (!button.disabled || document.querySelector('[role=alert]'))
  })
  assert.equal(await show.isEnabled(), true, `model viewer did not become ready: ${await page.locator('#viewer').innerText()}; ${JSON.stringify(errors)}`)

  async function stableCanvasScreenshot() {
    let previous = null
    for (let attempt = 0; attempt < 10; ++attempt) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const shot = await page.locator('canvas').screenshot()
      if (previous?.equals(shot)) return shot
      previous = shot
      await page.waitForTimeout(25)
    }
    throw new Error('canvas did not stabilize after the X-ray state change')
  }

  async function captureWithXray(checked) {
    await show.click()
    const toggle = page.getByLabel('隐藏体透视（X-ray）', { exact: true })
    await toggle.setChecked(checked)
    assert.equal(await toggle.isChecked(), checked)
    if (checked) assert.match(await page.locator('.cmv-layer-note').innerText(), /不是平滑混合.*边线不跟随.*同相位叠层仍会遮挡.*严格隔离请关闭 X-ray.*拾取按完整隐藏体.*不受抖动孔影响.*点击可能命中前层隐藏体/)
    await page.getByRole('button', { name: '关闭显示设置', exact: true }).click()
    return stableCanvasScreenshot()
  }

  const hidden = await captureWithXray(false)
  const xray = await captureWithXray(true)
  const hiddenAgain = await captureWithXray(false)
  assert.equal(xray.equals(hidden), false, 'X-ray must reveal the initially blanked synthetic body')
  assert.equal(hiddenAgain.equals(hidden), true, 'turning X-ray off must restore the hidden frame')

  await page.locator('#viewer').evaluate(el => { el.style.width = '300px'; el.style.height = '180px' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await show.click()
  const menuLayout = await page.locator('.cmv-layers').evaluate(el => {
    const menu = el.getBoundingClientRect(), stage = el.parentElement.getBoundingClientRect()
    return { top: menu.top, right: menu.right, bottom: menu.bottom, stageTop: stage.top, stageRight: stage.right, stageBottom: stage.bottom,
      stageClass: el.parentElement.className, viewportWidth: innerWidth, viewportHeight: innerHeight,
      clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }
  })
  assert.match(menuLayout.stageClass, /\bcmv-stage\b/)
  assert.ok(menuLayout.top >= menuLayout.stageTop - 1 && menuLayout.bottom <= menuLayout.stageBottom + 1,
    `display menu must stay inside the short stage: ${JSON.stringify(menuLayout)}`)
  assert.ok(menuLayout.right <= menuLayout.stageRight + 1,
    `display menu must stay inside the narrow stage: ${JSON.stringify(menuLayout)}`)
  assert.ok(menuLayout.bottom <= menuLayout.viewportHeight && menuLayout.right <= menuLayout.viewportWidth,
    `display menu must stay inside the browser viewport: ${JSON.stringify(menuLayout)}`)
  assert.equal(menuLayout.overflowY, 'auto')
  assert.ok(menuLayout.scrollHeight > menuLayout.clientHeight, 'short stage must make the display menu scrollable')
  const close = page.getByRole('button', { name: '关闭显示设置', exact: true })
  await close.scrollIntoViewIfNeeded()
  await close.click()
  assert.equal(await page.locator('.cmv-layers').count(), 0)
  assert.deepEqual(errors, [])
  console.log('X-ray React/WebGL UI smoke passed: pinned fixture hashes verified; toggle changes/restores the canvas and the short-viewport menu scrolls; semantic reveal is checked separately; no NX calls.')
} finally { await browser.close() }
