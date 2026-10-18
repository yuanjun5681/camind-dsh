// Real desktop DrawingReference + native serialization regression, with sends deliberately refused.
// Uses drawingPreview /refs/verify interception; no model/NX call or task writes.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { canvasColors, openTaskDrawing, packDescriptor } from './acceptance-drawing-helpers.mjs'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
try {
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('dsh-app:'))
  assert(page)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const editor = page.locator('[contenteditable="true"]').first()
  assert.equal((await editor.innerText()).trim(), '', 'Refuse to overwrite an existing draft')
  const sid = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const api = () => page.evaluate(async sid => (await (await fetch(`/camind/api/cam/tasks/${sid}`)).json()).data, sid)
  const before = await api()
  const oldTab = (await page.getByRole('tab', { selected: true }).first().innerText()).trim()
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  const model = page.getByRole('button', { name: '3D 模型', exact: true }), drawing = page.getByRole('button', { name: 'CAD 图纸', exact: true })
  const wasModel = await model.getAttribute('aria-pressed') === 'true'
  const chip = page.locator('[data-composer-chip="cam-drawing-ref"]'), ownText = '请解释当前选择，不执行加工。'
  const search = page.locator('.wb-preview-stage:not([hidden])').getByRole('textbox', { name: '搜索图纸文字' })
  const openSearch = async () => { if (!await search.count()) await page.getByRole('button', { name: '查找图纸文字', exact: true }).click() }
  let targets, first, second, host
  const choose = async (target, keyboard = false) => {
    await openSearch(); await search.fill(target.display_text.trim().slice(0, 30))
    const result = page.locator(`[data-drawing-result="dim:${target.id}"]`)
    try { await result.waitFor({ timeout: 5000 }) }
    catch (error) { throw new Error(`Search did not include dim:${target.id}; query=${JSON.stringify(await search.inputValue())}; result ids=${JSON.stringify(await page.locator('[data-drawing-result]').evaluateAll(nodes => nodes.map(n => n.dataset.drawingResult)))}`, { cause: error }) }
    if (keyboard) { await result.focus(); await result.press('Enter') } else await result.click()
    try { await chip.waitFor({ state: 'attached', timeout: 5000 }) }
    catch (error) { throw new Error(`Selection did not commit: ${(await page.locator('.wb-notice, .cdv-error').allTextContents()).join('; ')}`, { cause: error }) }
    assert.equal(await chip.count(), 1)
    await page.waitForFunction(() => document.activeElement?.matches('[contenteditable="true"]'))
  }
  const remount = async () => {
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    await page.getByRole('tab', { name: '工作台', exact: true }).click()
    return openTaskDrawing(page)
  }
  try {
    host = await openTaskDrawing(page)
    const descriptor = await packDescriptor(page, sid, before.inputs.dwg.uri), pack = JSON.parse(descriptor.packText)
    targets = pack.dims.filter(target => target.display_text?.trim())
    assert(targets.length >= 2)
    first = targets[0]; second = targets.find(target => target.id !== first.id && target.display_text !== first.display_text)
    assert(second)
    await editor.fill(ownText)
    await choose(first); assert((await editor.innerText()).includes(ownText))
    assert((await canvasColors(page)).yellow > 0, 'The selected dimension is visibly highlighted')
    await page.getByRole('button', { name: '清除当前提问对象', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[data-composer-chip="cam-drawing-ref"]'))
    assert((await editor.innerText()).includes(ownText))
    await choose(first); await choose(first); assert.equal(await chip.count(), 1)
    await page.getByRole('button', { name: '适配全图 (F)', exact: true }).click()
    await choose(second, true); assert((await editor.innerText()).includes(ownText))
    await fs.mkdir(path.resolve('.dsh/workbench-acceptance'), { recursive: true })
    await page.screenshot({ path: path.resolve('.dsh/workbench-acceptance/drawing-question-selected.png') })
    if (await model.isEnabled()) { await model.click(); assert.equal(await chip.count(), 1); await openTaskDrawing(page) }
    const r = await host.boundingBox()
    await page.mouse.move(r.x + r.width * .5, r.y + r.height * .5); await page.mouse.down(); await page.mouse.move(r.x + r.width * .5 + 50, r.y + r.height * .5 + 25, { steps: 5 }); await page.mouse.up()
    assert.equal(await chip.count(), 1)
    await page.evaluate(sid => {
      window.__drawingQuestionTest = { fetch: window.fetch, arm: false, hold: false, allow: false, captured: null, release: null, sourceOverride: false }
      const test = window.__drawingQuestionTest
      window.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url
        if (test.arm && url?.endsWith(`/camind/api/drawings/sessions/${sid}/refs/verify`)) {
          test.arm = false; test.captured = JSON.parse(args[1].body)
          if (test.hold) await new Promise(resolve => { test.release = resolve })
          if (test.allow) return test.fetch.apply(window, args)
          return new Response(JSON.stringify({ ok: false, message: '验收：已阻止发送，不调用模型' }), { status: 409, headers: { 'content-type': 'application/json' } })
        }
        const response = await test.fetch.apply(window, args)
        if (test.sourceOverride && url?.endsWith(`/camind/api/cam/tasks/${sid}`)) {
          const body = await response.json()
          body.data.version += 1
          body.data.inputs.dwg = { ...body.data.inputs.dwg, uri: `task-input://${body.data.revision + 1}/dwg`, sha256: 'f'.repeat(64) }
          return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } })
        }
        return response
      }
    }, sid)
    await page.evaluate(() => { Object.assign(window.__drawingQuestionTest, { arm: true, hold: true, allow: true, captured: null }) })
    await openSearch(); await search.fill(first.display_text.trim().slice(0, 30)); await page.locator(`[data-drawing-result="dim:${first.id}"]`).click()
    await page.waitForFunction(() => window.__drawingQuestionTest.release !== null)
    await search.fill(second.display_text.trim().slice(0, 30))
    await page.evaluate(() => { window.__drawingQuestionTest.release(); window.__drawingQuestionTest.release = null })
    await chip.waitFor()
    assert.equal(await search.inputValue(), second.display_text.trim().slice(0, 30))
    assert.equal(await search.evaluate(el => document.activeElement === el), true, 'Delayed selection preserves the newer search focus')
    await choose(second, true)
    await page.evaluate(() => { Object.assign(window.__drawingQuestionTest, { arm: true, hold: false, allow: false, captured: null }) })
    await editor.focus(); await editor.press('Enter')
    await page.waitForFunction(() => window.__drawingQuestionTest.captured)
    await page.waitForFunction(text => document.querySelector('[contenteditable="true"]')?.textContent.includes(text) && document.querySelectorAll('[data-composer-chip="cam-drawing-ref"]').length === 1, ownText)
    assert.equal(await page.evaluate(() => window.__drawingQuestionTest.captured.target.id), second.id, 'The native serializer captured the current target')
    await page.evaluate(() => { Object.assign(window.__drawingQuestionTest, { arm: true, hold: true, allow: true, captured: null }) })
    await editor.focus(); await editor.press('Enter')
    await page.waitForFunction(() => window.__drawingQuestionTest.release !== null)
    await choose(first)
    assert.equal(await page.evaluate(() => window.__drawingQuestionTest.captured.target.id), second.id, 'Selecting A must not change the in-flight snapshot of B')
    await page.evaluate(() => { Object.assign(window.__drawingQuestionTest, { allow: false }); window.__drawingQuestionTest.release(); window.__drawingQuestionTest.release = null })
    assert.equal(await chip.count(), 1)
    await editor.focus(); await editor.press('End'); await page.keyboard.insertText('版本更新后保留问题文字')
    await page.evaluate(() => { window.__drawingQuestionTest.sourceOverride = true })
    await page.waitForFunction(() => !document.querySelector('[data-composer-chip="cam-drawing-ref"]'), null, { timeout: 15000 })
    assert((await editor.innerText()).includes('版本更新后保留问题文字'))
    await page.evaluate(() => { window.__drawingQuestionTest.sourceOverride = false })
    assert.deepEqual(await api(), before, 'The controlled response override never mutates the authoritative task')
    assert.deepEqual(errors, [])
    const dir = path.resolve('.dsh/workbench-acceptance'); await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'drawing-question-report.json'), JSON.stringify({ real_desktop: true, selected_dimensions: targets.length, same_source_group_highlight: true, one_owned_reference: true, draft_preserved: true, native_failure_restores_draft: true, in_flight_snapshot_unchanged: true, changed_preview_clears_selection: true, formal_task_unchanged: true, clear_reference_button: true, canvas_pick: true, reasonable_selection_zoom: true, delayed_selection_preserves_search_focus: true, scope: 'Both submit attempts deliberately failed in the owner codec before model dispatch; no model/NX calls.', pageerrors: errors }, null, 2))
    console.log('drawing question desktop acceptance: PASS (DrawingReference replacement/serialization, no model or NX calls)')
  } finally {
    await page.evaluate(() => { const test = window.__drawingQuestionTest; if (test) { test.release?.(); window.fetch = test.fetch; delete window.__drawingQuestionTest } })
    await remount()
    await host.focus(); await page.keyboard.press('Escape')
    await editor.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await page.keyboard.press('Backspace')
    if (wasModel && await model.isEnabled()) await model.click()
    if (oldTab !== '工作台') await page.getByRole('tab', { name: oldTab, exact: true }).click()
  }
} finally { await browser.close() }
