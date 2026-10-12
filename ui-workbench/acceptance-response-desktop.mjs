// Real streaming acceptance: sends one number-only prompt in a newly created desktop session; no existing conversation is edited.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const home = process.env.DSH_HOME ?? fileURLToPath(new URL('../.dsh/', import.meta.url))
const root = path.join(home, 'sessions'), workspaceDirs = (await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name))
const existing = new Set((await Promise.all(workspaceDirs.map(dir => fs.readdir(dir)))).flat())
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
const errors = []
let sessionId, restored = false
try {
  const page = browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app:'))
  assert.ok(page)
  page.on('pageerror', error => errors.push(error.message))
  const originalId = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const originalTitle = (await page.title()).split(' — ')[0]
  assert.equal((await page.locator('[contenteditable="true"]').first().innerText()).trim(), '', 'Do not touch an existing draft')
  try {
    await page.getByText('新会话', { exact: true }).click()
    await page.waitForFunction(id => { const next = document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session'); return Boolean(next) && next !== id }, originalId)
    sessionId = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
    assert.match(sessionId, /^[A-Za-z0-9_-]+$/)
    assert.ok(!existing.has(sessionId), 'Refuse to submit in a reused pre-existing session')
    const editor = page.locator('[contenteditable="true"]').first()
    assert.equal((await editor.innerText()).trim(), '')
    await page.evaluate(() => {
      window.__wbResponseSamples = []
      window.__wbResponseObserver = new MutationObserver(() => {
        const panel = document.querySelector('.wb-agent')
        if (!panel) return
        const text = panel.querySelector('.wb-response')?.textContent ?? ''
        const streaming = panel.querySelector('summary')?.textContent === '公开回复生成中'
        const sample = { text: text.slice(0, 8192), streaming }
        const previous = window.__wbResponseSamples.at(-1)
        if ((!previous || previous.text !== sample.text || previous.streaming !== sample.streaming) && window.__wbResponseSamples.length < 200) window.__wbResponseSamples.push(sample)
      })
      window.__wbResponseObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await editor.fill('这是 Camind 工作台公开回复验收。不要调用任何工具。请逐行输出 1 到 80，每行只写一个数字，不要解释。')
    await editor.press('Enter')
    await page.getByRole('button', { name: '工作台', exact: true }).click()
    await page.waitForFunction(() => {
      const panel = document.querySelector('.wb-agent')
      return panel?.querySelector('header [role="status"]')?.textContent === '等待指令' && /\b80\b/.test(panel.querySelector('.wb-response')?.textContent ?? '')
    }, null, { timeout: 180000 })
    const samples = await page.evaluate(() => window.__wbResponseSamples)
    assert.ok(samples.some(sample => sample.streaming), 'Must observe a real partial response, not only a finalized message')
    assert.ok(new Set(samples.filter(sample => sample.streaming).map(sample => sample.text)).size > 1, 'Public text must update during the stream')
    const final = await page.locator('.wb-response').innerText()
    assert.match(final, /\b80\b/)
    // Read only this new session's log, including all concatenated zstd frames, to prove no tools ran.
    const dir = workspaceDirs.find(dir => existsSync(path.join(dir, sessionId)))
    assert.ok(dir, 'New session must be persisted')
    const logs = (await fs.readdir(path.join(dir, sessionId))).filter(name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name)).sort()
    assert.equal(logs.length, 1, 'New test session should have one canonical log generation')
    const log = path.join(dir, sessionId, logs[0])
    const text = log.endsWith('.zstd') ? (await promisify(execFile)('zstd', ['-dc', log], { maxBuffer: 16 * 1024 * 1024 })).stdout : await fs.readFile(log, 'utf8')
    const events = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
    assert.equal(events.filter(event => event.type === 'tool/call').length, 0, 'Acceptance must not run tools or NX')
    assert.ok(events.some(event => event.type === 'assistant/message'))
    assert.deepEqual(errors, [])
    await fs.mkdir(path.join(home, 'workbench-acceptance'), { recursive: true })
    await fs.writeFile(path.join(home, 'workbench-acceptance/response-report.json'), JSON.stringify({ sessionId, partial_updates: samples.filter(sample => sample.streaming).length, tools: 0, pageerrors: errors.length, scope: 'One number-only prompt in a new session' }, null, 2))
    console.log(JSON.stringify({ partial_updates: samples.filter(sample => sample.streaming).length, tools: 0, pageerrors: errors.length }))
  } finally {
    await page.evaluate(() => { window.__wbResponseObserver?.disconnect(); delete window.__wbResponseObserver; delete window.__wbResponseSamples })
    await page.locator('[data-slot="sidebar.workspaces"]').getByText(originalTitle, { exact: true }).first().click()
    await page.waitForFunction(id => document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') === id, originalId)
    restored = true
  }
} finally { await browser.close(); if (!restored) console.warn('Original session restoration was not confirmed') }
