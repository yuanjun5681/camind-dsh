// M5-03 real /camind, official /web and dsh-app:// drawing acceptance matrix.
// Covers boot, pack APIs, native references, cancellation, token fallbacks and loading cost.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const origin = process.env.CAMIND_WEB_ORIGIN || 'http://127.0.0.1:3080'
const entryUrl = `${origin}/${process.env.CAMIND_WEB_TOKEN ? `?token=${encodeURIComponent(process.env.CAMIND_WEB_TOKEN)}` : ''}`
const root = process.cwd()
const HEADER = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n`
const TABLES = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nContinuous\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nContinuous\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0\n41\n1.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n`
function makeDxf(count) {
  const lines = Array.from({ length: count }, (_, i) => `0\nLINE\n5\n${100 + i}\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n${i}.0\n20\n0.0\n30\n0.0\n11\n${i + 1}.0\n21\n0.0\n31\n0.0\n`).join('')
  return `${HEADER}${TABLES}0\nSECTION\n2\nENTITIES\n${lines}0\nENDSEC\n0\nEOF\n`
}
async function sessionCwd(sid) {
  const sessions = path.join(root, '.dsh/sessions')
  for (const entry of await fs.readdir(sessions, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(sessions, entry.name, sid)
    if (!(await fs.stat(dir).then(stat => stat.isDirectory()).catch(() => false))) continue
    const log = (await fs.readdir(dir)).find(name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name))
    const raw = log.endsWith('.zstd')
      ? (await promisify(execFile)('zstd', ['-dc', path.join(dir, log)], { maxBuffer: 16 * 1024 * 1024 })).stdout
      : await fs.readFile(path.join(dir, log), 'utf8')
    const header = JSON.parse(raw.split('\n')[0])
    const cwd = header.cwd ?? header.data?.cwd ?? header.header?.cwd
    assert(typeof cwd === 'string')
    return cwd
  }
  throw new Error('Session storage not found')
}
async function taskOf(page, sid) {
  return page.evaluate(async sid => (await (await fetch(`/camind/api/cam/tasks/${sid}`)).json()).data, sid)
}
async function preparePack(page, sid, sourceUri) {
  const base = `/camind/api/drawings/sessions/${encodeURIComponent(sid)}/packs`
  const started = await page.evaluate(async ({ base, sourceUri }) => {
    const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: sourceUri }) })
    return { status: response.status, body: await response.json() }
  }, { base, sourceUri })
  assert.equal(started.status, 202, JSON.stringify(started.body))
  const jobId = started.body.jobId
  let ready
  for (let i = 0; i < 360; i++) {
    const job = await page.evaluate(async ({ base, jobId }) => (await (await fetch(`${base}/${jobId}/status`)).json()), { base, jobId })
    if (job.state === 'error') throw new Error(job.error?.message || 'Pack conversion failed')
    if (job.state === 'ready') { ready = job; break }
    await page.waitForTimeout(250)
  }
  const key = ready?.result?.key
  assert(key)
  const hitStart = Date.now()
  const fetched = await page.evaluate(async ({ base, key, sourceUri }) => {
    const response = await fetch(`${base}/${key}?path=${encodeURIComponent(sourceUri)}`)
    return { status: response.status, cacheControl: response.headers.get('cache-control'), sha: response.headers.get('x-pack-sha256'), body: await response.json() }
  }, { base, key, sourceUri })
  const packHitMs = Date.now() - hitStart
  assert.equal(fetched.status, 200, JSON.stringify(fetched.body))
  assert.equal(fetched.cacheControl, 'no-store')
  const actualSha = createHash('sha256').update(Buffer.from(fetched.body.packText, 'utf8')).digest('hex')
  assert.equal(fetched.sha, actualSha)
  assert.equal(fetched.body.pack.sha256, actualSha)
  assert.equal(fetched.body.pack.identity, key)
  return { descriptor: fetched.body, pack: JSON.parse(fetched.body.packText), packHitMs }
}
async function cancelConversion(page, sid, before, shell) {
  const cwd = await sessionCwd(sid)
  const reference = before.inputs.dwg.reference
  const dir = await fs.mkdtemp(path.join(cwd, path.dirname(reference), `.cam-shell-cancel-${shell}-`))
  const file = path.join(dir, 'cancel.dxf')
  await fs.writeFile(file, makeDxf(50000))
  const base = `/camind/api/drawings/sessions/${encodeURIComponent(sid)}/packs`
  const sourceUri = path.relative(cwd, file)
  try {
    const started = await page.evaluate(async ({ base, sourceUri }) => {
      const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: sourceUri }) })
      return { status: response.status, body: await response.json() }
    }, { base, sourceUri })
    assert.equal(started.status, 202, JSON.stringify(started.body))
    const jobId = started.body.jobId
    await page.evaluate(async ({ base, jobId }) => (await fetch(`${base}/${jobId}/cancel`, { method: 'POST' })), { base, jobId })
    for (let i = 0; i < 360; i++) {
      const job = await page.evaluate(async ({ base, jobId }) => (await (await fetch(`${base}/${jobId}/status`)).json()), { base, jobId })
      if (job.state === 'error') {
        assert.equal(job.error.code, 'cancelled')
        return
      }
      if (job.state === 'ready') throw new Error('Cancellation arrived after conversion completed')
      await page.waitForTimeout(100)
    }
    throw new Error('Cancellation did not reach a terminal state')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
