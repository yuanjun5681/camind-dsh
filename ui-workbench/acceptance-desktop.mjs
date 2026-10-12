// Live first-stage workbench acceptance; uses an existing session/cache and never submits LLM or NX work.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
const home = process.env.DSH_HOME ?? fileURLToPath(new URL('../.dsh/', import.meta.url))
const errors = [], checks = {}
try {
  const page = browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app:'))
  assert.ok(page, 'Use the native desktop renderer')
  page.on('pageerror', error => errors.push(error.message))
  await page.bringToFront()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await page.locator('.wb-main').waitFor()
  const labels = await page.getByRole('tab').allTextContents()
  assert.deepEqual(labels.slice(0, 3), ['工作台', '对话', '轨迹'])
  assert.equal(await page.getByRole('tab', { name: '工作台', exact: true }).count(), 1, 'Legacy sidebar workbench must be removed')
  checks.first_class_navigation = true
  await page.locator('.wb-file').filter({ hasText: '.prt' }).first().click()
  await page.locator('.cmv-footer').filter({ hasText: /\d+ 面/ }).waitFor({ timeout: 30000 })
  assert.equal(await page.locator('.campv-embedded').count(), 1)
  assert.equal(await page.getByRole('tab', { name: '工作台', exact: true }).getAttribute('aria-selected'), 'true')
  const sceneFits = await page.evaluate(() => {
    const stage = document.querySelector('.cmv-stage')?.getBoundingClientRect()
    const body = document.querySelector('.cmv-body')?.getBoundingClientRect()
    return Boolean(stage && body && stage.height >= 200 && stage.bottom <= body.bottom + 1)
  })
  assert.ok(sceneFits, 'Canvas must fit its viewport, not be cropped by the old standalone minimum')
  checks.cached_model_in_canvas = true
  const editor = page.locator('[contenteditable="true"]').first()
  assert.equal((await editor.innerText()).trim(), '', 'Use an empty draft; do not overwrite an existing user draft')
  const question = '工作台选面草稿验收，不发送。'
  try {
    await editor.fill(question)
    await page.getByRole('button', { name: '选择面', exact: true }).click()
    await page.getByRole('textbox', { name: '面编号', exact: true }).fill('F000001')
    await page.getByRole('button', { name: '选择', exact: true }).click()
    assert.equal((await editor.innerText()).trim(), question, 'Selection alone must not alter the draft')
    await page.getByRole('button', { name: '添加到提问', exact: true }).click()
    await page.getByText('已添加到提问草稿，尚未发送。', { exact: true }).waitFor()
    assert.ok((await editor.innerText()).includes(question))
    assert.match(await editor.innerText(), /F000001.*[a-f0-9]{8}/)
    checks.native_face_reference_preserves_draft = true
  } finally {
    await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await editor.press('Backspace')
    await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]')?.textContent?.trim())
  }
  await page.getByRole('button', { name: '选择面', exact: true }).click()
  await page.getByRole('button', { name: '确认向导', exact: true }).click()
  await page.getByText('动态确认向导', { exact: true }).waitFor()
  await page.getByText('功能待接入 · 不参与加工放行', { exact: true }).first().waitFor()
  await page.locator('.wb-file').filter({ hasText: '.prt' }).first().click()
  await page.getByText('动态确认向导', { exact: true }).waitFor({ state: 'detached' })
  await page.locator('.cmv-footer').filter({ hasText: /\d+ 面/ }).waitFor()
  await page.getByRole('button', { name: '工序表', exact: true }).click()
  await page.getByText('结构化工序表', { exact: true }).waitFor()
  await page.getByRole('button', { name: '检视面板', exact: true }).click()
  await page.getByRole('complementary', { name: '对象检视' }).waitFor()
  await page.getByRole('button', { name: '检视面板', exact: true }).click()
  await page.getByRole('button', { name: '模型 / 图纸 / 文档', exact: true }).click()
  await page.locator('.cmv-stage canvas').waitFor()
  checks.honest_placeholders = true
  await page.getByRole('button', { name: '输入与加工', exact: true }).click()
  assert.equal(await page.locator('.wb-left').count(), 0)
  await page.getByRole('button', { name: '输入与加工', exact: true }).click()
  await page.getByRole('tab', { name: '交付物', exact: true }).click()
  await page.getByRole('tab', { name: '加工', exact: true }).click()
  await page.locator('.camrun-list, .wb-left .wb-empty').first().waitFor()
  await page.getByRole('tab', { name: '输入', exact: true }).click()
  checks.existing_panels = true
  await page.getByRole('button', { name: '查看对话', exact: true }).click()
  await page.locator('.wb-main').waitFor({ state: 'detached' })
  await page.waitForTimeout(3400)
  assert.equal(await page.locator('.wb-main').count(), 0, 'Polling must not steal a user-selected view')
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  await page.locator('.wb-agent').waitFor()
  await page.locator('.cmv-footer').filter({ hasText: /\d+ 面/ }).waitFor({ timeout: 30000 })
  // The native composer is the sole submission channel; do not type or send a message.
  const composerVisible = await page.locator('[data-composer-seat]').evaluate(el => getComputedStyle(el).display !== 'none')
  assert.ok(composerVisible)
  const composer = await page.locator('[data-composer-seat]').boundingBox()
  const viewport = await page.evaluate(() => ({ height: innerHeight, width: innerWidth }))
  assert.ok(composer && composer.y >= 0 && composer.y + composer.height <= viewport.height + 2, 'Native input must remain in the visible viewport')
  checks.shared_composer_and_manual_preference = true
  const cdp = await page.context().newCDPSession(page)
  const screenshot = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })).data, 'base64')
  await fs.mkdir(`${home}/workbench-acceptance`, { recursive: true })
  await fs.writeFile(`${home}/workbench-acceptance/desktop.png`, screenshot)
  assert.deepEqual(errors, [])
  await fs.writeFile(`${home}/workbench-acceptance/report.json`, JSON.stringify({ checks, pageerrors: errors.length, scope: 'No new messages, uploads, NX jobs or production approval' }, null, 2))
  console.log(JSON.stringify({ checks, pageerrors: errors.length }))
} finally { await browser.close() }
