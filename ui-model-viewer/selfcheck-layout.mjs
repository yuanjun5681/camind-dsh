// Real browser CSS regression: embedded NC source drawers must leave a visible GL stage.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const source = await fs.readFile(new URL('./src/styles.ts', import.meta.url), 'utf8')
const css = source.slice(source.indexOf('`') + 1, source.lastIndexOf('`'))
const browser = await chromium.launch(process.env.CAMIND_CHROMIUM_PATH ? { executablePath: process.env.CAMIND_CHROMIUM_PATH } : {})
try {
  const page = await browser.newPage()
  for (const width of [605, 900]) for (const withOps of [false, true]) {
    await page.setContent(`<style>${css}</style><div class="campv-embedded" style="width:${width}px;height:600px;display:flex"><div class="cmv"><div class="cmv-tools">NC</div><div class="cmv-body">${withOps ? '<aside class="cmv-ops">工序</aside>' : ''}<div class="cmv-stage"><canvas></canvas></div><aside class="cmv-source"><div class="cmv-source-head">NC源码</div><div class="cmv-source-lines">G01 X1</div></aside></div><div class="cmv-footer">NC预览</div></div></div>`)
    const layout = await page.evaluate(() => {
      const stage = document.querySelector('.cmv-stage').getBoundingClientRect()
      const drawer = document.querySelector('.cmv-source').getBoundingClientRect()
      return { stage: { width: stage.width, height: stage.height, bottom: stage.bottom }, drawer: { top: drawer.top } }
    })
    assert.ok(layout.stage.width >= 200 && layout.stage.height >= 120, `Visible canvas at ${width}px, operations=${withOps}: ${JSON.stringify(layout)}`)
    if (width <= 736) assert.ok(layout.drawer.top >= layout.stage.bottom - 1, 'Narrow source drawer belongs below the canvas')
  }
  console.log('viewer layout selfcheck passed: narrow/wide source drawers preserve the embedded canvas')
} finally { await browser.close() }
