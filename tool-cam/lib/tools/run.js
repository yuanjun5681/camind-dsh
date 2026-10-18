// cam_run 模型工具 v1 —— 工序单的远程执行 + 断点续跑 + 最小机器自检。
//
// 执行语义移植自旧 Camind backend/app/services/cam/ops.py 与
// flows/cam_job/flow.py（详见各函数注释），契约以旧 Camind
// docs/nx_endpoint_contract_v1.md 为准：
//   1. work copy：主模型复制为 <stem>_work_<suffix>.prt 再加工，主模型永不
//      被写；复制失败即中止，不静默退回直写主模型；
//   2. prepare：job.json 带 prepare.init_setup 时 /cam_init_setup 建 CAM setup
//      （裸件引导；件内已有 setup 的模板复制路线不需要）；
//   3. 逐 op 判读四终态：ok（NC 在盘）/ generated（有刀路缺 NC，续跑只补
//      post）/ empty（空刀路，fail-closed 需人看工艺）/ error；每 op 完成
//      （含失败）原子更新 runstate.json（tmp+rename）；
//   4. suffix 首次执行定格进 runstate；resume=true 时 job.json 内容指纹
//      （sha256 前 16 位）不符即拒绝——工序单变了不能吃旧刀路；
//   5. 收尾自检（v1 最小集合）：out_dir 实数 NC vs 期望对账 + 空刀路
//      fail-closed；翻面验证/特征核对属后续迭代（设计稿 §4.1）；
//   6. 汇总 fail-closed（旧 overall_action）：有 error → error；有工序缺 NC
//      或空刀路 → incomplete（拒绝放行，可续跑补齐）；全 ok 且对账一致 → ok。
//   7. 过程时间线：每条阶段事件带时间戳 append 进 runstate.history（随 runstate
//      原子落盘，resume 续跑往后追加如实记录多轮），op 记录 started_at/
//      finished_at/timeout_seconds，收尾 check 结论落 state.check——工作台
//      「加工」页签时间线的数据源（会话事件重启拒绝重载，run 目录才是事实源）。
//
// v1 支持的 op 类型：copy_postprocess（/cam_copy_postprocess）与
// from_scratch_workpiece_op（/cam_build_workpiece_op + /postprocess 补 NC）；
// face_select_generate / tap_holes 落 error 终态「v1 不支持该类型」。
//
// 后台执行：整条流程包进 ctx.jobs 后台任务（kind cam-run），工具立即返回
// {status:'accepted', job_id}，完成时平台自动叫醒模型，job_output 可读最终
// 汇总；jobs 服务不可用时退化同步执行。过程时间线落 runstate.history（见上）；
// 不写会话事件——dsh-session-persistence 拒绝重载含未知且未标 ignorable 事件
// 类型的会话（append() 无 ignorable 形参、0.1.1-rc.2 无注册面），cam/* 会话
// 事件（cam/stage、cam/check-report）已于 2026-08-26 实证事故后停发。
//
// 高风险声明核对不在这里——见 lib/gate.js 的 tools/pre-execute 闸门（本工具
// 被执行即说明闸门已放行）。

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { resolveRunDir } from '../gate.js'
import { safeSessionId } from './survey.js'

// ---- op 四终态与续跑决策（ops.py:31-35 / flow.py:488-502） --------------------
const OP_OK = 'ok' // 刀路已生成且 NC 在盘上
const OP_GENERATED = 'generated' // 刀路已生成但 NC 未出（续跑只补 post）
const OP_EMPTY = 'empty' // 空刀路（fail-closed，需人看工艺）
const OP_ERROR = 'error'

// 单序超时（ops.py:64-126）：显式 timeout_seconds 永远优先；整件级序（切削区
// 不是特征局部，或干脆没有 cut_area——「不是局部就是整件」）给 1800，其余 300。
const OP_TIMEOUT_DEFAULT = 300
const OP_TIMEOUT_WHOLE_PART = 1800
const FEATURE_LOCAL_CUT_AREA_PREFIXES = ['contour:', 'wall:', 'cyl_band:', 'trim:', 'planar_at:']
const WORKPIECE_TYPES = new Set([
  'from_scratch_workpiece_op', 'rough', 'rough_rest', 'semi_finish', 'finish', 'bore_mill',
])

// from_scratch_workpiece_op 的参数白名单（ops.py _from_scratch；桥白名单外的
// 键静默丢弃是旧项目事故源，这里显式枚举）。nx_type → worker 的 type 键。
const FROM_SCRATCH_KEYS = [
  'geometry', 'parent', 'subtype', 'program', 'method', 'tool', 'z_offset',
  'cut_area', 'spindle', 'feed', 'depth_per_cut', 'part_stock', 'floor_stock',
  'stepover', 'steep_depth', 'engage_mode', 'nonsteep_pattern', 'steep_pattern',
  'level_to_level', 'ipw', 'reference_tool', 'flip_clear_abs_z', 'blank_band',
]

function json(payload) {
  return JSON.stringify(payload, null, 2)
}

