// Real desktop UI with two controlled display-response fixtures: missing image and compatibility fallback.
// Only preview responses in this renderer are substituted; no task writes, uploads, model or NX calls.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
try {
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('dsh-app:'))
  assert(page)
  const sid = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const task = () => page.evaluate(async sid => (await (await fetch(`/camind/api/cam/tasks/${sid}`)).json()).data, sid)
  const before = await task(); assert(before.inputs.dwg)
  const oldTab = (await page.getByRole('tab', { selected: true }).first().innerText()).trim()
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  const wasModel = await page.getByRole('button', { name: '3D 模型', exact: true }).getAttribute('aria-pressed') === 'true'
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const remount = async () => {
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    await page.getByRole('tab', { name: '工作台', exact: true }).click()
    await page.getByRole('button', { name: 'CAD 图纸', exact: true }).click()
    await page.locator('.wb-drawing-svg > svg').waitFor({ timeout: 90000 })
  }
  try {
    for (const status of ['partial', 'fallback']) {
      await page.evaluate(({ status, sid }) => {
        window.__drawingStatusTestFetch ??= window.fetch
        const nativeFetch = window.__drawingStatusTestFetch
        window.fetch = async (...args) => {
          const response = await nativeFetch(...args)
          const url = typeof args[0] === 'string' ? args[0] : args[0].url
          if (!url?.endsWith(`/camind/api/cam/tasks/${sid}/drawing`)) return response
          const body = await response.json()
          body.data.preview_partial = true
          body.data.preview_info = { status, messages: [status === 'partial' ? '2 个图片对象未能显示，请打开原图核对。' : '部分图纸内容可能未显示，请打开原图核对。'], omissions: [], diagnostics: 'synthetic-preview-diagnostic' }
          return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } })
        }
      }, { status, sid })
      await remount()
      const label = status === 'partial' ? '预览有缺失' : '已使用兼容预览'
      const summary = page.locator('.wb-main-head .wb-preview-status > summary')
      await summary.waitFor()
      assert((await summary.innerText()).includes(label))
      assert.equal(await page.locator('.wb-drawing-stage .wb-preview-status, .wb-drawing-warning').count(), 0)
      await summary.click()
      const popover = page.locator('.wb-preview-popover')
      assert(!(await popover.innerText()).includes('synthetic-preview-diagnostic'))
      await page.waitForFunction(() => Boolean(document.querySelector('.wb-preview-popover')?.style.left), null, { timeout: 5000 })
      const placement = await popover.evaluate(el => { const b = el.getBoundingClientRect(), main = el.closest('.wb-main').getBoundingClientRect(); return { left: b.left, right: b.right, mainLeft: main.left, mainRight: main.right, style: el.getAttribute('style') } })
      assert(placement.left >= placement.mainLeft && placement.right <= placement.mainRight, `Status popover stays inside the workbench: ${JSON.stringify(placement)}; errors: ${errors.join(';')}`)
      await popover.getByRole('button', { name: '查看转换详情', exact: true }).click()
      const details = page.locator('.wb-conversion-details')
      assert.equal(await details.evaluate(el => el.open), true)
      const diagnostics = details.getByRole('textbox', { name: '转换诊断信息，可复制' })
      assert.equal(await diagnostics.isVisible(), false)
      await details.getByText('诊断信息', { exact: true }).click()
      assert.equal(await diagnostics.inputValue(), 'synthetic-preview-diagnostic')
      await diagnostics.press('Escape')
      if (await page.getByRole('button', { name: '3D 模型', exact: true }).isEnabled()) {
        await page.getByRole('button', { name: '3D 模型', exact: true }).click()
        assert.equal(await page.locator('.wb-preview-status').count(), 0, 'Drawing status does not leak into the model title')
        await page.getByRole('button', { name: 'CAD 图纸', exact: true }).click()
        await page.locator('.wb-preview-status').waitFor()
      }
    }
    assert.deepEqual(await task(), before)
    assert.deepEqual(errors, [])
    const dir = path.resolve('.dsh/workbench-acceptance'); await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'drawing-status-report.json'), JSON.stringify({ real_desktop: true, controlled_preview_responses: ['partial', 'fallback'], title_status: true, diagnostics_folded: true, task_unchanged: true, pageerrors: errors }, null, 2))
    console.log('drawing status desktop acceptance: PASS (controlled display fixtures, task unchanged)')
  } finally {
    await page.evaluate(() => { if (window.__drawingStatusTestFetch) window.fetch = window.__drawingStatusTestFetch; delete window.__drawingStatusTestFetch })
    await remount()
    if (wasModel && await page.getByRole('button', { name: '3D 模型', exact: true }).isEnabled()) await page.getByRole('button', { name: '3D 模型', exact: true }).click()
    if (oldTab !== '工作台') await page.getByRole('tab', { name: oldTab, exact: true }).click()
  }
} finally { await browser.close() }
