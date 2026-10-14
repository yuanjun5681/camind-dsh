// Fresh desktop acceptance of real local DWG + formal records. One number-only model request; no tools/NX; temporary workspace fixture only.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const root = path.resolve(new URL('../', import.meta.url).pathname)
let fixtureDir = path.join(root, `.cam-task-acceptance-${Date.now()}`)
const source = process.env.CAMIND_ACCEPTANCE_DWG ?? path.resolve(root, '../测试文件/zm26030-704/ZM26030-704.dwg')
await fs.mkdir(fixtureDir)
await fs.copyFile(source, path.join(fixtureDir, 'drawing.dwg'))
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
const errors = []; let sessionId, restored = false
try {
  const page = browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app:'))
  assert(page); page.on('pageerror', e => errors.push(e.message))
  const originalId = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const title = (await page.title()).split(' — ')[0]
  assert.equal((await page.locator('[contenteditable="true"]').first().innerText()).trim(), '')
  await page.getByText('新会话', { exact: true }).click()
  await page.waitForFunction(id => document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') !== id, originalId)
  sessionId = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const api = (action, body) => page.evaluate(async ({ sid, action, body }) => {
    const res = await fetch(`/camind/api/cam/tasks/${sid}${action ? `/${action}` : ''}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    return { status: res.status, body: await res.json() }
  }, { sid: sessionId, action, body })
  try {
    const sessionsRoot = path.join(root, '.dsh/sessions')
    let sessionDir
    for (const entry of await fs.readdir(sessionsRoot, { withFileTypes: true })) if (entry.isDirectory()) {
      const candidate = path.join(sessionsRoot, entry.name, sessionId)
      if (await fs.stat(candidate).then(s => s.isDirectory()).catch(() => false)) { sessionDir = candidate; break }
    }
    assert(sessionDir, 'New session header must exist')
    const log = (await fs.readdir(sessionDir)).find(name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name))
    const raw = log.endsWith('.zstd') ? (await promisify(execFile)('zstd', ['-dc', path.join(sessionDir, log)], { maxBuffer: 16 * 1024 * 1024 })).stdout : await fs.readFile(path.join(sessionDir, log), 'utf8')
    const header = JSON.parse(raw.split('\n')[0]), cwd = header.cwd ?? header.data?.cwd ?? header.header?.cwd
    assert(typeof cwd === 'string', `Unknown own-session header keys: ${Object.keys(header).join(',')}`)
    const ownFixture = path.join(cwd, path.basename(fixtureDir))
    if (ownFixture !== fixtureDir) { await fs.rm(fixtureDir, { recursive: true }); fixtureDir = ownFixture; await fs.mkdir(fixtureDir); await fs.copyFile(source, path.join(fixtureDir, 'drawing.dwg')) }
    let before = await api('')
    if (before.body.data.version !== 0) {
      const previous = before.body.data
      assert(previous.inputs.dwg?.reference.includes('.cam-task-acceptance-') && !previous.inputs.prt && !previous.goal && !previous.authorization && !previous.runs.length && !previous.active_run, 'Refuse to edit a non-test task')
      before = await api('revise', { version: previous.version, feedback: 'UI acceptance retry after a failed test; not a production task.' })
      assert.equal(before.status, 200)
    }
    const promptEditor = page.locator('[contenteditable="true"]').first()
    await promptEditor.fill('这是界面验收。不要调用任何工具。只回复数字7，不要解释。')
    await promptEditor.press('Enter')
    await page.getByRole('button', { name: '工作台', exact: true }).waitFor({ timeout: 90000 })
    const collected = await api('collect', { version: before.body.data.version, inputs: { dwg: `${path.basename(fixtureDir)}/drawing.dwg` } })
    assert.equal(collected.status, 200, collected.body.message)
    assert(collected.body.data.drawing.annotation_count > 100)
    assert(collected.body.data.blockers.some(text => text.includes('PRT')))
    assert.equal((await api('authorize', { version: collected.body.data.version, fingerprint: collected.body.data.fingerprint })).status, 400, 'Single DWG must not authorize programming')
    await page.getByRole('button', { name: '工作台', exact: true }).click()
    if (!(await page.getByRole('heading', { name: '核对本次审图结果', exact: true }).count())) await page.getByRole('button', { name: '继续处理', exact: true }).click()
    await page.getByRole('heading', { name: '核对本次审图结果', exact: true }).waitFor()
    const op = { id: 'accept-op', type: 'from_scratch_workpiece_op', new_name: 'ACCEPT_{suffix}', station: 'draft-station', depends_on: [], execution: 'nc', inspection: ['界面验收草案，不执行'], feed: 100, spindle: 1000 }
    const seeded = await api('operations', { version: collected.body.data.version, operations: [op] })
    assert.equal(seeded.status, 200, seeded.body.message)
    await page.getByRole('button', { name: '保存并稍后继续', exact: true }).click()
    await page.locator('.wb-main-head').getByRole('button', { name: '工序方案', exact: true }).click()
    await page.getByText('工序方案确认后将在这里显示', { exact: true }).waitFor()
    assert.equal(await page.locator('.wb-context button').count(), 1, 'Unconfirmed drafts expose no inspector actions')
    const unchanged = await api('')
    assert.equal(unchanged.body.data.operations[0].feed, 100)
    assert.equal(unchanged.body.data.authorization, null)
    await page.getByRole('button', { name: /^CAD 图纸/ }).click()
    await page.locator('.wb-canvas svg').waitFor()
    assert(await page.locator('.wb-canvas svg path').count() > 100)
    assert.equal(await page.locator('.wb-canvas svg script, .wb-canvas svg foreignObject, .wb-canvas svg [onload]').count(), 0)
    const annotation = page.locator('.wb-canvas aside button').filter({ hasText: /^[a-f0-9]+ · / }).first()
    await annotation.click()
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.fill('保留这段问题文字')
    await page.getByRole('button', { name: '添加标注到提问', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent?.includes('图纸'))
    assert((await editor.innerText()).includes('保留这段问题文字'))
    await editor.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await page.keyboard.press('Backspace')
    await page.waitForFunction(() => !document.querySelector('[contenteditable="true"]')?.textContent?.trim())
    const client = await fs.readFile(path.join(root, 'ui-workbench/lib/client.js'), 'utf8')
    const start = client.indexOf('function sanitizeDwgSvg(text)'), end = client.indexOf('\nfunction DwgPane', start)
    const sanitized = await page.evaluate(({ fn }) => eval(`(${fn})`)('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://example.com"/></foreignObject><path style="stroke:red;fill:url(https://example.com/x)" d="M0 0 L10 10"/><use href="https://example.com/x"/></svg>'), { fn: client.slice(start, end) })
    assert(!/script|foreignObject|iframe|onload|https:\/\/example/.test(sanitized)); assert(sanitized.includes('stroke="red"'))
    const drawing = await api('drawing'), entity = drawing.body.data.annotations[0]
    assert.equal((await api('reference', { reference: { session_id: 'foreign', kind: 'drawing', source_sha256: drawing.body.data.source_sha256, ids: [entity.id] } })).status, 400)
    await fs.chmod(path.join(fixtureDir, 'drawing.dwg'), 0o600)
    await fs.appendFile(path.join(fixtureDir, 'drawing.dwg'), 'changed')
    assert.equal((await api('reference', { reference: { session_id: sessionId, kind: 'drawing', source_sha256: drawing.body.data.source_sha256, ids: [entity.id] } })).status, 400, 'Changed original must invalidate reference')
    assert.deepEqual(errors, [])
    const artifacts = path.join(root, '.dsh/workbench-acceptance'); await fs.mkdir(artifacts, { recursive: true })
    const cdp = await page.context().newCDPSession(page)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(artifacts, 'drawing.png'), Buffer.from(shot.data, 'base64')); await cdp.detach()
    await fs.writeFile(path.join(artifacts, 'task-report.json'), JSON.stringify({ sessionId, annotations: collected.body.data.drawing.annotation_count, single_file_authorization_denied: true, original_change_refused: true, sanitizer: true, native_reference_preserves_draft: true, unconfirmed_scheme_empty: true, inspector_read_only: true, draft_unchanged: true, pageerrors: errors.length, scope: 'Local real DWG/desktop; one number-only model prompt with no file content, no NX, no production evidence. Temporary source removed after test.' }, null, 2))
    console.log(JSON.stringify({ annotations: collected.body.data.drawing.annotation_count, pageerrors: errors.length, scope: 'DWG and formal records; no NX' }))
  } finally {
    const sidebar = page.locator('[data-slot="sidebar.workspaces"]')
    while (await sidebar.getByText(/^展开其余/).count()) await sidebar.getByText(/^展开其余/).first().click()
    await sidebar.getByText(title, { exact: true }).first().click()
    await page.waitForFunction(id => document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') === id, originalId)
    restored = true
  }
} finally { await browser.close(); await fs.rm(fixtureDir, { recursive: true, force: true }); if (!restored) console.warn('Original session restoration not confirmed') }