// job.json 内容指纹（原文 sha256 前 16 位）：resume 防旧刀路的判据。
export function fingerprintOfJob(raw) {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

export function generateSuffix() {
  return randomBytes(4).toString('hex')
}

// 主模型 → 同目录 <stem>_work_<suffix>.prt（ops.py work_copy_path）。
export function workCopyPathOf(prt, suffix) {
  const slash = prt.lastIndexOf('/')
  const dir = slash >= 0 ? prt.slice(0, slash + 1) : ''
  const base = slash >= 0 ? prt.slice(slash + 1) : prt
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return `${dir}${stem}_work_${suffix}.prt`
}

export function opTimeoutOf(op) {
  const explicit = Number(op?.timeout_seconds)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  if (op?.blank_band !== undefined && op?.blank_band !== null) return OP_TIMEOUT_WHOLE_PART
  if (!WORKPIECE_TYPES.has(op?.type)) return OP_TIMEOUT_DEFAULT
  const cutArea = op?.cut_area
  if (typeof cutArea === 'string' && cutArea.trim()) {
    return FEATURE_LOCAL_CUT_AREA_PREFIXES.some((p) => cutArea.startsWith(p))
      ? OP_TIMEOUT_DEFAULT
      : OP_TIMEOUT_WHOLE_PART
  }
  return OP_TIMEOUT_WHOLE_PART // 没有切削区限制 ⇒ 整件
}

// postprocess data.files[name] → NC 路径；worker 用 'error:...' 字符串表失败。
export function ncOf(postData, name) {
  const files = postData?.files ?? {}
  const val = files?.[name]
  if (typeof val === 'string' && !val.startsWith('error:')) return { nc: val }
  return { nc: null, postError: typeof val === 'string' ? val : null }
}

// 创建/生成类端点的平坦/嵌套响应 → {created, path_exists, toolpath_length, error}
// （ops.py _created_metrics：op 段优先、ipw 段回退、committed 兜底；
// created 缺字段 = undefined，调用方 fail-closed「判不出」）。
export function createdMetricsOf(data) {
  const opSeg = data?.op && typeof data.op === 'object' ? data.op : null
  const metrics = opSeg ?? data ?? {}
  const ipw = data?.ipw
  let source = metrics
  if (ipw && typeof ipw === 'object' && ipw.generated && !metrics.generated) source = ipw
  const pathExists = source.path_exists ?? data?.path_exists
  const toolpathLength = source.toolpath_length ?? data?.toolpath_length
  let created
  if (opSeg && 'created' in opSeg) created = opSeg.created
  else if (data && 'created' in data) created = data.created
  else if (data && 'committed' in data) created = data.committed
  else created = undefined
  const error = data?.error
    ?? (typeof metrics.error === 'string' ? metrics.error : undefined)
    ?? data?.commit_error ?? data?.generate_error
  // created 判不出时把 worker 诊断带出来（如 _create_workpiece_group 早退的
  // group 段：parent_found/error），别让 fail-closed 吃掉真因。
  let detail
  if (created === undefined) {
    const group = data?.group
    if (group && typeof group === 'object') {
      detail = typeof group.error === 'string' ? group.error : undefined
      if (!detail && group.parent_found === false) detail = `父组 ${group.parent_name ?? '?'} 未找到`
    }
    if (!detail) detail = `worker 返回键：${Object.keys(data ?? {}).join(', ') || '(空)'}`
  }
  return { created, path_exists: pathExists, toolpath_length: toolpathLength, error, detail }
}

function normalizeRegeneration(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeRegeneration)
  if (typeof value === 'string') return value.trim() ? [{ operation: value.trim() }] : []
  if (value && typeof value === 'object') {
    if (Array.isArray(value.operations)) return normalizeRegeneration(value.operations)
    if (Object.keys(value).length === 0) return []
    const operation = typeof value.operation === 'string' && value.operation.trim() ? value.operation.trim()
      : typeof value.tool === 'string' && value.tool.trim() ? value.tool.trim() : '未知工序'
    const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : undefined
    return [{ operation, ...(reason ? { reason } : {}) }]
  }
  return value ? [{ operation: '未知工序' }] : []
}

