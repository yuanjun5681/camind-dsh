// Live desktop acceptance via an operator-started CDP app; no messages or CAM jobs are submitted here.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('../', import.meta.url))
const home = process.env.DSH_HOME ?? `${root}.dsh`
const data = JSON.parse(await fs.readFile(`${home}/model-previews/joint-acceptance.json`))
// Playwright is an acceptance-machine tool, not a runtime/build dependency.
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
const checks = {}, errors = []
try {
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('dsh-app:'))
  assert.ok(page, 'Must test the native dsh-app renderer, not a browser fixture')
  await page.bringToFront()
  page.on('pageerror', error => errors.push(error.message))
  const cdp = await page.context().newCDPSession(page)
  // Direct capture avoids this acceptance machine's old Playwright high-DPI viewport resizing.
  const capture = async clip => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })).data, 'base64')
  const canvasImage = async () => capture(await page.locator('.cmv-stage canvas').boundingBox())
  await page.getByRole('tab', { name: '输入', exact: true }).click()
  await page.locator('.wb-file').filter({ hasText: 'zm26030-704_stp.prt' }).first().click()
  await page.getByLabel('加工批次', { exact: true }).selectOption('')
  await page.locator('.cmv-footer').filter({ hasText: '231 面' }).waitFor({ timeout: 30000 })
  await page.getByLabel('加工批次', { exact: true }).selectOption(data.runId)
  await page.getByRole('navigation', { name: '工序导航' }).waitFor({ timeout: 30000 })
  await page.locator('.cmv-footer').filter({ hasText: '来源与对齐信息已校验' }).waitFor()
  assert.equal(await page.locator('.cmv-op').count(), 2)
  if (await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).count()) await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  if (await page.locator('.cmv-selection').count()) await page.getByRole('button', { name: '选择面', exact: true }).click()
  await page.getByLabel('标准视图', { exact: true }).selectOption('0')
  await page.waitForTimeout(300)
  const iso = await canvasImage()
  await page.getByLabel('标准视图', { exact: true }).selectOption('1')
  await page.waitForTimeout(200)
  assert.equal(iso.equals(await canvasImage()), false)
  for (const value of ['2', '3', '4', '5', '6', '0']) await page.getByLabel('标准视图', { exact: true }).selectOption(value)
  await page.getByLabel('投影方式', { exact: true }).selectOption('1')
  await page.getByLabel('投影方式', { exact: true }).selectOption('0')
  checks.views_and_projection = true
  await page.getByRole('button', { name: '仅当前', exact: true }).click()
  assert.equal(await page.locator('.cmv-op input:checked').count(), 1)
  await page.getByRole('button', { name: '本工位全部', exact: true }).click()
  assert.equal(await page.locator('.cmv-op input:checked').count(), 2)
  const opNames = await page.locator('.cmv-op button').allTextContents()
  await page.locator('.cmv-op button').nth(1).click()
  assert.match(await page.locator('.cmv-hud').innerText(), /1_GP_FACE/)
  await page.locator('.cmv-op input').nth(1).uncheck()
  assert.equal(await page.getByRole('button', { name: '播放', exact: true }).isDisabled(), true)
  await page.locator('.cmv-op button').nth(1).click()
  assert.equal(await page.locator('.cmv-op input').nth(1).isChecked(), true)
  checks.visibility_selection_independent = true
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const progress = await page.getByLabel('当前工序播放进度', { exact: true }).inputValue()
  assert.ok(Number(progress) > 0)
  const beforeStep = Number(progress)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  assert.ok(Number(await page.getByLabel('当前工序播放进度', { exact: true }).inputValue()) >= beforeStep)
  const canvas = page.locator('.cmv-stage canvas')
  await canvas.focus(); await page.keyboard.press('Space'); await page.getByRole('button', { name: '暂停', exact: true }).waitFor(); await page.keyboard.press('Space')
  checks.play_pause_step_keyboard = true
  const box = await canvas.boundingBox(), center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const beforeOrbit = await canvasImage()
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 50, center.y + 25, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(150)
  assert.equal(beforeOrbit.equals(await canvasImage()), false)
  const beforeZoom = await canvasImage()
  await page.mouse.wheel(0, -140); await page.waitForTimeout(200)
  assert.equal(beforeZoom.equals(await canvasImage()), false)
  const beforePan = await canvasImage()
  await page.mouse.down({ button: 'right' }); await page.mouse.move(center.x + 90, center.y + 35, { steps: 6 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(150)
  assert.equal(beforePan.equals(await canvasImage()), false)
  checks.orbit_zoom_pan = true
  await page.getByLabel('标准视图', { exact: true }).selectOption('1')
  await page.getByLabel('适配范围', { exact: true }).selectOption('active')
  await page.getByLabel('当前工序播放进度', { exact: true }).press('End')
  await page.waitForTimeout(150)
  const pickPixel = async mode => {
    const bounds = await canvas.boundingBox(), png = (await canvasImage()).toString('base64')
    const point = await page.evaluate(async ({ png, mode }) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode()
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height
      const context = c.getContext('2d'); context.drawImage(image, 0, 0)
      const bytes = context.getImageData(0, 0, c.width, c.height).data
      for (let y = Math.floor(c.height * 0.15); y < c.height * 0.8; y++) for (let x = Math.floor(c.width * 0.1); x < c.width * 0.9; x++) {
        const i = (y * c.width + x) * 4, [r, g, b] = bytes.slice(i, i + 3)
        const match = mode === 'path' ? r < 150 && g > r + 35 && b > g + 10 : r > 90 && r < 190 && Math.abs(g - r) < 30 && Math.abs(b - r) < 40 && bytes[i + 12] > 90 && bytes[i + c.width * 8] > 90
        if (match) return { x: (x + 0.5) / c.width, y: (y + 0.5) / c.height }
      }
      return null
    }, { png, mode })
    assert.ok(point, `No visible ${mode} pixel in the native canvas`)
    await page.mouse.click(bounds.x + point.x * bounds.width, bounds.y + point.y * bounds.height)
  }
  await pickPixel('path')
  assert.equal(await page.locator('.cmv-source').count(), 0, 'Picking preserves the animation workspace')
  const stageBeforeInspection = await page.locator('.cmv-stage').boundingBox()
  await page.locator('.cmv-inspect summary').click()
  await page.getByRole('button', { name: '程序核对', exact: true }).click()
  await page.getByRole('dialog', { name: 'NC 程序核对', exact: true }).waitFor()
  assert.deepEqual(await page.locator('.cmv-stage').boundingBox(), stageBeforeInspection)
  assert.match(await page.locator('.cmv-source-head').innerText(), /[01]_GP_FACE/)
  checks.native_trajectory_picking = true
  await page.getByLabel('源码行号', { exact: true }).fill('120')
  await page.getByRole('button', { name: '定位', exact: true }).click()
  assert.match(await page.locator('.cmv-hud').innerText(), /第1\d\d行/)
  assert.ok(await page.locator('.cmv-source-line').count() <= 100)
  await page.locator('.cmv-source-lines').hover(); await page.mouse.wheel(0, 100); await page.waitForTimeout(200)
  assert.equal(await page.getByRole('button', { name: '跟随刀位', exact: true }).getAttribute('aria-pressed'), 'false')
  await page.getByRole('button', { name: '跟随刀位', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.cmv-op button').first().click()
  await page.locator('.cmv-inspect summary').click()
  await page.getByRole('button', { name: '程序核对', exact: true }).click()
  assert.match(await page.locator('.cmv-source-head').innerText(), /0_GP_FACE/)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  checks.source_file_boundary_follow_virtualization = true
  await page.getByRole('button', { name: '选择面', exact: true }).click()
  await pickPixel('face')
  await page.waitForTimeout(100)
  assert.match(await page.locator('.cmv-selected').innerText(), /F\d{6}/)
  checks.native_face_picking = true
  await page.getByLabel('面编号', { exact: true }).fill('F000084,F000119')
  await page.getByRole('button', { name: '选择', exact: true }).click()
  assert.match(await page.locator('.cmv-selected').innerText(), /F000084/)
  assert.match(await page.locator('.cmv-selected').innerText(), /F000119/)
  await page.getByLabel('面编号', { exact: true }).fill('F999999')
  await page.getByRole('button', { name: '选择', exact: true }).click()
  assert.match(await page.getByRole('alert').innerText(), /面编号不存在/)
  await page.locator('.cmv-selection fieldset').getByLabel('plane', { exact: true }).uncheck()
  assert.match(await page.locator('.cmv-selected').innerText(), /未选面/)
  await page.getByRole('button', { name: '全部', exact: true }).click()
  await page.getByLabel('面编号', { exact: true }).press('Escape')
  assert.equal(await page.locator('.cmv-selection').count(), 0)
  checks.face_selection_filter_escape = true
  await page.getByRole('button', { name: '显示', exact: true }).click()
  await page.getByLabel('刀路穿透显示', { exact: true }).check()
  await page.getByLabel('工位坐标轴', { exact: true }).check()
  await page.getByRole('button', { name: '关闭显示设置', exact: true }).click()
  await page.getByLabel('适配范围', { exact: true }).selectOption('all')
  await page.getByLabel('适配范围', { exact: true }).selectOption('model')
  await page.getByLabel('适配范围', { exact: true }).selectOption('active')
  await page.locator('.cmv-inspect summary').click()
  await page.getByRole('button', { name: '预览信息', exact: true }).click()
  assert.match(await page.getByRole('dialog', { name: '预览信息' }).innerText(), /已校验模型与工序坐标变换/)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  checks.layers_axes_fit_details = true
  await fs.writeFile(`${home}/model-previews/joint-desktop-scene.png`, await capture())
  await page.getByRole('button', { name: '扩大视区', exact: true }).click()
  await page.getByRole('button', { name: '退出扩大', exact: true }).waitFor({ timeout: 10000 })
  await page.getByLabel('适配范围', { exact: true }).selectOption('active')
  await page.waitForTimeout(150)
  await fs.writeFile(`${home}/model-previews/joint-desktop-expanded.png`, await capture())
  await page.getByRole('button', { name: '退出扩大', exact: true }).click()
  await page.getByLabel('适配范围', { exact: true }).selectOption('active')
  checks.expand = true
  await page.getByRole('tab', { name: '加工', exact: true }).click()
  const card = page.locator('.camrun-card').filter({ hasText: data.runId })
  await card.getByRole('button', { name: '查看刀路', exact: true }).first().waitFor({ timeout: 15000 })
  await card.getByRole('button', { name: '查看刀路', exact: true }).first().click()
  await page.locator('.cmv-footer').filter({ hasText: 'NC原始坐标' }).waitFor({ timeout: 10000 })
  assert.equal(await page.getByRole('button', { name: '选择面', exact: true }).count(), 0)
  await fs.writeFile(`${home}/model-previews/joint-desktop-nc-only.png`, await capture())
  await card.getByRole('button', { name: '加工检查', exact: true }).click()
  await page.getByRole('navigation', { name: '工序导航' }).waitFor({ timeout: 15000 })
  checks.workbench_run_entry_and_nc_only = true
  const sha = createHash('sha256').update(await fs.readFile(data.source)).digest('hex')
  assert.equal(sha, data.sha)
  assert.deepEqual(errors, [])
  const report = { native_scheme: 'dsh-app:', run: data.runId, source_unchanged: true, operations: opNames, checks, page_errors: errors }
  await fs.writeFile(`${home}/model-previews/joint-desktop-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close() }
