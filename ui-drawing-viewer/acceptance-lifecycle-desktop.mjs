// M3-04 live dsh-app:// lifecycle smoke on the real React/WebGL desktop shell.
// Deterministic races and every edge case remain covered by acceptance-lifecycle.mjs offline.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const root = fileURLToPath(new URL('./', import.meta.url))
const desktop = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const goodText = fs.readFileSync(path.join(desktop, 'tests/fixtures/draft/draft_good.json'), 'utf8')
const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { DrawingPreview, apply } from './src/client.ts';
      apply({ effect: fn => fn(), slots: { inject() {} } });
      document.querySelectorAll('#viewer').forEach(el => el.remove());
      const viewer = document.createElement('div');
      viewer.id = 'viewer';
      viewer.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;z-index:99999;background:#1e2023';
      document.body.appendChild(viewer);
      let root = createRoot(viewer);
      const refs = [], goodText = ${JSON.stringify(goodText)};
      const Adapter = ({ controller }) => {
        React.useEffect(() => { controller?.setViewportInsets({ top: 0, right: 0, bottom: 0, left: 0 }) }, [controller]);
        return null;
      };
      const render = (name, packText = goodText) => {
        const descriptor = { name, packText, session: 'm3-live',
          source: { uri: 'upload://m3/live.dwg', sha256: '${'1'.repeat(64)}', name: 'live.dwg' },
          pack: { sha256: '${'2'.repeat(64)}', identity: '${'3'.repeat(64)}' } };
        root.render(React.createElement(DrawingPreview, { descriptor, onReference: ref => refs.push(ref), adapter: Adapter }));
      };
      const mount = name => { root = createRoot(viewer); render(name) };
      const unmount = () => root.unmount();
      window.__m3 = { render, mount, unmount, refs };
      render('a.dwg');
    `,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  alias: { react: path.join(root, '../ui-shell/node_modules/react'), 'react-dom': path.join(root, '../ui-shell/node_modules/react-dom') },
})
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
const pageErrors = []
let cdp
try {
  const page = browser.contexts()[0].pages().find(item => item.url().startsWith('dsh-app:'))
  assert(page, 'A real dsh-app:// desktop page is required')
  page.on('pageerror', error => pageErrors.push(error.message))
  cdp = await page.context().newCDPSession(page)
  await page.evaluate(outputFiles[0].text)
  const meta = page.locator('#viewer .cdv-meta')
  const canvas = page.locator('#viewer .cdv-canvas')
  await meta.filter({ hasText: 'a.dwg' }).waitFor()
  assert.match(await meta.innerText(), /16 实体 · 2 尺寸/)
  assert.equal(await page.evaluate(() => Boolean(window.__DSH_BOOT__?.entries?.some(entry => entry.id === 'camind-ui-drawing-viewer'))), true)

  await page.evaluate(() => window.__m3.render('b.dwg'))
  await meta.filter({ hasText: 'b.dwg' }).waitFor()
  assert(!((await meta.innerText()).includes('a.dwg')))
  await page.evaluate(() => window.__m3.render('broken.dwg', '{'))
  await page.locator('#viewer .cdv-error').waitFor()
  assert.equal(await canvas.getAttribute('data-camera'), null, 'A failed B load must clear the old camera')
  assert(!((await meta.innerText()).includes('16 实体')), 'A failed B load must not retain A metadata')
  assert(!((await meta.innerText()).includes('a.dwg')))

  await page.evaluate(() => window.__m3.unmount())
  assert.equal(await page.locator('#viewer > *').count(), 0)
  await page.evaluate(() => window.__m3.mount('a.dwg'))
  await canvas.waitFor()
  assert.match(await meta.innerText(), /a.dwg/)
  await page.evaluate(() => { const el = document.querySelector('#viewer'); el.style.width = '0px'; el.style.height = '0px'; window.__m3.render('a.dwg') })
  await page.waitForTimeout(100)
  await page.evaluate(() => { const el = document.querySelector('#viewer'); el.style.width = '800px'; el.style.height = '600px' })
  await page.waitForFunction(() => {
    const host = document.querySelector('#viewer .cdv-canvas'), gl = host?.querySelector('canvas')
    return Boolean(host?.dataset.camera && gl && gl.width > 100 && host.getBoundingClientRect().width > 100)
  })

  const nativeDpr = await page.evaluate(() => devicePixelRatio), baselineDpr = nativeDpr === 1 ? 2 : 1
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: baselineDpr, mobile: false })
  await page.waitForFunction(expected => {
    const host = document.querySelector('#viewer .cdv-canvas'), gl = host?.querySelector('canvas')
    return gl && Math.abs(gl.width - host.getBoundingClientRect().width * expected) <= 1
  }, baselineDpr)
  const beforeDpr = await canvas.evaluate(el => ({ camera: el.dataset.camera, width: el.querySelector('canvas').width }))
  const expectedWidth = Math.round(beforeDpr.width * nativeDpr / baselineDpr)
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  await page.waitForFunction(expected => {
    const gl = document.querySelector('#viewer .cdv-canvas canvas')
    return gl && Math.abs(gl.width - expected) <= 1
  }, expectedWidth)
  assert.notEqual(expectedWidth, beforeDpr.width, 'DPR acceptance must change the backing store')
  assert.equal(await canvas.getAttribute('data-camera'), beforeDpr.camera, 'DPR changes must preserve the camera')

  const point = await canvas.evaluate(host => {
    const state = JSON.parse(host.dataset.camera), insets = JSON.parse(host.dataset.insets)
    const rect = host.getBoundingClientRect(), gl = host.querySelector('canvas'), dpr = gl.width / rect.width
    const width = gl.width - insets.left - insets.right, height = gl.height - insets.top - insets.bottom
    const scale = height / (state.halfH * 2)
    return { x: rect.left + ((210 - state.cx) * scale + width / 2 + insets.left) / dpr,
      y: rect.top + (state.cy * scale + height / 2 + insets.top) / dpr }
  })
  const refCount = await page.evaluate(() => window.__m3.refs.length)
  await canvas.evaluate((host, point) => {
    const gl = host.querySelector('canvas')
    gl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: point.x, clientY: point.y, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
    gl.dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, clientX: point.x, clientY: point.y, bubbles: true }))
  }, point)
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.__m3.refs.length), refCount, 'pointercancel followed by click must not pick')
  await canvas.evaluate((host, point) => host.querySelector('canvas').dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, clientX: point.x, clientY: point.y, bubbles: true })), point)
  await page.waitForFunction(count => window.__m3.refs.length > count, refCount)

  const beforeLost = await canvas.getAttribute('data-camera')
  await canvas.evaluate(host => {
    const gl = host.querySelector('canvas')
    gl.dispatchEvent(new WebGLContextEvent('webglcontextlost', { cancelable: true }))
    gl.dispatchEvent(new WebGLContextEvent('webglcontextrestored'))
  })
  await page.waitForTimeout(150)
  assert.equal(await canvas.locator('canvas').count(), 2)
  assert.equal(await canvas.getAttribute('data-camera'), beforeLost, 'Context recovery must preserve the camera')

  await page.evaluate(() => window.__m3.unmount())
  assert.equal(await page.locator('#viewer > *').count(), 0, 'Dispose must remove the mounted preview')
  assert.deepEqual(pageErrors, [])
  const report = { real_desktop: true, valid_ab_replacement: true, failed_b_clears_a: true, react_remount: true, zero_size_recovery: true, dpr_recovery: true, pointercancel: true, webgl_recovery: true, dispose: true, pageerrors: pageErrors, scope: 'Live smoke only; deterministic A/B races and full lifecycle assertions run in acceptance-lifecycle.mjs.' }
  const dir = path.resolve('.dsh/workbench-acceptance')
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, 'drawing-lifecycle-desktop-report.json'), JSON.stringify(report, null, 2))
  console.log(`drawing lifecycle desktop acceptance: PASS (${JSON.stringify(report)})`)
} finally {
  if (cdp) await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  await browser.close()
}
