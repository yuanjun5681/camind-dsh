// Real desktop UI with controlled DraftPreview descriptor fixtures: missing content and skipped types.
// Only descriptor responses are substituted; no task writes, uploads, model or NX calls.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { openTaskDrawing } from './acceptance-drawing-helpers.mjs'
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
    return openTaskDrawing(page)
  }
  try {
    for (const status of ['partial', 'fallback']) {
      await page.evaluate(({ status, sid }) => {
        window.__drawingStatusTestFetch ??= window.fetch
        const nativeFetch = window.__drawingStatusTestFetch, message = status === 'partial' ? '2 个图片对象未能显示，请打开原图核对。' : '部分图纸内容可能未显示，请打开原图核对。'
        window.fetch = async (...args) => {
          const response = await nativeFetch(...args)
          const url = typeof args[0] === 'string' ? args[0] : args[0].url
          if (!url?.includes(`/camind/api/drawings/sessions/${sid}/packs/`) || !url.includes('?path=')) return response
          const body = await response.json()
          body.missing = [...(body.missing ?? []), message]
          if (status === 'fallback') {
            const pack = JSON.parse(body.packText), template = pack.entities.find(entity => entity.type === 'line') ?? pack.entities[0]
            const nextId = Math.max(...pack.entities.map(entity => Number.isInteger(entity.id) ? entity.id : -1)) + 1
            const future = { ...template, id: nextId, type: 'future_entity' }
            delete future.dim_id
            if (future.color) future.color = { aci: 5, raw: 5 }
            pack.entities.push(future)
            pack.self_check.input_entities += 1
            pack.self_check.drawn_entities += 1
            pack.coverage.entities_by_type.future_entity = 1
            body.packText = JSON.stringify(pack)
            const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.packText))
            body.pack.sha256 = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
          }
          return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } })
        }
      }, { status, sid })
      await remount()
      const expected = status === 'partial' ? '2 个图片对象未能显示，请打开原图核对。' : '部分图纸内容可能未显示，请打开原图核对。'
      const missing = page.locator('.wb-preview-stage:not([hidden]) .cdv-missing')
      await missing.waitFor()
      assert((await missing.innerText()).includes(expected))
      assert.equal(await page.locator('.wb-preview-status, .wb-drawing-warning').count(), 0, 'Legacy warning chrome is not duplicated')
      const tools = page.locator('.wb-preview-stage:not([hidden]) .wb-drawing-tools')
      await tools.getByLabel('更多图纸选项', { exact: true }).click()
      const diagnostics = tools.getByRole('textbox', { name: '转换诊断信息，可复制' })
      assert((await diagnostics.inputValue()).includes(expected))
      if (status === 'fallback') {
        assert((await diagnostics.inputValue()).includes('future_entity'))
        assert((await page.locator('.wb-preview-stage:not([hidden]) .cdv-meta').innerText()).includes('跳过未知类型：future_entity'))
      }
      await diagnostics.press('Escape')
      if (await page.getByRole('button', { name: '3D 模型', exact: true }).isEnabled()) {
        await page.getByRole('button', { name: '3D 模型', exact: true }).click()
        assert.equal(await page.locator('.wb-preview-stage:not([hidden]) .cdv-missing').count(), 0, 'Drawing status does not leak into the model title')
        await openTaskDrawing(page)
        await page.locator('.wb-preview-stage:not([hidden]) .cdv-missing').waitFor()
      }
    }
    assert.deepEqual(await task(), before)
    assert.deepEqual(errors, [])
    const dir = path.resolve('.dsh/workbench-acceptance'); await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'drawing-status-report.json'), JSON.stringify({ real_desktop: true, controlled_preview_responses: ['partial', 'fallback'], title_status: true, diagnostics_folded: true, task_unchanged: true, pageerrors: errors }, null, 2))
    console.log('drawing status desktop acceptance: PASS (controlled descriptor fixtures, task unchanged)')
  } finally {
    await page.evaluate(() => { if (window.__drawingStatusTestFetch) window.fetch = window.__drawingStatusTestFetch; delete window.__drawingStatusTestFetch })
    await remount()
    if (wasModel && await page.getByRole('button', { name: '3D 模型', exact: true }).isEnabled()) await page.getByRole('button', { name: '3D 模型', exact: true }).click()
    if (oldTab !== '工作台') await page.getByRole('tab', { name: oldTab, exact: true }).click()
  }
} finally { await browser.close() }
