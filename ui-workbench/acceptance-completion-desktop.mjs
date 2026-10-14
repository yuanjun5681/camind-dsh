// Final live-task desktop checks: immutable actual NC package, fail-closed release, same-task feedback revision; no new NX submission.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const root = path.resolve(new URL('../', import.meta.url).pathname), sid = process.env.CAMIND_ACCEPTANCE_SESSION
assert(sid && /^session-[a-z0-9-]+$/.test(sid), 'Explicit own acceptance session required')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
try {
  const page = browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app:'))
  assert.equal(await page.locator('[data-conversation-session]').getAttribute('data-conversation-session'), sid)
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const api = () => page.evaluate(async sid => (await (await fetch('/camind/api/cam/tasks/' + sid)).json()).data, sid)
  const before = await api(); assert.match(before.goal, /验收/); assert.equal(before.active_run, null)
  const delivery = before.deliveries.at(-1); assert.equal(delivery.status, 'problem')
  const dir = path.join(root, '.dsh/cam-runs', sid, delivery.run_id, 'delivery')
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))
  for (const file of manifest.files) assert.equal(hash(await fs.readFile(path.join(dir, file.name))), file.sha256)
  const zipHash = hash(await fs.readFile(path.join(dir, 'nc_batch.zip')))
  const workspace = process.env.CAMIND_ACCEPTANCE_WORKSPACE
  assert(workspace)
  const ncFiles = await fs.readdir(path.join(workspace, 'delivery', delivery.run_id, 'nc'))
  assert.equal(ncFiles.length, 1)
  const nc = await fs.readFile(path.join(workspace, 'delivery', delivery.run_id, 'nc', ncFiles[0]), 'latin1')
  assert.match(nc, /S8000/); assert.match(nc, /F2400/)
  // T01 differs from declared machine T3: recorded as unresolved, never a verified machine-bound program.
  assert.match(nc, /T01 M06/)
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  if (!(await page.getByRole('button', { name: '交付文件', exact: true }).getAttribute('aria-pressed') === 'true')) await page.getByRole('button', { name: '交付文件', exact: true }).click()
  await page.getByRole('button', { name: '核验放行条件', exact: true }).click()
  await page.getByRole('complementary', { name: '任务资料' }).getByRole('alert').filter({ hasText: /不能生产放行/ }).waitFor()
  assert.equal((await api()).deliveries.at(-1).status, 'problem')
  await page.screenshot({ path: path.join(root, '.dsh/workbench-acceptance/blocked-release.png') })
  await page.getByRole('textbox', { name: '反馈及实测证据', exact: true }).fill('真实接口验收反馈：NC S8000/F2400已回读；NC T01与机床冻结刀位T3不一致。材料/装夹是试验假设，未完成真实刀柄与夹具/残料证明，禁止生产放行。建立下一修订做依赖失效验收，不提交新NX任务。')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '建立同任务修订', exact: true }).click()
  await page.getByRole('heading', { name: `加工任务 R${before.revision + 1}`, exact: true }).waitFor()
  const after = await api(); assert.equal(after.revision, before.revision + 1); assert.equal(after.authorization, null)
  assert.equal(after.operations.length, 0); assert.equal(after.active_run, null)
  assert.equal(after.revisions.at(-1).revision, before.revision)
  assert.equal(hash(await fs.readFile(path.join(dir, 'nc_batch.zip'))), zipHash)
  for (const file of manifest.files) assert.equal(hash(await fs.readFile(path.join(dir, file.name))), file.sha256)
  assert.equal(after.runs.length, before.runs.length, 'Feedback revision must not execute new work')
  assert.equal(errors.length, 0, errors.join('\n'))
  await fs.writeFile(path.join(root, '.dsh/workbench-acceptance/completion-report.json'), JSON.stringify({ sessionId: sid, runId: delivery.run_id, zipHash, ncFiles, spindle_readback: 8000, feed_readback: 2400, tool_number_mismatch: 'actual T01 vs frozen machine T3; unresolved', release_denied: true, immutable: true, revision: after.revision, errors }, null, 2))
  console.log(JSON.stringify({ nc: ncFiles.length, release_denied: true, immutable: true, revision: after.revision, errors }))
} finally { await browser.close() }
