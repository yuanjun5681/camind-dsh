// Read-only real desktop regression for DraftPane v2: existing DWG task, no uploads/model/NX.
// Uses public camera/insets diagnostics instead of the retired SVG viewBox.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { camera, canvasColors, openTaskDrawing, packDescriptor, safeRect, screenAt, waitForDrawing, worldAt } from './acceptance-drawing-helpers.mjs'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
try {
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('dsh-app:'))
  assert(page, 'A freshly started real desktop is required')
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const sid = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const task = () => page.evaluate(async sid => (await (await fetch(`/camind/api/cam/tasks/${sid}`)).json()).data, sid)
  const before = await task(); assert(before.inputs.dwg, 'Select an existing task with a DWG before running')
  assert.equal((await page.locator('[contenteditable="true"]').first().innerText()).trim(), '', 'Use an empty draft; selection tests never overwrite user text')
  const wasWorkbench = await page.locator('.wb-main').count() > 0
  if (!wasWorkbench) await page.getByRole('tab', { name: '工作台', exact: true }).click()
  const model = page.getByRole('button', { name: '3D 模型', exact: true })
  const wasModel = await model.getAttribute('aria-pressed') === 'true'
  const host = await openTaskDrawing(page)
  const tools = page.locator('.wb-preview-stage:not([hidden]) .wb-drawing-tools')
  const fit = async () => { await tools.getByRole('button', { name: '适配全图 (F)', exact: true }).click(); await page.waitForTimeout(50) }
  const more = async () => { await tools.getByLabel('更多图纸选项', { exact: true }).click() }
  const colorToggle = tools.getByRole('checkbox', { name: '原始配色', exact: true })
  let previousColor = false
  try {
    assert.equal(await page.locator('.wb-drawing-annotations').count(), 0, 'Annotations start collapsed')
    const descriptor = await packDescriptor(page, sid, before.inputs.dwg.uri)
    assert.equal(descriptor.missing?.length ?? 0, 0, 'The real fixture has only dimension helper omissions')
    await more()
    assert(!(await tools.innerText()).includes('ignored_dimension_defpoint'), 'Helper omissions stay out of user-facing warnings')
    const diagnostic = tools.getByRole('textbox', { name: '转换诊断信息，可复制' })
    assert((await diagnostic.inputValue()).includes('"conversion"'), 'Conversion diagnostics remain copyable')
    await diagnostic.press('Escape')
    await fit()
    const initial = await camera(page), r = await host.boundingBox()
    assert(r.width > 100 && r.height > 100)
    const p = { x: Math.round(r.x + r.width * .35), y: Math.round(r.y + r.height * .35) }
    const anchor = worldAt(initial, p.x, p.y)
    await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -100)
    await page.waitForFunction(old => JSON.parse(document.querySelector('.wb-preview-stage:not([hidden]) .cdv-canvas').dataset.camera).halfH < old, initial.camera.halfH)
    const zoomed = await camera(page), afterAnchor = worldAt(zoomed, p.x, p.y)
    assert(Math.abs(anchor.x - afterAnchor.x) < initial.camera.halfH * 1e-5)
    assert(Math.abs(anchor.y - afterAnchor.y) < initial.camera.halfH * 1e-5, 'Zoom stays at the mouse')
    await page.evaluate(() => getSelection().removeAllRanges())
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 70, p.y + 40, { steps: 8 }); await page.mouse.up()
    assert.equal(await page.evaluate(() => getSelection().toString()), '', 'Pan must not select page text')
    const panned = await camera(page)
    assert.notDeepEqual(panned.camera, zoomed.camera, 'Dragging must pan the camera')
    assert.equal(panned.camera.halfH, zoomed.camera.halfH, 'Pan does not change zoom')
    await tools.getByRole('button', { name: '框选放大', exact: true }).click()
    await page.mouse.move(r.x + r.width * .25, r.y + r.height * .3); await page.mouse.down()
    await page.mouse.move(r.x + r.width * .65, r.y + r.height * .65, { steps: 8 }); await page.mouse.up()
    assert((await camera(page)).camera.halfH < panned.camera.halfH)
    assert.equal(await tools.getByRole('button', { name: '框选放大', exact: true }).getAttribute('aria-pressed'), 'false')
    await tools.getByRole('button', { name: '框选放大', exact: true }).click(); await page.keyboard.press('Escape')
    assert.equal(await tools.getByRole('button', { name: '框选放大', exact: true }).getAttribute('aria-pressed'), 'false')
    await host.focus(); await page.keyboard.press('f')
    const keyboardFit = await camera(page)
    assert(Math.abs(keyboardFit.camera.halfH - initial.camera.halfH) < initial.camera.halfH * 1e-5, 'Keyboard fit restores the fitted camera')
    await page.keyboard.press('+'); assert((await camera(page)).camera.halfH < initial.camera.halfH)
    const beforeArrow = await camera(page); await page.keyboard.press('ArrowRight')
    assert((await camera(page)).camera.cx < beforeArrow.camera.cx, 'Keyboard panning remains available')
    await tools.getByRole('button', { name: '框选放大', exact: true }).click(); await page.keyboard.press('Escape')
    assert.equal(await tools.getByRole('button', { name: '框选放大', exact: true }).getAttribute('aria-pressed'), 'false', 'Cancellation clears box mode')
    await fit()
    const safe = await camera(page), safeBounds = safeRect(safe), pack = JSON.parse(descriptor.packText)
    for (const [x, y] of [[pack.bbox[0], pack.bbox[1]], [pack.bbox[0], pack.bbox[3]], [pack.bbox[2], pack.bbox[1]], [pack.bbox[2], pack.bbox[3]]]) {
      const point = screenAt(safe, x, y)
      assert(point.x >= safeBounds.left - 1 && point.x <= safeBounds.right + 1 && point.y >= safeBounds.top - 1 && point.y <= safeBounds.bottom + 1, `Fit keeps geometry inside the safe viewport: ${JSON.stringify({ point, safeBounds })}`)
    }
    if (await model.isEnabled()) {
      const view = await camera(page)
      await model.click(); await openTaskDrawing(page)
      assert.deepEqual((await camera(page)).camera, view.camera, '3D/2D switching preserves the drawing camera')
    }
    const annotationButton = tools.getByRole('button', { name: '查找图纸文字', exact: true })
    await annotationButton.click()
    const aside = page.locator('.wb-preview-stage:not([hidden]) .wb-drawing-annotations'), search = aside.getByRole('textbox', { name: '搜索图纸文字' })
    await search.fill('')
    assert.equal(await aside.locator('.wb-drawing-annotation-list > button').count(), 0, 'Empty search does not dump fragments')
    const dim = pack.dims.find(item => item.display_text?.trim())
    assert(dim, 'The real pack must contain a searchable dimension')
    await search.fill(dim.display_text)
    await aside.locator(`[data-drawing-result="dim:${dim.id}"]`).click()
    await page.locator('[data-composer-chip="cam-drawing-ref"]').waitFor()
    assert.equal(await aside.locator('.wb-drawing-annotation-list > button[aria-pressed="true"]').count(), 1)
    assert((await canvasColors(page)).yellow > 0, 'The selected target is visibly highlighted')
    const beforeSearch = await camera(page)
    await search.fill('f-no-matching-annotation'); await search.press('f')
    assert.deepEqual((await camera(page)).camera, beforeSearch.camera, 'Input keys must not trigger canvas shortcuts')
    await aside.getByText('没有匹配的内容', { exact: true }).waitFor()
    await search.press('Escape'); assert.equal(await aside.count(), 0)
    await more()
    previousColor = await colorToggle.isChecked()
    await colorToggle.check()
    assert((await canvasColors(page)).blue > 0, 'Original ACI blue remains available for inspection')
    await colorToggle.uncheck()
    assert.equal((await canvasColors(page)).blue, 0, 'Readable colors replace the original low-contrast blue')
    await colorToggle.press('Escape')
    const cdp = await page.context().newCDPSession(page)
    try {
      for (const width of [1024, 736, 360]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 768, deviceScaleFactor: 1, mobile: false })
        const fits = await page.locator('.wb-preview-stage:not([hidden]) .cdv-body').evaluate(el => { const body = el.getBoundingClientRect(), controls = el.querySelector('.wb-drawing-controls').getBoundingClientRect(); return body.width > 0 && controls.right <= body.right && controls.left >= body.left })
        assert(fits, `Drawing toolbar fits at ${width}px`)
      }
    } finally { await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach() }
    await fit()
    assert.deepEqual(await task(), before, 'Viewing must not mutate task/evidence/authorization')
    assert.deepEqual(errors, [])
    const dir = path.resolve('.dsh/workbench-acceptance'); await fs.mkdir(dir, { recursive: true })
    await page.screenshot({ path: path.join(dir, 'drawing-optimized.png') })
    await fs.writeFile(path.join(dir, 'drawing-report.json'), JSON.stringify({ source: 'real desktop / existing task / DraftPane v2', anchored_zoom: true, no_text_selection: true, box_zoom: true, keyboard: true, view_preserved: true, readable_colors: true, safe_fit: true, helper_omissions_not_warning: true, diagnostics_folded: true, frozen_task_unchanged: true, pageerrors: errors }, null, 2))
    console.log('drawing desktop acceptance: PASS (DraftPane v2, real DWG, no model calls/NX/task changes)')
  } finally {
    if (await page.locator('[data-composer-chip="cam-drawing-ref"]').count()) { await host.focus(); await page.keyboard.press('Escape') }
    if (await page.locator('.wb-drawing-annotations').count()) await page.getByRole('button', { name: '收起图纸文字搜索' }).click()
    if (await colorToggle.isVisible()) await colorToggle.setChecked(previousColor)
    await tools.locator(':scope > details').evaluate(el => { el.open = false })
    if (wasModel && await model.isEnabled()) await model.click()
    if (!wasWorkbench) await page.getByRole('tab', { name: '对话', exact: true }).click()
  }
} finally { await browser.close() }
