// Live desktop acceptance: copied user-approved PRT/DWG, native Agent tools and configured NX; never touch source bytes.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const root = path.resolve(new URL('../', import.meta.url).pathname)
const evidence = path.join(root, '.dsh/workbench-acceptance')
const sources = { prt: process.env.CAMIND_ACCEPTANCE_PRT || path.resolve(root, '../测试文件/zm26030-704/zm26030-704_stp.prt'), dwg: process.env.CAMIND_ACCEPTANCE_DWG || path.resolve(root, '../测试文件/zm26030-704/ZM26030-704.dwg') }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const originalSha = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([role, file]) => [role, sha(await fs.readFile(file))])))
const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
const context = browser.contexts()[0]
const page = context.pages().find(page => page.url().startsWith('dsh-app:')) ?? await context.waitForEvent('page', { timeout: 60000 })
await page.waitForURL('dsh-app://**', { timeout: 60000 })
const errors = []; page.on('pageerror', e => errors.push(e.message))
let sessionId, cwd, fixture, task
try {
  const originalId = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  assert.equal((await page.locator('[contenteditable="true"]').first().innerText()).trim(), '')
  await page.getByText('新会话', { exact: true }).click()
  await page.waitForFunction(id => document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') !== id, originalId)
  sessionId = await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')
  let sessionDir
  for (const entry of await fs.readdir(path.join(root, '.dsh/sessions'), { withFileTypes: true })) if (entry.isDirectory()) {
    const candidate = path.join(root, '.dsh/sessions', entry.name, sessionId)
    if (await fs.stat(candidate).then(s => s.isDirectory()).catch(() => false)) { sessionDir = candidate; break }
  }
  assert(sessionDir)
  const log = (await fs.readdir(sessionDir)).find(name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name))
  const raw = log.endsWith('.zstd') ? (await promisify(execFile)('zstd', ['-dc', path.join(sessionDir, log)], { maxBuffer: 16 * 1024 * 1024 })).stdout : await fs.readFile(path.join(sessionDir, log), 'utf8')
  const header = JSON.parse(raw.split('\n')[0]); cwd = header.cwd ?? header.data?.cwd ?? header.header?.cwd
  assert(typeof cwd === 'string')
  fixture = path.join(cwd, `.cam-nx-acceptance-${Date.now()}`)
  await fs.mkdir(fixture)
  for (const [role, source] of Object.entries(sources)) await fs.copyFile(source, path.join(fixture, `source.${role}`))
  const api = (action, body) => page.evaluate(async ({ sid, action, body }) => {
    const res = await fetch(`/camind/api/cam/tasks/${sid}${action ? `/${action}` : ''}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    return { status: res.status, body: await res.json() }
  }, { sid: sessionId, action, body })
  let response = await api('')
  assert.equal(response.body.data.version, 0, 'Refuse to reuse an existing formal task')
  response = await api('collect', { version: 0, inputs: { prt: `${path.basename(fixture)}/source.prt`, dwg: `${path.basename(fixture)}/source.dwg` } })
  assert.equal(response.status, 200, response.body.message)
  task = response.body.data
  for (const role of ['prt', 'dwg']) assert.equal(task.inputs[role].sha256, originalSha[role])
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.fill('这是经过用户授权的真实 NX 接口验收，不是生产放行。请调用 cam_survey，part 为 task-input://1/prt，读取当前正式零件；再调用 read_drawing 读取前20条图纸标注。只读件审图，不创建或执行工序，不调用 cam_plan/cam_run/cam_deliver。最后简要报告实体、尺寸、单位与缺失信息。')
  await editor.press('Enter')
  await page.getByRole('tab', { name: '工作台', exact: true }).click()
  await page.locator('.wb-agent').waitFor({ timeout: 30000 })
  await page.locator('.wb-agent').waitFor({ state: 'detached', timeout: 300000 })
  response = await api(''); task = response.body.data
  assert(task.facts.prt, 'Native Agent must persist real NX survey facts')
  assert.equal(task.facts.prt.source_sha256, originalSha.prt)
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  if (!(await page.getByRole('heading', { name: '核对本次审图结果', exact: true }).count())) await page.getByRole('button', { name: '继续处理', exact: true }).click()
  await page.getByRole('heading', { name: '核对本次审图结果', exact: true }).waitFor()
  await page.screenshot({ path: path.join(evidence, 'nx-live.png') })
  // Complete workflow is explicit opt-in: it submits real work-copy NX programming and auto-signs test-only scope.
  if (process.env.CAMIND_ACCEPTANCE_FULL === '1') {
    const submit = async prompt => {
      await page.getByRole('tab', { name: '工作台', exact: true }).click()
      await editor.fill(prompt + ' 仅调用相关CAM/机床/job工具，不扫描源码、不修改代码或原件。')
      await editor.press('Enter'); await page.locator('.wb-agent').waitFor({ timeout: 30000 })
      await page.locator('.wb-agent').waitFor({ state: 'detached', timeout: 360000 })
    }
    await page.getByRole('button', { name: '查看正式 PRT', exact: true }).click()
    const generate = page.getByRole('button', { name: '确认并生成三维预览', exact: true })
    const readyPreview = page.locator('.cmv-footer').filter({ hasText: /\d+ 面/ })
    await generate.or(readyPreview).first().waitFor({ timeout: 30000 })
    if (await generate.isVisible()) await generate.click()
    await readyPreview.waitFor({ timeout: 240000 })
    console.log('full acceptance: NX geometry ready')
    task = (await api('')).body.data; assert(task.geometry)
    for (const [id, value] of Object.entries({ input_pair: 'confirm', material: '验收假设 AL6061，不是生产材料', stock: '验收虚拟包围盒毛坯，不是实际来料', datum: '验收默认初始化坐标系，未物理核验', fixture: '验收虚拟装夹，无真实夹具，禁止生产放行' })) {
      response = await api('answer', { version: task.version, id, value, resolved: true }); assert.equal(response.status, 200, response.body.message); task = response.body.data
    }
    const post = process.env.CAMIND_ACCEPTANCE_POST
    assert(post, 'Full test requires a known registered NX post name (not machine display name)')
    await submit(`加载cam-machining skill，cam_task read和read_machine VMC-HJ-01；只用cam_task update保存接口验收草案：一道from_scratch_workpiece_op，id=accept-rough，new_name=ACCEPT_ROUGH_{suffix}，station=TEST_MAIN，execution=nc，depends_on=[]，inspection=["NC对账","仅验收问题包禁止生产"]；geometry=FS_WORKPIECE，parent=MCS_MAIN，tool=AP_MILL_D10，tool_assembly_id=END_MILL_D10_ROUGH，spindle=8000，feed=2400；machine_id=VMC-HJ-01，post_name=${post}，prepare={init_setup:{tool_diameter:10,ensure_tool:true}}。goal明确真实NX接口验收、单次开粗、材料装夹为验收假设。暂不执行，等待界面审核。`)
    task = (await api('')).body.data
    for (const question of task.questions.filter(q => q.prompt.includes('后处理') && q.prompt.includes(post) && !task.answers[q.id]?.resolved)) {
      response = await api('answer', { version: task.version, id: question.id, value: `接口验收明确采用已注册 ${post}；仅核对接口名称，生产资格仍为DRAFT，不作放行证据`, resolved: true }); assert.equal(response.status, 200, response.body.message); task = response.body.data
    }
    assert.equal(task.operations.length, 1); assert.equal(task.blockers.length, 0, task.blockers.join('；'))
    console.log('full acceptance: draft ready for native review')
    const postpone = page.getByRole('button', { name: '保存并稍后继续', exact: true }); if (await postpone.count()) await postpone.click()
    await page.getByRole('button', { name: '工序方案', exact: true }).click()
    await page.getByRole('button', { name: '审核并确认方案', exact: true }).click()
    await page.getByText('我已核对当前冻结版本和上述范围', { exact: true }).click()
    await page.getByRole('button', { name: '确认方案', exact: true }).click()
    await page.getByRole('heading', { name: /正式工序草案/ }).waitFor()
    await submit(`界面已签字验收方案。cam_task read，完整原样operations包括sequence/parent/inspection，cam_plan part=task-input://1/prt part_id=ZM26030_704_FULL_TEST，然后cam_run并用job_output等待终态；尚不交付。`)
    task = (await api('')).body.data
    const run = task.runs.at(-1); assert.equal(run.result.overall, 'ok', JSON.stringify(run.result))
    const state = JSON.parse(await fs.readFile(path.join(root, '.dsh/cam-runs', sessionId, run.id, 'runstate.json'), 'utf8'))
    assert.equal(state.ops.filter(op => op.status === 'ok').length, 1)
    await editor.fill(`只调用cam_deliver打包 ${run.id}，note写仅验收问题包禁止生产。开发者确认本次打包，不修订，不做生产放行。`)
    await editor.press('Enter')
    const approval = page.getByRole('button', { name: '允许一次', exact: true }); await approval.waitFor({ timeout: 90000 })
    assert.match(await page.locator('[data-conversation-content]').innerText(), /问题包打包确认/)
    await approval.click(); await page.locator('.wb-agent').waitFor({ state: 'detached', timeout: 180000 })
    task = (await api('')).body.data; const delivery = task.deliveries.at(-1)
    assert.equal(delivery.package_kind, 'problem'); assert.equal(delivery.status, 'problem')
    const dir = path.join(root, '.dsh/cam-runs', sessionId, run.id, 'delivery')
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))
    for (const item of manifest.files) assert.equal(sha(await fs.readFile(path.join(dir, item.name))), item.sha256)
    const zipSha = sha(await fs.readFile(path.join(dir, 'nc_batch.zip')))
    assert(manifest.nc_audit[0].spindleFound); assert(manifest.nc_audit[0].feedFound)
    await page.getByRole('button', { name: '交付文件', exact: true }).click()
    await page.getByRole('button', { name: '核验放行条件', exact: true }).click()
    await page.getByRole('complementary', { name: '任务资料' }).getByRole('alert').filter({ hasText: /不能生产放行/ }).waitFor()
    await page.getByRole('textbox', { name: '反馈及实测证据', exact: true }).fill('接口验收反馈：NC已回收、参数已回读，刀号与夹具/刀柄/残料证明仍未核实；建立下一修订，不执行新NX任务。')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: '建立同任务修订', exact: true }).click()
    await page.getByRole('heading', { name: '加工任务 R2', exact: true }).waitFor()
    task = (await api('')).body.data; assert.equal(task.revision, 2); assert.equal(task.authorization, null); assert.equal(task.operations.length, 0)
    assert.equal(sha(await fs.readFile(path.join(dir, 'nc_batch.zip'))), zipSha)
    await fs.writeFile(path.join(evidence, 'nx-full-report.json'), JSON.stringify({ sessionId, runId: run.id, state, manifest, zipSha, revision: task.revision, errors, originalSha }, null, 2))
  }
  await fs.writeFile(path.join(evidence, 'nx-live-report.json'), JSON.stringify({ sessionId, cwd, fixture, originalSha, task, errors, scope: process.env.CAMIND_ACCEPTANCE_FULL === '1' ? 'Native full test: single NX roughing work-copy, immutable problem package and denied release/revision; not production' : 'Live native survey and drawing; no programming' }, null, 2))
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(JSON.stringify({ sessionId, fixture, bodies: task.facts.prt.body_count, annotations: task.drawing.annotation_count, geometry: task.geometry, errors }))
} finally {
  for (const [role, source] of Object.entries(sources)) assert.equal(sha(await fs.readFile(source)), originalSha[role], 'Source bytes must be preserved')
  await browser.close()
}
