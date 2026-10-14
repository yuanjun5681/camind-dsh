// Render the actual React/WebGL NC viewer and verify playback above an overlapping composer.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const root = fileURLToPath(new URL('./', import.meta.url))
const { outputFiles } = await build({
  stdin: { resolveDir: root, contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ToolpathViewer,apply} from './src/client.ts'; apply({effect:fn=>fn(),slots:{inject(){}}}); createRoot(document.getElementById('viewer')).render(React.createElement(ToolpathViewer,{fileName:'test.nc',content:'G21\\nG90 G17\\nG0 X0 Y0 Z10\\nG1 Z0 F60\\n'+Array.from({length:400},(_,i)=>'G1 X'+(i+1)+' Y'+(i%2)).join('\\n')+'\\nM30'}));` },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  alias: { react: `${root}../ui-shell/node_modules/react`, 'react-dom': `${root}../ui-shell/node_modules/react-dom`, '@camind/core': `${root}src/core/index.ts` },
  plugins: [{ name: 'native-controls', setup(b) {
    b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'controls', namespace: 'test-controls' }))
    b.onLoad({ filter: /.*/, namespace: 'test-controls' }, () => ({ contents: `import React from 'react'; export const Button=({variant,...props})=>React.createElement('button',props); export const Input=props=>React.createElement('input',props);`, resolveDir: root }))
  } }],
})
const browser = await chromium.launch({ ...(process.env.CAMIND_CHROMIUM_PATH ? { executablePath: process.env.CAMIND_CHROMIUM_PATH } : {}), args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  for (const width of [900, 605, 400]) {
    await page.setViewportSize({ width: 1100, height: 700 })
    await page.setContent(`<style>body{margin:0}#viewer{width:${width}px;height:650px;display:flex}#composer{position:fixed;bottom:70px;left:160px;width:220px;height:44px;background:white;z-index:3}</style><div id="viewer" class="campv-embedded"></div><div id="composer">输入框</div>`)
    await page.addScriptTag({ content: outputFiles[0].text })
    const play = page.getByRole('button', { name: '播放', exact: true })
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '播放')?.disabled)
    const bar = await page.locator('.cmv-playbar').boundingBox(), body = await page.locator('.cmv-body').boundingBox()
    assert.ok(bar.y + bar.height <= body.y + 1, `Playback precedes the canvas at ${width}px`)
    assert.equal(await page.getByRole('button', { name: '程序核对', exact: true }).isVisible(), false)
    assert.equal(await page.locator('.cmv-footer').count(), 0, 'NC has no bottom footer competing with the composer')
    await play.click()
    await page.waitForFunction(() => Number(document.querySelector('.cmv-playbar input').value) > 0 && Number(document.querySelector('.cmv-playbar input').value) < 100)
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    const stopped = await page.getByLabel('当前工序播放进度').inputValue()
    await page.waitForTimeout(100)
    assert.equal(await page.getByLabel('当前工序播放进度').inputValue(), stopped)
    await page.getByLabel('当前工序播放进度').focus()
    await page.keyboard.press('End')
    const canvasBefore = await page.locator('.cmv-stage').boundingBox()
    await page.locator('.cmv-inspect summary').click()
    await page.getByRole('button', { name: '程序核对', exact: true }).click()
    await page.locator('.cmv-source').waitFor()
    await page.getByRole('dialog', { name: 'NC 程序核对', exact: true }).waitFor()
    assert.deepEqual(await page.locator('.cmv-stage').boundingBox(), canvasBefore, 'Program inspection does not resize the scene')
    const sourceLines = page.locator('.cmv-source-lines')
    const followButton = page.getByRole('button', { name: '跟随刀位', exact: true })
    await page.waitForTimeout(50)
    // Follow can already be enabled when the user explicitly asks to locate again.
    await sourceLines.evaluate(el => { el.scrollTop = 0 })
    await followButton.click()
    assert.equal(await followButton.getAttribute('aria-pressed'), 'true', 'One click always enables follow instead of toggling it off')
    await page.waitForFunction(() => document.querySelector('.cmv-source-lines').scrollTop > 100)
    assert.ok(await sourceLines.locator('[aria-current=true]').isVisible(), 'Current line is mounted after locating')
    await sourceLines.hover(); await page.mouse.wheel(0, -500)
    await page.waitForFunction(() => document.querySelector('.cmv-source-head button').getAttribute('aria-pressed') === 'false')
    await followButton.click()
    assert.equal(await followButton.getAttribute('aria-pressed'), 'true')
    await page.waitForFunction(() => {
      const el = document.querySelector('.cmv-source-lines'), row = el.querySelector('[aria-current=true]')
      if (!row) return false
      const viewport = el.getBoundingClientRect(), rect = row.getBoundingClientRect()
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom
    })

    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.locator('.cmv-inspect summary').click()
    await page.getByRole('button', { name: '预览信息', exact: true }).click()
    const info = page.getByRole('dialog', { name: '预览信息', exact: true })
    await info.waitFor()
    assert.match(await info.innerText(), /程序换刀号/)
    assert.equal(await info.locator('pre').count(), 0, 'Information uses readable fields instead of JSON')
    assert.deepEqual(await page.locator('.cmv-stage').boundingBox(), canvasBefore)
    await info.getByRole('button', { name: '关闭', exact: true }).click()
  }
  assert.deepEqual(errors, [])
  console.log('viewer playback selfcheck passed: actual NC/WebGL playback, pause, top controls, hidden inspection, inspection modals preserve scene bounds, one-click follow after manual browsing')
} finally { await browser.close() }
