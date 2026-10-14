// Formal CAM task records: immutable input blobs, CAS/OS lock, source-aware drafts, scoped confirmation and revision history.
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { readDrawing } from './drawing.js'
import { requirementDraft } from './requirement-summary.js'
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,160}$/
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const copy = value => JSON.parse(JSON.stringify(value))
const requiredSetup = ['material', 'stock', 'datum', 'fixture']
// Intake confirmation is separate from programming authorization. Missing tools,
// geometry, machines and planning inputs never become intake questions by default.
export function reviewFingerprint(task) {
  return digest({ revision: task.revision, inputs: task.inputs, requirements: task.requirements,
    questions: task.questions.filter(q => !q.scope || q.scope === 'review'),
    answers: Object.fromEntries(Object.entries(task.answers).filter(([id]) => id === 'input_pair' || task.questions.some(q => q.id === id && (!q.scope || q.scope === 'review')))) })
}
export function reviewState(task) {
  const questions = task.questions.filter(q => (!q.scope || q.scope === 'review') && !task.answers[q.id]?.resolved)
  const blockers = []
  for (const role of ['prt', 'dwg']) if (!task.inputs[role]) blockers.push(`请添加并归档 ${role.toUpperCase()} 文件`)
  if (task.inputs.dwg && (!task.drawing?.readable || task.drawing.units !== 'mm')) blockers.push('请处理图纸解析或单位问题')
  const pair = task.answers.input_pair
  if (!pair?.resolved || pair.value !== 'confirm' || pair.input_fingerprint !== digest(task.inputs)) blockers.push('请确认模型与图纸的版本和加工范围对应')
  if (!task.requirements.some(entry => !entry.stale && entry.source?.kind === 'drawing' && entry.source.sha256 === task.inputs.dwg?.sha256)) blockers.push('请先完成图纸要求整理')
  if (task.requirements.some(entry => entry.stale || (entry.source?.kind === 'drawing' && entry.source.sha256 !== task.inputs.dwg?.sha256))) blockers.push('图纸要求已变更，请重新审图')
  blockers.push(...questions.map(q => q.prompt))
  const fingerprint = reviewFingerprint(task)
  const completed = blockers.length === 0 && task.review_confirmation?.fingerprint === fingerprint
  return { status: completed ? 'complete' : Object.keys(task.inputs).length ? 'pending' : 'empty', questions, blockers, fingerprint }
}
function fail(message, code = 'TaskInvalid') { throw Object.assign(new Error(message), { code }) }
function checkId(id) { if (typeof id !== 'string' || !ID.test(id)) fail('无效会话或对象标识'); return id }
export function taskFingerprint(task) {
  return digest({ revision: task.revision, inputs: task.inputs, facts: task.facts.prt?.data_sha256, geometry: task.geometry, requirements: task.requirements, setup: task.setup, questions: task.questions, operations: task.operations, machine_id: task.machine_id, post_name: task.post_name, prepare: task.prepare })
}
export function draftBlockers(task) {
  const blockers = []
  for (const role of ['prt', 'dwg']) if (!task.inputs[role]) blockers.push(`缺少正式 ${role.toUpperCase()} 输入快照`)
  if (task.inputs.dwg && !task.drawing?.readable) blockers.push('DWG 不能完整读取标注，需处理解析错误/未知实体')
  if (task.drawing && task.drawing.units !== 'mm') blockers.push('DWG 单位不是已核实的毫米；需修正/明确转换后重新接件')
  if (!task.facts?.prt || task.facts.prt.source_sha256 !== task.inputs.prt?.sha256) blockers.push('需要 NX 读取当前 PRT 的事实')
  if (!task.geometry || task.geometry.source_sha256 !== task.inputs.prt?.sha256 || task.geometry.units !== 'mm') blockers.push('需要当前 PRT 的已校验毫米几何包')
  const pair = digest(task.inputs)
  if (task.answers.input_pair?.input_fingerprint !== pair || task.answers.input_pair?.value !== 'confirm' || task.answers.input_pair?.resolved !== true) blockers.push('PRT 与 DWG 的版本/加工范围对应关系待确认')
  for (const field of requiredSetup) {
    const entry = task.setup[field]
    if (!entry?.value || !['user', 'drawing', 'nx'].includes(entry.source?.kind) || (entry.source.kind === 'user' && (entry.source.answer_id !== field || task.answers[field]?.value !== entry.value || task.answers[field]?.resolved !== true))) blockers.push(`${{ material: '材料与状态', stock: '毛坯', datum: '定位基准', fixture: '装夹' }[field]} 缺少已确认来源`)
  }
  if (task.requirements.some(entry => entry.stale || (entry.source?.kind === 'drawing' && entry.source.sha256 !== task.inputs.dwg?.sha256))) blockers.push('要求来源已失效，需重新核对当前输入')
  for (const question of task.questions) if (question.critical && !task.answers[question.id]?.resolved) blockers.push(`待确认：${question.prompt}`)
  if (!task.machine_id) blockers.push('尚未绑定机床')
  if (!task.operations.length) blockers.push('正式工序表为空')
  return blockers
}
export function validateOperations(ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > 128) fail('工序表需包含 1–128 项')
  const seen = new Set()
  for (const [index, op] of ops.entries()) {
    checkId(op.id)
    if (seen.has(op.id)) fail(`工序 ID 重复：${op.id}`)
    if (typeof op.new_name !== 'string' || !op.new_name.includes('{suffix}')) fail(`工序 ${op.id} 缺少带 {suffix} 的 NX 名称`)
    if (!op.station || typeof op.station !== 'string') fail(`工序 ${op.id} 缺少工位`)
    if (!Array.isArray(op.depends_on) || op.depends_on.some(id => !seen.has(id))) fail(`工序 ${op.id} 依赖不存在、后置或成环；重排已拒绝`)
    if (!['nc', 'external'].includes(op.execution)) fail(`工序 ${op.id} 需明确执行方式`)
    if (!Array.isArray(op.inspection) || !op.inspection.length || op.inspection.some(value => typeof value !== 'string' || !value.trim())) fail(`工序 ${op.id} inspection 必须是非空字符串数组，例如 ["NC对账"]`)
    for (const field of ['spindle', 'feed']) if (Object.hasOwn(op, field) && (!Number.isFinite(op[field]) || op[field] <= 0)) fail(`工序 ${op.id}.${field} 必须为正数`)
    seen.add(op.id)
    op.sequence = index + 1
  }
}
export function createCamTasks({ home, resolve, machineRegistry, geometry, drawingReader = readDrawing }) {
  const root = path.join(home, 'cam-tasks')
  const dirOf = sid => path.join(root, checkId(sid))
  async function safeDir(sid, create = false) {
    const dir = dirOf(sid)
    for (const candidate of [root, dir]) {
      if (create) await fs.mkdir(candidate, { recursive: true })
      try { const stat = await fs.lstat(candidate); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('任务目录符号链接/非目录已拒绝') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return dir
  }
  const blank = sid => ({ schema: 1, session_id: sid, version: 0, revision: 1, goal: '', inputs: {}, facts: {}, drawing: null, geometry: null,
    setup: {}, machine_id: '', post_name: 'MILL_3_AXIS', prepare: {}, requirements: [], questions: [], answers: {}, operations: [],
    authorization: null, active_run: null, stop_requested: false, runs: [], deliveries: [], revisions: [], audit: [] })
  async function read(sid) {
    const dir = await safeDir(sid)
    try {
      const file = path.join(dir, 'task.json'), stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) fail('任务记录类型/大小不合法')
      const task = JSON.parse(await fs.readFile(file, 'utf8'))
      if (task.schema !== 1 || task.session_id !== sid) fail('任务记录归属/版本不符')
      return task
    } catch (error) { if (error.code === 'ENOENT') return blank(sid); throw error }
  }
  async function transact(sid, expected, actor, action, fn) {
    const dir = await safeDir(sid, true), lock = path.join(dir, '.lock')
    let acquired = false
    for (let attempt = 0; attempt < 250; attempt++) {
      try { await fs.mkdir(lock); acquired = true; await fs.writeFile(path.join(lock, 'pid'), String(process.pid)); break }
      catch (error) {
        if (error.code !== 'EEXIST') { if (acquired) await fs.rm(lock, { recursive: true, force: true }); throw error }
        let stat
        try { stat = await fs.lstat(lock) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        if (stat.isSymbolicLink() || !stat.isDirectory()) fail('任务锁目录不合法')
        try {
          const pid = Number(await fs.readFile(path.join(lock, 'pid'), 'utf8'))
          if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, 0)
        } catch (error) { if (error.code === 'ESRCH') { await fs.rm(lock, { recursive: true }); continue } }
        await new Promise(done => setTimeout(done, 20))
      }
    }
    if (!acquired) fail('任务被占用，请重试', 'TaskLocked')
    try {
      const task = await read(sid)
      if (expected !== undefined && (!Number.isInteger(expected) || expected !== task.version)) fail('任务版本已更新，请重新加载后提交', 'TaskConflict')
      await fn(task, dir)
      task.version++; task.updated_at = new Date().toISOString()
      task.audit.push({ at: task.updated_at, actor, action, version: task.version, revision: task.revision })
      const text = JSON.stringify(task, null, 2)
      if (Buffer.byteLength(text) > 4 * 1024 * 1024) fail('任务记录超限，请归档历史后继续')
      const temp = path.join(dir, `.task-${randomUUID()}.tmp`)
      try { await fs.writeFile(temp, text, { flag: 'wx', mode: 0o600 }); await fs.rename(temp, path.join(dir, 'task.json')) }
      finally { await fs.rm(temp, { force: true }) }
      return project(task)
    } finally { await fs.rm(lock, { recursive: true, force: true }) }
  }
  function idle(task) { if (task.active_run) fail('加工仍在运行或状态未知；先停止后续提交并核实 NX 状态') }
  function project(task) {
    const blockers = draftBlockers(task)
    const review = reviewState(task)
    const phase = task.active_run ? task.active_run.state === 'unknown' ? '执行状态未知' : task.stop_requested ? '停止确认中' : '执行中' : task.deliveries.at(-1)?.revision === task.revision ? task.deliveries.at(-1)?.status === 'released' ? '已放行' : '问题包待处理' : !task.operations.length ? review.status === 'complete' ? '审图完成' : review.status === 'empty' ? '待接件' : '审图待确认' : blockers.length ? '方案待补充' : task.authorization ? '已授权' : '待授权'
    const draft = requirementDraft(task), summary = task.review_confirmation?.requirement_summary
    const summaryValid = review.status === 'complete' && summary?.schema === 1 && summary.fingerprint === digest(draft)
    const requirement_summary = { draft, fingerprint: digest(draft), status: summaryValid ? 'confirmed' : summary ? 'stale' : 'unconfirmed', confirmed: summaryValid ? summary : null }
    return { ...task, review, requirement_summary, blockers, phase, fingerprint: taskFingerprint(task), operation_fingerprint: digest({ revision: task.revision, inputs: task.inputs, operations: task.operations, setup: task.setup }) }
  }
  async function inputFile(sid, role, input = null) {
    const task = await read(sid), value = input ?? task.inputs[role]
    if (!value || !/^[a-f0-9]{64}$/.test(value.sha256)) fail('正式输入不存在')
    const dir = await safeDir(sid), file = path.join(dir, `${value.sha256}.${role}`)
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) fail('输入快照类型/大小不合法')
    if (digest(await fs.readFile(file)) !== value.sha256) fail('正式输入快照已变更，拒绝复用')
    return { file, name: value.name, sha256: value.sha256 }
  }
  async function sourcesFresh(task) {
    for (const [role, input] of Object.entries(task.inputs)) {
      await inputFile(task.session_id, role, input)
      const source = await resolve(task.session_id, input.reference)
      if (digest(await fs.readFile(source.file)) !== input.sha256) fail(`${role.toUpperCase()} 来源已换版，请重新接件和审核`)
    }
  }
  async function geometryFresh(task) {
    if (!geometry) return
    const current = await geometry(task.session_id, task.inputs.prt.uri)
    if (current?.state !== 'ready' || current.geometry_sha256 !== task.geometry?.geometry_sha256 || current.manifest?.units !== 'mm') fail('几何包已换版或不可核验，请重新读取与审核')
  }
  return {
    root, async read(sid) {
      const task = await read(sid)
      if (!task.geometry && task.facts.prt && geometry) {
        const result = await geometry(sid, task.inputs.prt.uri)
        if (result?.state === 'ready' && result.manifest?.units === 'mm') return transact(sid, task.version, 'geometry', 'geometry_verified', async value => { value.geometry = { source_sha256: value.inputs.prt.sha256, geometry_sha256: result.geometry_sha256, units: 'mm' }; value.authorization = null })
      }
      return project(task)
    }, inputFile,
    async resolveInput(sid, reference) {
      const match = /^task-input:\/\/(\d+)\/(prt|dwg)$/.exec(reference)
      if (!match) fail('无效任务输入引用')
      const task = await read(sid)
      const input = +match[1] === task.revision ? task.inputs[match[2]] : task.revisions.find(revision => revision.revision === +match[1])?.inputs[match[2]]
      if (!input) fail('任务输入版本不存在')
      return inputFile(sid, match[2], input)
    },
    async collect(sid, expected, refs, exec) {
      return transact(sid, expected, 'agent-or-user', 'collect_inputs', async (task, dir) => {
        idle(task)
        if (!refs || !Object.keys(refs).length || Object.keys(refs).some(role => !['prt', 'dwg'].includes(role))) fail('只接受明确的 prt/dwg 会话引用')
        const oldPartSha = task.inputs.prt?.sha256
        for (const [role, reference] of Object.entries(refs)) {
          if (typeof reference !== 'string' || reference.length > 4096) fail('输入引用不合法')
          const resolved = await resolve(sid, reference, exec)
          if (path.extname(resolved.file).toLowerCase() !== `.${role}`) fail(`输入必须为 ${role.toUpperCase()}`)
          const handle = await fs.open(resolved.file, constants.O_RDONLY | constants.O_NOFOLLOW)
          let bytes
          try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 128 * 1024 * 1024) fail('输入非普通文件或超过 128 MiB'); bytes = await handle.readFile() }
          finally { await handle.close() }
          const sha256 = digest(bytes), file = path.join(dir, `${sha256}.${role}`)
          try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error; await inputFile(sid, role, { sha256, name: path.basename(resolved.file) }) }
          const again = await resolve(sid, reference, exec)
          if (digest(await fs.readFile(again.file)) !== sha256) fail('接件期间源文件变更，请重试')
          task.inputs[role] = { name: resolved.name ?? path.basename(resolved.file), reference: resolved.reference ?? reference, sha256, bytes: bytes.length, uri: `task-input://${task.revision}/${role}` }
          if (role === 'dwg') {
            const data = await drawingReader(file)
            const encoded = JSON.stringify(data)
            await fs.writeFile(path.join(dir, `${sha256}.drawing.json`), encoded, { mode: 0o600 })
            task.drawing = { data_sha256: digest(encoded), source_sha256: sha256, readable: data.readable, units: data.units, preview_partial: data.preview_partial, annotation_count: data.annotations.length, note: data.note }
          }
        }
        if (oldPartSha !== task.inputs.prt?.sha256) { task.facts = {}; task.geometry = null }
        task.answers = {}; task.authorization = null
        task.requirements = task.requirements.map(r => ({ ...r, stale: true }))
        task.setup = {}; task.operations = []
      })
    },
    async drawing(sid) {
      const task = await read(sid), input = await inputFile(sid, 'dwg')
      const file = path.join(await safeDir(sid), `${input.sha256}.drawing.json`), stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) fail('图纸数据类型/大小不合法')
      const encoded = await fs.readFile(file, 'utf8')
      if (digest(encoded) !== task.drawing.data_sha256) fail('图纸解析缓存已变更，需重新接件')
      return { ...JSON.parse(encoded), source_sha256: task.inputs.dwg.sha256 }
    },
    async recordSurvey(sid, sha256, data) {
      return transact(sid, undefined, 'nx', 'survey', async (task, dir) => {
        if (task.inputs.prt?.sha256 !== sha256) return
        if (!Array.isArray(data.bbox) || data.bbox.length !== 6 || !data.bbox.every(Number.isFinite) || !(data.bodies?.part_body_count > 0)) fail('NX 未返回可核验的实体/bbox')
        const json = JSON.stringify(data), hash = digest(json)
        if (Buffer.byteLength(json) > 16 * 1024 * 1024) fail('NX 事实数据超限')
        await fs.writeFile(path.join(dir, `${hash}.survey.json`), json, { mode: 0o600 })
        task.facts.prt = { source_sha256: sha256, data_sha256: hash, bbox: data.bbox, body_count: data.bodies.part_body_count, at: new Date().toISOString() }
        if (geometry) {
          const result = await geometry(sid, task.inputs.prt.uri)
          if (result?.state === 'ready' && result.manifest?.units === 'mm') task.geometry = { source_sha256: sha256, geometry_sha256: result.geometry_sha256, units: 'mm' }
        }
      })
    },
    async update(sid, expected, patch, actor = 'agent') {
      if (!['agent', 'user'].includes(actor)) fail('草案修改来源不合法')
      return transact(sid, expected, actor, 'draft', async task => {
        idle(task)
        const allowed = ['goal', 'setup', 'machine_id', 'post_name', 'prepare', 'requirements', 'questions', 'operations']
        if (!patch || Object.keys(patch).some(key => !allowed.includes(key))) fail('草案字段不合法，确认/授权/执行结果由专用操作记录')
        const before = taskFingerprint(task), oldQuestions = copy(task.questions), oldEntries = [...Object.values(task.setup), ...task.requirements]
        for (const [key, value] of Object.entries(patch)) task[key] = copy(value)
        if (typeof task.goal !== 'string' || task.goal.length > 10000) fail('任务目标不合法')
        if (task.operations.length) validateOperations(task.operations)
        if (!Array.isArray(task.questions) || task.questions.length > 128 || !Array.isArray(task.requirements) || task.requirements.length > 512) fail('问题/要求清单不合法或超限')
        for (const question of task.questions) { checkId(question.id); if ('answer' in question || !question.prompt || typeof question.critical !== 'boolean') fail('问题必须有明确文本与关键性，答案经用户操作保存'); if (question.scope && !['review', 'planning', 'system'].includes(question.scope)) fail('问题范围须为 review/planning/system') }
        if (new Set(task.questions.map(q => q.id)).size !== task.questions.length) fail('问题 ID 不能重复')
        for (const entry of [...Object.values(patch.setup ?? {}), ...patch.requirements ?? []]) {
          const source = entry.source
          if (!source || !['recommendation', 'drawing', 'nx', 'user'].includes(source.kind)) fail('事实/要求必须标明来源类别')
          if (source.kind === 'user' && !oldEntries.some(old => digest(old) === digest(entry))) fail('用户确认通过确认向导记录，不由草案工具代签')
          if (source.kind === 'nx') fail('NX 实测事实由读件工具记录，草案引用显示为建议')
          if (source.kind === 'drawing') {
            if (source.sha256 !== task.inputs.dwg?.sha256 || typeof source.entity_id !== 'string' || !source.quote) fail('图纸来源必须绑定当前 SHA、实体句柄与原文')
            const drawing = await this.drawing(sid)
            const entity = drawing.annotations.find(a => a.id === source.entity_id)
            if (!entity || !entity.text.includes(source.quote)) fail('图纸原文引用无法核验')
          }
        }
        if (taskFingerprint(task) !== before) {
          task.authorization = null
          for (const old of oldQuestions) if (!task.questions.some(q => q.id === old.id && digest(q) === digest(old))) delete task.answers[old.id]
        }
      })
    },
    async answer(sid, expected, id, value, resolved = true) {
      return transact(sid, expected, 'user', 'answer', async task => {
        idle(task); checkId(id)
        if (id !== 'input_pair' && !requiredSetup.includes(id) && !task.questions.some(q => q.id === id)) fail('问题不存在')
        if (typeof value !== 'string' || !value.trim() || value.length > 10000) fail('请输入明确回答；暂不确定须保留未决状态')
        if (resolved && (value.trim() === '暂不确定' || (id === 'input_pair' && value !== 'confirm'))) fail('尚未确认，不能记录为已解决')
        task.answers[id] = { value, resolved: resolved === true, at: new Date().toISOString(), input_fingerprint: digest(task.inputs) }
        if (requiredSetup.includes(id) && resolved) task.setup[id] = { value, source: { kind: 'user', answer_id: id, input_fingerprint: digest(task.inputs) } }
        task.authorization = null
      })
    },
    async finishReview(sid, expected, fingerprint, requirementIds) {
      return transact(sid, expected, 'user', 'finish_review', async task => {
        idle(task); await sourcesFresh(task)
        const review = reviewState(task)
        if (review.fingerprint !== fingerprint) fail('审图内容已变更，请核对最新内容', 'TaskConflict')
        if (review.blockers.length) fail(review.blockers.join('；'))
        const draft = requirementDraft(task)
        let requirement_summary
        if (requirementIds !== undefined) {
          if (!Array.isArray(requirementIds) || !requirementIds.length || new Set(requirementIds).size !== requirementIds.length || requirementIds.some(id => !draft.some(item => item.id === id))) fail('请勾选当前清单中的加工要求', 'TaskConflict')
          requirement_summary = { schema: 1, fingerprint: digest(draft), items: draft.filter(item => requirementIds.includes(item.id)) }
        }
        task.review_confirmation = { fingerprint, revision: task.revision, at: new Date().toISOString(), ...(requirement_summary ? { requirement_summary } : {}) }
      })
    },
    async authorize(sid, expected, fingerprint, bounds = {}) {
      return transact(sid, expected, 'user', 'authorize', async task => {
        idle(task); await sourcesFresh(task)
        if (fingerprint !== taskFingerprint(task)) fail('审核对象已经变更，请重新查看', 'TaskConflict')
        const blockers = draftBlockers(task)
        if (blockers.length) fail(blockers.join('；'))
        await geometryFresh(task)
        const machine = machineRegistry.snapshot(task.machine_id)
        validateOperations(task.operations)
        if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) fail('自主调整范围必须是对象')
        for (const [id, fields] of Object.entries(bounds)) {
          const op = task.operations.find(op => op.id === id)
          if (!op) fail('自动调整范围引用未知工序')
          if (op.type !== 'from_scratch_workpiece_op') fail('模板复制暂不应用转速/进给调整，不能授予自动调整范围')
          if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('工序调整范围必须是对象')
          for (const [field, range] of Object.entries(fields)) if (!Number.isFinite(op[field]) || !Array.isArray(range) || op[field] < range[0] || op[field] > range[1]) fail('当前工序参数必须存在且位于授权区间内')
          for (const [field, range] of Object.entries(fields)) if (!['spindle', 'feed'].includes(field) || !Array.isArray(range) || range.length !== 2 || !range.every(n => Number.isFinite(n) && n > 0) || range[0] > range[1]) fail('自主调整只接受明确的转速/进给正数区间')
        }
        for (const fields of Object.values(bounds)) for (const [field, [min, max]] of Object.entries(fields)) {
          const cap = field === 'spindle' ? machine.spindle?.rpm_max : machine.kinematics?.max_cut_feed_mm_min
          const floor = field === 'spindle' ? machine.spindle?.rpm_min : 0
          if (!Number.isFinite(cap) || max > cap || min < (floor ?? 0)) fail('自主调整区间超出机床约束或机床上限未知')
        }
        task.authorization = { at: new Date().toISOString(), fingerprint, inputs: copy(task.inputs), operations: copy(task.operations), setup: copy(task.setup), requirements: copy(task.requirements), prepare: copy(task.prepare), machine_id: task.machine_id, post_name: task.post_name, machine_sha256: digest(machine), bounds: copy(bounds), revision: task.revision }
        task.stop_requested = false
      })
    },
    async assertAuthorized(sid, ops = null) {
      const task = await read(sid), auth = task.authorization
      if (!auth || auth.revision !== task.revision) fail('需要先在确认向导审核并授权当前方案')
      await sourcesFresh(task)
      if (taskFingerprint(task) !== auth.fingerprint) fail('当前事实/方案已变更，需重新审核')
      await geometryFresh(task)
      if (task.stop_requested) fail('已请求停止后续加工提交；等待在途 NX 调用返回')
      if (digest(machineRegistry.snapshot(task.machine_id)) !== auth.machine_sha256) fail('机床/刀库档案已换版，需重新审核')
      const proposed = copy(ops ?? task.operations), frozen = copy(auth.operations)
      if (proposed.length !== frozen.length) fail('工序数量改变，需重新授权')
      for (let index = 0; index < proposed.length; index++) {
        const left = proposed[index], right = frozen[index]
        for (const [field, range] of Object.entries(auth.bounds[right.id] ?? {})) {
          if (!Number.isFinite(left[field]) || left[field] < range[0] || left[field] > range[1]) fail(`${right.id}.${field} 超出授权范围`)
          delete left[field]; delete right[field]
        }
        if (!isDeepStrictEqual(left, right)) fail('加工对象/方法/刀具/工位/依赖改变，需重新授权')
      }
      return task
    },
    async assertJob(sid, job) {
      const task = await this.assertAuthorized(sid, job.operations)
      if (job.formal_task?.revision !== task.revision || job.formal_task?.authorization !== task.authorization.fingerprint || job.machine_context?.machine_instance_id !== task.machine_id || job.post_name !== task.post_name || !isDeepStrictEqual(job.prepare ?? {}, task.prepare ?? {}) || job.prt_sha256 !== task.inputs.prt.sha256) fail('执行批次的输入/机床/后处理/初始化与冻结方案不符')
      const input = await inputFile(sid, 'prt')
      if (job.prt_local !== input.file) fail('执行必须使用当前正式输入快照')
      return task
    },
    async assertRun(sid, runId, job) {
      const task = await this.assertJob(sid, job)
      const record = task.runs.find(run => run.id === runId)
      if (!record || record.revision !== task.revision || record.job_sha256 !== digest(job) || record.authorization !== task.authorization.fingerprint) fail('执行批次未绑定当前冻结方案')
      return task
    },
    async bindRun(sid, runId, job) {
      const task = await this.assertJob(sid, job)
      return transact(sid, task.version, 'system', 'bind_run', async value => { value.runs.push({ id: checkId(runId), revision: value.revision, job_sha256: digest(job), authorization: value.authorization.fingerprint }) })
    },
    async beginRun(sid, runId, job) {
      const task = await this.assertRun(sid, runId, job)
      return transact(sid, task.version, 'system', 'begin_run', async value => {
        idle(value)
        const record = value.runs.find(run => run.id === runId)
        if (!record || record.job_sha256 !== digest(job) || record.authorization !== value.authorization.fingerprint) fail('执行批次未绑定当前冻结方案')
        value.active_run = { id: runId, at: new Date().toISOString(), state: 'running' }
      })
    },
    async finishRun(sid, runId, result, unknown = false) {
      return transact(sid, undefined, 'system', 'finish_run', async task => {
        if (task.active_run?.id !== runId) fail('执行批次归属不符')
        if (unknown) task.active_run.state = 'unknown'
        else { task.active_run = null; task.stop_requested = false }
        const run = task.runs.find(run => run.id === runId)
        if (run) run.result = { overall: result.overall ?? 'error', reason: result.reason ?? result.error?.msg ?? '', at: new Date().toISOString() }
      })
    },
    async recordDelivery(sid, runId, manifest) {
      return transact(sid, undefined, 'system', 'problem_package', async task => {
        idle(task)
        const run = task.runs.find(run => run.id === runId)
        if (!run || run.revision !== task.revision) fail('交付批次不属于当前任务修订')
        if (task.deliveries.some(item => item.run_id === runId)) fail('该批次交付记录已经冻结')
        task.deliveries.push({ run_id: runId, revision: task.revision, status: 'problem', at: new Date().toISOString(), ...copy(manifest) })
      })
    },
    async release(sid, expected, runId) {
      return transact(sid, expected, 'user', 'release', async task => {
        idle(task); await sourcesFresh(task)
        const delivery = task.deliveries.find(item => item.run_id === runId && item.revision === task.revision)
        if (!delivery) fail('当前修订没有可审核的交付包')
        fail(`不能生产放行：${delivery.blockers.join('；')}。人工确认不替代缺失的检查证据。`)
      })
    },
    async validateReference(sid, reference) {
      if (reference?.session_id !== sid || !Array.isArray(reference.ids) || reference.ids.length < 1 || reference.ids.length > 100 || reference.ids.some(id => typeof id !== 'string')) fail('对象引用归属/标识不合法')
      const task = await read(sid)
      await sourcesFresh(task)
      if (reference.kind === 'drawing') {
        if (reference.source_sha256 !== task.inputs.dwg?.sha256) fail('图纸已换版，请重新选择标注')
        const data = await this.drawing(sid)
        const entities = reference.ids.map(id => data.annotations.find(entity => entity.id === id))
        if (entities.some(entity => !entity)) fail('图纸标注不存在，请重新选择')
        return { ...reference, entities: entities.map(({ id, type, text, nominal, layer }) => ({ id, type, text, nominal, layer })) }
      }
      if (reference.kind !== 'operation' || reference.revision !== task.revision || reference.plan_sha256 !== project(task).operation_fingerprint) fail('工序方案已变更，请重新选择工序')
      const operations = reference.ids.map(id => task.operations.find(op => op.id === id))
      if (operations.some(op => !op)) fail('工序已删除，请重新选择')
      return { ...reference, operations }
    },
    async stop(sid, expected) { return transact(sid, expected, 'user', 'request_stop', async task => { if (!task.active_run) fail('没有正在执行的批次'); task.stop_requested = true }) },
    async revise(sid, expected, feedback) {
      return transact(sid, expected, 'user', 'revision', async task => {
        idle(task)
        if (typeof feedback !== 'string' || !feedback.trim() || feedback.length > 10000) fail('请输入反馈与实测证据，不直接推断原因')
        task.revisions.push({ revision: task.revision, inputs: copy(task.inputs), requirements: copy(task.requirements), setup: copy(task.setup), operations: copy(task.operations), authorization: copy(task.authorization), feedback, at: new Date().toISOString() })
        task.revision++; task.authorization = null; task.answers = {}; task.setup = {}; task.operations = []
        task.requirements = task.requirements.map(r => ({ ...r, stale: true }))
        for (const [role, input] of Object.entries(task.inputs)) input.uri = `task-input://${task.revision}/${role}`
      })
    },
  }
}
