// M5-01 real desktop renderer acceptance: default DrawingPreview vs explicit legacy rollback.
// Legacy phase delays descriptor reads to prove canvas picks consume the latest verified pack.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const expected = process.env.EXPECTED_RENDERER
assert(['preview', 'legacy'].includes(expected), 'EXPECTED_RENDERER must be preview or legacy')
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
const errors = []
try {
  const page = browser.contexts()[0].pages().find(item => item.url().startsWith('dsh-app:'))
  assert(page, 'A real dsh-app:// desktop page is required')
  page.on('pageerror', error => errors.push(error.message))
  const sid = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const priorClear = page.locator('.wb-drawing-context-clear')
  if (await priorClear.count()) await priorClear.click()
  const editor = page.locator('[contenteditable="true"]').first()
  assert.equal((await editor.innerText()).trim(), '', 'Use an empty draft')
  const task = () => page.evaluate(async sid => (await (await fetch(`/camind/api/cam/tasks/${sid}`)).json()).data, sid)
  const before = await task()
  assert(before.inputs.dwg?.uri, 'Select an existing DWG task')
  assert(!before.inputs.prt, 'Use a DWG-only task to prevent automatic model/NX preview generation')
  if (expected === 'legacy') await page.evaluate(sid => {
    window.__legacyRendererTest = { nativeFetch: window.fetch, captured: null, release: null, hold: null, ready: false }
    const test = window.__legacyRendererTest
    test.hold = new Promise(resolve => { test.release = resolve })
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url
      if (url?.includes(`/camind/api/drawings/sessions/${sid}/packs/`) && url.includes('?path=')) {
        await test.hold
        const response = await test.nativeFetch.apply(window, args)
        test.ready = true
        return response
      }
      if (url?.endsWith(`/camind/api/drawings/sessions/${sid}/refs/verify`)) test.captured = JSON.parse(args[1].body)
      return test.nativeFetch.apply(window, args)
    }
  }, sid)
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  await page.getByRole('button', { name: 'CAD 图纸', exact: true }).click()
  const stage = page.locator('.wb-preview-stage:not([hidden])')
  if (expected === 'preview') {
    await stage.locator('.cdv-canvas').waitFor({ timeout: 90000 })
    assert.equal(await stage.getAttribute('data-drawing-renderer'), 'drawing-preview')
    assert.equal(await stage.locator('.wb-drawing-svg').count(), 0, 'Default mode must not mount the legacy SVG pane')
  } else {
    await stage.locator('.wb-drawing-svg svg').waitFor({ timeout: 90000 })
    assert.equal(await stage.getAttribute('data-drawing-renderer'), 'legacy-dwg-pane')
    assert.equal(await stage.locator('.cdv-canvas').count(), 0, 'Rollback must not mount the new DraftPane')
    const chip = page.locator('[data-composer-chip="cam-drawing-ref"]')
    const target = stage.locator('[data-drawing-target]').filter({ visible: true }).first()
    await target.waitFor()
    await target.click()
    await page.waitForTimeout(150)
    assert.equal(await chip.count(), 0, 'A canvas pick before descriptor readiness stays read-only')
    await page.evaluate(() => window.__legacyRendererTest.release())
    await page.waitForFunction(() => window.__legacyRendererTest.ready)
    await page.waitForTimeout(50)
    await target.click()
    await chip.waitFor({ timeout: 15000 })
    const captured = await page.evaluate(() => window.__legacyRendererTest.captured)
    assert(captured, 'The late-descriptor canvas pick must reach /refs/verify')
    assert.equal(captured.kind, 'camind-drawing-ref')
    assert.equal(captured.version, 1)
    assert.equal(captured.session, sid)
    assert.equal(captured.source.uri, before.inputs.dwg.uri)
    assert.equal(captured.source.sha256, before.inputs.dwg.sha256)
    assert.match(captured.pack.sha256, /^[0-9a-f]{64}$/)
    assert.match(captured.pack.identity, /^[0-9a-f]{64}$/)
    assert(['dim', 'entity'].includes(captured.target.type))
    assert.equal(await page.locator('[data-composer-chip="cam-drawing"]').count(), 0, 'Rollback must not emit the retired unverified chip')
    const clear = page.locator('.wb-drawing-context-clear')
    if (await clear.count()) await clear.click()
    await page.evaluate(() => { const test = window.__legacyRendererTest; window.fetch = test.nativeFetch; delete window.__legacyRendererTest })
  }
  assert.deepEqual(await task(), before, 'Renderer switching and selection must not mutate the formal task')
  assert.deepEqual(errors, [])
  const report = { real_desktop: true, renderer: expected, late_descriptor_canvas_pick_verified: expected === 'legacy', drawing_reference_v1: expected === 'legacy', no_retired_chip: true, formal_task_unchanged: true, pageerrors: errors }
  const dir = path.resolve('.dsh/workbench-acceptance')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `drawing-renderer-${expected}-report.json`), JSON.stringify(report, null, 2))
  console.log(`drawing renderer acceptance: PASS (${JSON.stringify(report)})`)
} finally {
  const page = browser.contexts()[0]?.pages().find(item => item.url().startsWith('dsh-app:'))
  if (page) await page.evaluate(() => {
    const test = window.__legacyRendererTest
    if (!test) return
    test.release?.()
    window.fetch = test.nativeFetch
    delete window.__legacyRendererTest
  }).catch(() => {})
  await browser.close()
}