// 执行与交付共用同一份归一化：上游当前返回名称数组/对象数组；异常形态也只
// 能向 fail-closed 收敛，不能把布尔、字符串或 null 直接展开进交付逻辑。
export function regenerationItemsOf(op) {
  const items = [
    ...normalizeRegeneration(op?.other_operations_pending_regeneration),
    ...normalizeRegeneration(op?.regeneration_required),
    ...normalizeRegeneration(op?.error_detail?.regeneration_required),
  ]
  const seen = new Set()
  return items.filter((item) => {
    const key = JSON.stringify([item.operation, item.reason ?? null])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasPendingRegeneration(op) {
  return regenerationItemsOf(op).length > 0
}

function t501FieldsOf(data, errorDetail) {
  const detail = errorDetail ?? data?.error_detail ?? data?.errorDetail
  return {
    ...(data?.regenerated_operations !== undefined ? { regenerated_operations: data.regenerated_operations } : {}),
    ...(data?.other_operations_pending_regeneration !== undefined ? { other_operations_pending_regeneration: data.other_operations_pending_regeneration } : {}),
    ...(data?.regeneration_required !== undefined ? { regeneration_required: data.regeneration_required } : {}),
    ...(data?.tool_numbers_fixed !== undefined ? { tool_numbers_fixed: data.tool_numbers_fixed } : {}),
    ...(detail !== undefined ? { error_detail: detail } : {}),
  }
}

// 续跑决策（flow.py:488-502）：ok 跳过、generated 只补 post、其余重跑；T-501
// 待重算不是普通 generated，未授权恢复不得自动续跑。
export function resumeDecisionOf(prevStatus, op) {
  if (hasPendingRegeneration(op)) return 'stop'
  if (prevStatus === OP_OK) return 'skip'
  if (prevStatus === OP_GENERATED) return 'post'
  return 'rerun'
}

// NC 对账：out_dir 列举实数 vs 期望（ok 工序记录的 NC 文件名）。
export function reconcileNc({ entries, expectedNames }) {
  const ncNames = new Set(
    (Array.isArray(entries) ? entries : [])
      .filter((e) => e && e.is_dir === false && typeof e.name === 'string'
        && e.name.toLowerCase().endsWith('.nc'))
      .map((e) => e.name),
  )
  const missing = expectedNames.filter((n) => !ncNames.has(n))
  return {
    expected: expectedNames.length,
    found: expectedNames.length - missing.length,
    missing,
    total_nc_in_dir: ncNames.size,
  }
}

// 汇总 fail-closed（ops.py overall_action：error → error；缺 NC/空刀路 →
// incomplete；全 ok 且对账一致 → ok）。check 判不出（列举失败）同样拒绝放行。
export function overallOf(opEntries, check) {
  const failed = opEntries.filter((o) => o.status === OP_ERROR)
  if (failed.length > 0) {
    return { overall: 'error', reason: `有工序执行失败：${failed.map((o) => o.name).join('、')}` }
  }
  const pending = opEntries.flatMap(regenerationItemsOf)
  if (pending.length > 0) {
    const names = [...new Set(pending.map((item) => item.operation))]
    return { overall: 'incomplete', reason: `存在待重算刀路：${names.join('、')}；未经显式授权不得交付或自动续跑。` }
  }
  const notOk = opEntries.filter((o) => o.status !== OP_OK)
  if (notOk.length > 0) {
    return {
      overall: 'incomplete',
      reason: `交付不完整：有工序缺 NC 或空刀路（fail-closed 拒绝放行；可续跑补齐）：${notOk.map((o) => `${o.name}(${o.status})`).join('、')}`,
    }
  }
  if (check && check.listing_ok === false) {
    return { overall: 'incomplete', reason: 'NC 对账无法完成（out_dir 列举失败）——判不出不等于判失败，fail-closed 拒绝放行。' }
  }
  if (check && check.missing.length > 0) {
    return {
      overall: 'incomplete',
      reason: `NC 对账不符：期望 ${check.expected} 个，盘上实数 ${check.found} 个，缺 ${check.missing.join('、')}。`,
    }
  }
  return { overall: 'ok', reason: null }
}

// runstate.json 原子落盘：tmp + rename（同目录换名，崩在半截留 tmp 不伤正本）。
export function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tmp, file)
}

function readJsonFile(file) {
  try {
    const raw = readFileSync(file, 'utf8')
    return { value: JSON.parse(raw), raw }
  } catch (error) {
    return { error: error.message }
  }
}

// proxy 错误分类 → 给模型的处置建议（与 cam_survey 同口径，设计稿 §4.1）。
function adviceOf(result) {
  if (result.retryable === true) return '可到 Windows 侧确认 CAM-Agent proxy 与 worker 状态后重试（cam_run resume=true 续跑，ok 工序不重算）。'
  if (result.errorClass === 'refused') return 'proxy 按设计拒绝（护栏正常工作的证据）：请核对入参与前置条件，不要原样重试。'
  if (result.errorClass === 'internal_error') return 'proxy 内部错误：请记录现象并告知人工排查。'
  return '无法判定错误类别：请把错误信息如实转述给用户。'
}

function basenameOf(p) {
  const text = String(p)
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return slash >= 0 ? text.slice(slash + 1) : text
}

// 整条执行流程（后台 job 的 run 体 / 退化同步执行共用）。任何阶段失败都
// 汇总成中文可行动的 summary（overall=error），不向模型抛异常栈。
export async function executeCamRun({ camPipeline, runDir, runId, resume, dshHome, isCancelled }) {
  const statePath = path.join(runDir, 'runstate.json')
  const summary = {
    status: 'ok',
    run_id: runId,
    resumed: resume,
    overall: undefined,
    ops: [],
    notes: [],
    advice: [],
  }
  let state = null
  const persist = (state) => {
    state.updated_at = new Date().toISOString()
    writeJsonAtomic(statePath, state)
  }
  const failStage = (stage, result, extraAdvice) => {
    summary.overall = 'error'
    summary.failed_stage = stage
    summary.error = {
      error_type: result.errorType ?? 'worker_error',
      msg: result.msg,
      ...(result.errorClass !== undefined ? { error_class: result.errorClass } : {}),
      ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
    }
    summary.advice.push(extraAdvice ?? adviceOf(result))
    if (state?.work_copy) {
      state.cleanup = summary.cleanup = { status: 'pending', work_copy: state.work_copy, reason: '加工未正常完成，保留工作副本供核对；未自动保存或关闭。' }
    }
    // 失败也进时间线（过程视图要知道死在哪一步）；state 尚未建立的读盘期
    // 失败没有 run 可记，跳过。
    if (state && Array.isArray(state.history)) {
      state.history.push({ ts: new Date().toISOString(), stage: 'failed', failed_stage: stage, msg: result.msg })
      persist(state)
    }
    return summary
  }

  // ---- 读盘与指纹 ----------------------------------------------------------
  const jobFile = readJsonFile(path.join(runDir, 'job.json'))
  if (jobFile.error) return failStage('load', { errorType: 'local_io', msg: `job.json 无法解析：${jobFile.error}。请重新 cam_plan 落盘。` })
  const job = jobFile.value
  const fingerprint = fingerprintOfJob(jobFile.raw)

  if (existsSync(statePath)) {
    const stateFile = readJsonFile(statePath)
    if (stateFile.error) return failStage('load', { errorType: 'local_io', msg: `runstate.json 无法解析：${stateFile.error}。保险起见请人工检查 run 目录后继续。` })
    state = stateFile.value
  }
  if (resume) {
    if (!state) {
      return failStage('load', { errorType: 'no_state', msg: 'resume=true 但 runstate.json 不存在——本 run 还没执行过。请去掉 resume 首跑。' })
    }
    if (state.job_fingerprint !== fingerprint) {
      return failStage('load', {
        errorType: 'fingerprint_mismatch',
        msg: 'job.json 与上次执行时已不同（内容指纹不符）——工序单改了不能吃旧刀路。'
          + '如确要按新工序单执行，请重新 cam_plan 落盘（产生新 run_id）后对新 run 首跑。',
      })
    }
  }

  const suffix = resume ? state.suffix : generateSuffix()
  const ops = Array.isArray(job.operations) ? job.operations : []
  const resolved = ops.map((op, index) => ({
    index,
    op,
    name: String(op?.new_name ?? `op_${index}`).replaceAll('{suffix}', suffix),
  }))
  if (!resume || !state) {
    state = {
      run_id: runId,
      suffix,
      job_fingerprint: fingerprint,
      history: [],
      ops: resolved.map(({ index, op, name }) => ({
        index,
        name,
        type: op?.type ?? 'unknown',
        status: 'pending',
        timeout_seconds: opTimeoutOf(op),
      })),
    }
  } else {
    state.suffix = suffix
    state.job_fingerprint = fingerprint
  }
  if (!Array.isArray(state.history)) state.history = [] // 旧格式 runstate 无 history
  summary.suffix = suffix
  persist(state)

  // 过程时间线：每条阶段事件带时间戳 append 进 state.history 并原子落盘。
  const mark = (payload) => {
    state.history.push({ ts: new Date().toISOString(), ...payload })
    persist(state)
  }

  if (isCancelled()) {
    summary.aborted = true
    summary.overall = 'error'
    summary.error = { error_type: 'cancelled', msg: '任务在开始执行前被取消。' }
    return summary
  }

  // ---- 0. 开工前健康门禁（旧 client.ensure_ready；不靠模型自觉） ------------
  mark({ stage: 'ensure_ready' })
  const ready = await camPipeline.ensureReady()
  if (ready.status !== 'ok') return failStage('ensure_ready', ready)

  // ---- 1. 上传 part（已在盘上则跳过） ---------------------------------------
  const st = await camPipeline.stat(job.prt)
  if (st.status !== 'ok') return failStage('upload', st)
  mark({ stage: 'upload', skipped: st.data?.exists === true || undefined })
  if (st.data?.exists === true) {
    summary.notes.push(`proxy 侧已存在 ${job.prt}，跳过上传。`)
  } else {
    const local = typeof job.prt_local === 'string' ? job.prt_local : ''
    if (!local) {
      return failStage('upload', { errorType: 'local_io', msg: 'job.json 缺 prt_local（本地原件路径）——请用本版本 cam_plan 重新落盘。' })
    }
    const uploadsRoot = path.resolve(dshHome, 'uploads')
    if (!job.formal_task && !path.resolve(local).startsWith(uploadsRoot + path.sep)) {
      return failStage('upload', { errorType: 'local_io', msg: `job.json 的 prt_local（${local}）不在 uploads 目录内，拒绝读取。请重新 cam_plan 落盘。` })
    }
    if (!existsSync(local)) {
      return failStage('upload', { errorType: 'local_io', msg: `本地原件已不在：${local}。请重新上传零件并重新 cam_plan。` })
    }
    const up = await camPipeline.uploadFile(local, job.prt)
    if (up.status !== 'ok') return failStage('upload', up)
    summary.notes.push(`已上传 ${local} → ${job.prt}。`)
  }

  // ---- 2. work copy（主模型永不被写；失败即中止） ---------------------------
  mark({ stage: 'work_copy' })
  const workPrt = resume && state.work_copy ? state.work_copy : job.formal_task
    ? `${job.out_dir}/${workCopyPathOf(job.prt, suffix).split('/').pop()}` : workCopyPathOf(job.prt, suffix)
  let needCopy = true
  if (resume && typeof state.work_copy === 'string' && state.work_copy) {
    const stWork = await camPipeline.stat(state.work_copy)
    if (stWork.status === 'ok' && stWork.data?.exists === true) {
      needCopy = false
      summary.notes.push(`work copy 已在盘上：${state.work_copy}，直接续用。`)
    }
  }
  if (needCopy) {
    const srcAbs = await camPipeline.windowsPath(job.prt)
    if (srcAbs.status !== 'ok') return failStage('work_copy', srcAbs)
    const dstAbs = await camPipeline.windowsPath(workPrt)
    if (dstAbs.status !== 'ok') return failStage('work_copy', dstAbs)
    const copied = await camPipeline.run('/cam_copy_part', { src: srcAbs.data, dst: dstAbs.data }, { deadlineSeconds: 180 })
    if (copied.status !== 'ok') return failStage('work_copy', copied)
    if (copied.data?.ok !== true) {
      return failStage('work_copy', {
        errorType: 'worker_error',
        msg: `work copy 失败（${copied.data?.error ?? '未知原因'}）；不会退回直写主模型。请确认 Windows 侧目录可写。`,
      })
    }
  }
  state.work_copy = workPrt
  persist(state)

  // ---- 3. prepare（裸件建 CAM setup；job.json 声明了才做） ------------------
  if (job.prepare?.init_setup && !state.prepared) {
    mark({ stage: 'prepare' })
    const cfg = typeof job.prepare.init_setup === 'object' && job.prepare.init_setup !== null
      ? job.prepare.init_setup
      : {}
    const params = { prt: workPrt, save: true }
    for (const key of ['tool_diameter', 'ensure_tool']) {
      if (cfg[key] !== undefined) params[key] = cfg[key]
    }
    const prep = await camPipeline.run('/cam_init_setup', params, { deadlineSeconds: 600 })
    if (prep.status !== 'ok') return failStage('prepare', prep)
    if (!prep.data?.has_cam_setup) {
      return failStage('prepare', {
        errorType: 'worker_error',
        msg: `init_setup 未能建立 CAM setup：${prep.data?.tool_err ?? json(prep.data ?? {})}`,
      })
    }
    if (prep.data?.saved === false) {
      return failStage('prepare', { errorType: 'worker_error', msg: `init_setup 保存失败：${prep.data?.save_err ?? '未知原因'}` })
    }
    state.prepared = true
    persist(state)
    summary.prepare = {
      had_cam_setup: prep.data?.had_cam_setup ?? null,
      tool_created: prep.data?.tool_created ?? null,
      mcs: (prep.data?.geometry_groups ?? []).find((g) => g && g !== 'NONE' && !String(g).startsWith('_err')) ?? null,
    }
  }

  // Bind machine pocket numbers before generating toolpath events (T/H/D are baked into NC).
  if (job.formal_task && !state.tool_numbers_verified) {
    mark({ stage: 'tool_numbers', msg: '按冻结刀库设置并回读刀号' })
    const machine = readJsonFile(path.join(runDir, 'machine_snapshot.json')).value
    const numbers = {}
    for (const op of ops.filter(op => op.type === 'from_scratch_workpiece_op')) {
      const pocket = machine?.magazine?.pockets?.find(p => p.tool?.tool_assembly_id === op.tool_assembly_id)
      const match = /^T([1-9][0-9]*)$/.exec(pocket?.control_tool_id ?? '')
      if (!op.tool || !match || (numbers[op.tool] && numbers[op.tool] !== Number(match[1]))) return failStage('tool_numbers', { errorType: 'tool_binding', msg: '冻结刀库缺少明确刀位，或同一 NX 刀具绑定多个刀位；请修改方案后重新审核。' })
      numbers[op.tool] = Number(match[1])
    }
    if (Object.keys(numbers).length) {
      const result = await camPipeline.run('/cam_set_tool_numbers', { prt: workPrt, numbers, operations: [], regenerate: false, save: true }, { deadlineSeconds: 300 })
      if (result.status !== 'ok') return failStage('tool_numbers', result)
      const registersMatch = Object.entries(numbers).every(([tool, number]) => {
        const after = result.data?.tools?.[tool]?.after
        // 建工序前 operations=[] 时上游无法经工序读 TOG，会明确返回 null；
        // 与 _ensure_tool_numbers 同口径：null=该配置不暴露，0 才是未定义。
        const definitionBitsMatch = [after?.num_tog, after?.adj_tog, after?.cutcom_tog]
          .every(value => value === 1 || value === null)
        return after?.num === number && after?.adj === number && after?.cutcom === number && definitionBitsMatch
      })
      if (result.data?.ok !== true || result.data?.saved !== true || !registersMatch) return failStage('tool_numbers', { errorType: 'tool_binding', msg: 'NX 未返回已保存且 T/H/D 与定义位逐刀匹配的回读；停止生成，不能把建议当作刀号已经应用。' })
      state.tool_number_binding = result.data
    }
    state.tool_numbers_verified = true; persist(state)
  }

  // ---- 4. 逐 op 执行 --------------------------------------------------------
  const postOnly = async ({ op, name }) => {
    // 刀路已在 work copy 里，只补 NC（ops.py _post_only）。
    const ran = await camPipeline.run('/postprocess', {
      prt: workPrt,
      operations: [name],
      out_dir: job.out_dir,
      post_name: op.post_name ?? job.post_name,
    }, { deadlineSeconds: opTimeoutOf(op) })
    if (ran.status !== 'ok') {
      const fields = t501FieldsOf(ran.data, ran.errorDetail)
      return { status: hasPendingRegeneration(fields) ? OP_ERROR : OP_GENERATED, error: ran.msg, error_type: ran.errorType, ...fields, ...(ran.errorClass !== undefined ? { error_class: ran.errorClass } : {}) }
    }
    const { nc, postError } = ncOf(ran.data, name)
    if (nc) return { status: OP_OK, nc_files: [nc], ...t501FieldsOf(ran.data) }
    return { status: OP_GENERATED, error: postError ?? 'postprocess 未返回 NC', ...t501FieldsOf(ran.data) }
  }

  const copyPostprocess = async ({ op, name }) => {
    // ops.py _copy_postprocess：模板逐字、{suffix} 已替换、post_name/out_dir 传递。
    const ran = await camPipeline.run('/cam_copy_postprocess', {
      prt: workPrt,
      template: op.template,
      new_name: name,
      out_dir: job.out_dir,
      post_name: op.post_name ?? job.post_name,
      generate: op.generate ?? true,
    }, { deadlineSeconds: opTimeoutOf(op) })
    if (ran.status !== 'ok') {
      return { status: OP_ERROR, error: ran.msg, error_type: ran.errorType, ...t501FieldsOf(ran.data, ran.errorDetail), ...(ran.errorClass !== undefined ? { error_class: ran.errorClass } : {}) }
    }
    const copy = ran.data?.copy ?? {}
    if (!copy.copied) return { status: OP_ERROR, error: copy.error ?? '模板复制失败' }
    if (!copy.path_exists || !copy.toolpath_length) return { status: OP_EMPTY, error: '刀路为空' }
    // 撞名时 worker 自动改名（请求 PROBE_OP_x → 实建 PROBE_OP_x_01），且
    // postprocess.files 按实际名键控——NC 查找必须用返回的 copy.new_name，
    // 否则「NC 已落盘但判读miss」（真机实证 2026-08-23）。实际名记入 op 状态，
    // 供续跑 postOnly 对准。
    const actualName = typeof copy.new_name === 'string' && copy.new_name.trim() ? copy.new_name.trim() : name
    const { nc, postError } = ncOf(ran.data?.postprocess, actualName)
    if (nc) return { status: OP_OK, nc_files: [nc], actual_name: actualName, ...t501FieldsOf(ran.data?.postprocess) }
    return { status: OP_GENERATED, error: postError ?? '未返回 NC', actual_name: actualName, ...t501FieldsOf(ran.data?.postprocess) }
  }

  const fromScratch = async ({ op, name }) => {
    // ops.py _from_scratch：参数白名单直通 + tool 空值守卫 + _interpret_created 判读。
    const params = { prt: workPrt, generate: op.generate ?? true, new_name: name }
    for (const key of FROM_SCRATCH_KEYS) {
      if (op[key] !== undefined) params[key] = op[key]
    }
    if (op.nx_type !== undefined) params.type = op.nx_type
    if ('tool' in params) {
      const tool = params.tool
      // 上游按真值判断：空串/0 会被当成「没传」并落进隐式选刀——空值不是指定。
      if (typeof tool !== 'string' || !tool.trim()) {
        return { status: OP_ERROR, error: `工序 ${name} 的 tool=${json(tool)} 不是有效刀名——上游按真值判断，空串/0 会被当成没传并落进隐式选刀。要隐式选刀请去掉 tool 键。` }
      }
    }
    const ran = await camPipeline.run('/cam_build_workpiece_op', params, { deadlineSeconds: opTimeoutOf(op) })
    if (ran.status !== 'ok') {
      return { status: OP_ERROR, error: ran.msg, error_type: ran.errorType, ...(ran.errorDetail !== undefined ? { error_detail: ran.errorDetail } : {}), ...(ran.errorClass !== undefined ? { error_class: ran.errorClass } : {}) }
    }
    const m = createdMetricsOf(ran.data ?? {})
    if (m.error) return { status: OP_ERROR, error: m.error }
    if (m.created === undefined) {
      return { status: OP_ERROR, error: `worker 返回既无 op 段、也无 created 字段——判不出，fail-closed；请人工核对该工序在件里的状态。${m.detail ? `worker 诊断：${m.detail}` : ''}` }
    }
    if (!m.created) return { status: OP_ERROR, error: '工序创建失败' }
    if (!m.path_exists || !m.toolpath_length) {
      return { status: OP_EMPTY, error: `刀路为空（path_exists=${m.path_exists} length=${m.toolpath_length}）` }
    }
    const posted = await postOnly({ op, name })
    if (m.toolpath_length !== undefined && m.toolpath_length !== null) posted.toolpath_length = m.toolpath_length
    return posted
  }

  const runOp = (entry) => {
    const type = entry.op?.type
    if (type === 'copy_postprocess') return copyPostprocess(entry)
    if (type === 'from_scratch_workpiece_op') return fromScratch(entry)
    return Promise.resolve({
      status: OP_ERROR,
      error: `v1 不支持该工序类型（${type ?? '未知'}）；本迭代支持 copy_postprocess / from_scratch_workpiece_op。`
        + '请调整工序单（重新 cam_plan）或等后续迭代。',
    })
  }

  mark({ stage: 'ops', total: resolved.length })
  // pending 可能由后序工序记录、却点名前序工序；先扫完整 runstate，再决定
  // 是否允许任何续跑动作，避免先执行 A、走到 B 才发现 A 待重算。
  const stopAllForRegeneration = resume && resolved.some(entry => hasPendingRegeneration(state.ops[entry.index]))
  for (const entry of resolved) {
    const prev = state.ops[entry.index]
    const decision = stopAllForRegeneration ? 'stop' : resume ? resumeDecisionOf(prev?.status, prev) : 'rerun'
    if (decision === 'skip') {
      summary.ops.push({ ...prev, decision: 'skip' })
      mark({ stage: 'op', index: entry.index, name: entry.name, status: 'skip' })
      continue
    }
    if (decision === 'stop') {
      summary.ops.push({ ...prev, decision: 'stop' })
      mark({ stage: 'op', index: entry.index, name: entry.name, status: 'stop' })
      if (stopAllForRegeneration) continue
      break
    }
    if (isCancelled()) {
      summary.aborted = true
      break
    }
    mark({ stage: 'op', index: entry.index, name: entry.name, action: decision === 'post' ? 'post' : 'full' })
    const startedAt = new Date().toISOString()
    const result = decision === 'post'
      ? await postOnly({ op: entry.op, name: prev?.actual_name ?? entry.name })
      : await runOp(entry)
    const record = {
      index: entry.index,
      name: entry.name,
      type: entry.op?.type ?? 'unknown',
      status: result.status,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      // init 条目算好的限时随执行记录走（record 整体覆盖 init 条目）。
      timeout_seconds: prev?.timeout_seconds ?? opTimeoutOf(entry.op),
      ...(result.actual_name && result.actual_name !== entry.name ? { actual_name: result.actual_name } : {}),
      ...t501FieldsOf(result),
      ...(result.nc_files ? { nc_files: result.nc_files } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.error_type !== undefined ? { error_type: result.error_type } : {}),
      ...(result.error_class !== undefined ? { error_class: result.error_class } : {}),
    }
    state.ops[entry.index] = record
    persist(state)
    summary.ops.push({ ...record, decision })
    mark({ stage: 'op', index: entry.index, name: entry.name, status: result.status })
    if (hasPendingRegeneration(result)) break
  }

  if (summary.aborted) {
    summary.overall = 'error'
    summary.error = { error_type: 'cancelled', msg: '任务被停止（job_kill）。已完成的工序保留在 runstate，cam_run resume=true 可续跑。' }
    state.history.push({ ts: new Date().toISOString(), stage: 'aborted', msg: summary.error.msg })
    persist(state)
    return summary
  }

  // ---- 5. 收尾自检（v1 最小集合：NC 对账 + 空刀路 fail-closed） -------------
  mark({ stage: 'check' })
  const expectedNames = summary.ops
    .filter((o) => o.status === OP_OK)
    .flatMap((o) => (o.nc_files ?? []).map(basenameOf))
  let check
  const listed = await camPipeline.listDir(job.out_dir)
  if (listed.status !== 'ok') {
    check = { listing_ok: false, expected: expectedNames.length, found: 0, missing: expectedNames, msg: listed.msg }
  } else {
    check = { listing_ok: true, ...reconcileNc({ entries: listed.data?.entries, expectedNames }) }
  }
  const emptyOps = summary.ops.filter((o) => o.status === OP_EMPTY).map((o) => o.name)
  check.empty_ops = emptyOps
  summary.check = check
  state.check = { at: new Date().toISOString(), ...check } // 对账结论落盘：时间线尾部数据源
  summary.nc = {
    out_dir: job.out_dir,
    expected: check.expected ?? expectedNames.length,
    found: check.found ?? 0,
    ...(check.total_nc_in_dir !== undefined ? { total_nc_in_dir: check.total_nc_in_dir } : {}),
    files: summary.ops.filter((o) => o.status === OP_OK).flatMap((o) => o.nc_files ?? []),
  }

  if (job.formal_task) {
    mark({ stage: 'production_check', msg: 'NX 过切/刀柄检查；不代表完整生产验证' })
    const gouge = await camPipeline.run('/cam_gouge_check', { prt: workPrt, operations: summary.ops.filter(op => [OP_OK, OP_GENERATED].includes(op.status)).map(op => op.actual_name ?? op.name), check_holder: true, set_holder: false }, { deadlineSeconds: 300 })
    state.production_checks = { at: new Date().toISOString(), work_copy: workPrt, gouge, coverage: 'partial', release_ready: false }
    persist(state)
  }

  // ---- 6. 汇总（fail-closed） ----------------------------------------------
  const { overall, reason } = overallOf(summary.ops, check)
  summary.execution_overall = overall
  summary.production_check = job.formal_task ? 'incomplete' : 'not_verified'
  summary.overall = overall
  state.execution_overall = overall
  state.production_overall = summary.production_check
  if (reason) summary.reason = reason
  if (job.formal_task) {
    state.cleanup = summary.cleanup = { status: 'pending', work_copy: workPrt, reason: '待保存并关闭本批次工作副本' }
    persist(state)
    if (overall === 'ok' && !isCancelled()) {
      mark({ stage: 'finalize', status: 'running', msg: '保存并核验本批次工作副本，再单件关闭' })
      let finalized
      try { finalized = await camPipeline.run('/cam_finalize_work_copy', { prt: workPrt, out_dir: job.out_dir }, { deadlineSeconds: 180 }) }
      catch (error) { finalized = { status: 'error', errorType: error.name || 'finalization_error', msg: error.message || '工作副本收尾调用异常' } }
      const data = finalized.data
      const complete = finalized.status === 'ok' && data?.ok === true && data.saved === true && data.save_verified === true && data.modified_after_save === false && data.closed === true
      state.cleanup = summary.cleanup = { status: complete ? 'complete' : 'pending', work_copy: workPrt,
        reason: complete ? '本批次工作副本已保存、状态核验并关闭' : finalized.msg || data?.error || '工作副本保存或关闭未得到完整回读，请人工核对；未关闭其他模型',
        result: finalized }
      persist(state)
      mark({ stage: 'finalize', status: complete ? 'ok' : 'pending', msg: state.cleanup.reason })
    } else {
      state.cleanup.reason = '加工未正常完成或已停止，保留工作副本供核对；未自动保存或关闭。'
      persist(state)
      mark({ stage: 'finalize', status: 'pending', msg: state.cleanup.reason })
    }
    if (state.cleanup.status !== 'complete') summary.advice.push(`工作副本待处理：${state.cleanup.reason}。NC 生成结果保留，下一件预览可能仍被未保存模型护栏阻断。`)
  }
  if (overall === 'ok') {
    summary.advice.push('全部工序 NC 在盘且对账一致。下一步可 cam_deliver 交付打包（/fs_zip 回收 NC + 生成交付报告与加工设定单，调用时过签字闸门）。')
  } else if (overall === 'incomplete') {
    summary.advice.push('可用 cam_run resume=true 断点续跑：ok 工序跳过、generated 只补 post、其余重跑。')
    if (emptyOps.length > 0) {
      summary.advice.push(`空刀路（empty）是 fail-closed 信号：${emptyOps.join('、')} 需人看工艺（几何/刀具/模板是否合适），不要盲目重跑。`)
    }
  } else {
    const firstError = summary.ops.find((o) => o.status === OP_ERROR)
    if (firstError?.error_class === 'refused') {
      summary.advice.push('error_class=refused：proxy 按设计拒绝（护栏正常工作的证据），请核对入参与前置条件，不要原样重试。')
    } else if (firstError?.error_class === 'internal_error') {
      summary.advice.push('error_class=internal_error：proxy 内部错误，请记录现象并告知人工排查。')
    } else {
      summary.advice.push('可排查后 cam_run resume=true 续跑（ok 工序不重算）；连接类失败请先到 Windows 侧确认 proxy 与 worker 状态。')
    }
  }
  persist(state)
  mark({ stage: 'done', status: overall })
  return summary
}

// 进程内互斥（旧 Camind NX 整程串行锁语义；真正互斥靠 proxy 文件队列）。
// 同时只允许一个 cam_run 在执行——第二个直接报错，不排队（队在后面的是
// 分钟级 NX 占用，静默排队的代价不对称）。
let activeRun = null

export function registerCamRun(ctx, camPipeline) {
  ctx.tools.register({
    name: 'cam_run',
    description:
      'CAM 远程执行：按 run 目录的 job.json 在 NX 工作台执行工序单（ensure_ready → 上传 → '
      + 'work copy（主模型不被写）→ prepare → 逐 op 执行出 NC → NC 对账 + 空刀路自检）。'
      + 'run_id 来自 cam_plan；resume=true 断点续跑（ok 跳过 / generated 只补 post / 其余重跑；'
      + 'job.json 内容指纹不符会拒绝——改了工序单请重新 cam_plan）。'
      + '高风险声明不齐会被闸门拦下，齐全需人工签字放行。'
      + '本工具立即返回 job_id 后台执行，完成时系统通知，用 job_output 读最终汇总；'
      + 'v1 支持的工序类型：copy_postprocess / from_scratch_workpiece_op。',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'cam_plan 返回的 run_id' },
        resume: { type: 'boolean', description: '断点续跑（默认 false=从头执行；true=按 runstate 续跑）' },
      },
      required: ['run_id'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const runId = typeof args?.run_id === 'string' ? args.run_id.trim() : ''
      if (!runId) return json({ status: 'error', stage: 'args', msg: '缺少参数 run_id（cam_plan 落盘时返回的值）。' })
      const resume = args?.resume === true
      const dshHome = process.env.DSH_HOME
      if (!dshHome) return json({ status: 'error', stage: 'args', msg: 'DSH_HOME 未设置，无法定位 run 目录。' })
      const resolvedDir = resolveRunDir(dshHome, safeSessionId(exec?.agent?.id), runId)
      if (resolvedDir.error) return json({ status: 'error', stage: 'args', msg: resolvedDir.error.reason })
      const runDir = resolvedDir.dir
      if (!existsSync(path.join(runDir, 'job.json'))) {
        return json({ status: 'error', stage: 'args', msg: `run 目录 ${runDir} 不存在或缺 job.json。请先用 cam_plan 落盘工序单（它会返回 run_id）。` })
      }
      if (activeRun) {
        return json({
          status: 'error',
          stage: 'mutex',
          msg: `另一个 cam_run 正在执行（run_id=${activeRun}）——NX 整程串行。可用 job_output 查看进度、job_kill 停止后再试。`,
        })
      }

      const labelFile = readJsonFile(path.join(runDir, 'job.json'))
      const tasks = ctx.get('camTasks'), sessionId = safeSessionId(exec?.agent?.id)
      let formal = false
      try {
        const task = await tasks?.read(sessionId)
        formal = task?.version > 0
        if (formal) await tasks.assertRun(sessionId, runId, labelFile.value)
        else if (labelFile.value?.formal_task) throw new Error('正式任务服务/记录缺失，拒绝执行')
      } catch (error) { return json({ status: 'error', stage: 'authorization', msg: error.message }) }
      const runBound = async isCancelled => {
        if (formal) await tasks.beginRun(sessionId, runId, labelFile.value)
        let inFlight = false
        const pipeline = formal ? { ...camPipeline, run: async (...args) => {
          try { await tasks.assertRun(sessionId, runId, labelFile.value) }
          catch (error) { return { status: 'error', errorType: 'authorization', msg: error.message } }
          inFlight = true
          try { return await camPipeline.run(...args) } finally { inFlight = false }
        } } : camPipeline
        try {
          const summary = await executeCamRun({ camPipeline: pipeline, runDir, runId, resume, dshHome, isCancelled })
          if (formal) await tasks.finishRun(sessionId, runId, summary, /Timeout|connection/i.test(summary.error?.error_type ?? '') || summary.ops.some(op => /Timeout|connection/i.test(op.error_type ?? '')) || /Timeout|connection/i.test(summary.cleanup?.result?.errorType ?? ''))
          return summary
        } catch (error) {
          if (formal) await tasks.finishRun(sessionId, runId, { overall: 'error', reason: error.message }, inFlight)
          throw error
        }
      }
      const partId = labelFile.value?.part_id ?? runId

      const jobs = ctx.get('jobs')
      if (jobs && exec?.agent) {
        activeRun = runId
        let cancelled = false
        const release = () => {
          if (activeRun === runId) activeRun = null
        }
        let jobId
        try {
          jobId = jobs.start({
            kind: 'cam-run',
            label: `cam_run ${partId}（${runId}）`,
            owner: exec.agent.id,
            run: () => ({
              cancel: () => {
                cancelled = true
              },
              done: runBound(() => cancelled)
                .then((summary) => (summary.aborted
                  ? { status: 'killed', detail: 'job_kill 停止', result: json(summary) }
                  : { status: 'completed', result: json(summary) }))
                .catch((error) => ({ status: 'failed', detail: String(error?.message ?? error) }))
                .finally(release),
            }),
          })
        } catch (error) {
          release()
          return json({ status: 'error', stage: 'jobs', msg: `后台任务启动失败：${error.message}` })
        }
        return json({
          status: 'accepted',
          job_id: jobId,
          run_id: runId,
          resume,
          msg: '已进入后台执行。完成时系统会通知你；期间可继续对话，用 job_output 查进度、job_kill 停止。最终汇总（每 op 终态 / NC 清单 / 处置建议）在 job_output 里。',
        })
      }

      // jobs 服务不可用（或调用无 agent 上下文）时退化同步执行。
      activeRun = runId
      try {
        const summary = await runBound(() => false)
        summary.notes.push('jobs 服务不可用，本次为前台同步执行（无 job_id，完成即返回）。')
        return json(summary)
      } finally {
        activeRun = null
      }
    },
  })
}