function contrastOf(page) {
  return page.evaluate(() => {
    const parse = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = rgb => rgb.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    const el = document.querySelector('.cdv'), text = el?.querySelector('strong') ?? el
    if (!el || !text) return null
    const bg = parse(getComputedStyle(el).backgroundColor), fg = parse(getComputedStyle(text).color)
    if (bg.length < 3 || fg.length < 3) return null
    const light = Math.max(lum(bg), lum(fg)), dark = Math.min(lum(bg), lum(fg))
    return { ratio: (light + 0.05) / (dark + 0.05), background: getComputedStyle(el).backgroundColor, foreground: getComputedStyle(text).color }
  })
}
async function tokenSnapshot(page, officialWeb) {
  const value = await page.evaluate(() => {
    const el = document.querySelector('.cdv'), rootStyle = getComputedStyle(document.body)
    const probe = document.createElement('div')
    probe.style.color = 'var(--dsw-alias-bg-base)'
    document.body.append(probe)
    const dswColor = getComputedStyle(probe).color
    probe.remove()
    return { background: getComputedStyle(el).backgroundColor, dswColor,
      camind: rootStyle.getPropertyValue('--camind-surface-page').trim(), dsw: rootStyle.getPropertyValue('--dsw-alias-bg-base').trim() }
  })
  assert(value.dsw, 'The official DSW background token must exist')
  assert(!['rgba(0, 0, 0, 0)', 'transparent'].includes(value.background), 'Drawing background must have a computed token value')
  if (officialWeb) {
    assert.equal(value.camind, '', 'Official /web must not activate Camind foundation')
    assert.equal(value.background, value.dswColor, 'Official /web must use the DSW fallback, not a missing Camind token')
  }
  return value
}
async function themePreference(page) {
  const namespace = await page.evaluate(async () => {
    const document = await (await fetch('/camind/api/settings')).json()
    return document.namespaces.find(item => item.ns === 'ui-theme')
  })
  assert(namespace?.value?.preference, 'The official ui-theme namespace is required')
  return namespace
}
async function setThemePreference(page, preference) {
  const current = await themePreference(page)
  const result = await page.evaluate(async ({ current, preference }) => {
    const response = await fetch('/camind/api/settings/mutate', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ns: 'ui-theme', ops: [{ op: 'set', path: ['preference'], value: preference }], expectedRevision: current.revision }) })
    return { status: response.status, body: await response.json() }
  }, { current, preference })
  assert.equal(result.status, 200, JSON.stringify(result.body))
}
async function verifyReference(page, sid, before, pack) {
  await page.evaluate(() => { window.__shellReferenceTest = { nativeFetch: window.fetch, captured: null }; const test = window.__shellReferenceTest; window.fetch = async (...args) => { const url = typeof args[0] === 'string' ? args[0] : args[0].url; if (url?.endsWith('/refs/verify')) test.captured = JSON.parse(args[1].body); return test.nativeFetch.apply(window, args) } })
  const clear = page.locator('.wb-drawing-context-clear')
  if (await clear.count()) await clear.click()
  const search = page.locator('.wb-preview-stage:not([hidden])').getByRole('textbox', { name: '搜索图纸文字' })
  if (!(await search.count())) await page.getByRole('button', { name: '查找图纸文字', exact: true }).click()
  const target = pack.dims.find(item => item.display_text?.trim())
  assert(target)
  await search.fill(target.display_text.trim().slice(0, 30))
  await page.locator(`[data-drawing-result="dim:${target.id}"]`).click()
  await page.locator('[data-composer-chip="cam-drawing-ref"]').waitFor({ timeout: 15000 })
  const captured = await page.evaluate(() => window.__shellReferenceTest.captured)
  assert(captured)
  assert.equal(captured.kind, 'camind-drawing-ref')
  assert.equal(captured.session, sid)
  assert.equal(captured.source.uri, before.inputs.dwg.uri)
  assert.equal(captured.source.sha256, before.inputs.dwg.sha256)
  assert.equal(captured.target.type, 'dim')
  assert.equal(captured.target.id, target.id)
  await page.evaluate(() => { const test = window.__shellReferenceTest; window.fetch = test.nativeFetch; delete window.__shellReferenceTest })
  if (await clear.count()) await clear.click()
}
async function verifyShell({ page, sid, shell, cdp }) {
  const before = await taskOf(page, sid)
  assert(before.inputs.dwg?.uri)
  assert(!before.inputs.prt)
  assert.equal(await page.evaluate(() => Boolean(window.__DSH_BOOT__?.entries?.some(entry => entry.id === 'camind-ui-drawing-viewer'))), true, `${shell} boot graph`)
  const loadStart = Date.now()
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  await page.getByRole('button', { name: 'CAD 图纸', exact: true }).click()
  const canvas = page.locator('.wb-preview-stage:not([hidden]) .cdv-canvas')
  await canvas.waitFor({ timeout: 90000 })
  const readyMs = Date.now() - loadStart
  const { pack, packHitMs } = await preparePack(page, sid, before.inputs.dwg.uri)
  await verifyReference(page, sid, before, pack)
  await cancelConversion(page, sid, before, shell)
  const themes = {}, originalTheme = (await themePreference(page)).value.preference
  for (const theme of ['light', 'dark', 'system']) {
    await setThemePreference(page, theme)
    if (theme === 'system') await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    else await cdp.send('Emulation.setEmulatedMedia', { features: [] })
    await page.waitForFunction(theme => document.documentElement.style.colorScheme === theme, theme === 'system' ? 'dark' : theme, { timeout: 10000 })
    const token = await tokenSnapshot(page, shell === 'web')
    const contrast = await contrastOf(page)
    assert(contrast && contrast.ratio >= 4.5, `${shell}/${theme} text contrast ${contrast?.ratio}`)
    themes[theme] = { token, contrast }
  }
  await setThemePreference(page, originalTheme)
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  if (originalTheme === 'system') await page.waitForFunction(() => document.documentElement.getAttribute('data-ds-theme-source') === 'system')
  else await page.waitForFunction(theme => document.documentElement.style.colorScheme === theme, originalTheme)
  assert.deepEqual(await taskOf(page, sid), before)
  return { real_shell: shell, boot: true, pack_sha256_verified: true, native_reference_verified: true, cancelled: true, themes, readyMs, packHitMs, formal_task_unchanged: true }
}
const desktopBrowser = await chromium.connectOverCDP('http://127.0.0.1:9236')
let sid
const reports = {}
try {
  const desktop = desktopBrowser.contexts()[0].pages().find(item => item.url().startsWith('dsh-app:'))
  assert(desktop, 'Real desktop required')
  sid = await desktop.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const desktopCdp = await desktop.context().newCDPSession(desktop)
  reports['dsh-app'] = await verifyShell({ page: desktop, sid, shell: 'dsh-app', cdp: desktopCdp })
} finally {
  await desktopBrowser.close()
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const shell of ['camind', 'web']) {
    const page = await browser.newPage()
    await page.goto(entryUrl)
    if (shell === 'camind') await page.goto(`${origin}/camind/s/${encodeURIComponent(sid)}`)
    else {
      await page.goto(`${origin}/web`)
      await page.locator(`[data-row-key="session:${sid}"]`).click()
    }
    await page.waitForFunction(sid => document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') === sid, sid, { timeout: 90000 })
    const cdp = await page.context().newCDPSession(page)
    reports[shell] = await verifyShell({ page, sid, shell, cdp })
    await page.close()
  }
} finally {
  await browser.close()
}
const dir = path.resolve('.dsh/workbench-acceptance')
await fs.mkdir(dir, { recursive: true })
await fs.writeFile(path.join(dir, 'drawing-three-shells-report.json'), JSON.stringify(reports, null, 2))
console.log(`drawing three-shell acceptance: PASS (${Object.keys(reports).join(', ')})`)
