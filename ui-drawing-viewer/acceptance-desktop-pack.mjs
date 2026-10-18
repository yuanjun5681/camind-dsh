// M2-06 live dsh-app:// pack-job acceptance: real routes, cache identity, SHA and rendering.
// Uses the current frozen DWG task input; no uploads, model/NX calls or formal-task writes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
try {
  const page = browser.contexts()[0].pages().find(item => item.url().startsWith('dsh-app:'))
  assert(page, 'A real dsh-app:// desktop page is required')
  const sid = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  const task = () => page.evaluate(async sid => (await (await fetch(`/camind/api/cam/tasks/${sid}`)).json()).data, sid)
  const before = await task()
  assert(before.inputs.dwg?.uri, 'Select an existing task with a frozen DWG input')
  assert(!before.inputs.prt, 'Use a DWG-only task so opening the workbench cannot start model/NX geometry generation')
  const base = `/camind/api/drawings/sessions/${encodeURIComponent(sid)}/packs`
  const sourceUri = before.inputs.dwg.uri
  const started = await page.evaluate(async ({ base, sourceUri }) => {
    const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: sourceUri }) })
    return { status: response.status, body: await response.json() }
  }, { base, sourceUri })
  assert.equal(started.status, 202, JSON.stringify(started.body))
  const jobId = started.body.jobId
  assert(jobId, 'Pack preparation must return a jobId')
  let ready
  for (let i = 0; i < 360; i++) {
    const job = await page.evaluate(async ({ base, jobId }) => (await (await fetch(`${base}/${jobId}/status`)).json()), { base, jobId })
    if (job.state === 'error') throw new Error(job.error?.message || 'Desktop pack conversion failed')
    if (job.state === 'ready') { ready = job; break }
    await page.waitForTimeout(250)
  }
  const key = ready?.result?.key
  assert(key, 'Pack job did not become ready with an identity')
  const fetched = await page.evaluate(async ({ base, key, sourceUri }) => {
    const response = await fetch(`${base}/${key}?path=${encodeURIComponent(sourceUri)}`)
    return { status: response.status, cacheControl: response.headers.get('cache-control'), packSha256: response.headers.get('x-pack-sha256'), body: await response.json() }
  }, { base, key, sourceUri })
  assert.equal(fetched.status, 200, JSON.stringify(fetched.body))
  assert.equal(fetched.cacheControl, 'no-store')
  const actualSha = createHash('sha256').update(Buffer.from(fetched.body.packText, 'utf8')).digest('hex')
  assert.equal(fetched.packSha256, actualSha)
  assert.equal(fetched.body.pack.sha256, actualSha)
  assert.equal(fetched.body.pack.identity, key)
  assert.equal(fetched.body.source.uri, sourceUri)
  assert.equal(fetched.body.source.sha256, before.inputs.dwg.sha256)
  const pack = JSON.parse(fetched.body.packText)
  assert(pack.entities.length > 0 && pack.dims.length > 0)
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  await page.getByRole('button', { name: 'CAD 图纸', exact: true }).click()
  const canvas = page.locator('.wb-preview-stage:not([hidden]) .cdv-canvas')
  await canvas.waitFor({ timeout: 90000 })
  await page.waitForFunction(() => Boolean(document.querySelector('.wb-preview-stage:not([hidden]) .cdv-canvas')?.dataset.camera), null, { timeout: 90000 })
  assert.deepEqual(await task(), before, 'Read-only pack preparation must not mutate the formal task')
  const report = { real_desktop: true, job_lifecycle: ['202', 'ready', 'GET'], cache_control: 'no-store', pack_sha256_verified: true, source_sha256_verified: true, entities: pack.entities.length, dims: pack.dims.length, rendered: true, formal_task_unchanged: true, scope: 'Frozen task-input:// DWG; derived cache only; no uploads/model/NX/task writes.' }
  const dir = path.resolve('.dsh/workbench-acceptance')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'drawing-host-desktop-report.json'), JSON.stringify(report, null, 2))
  console.log(`drawing desktop pack acceptance: PASS (${JSON.stringify(report)})`)
} finally {
  await browser.close()
}
