// CAM run 只读查询路由 —— GET /camind/api/cam/runs（列表 + 单 run 详情）。
//
// 数据源是 run 目录磁盘落盘（$DSH_HOME/cam-runs/<session>/<runId>/），不读会话
// 事件投影：免疫「cam/* 事件会话重启后拒绝重载」的上游限制（设计稿 §4.4），且能
// 展示中断后可 resume 续跑的 run。消费方是 ui-shell 工作台「加工」页签。
//
// 路由形态（prefix /camind/api/cam/runs 下全部请求都由本 handler 应答）：
//   - GET /camind/api/cam/runs?session=<id>            列表（updated_at 倒序）
//   - GET /camind/api/cam/runs/<session>/<runId>       详情（runstate 全文 +
//     job.json 摘要 + delivery 清单 + NC 条目名）
//   - .../delivery/<file>（含 nc/<name>）              委托 delivery-route.js
//
// 路径纪律与 delivery-route.js 同口径：session 只认 [A-Za-z0-9_-]（safeSessionId
// 产出字符集），runId 只认 cam_plan 分配字符集（gate.js RUN_ID_PATTERN），目录解析
// 后做 runsRoot 前缀 containment 复核。单个 run 文件损坏不拖垮整表（字段置空、
// 如实标注 read_error），只有 session/runId 越界与目录不存在才 400/403/404。
// 本地只读面：与既有 ping/下载路由同一信任模型；只注册 GET，其余方法 405。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { createDeliveryRouteHandler } from './delivery-route.js'
import { RUN_ID_PATTERN } from './gate.js'
import { zipEntryNames } from './tools/deliver.js'

const ROUTE_PREFIX = '/camind/api/cam/runs'
const SESSION_PATTERN = /^[A-Za-z0-9_-]+$/
// 交付三件套（与 deliver.js DELIVERY_FILES 同一份相对布局）：齐全才算「已交付」。
const DELIVERY_FILES = ['nc_batch.zip', 'delivery_report.md', 'setup_sheet.md']

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function basenameOf(p) {
  const text = String(p)
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return slash >= 0 ? text.slice(slash + 1) : text
}

function readJsonSafe(file) {
  try {
    return { value: JSON.parse(readFileSync(file, 'utf8')) }
  } catch (error) {
    return { error: error.message }
  }
}

function mtimeIso(file) {
  try {
    return statSync(file).mtime.toISOString()
  } catch {
    return null
  }
}

// 派生 overall（列表/详情同一口径）：无 runstate → planned（只落盘未执行）；
// 有 error 工序 → error；全 ok → ok；其余 → incomplete。
// 注意这是 ops 终态的直读汇总，不含 cam_run 收尾的 NC 对账一项（对账结论以
// 交付报告为准）；页签徽章只需粗粒度。
function overallOfState(state) {
  if (state === null) return 'planned'
  const ops = Array.isArray(state?.ops) ? state.ops : []
  if (ops.some((o) => o?.status === 'error')) return 'error'
  if (ops.length > 0 && ops.every((o) => o?.status === 'ok')) return 'ok'
  return 'incomplete'
}

// delivery/ 扫描：平铺文件清单（名称 + 字节数）与三件套存在性。目录不存在或
// 不可读都按「未交付」处理，不出错。
function scanDelivery(runDir) {
  const deliveryDir = path.join(runDir, 'delivery')
  let names = []
  try {
    names = readdirSync(deliveryDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return { delivered: false, delivery: [] }
  }
  const files = []
  for (const name of names) {
    try {
      files.push({ name, bytes: statSync(path.join(deliveryDir, name)).size })
    } catch {
      // 文件在扫描间隙被移走：跳过即可（run 目录是本地只读面的数据源）。
    }
  }
  const delivered = DELIVERY_FILES.every((name) => names.includes(name))
  return { delivered, delivery: files }
}

// 开包实数 NC 条目名（不信任何清单字段；zip 不可读时返回 error，不落空数组误导）。
function ncNamesOf(runDir) {
  const zipPath = path.join(runDir, 'delivery', 'nc_batch.zip')
  if (!existsSync(zipPath)) return { nc_files: [] }
  try {
    const names = [...new Set(
      zipEntryNames(readFileSync(zipPath))
        .filter((n) => !n.endsWith('/') && n.toLowerCase().endsWith('.nc'))
        .map(basenameOf),
    )]
    return { nc_files: names }
  } catch (error) {
    return { nc_files: [], nc_error: `nc_batch.zip 开包失败：${error.message}` }
  }
}

// 单个 run 目录的摘要读取（列表与详情共用底座）。任何文件缺失/损坏都局部置空，
// 不抛出——run 目录可能正在被 cam_run 写（runstate tmp+rename 间隙）。
function readRun(sessionDir, runId) {
  const runDir = path.join(sessionDir, runId)
  const jobRes = readJsonSafe(path.join(runDir, 'job.json'))
  const stateRes = readJsonSafe(path.join(runDir, 'runstate.json'))
  const machineRes = readJsonSafe(path.join(runDir, 'machine_snapshot.json'))
  const job = jobRes.value ?? null
  const state = stateRes.value ?? null
  const machineDoc = machineRes.value ?? null
  const stateOps = (state && Array.isArray(state.ops)) ? state.ops : []
  return {
    runDir,
    job,
    state,
    machine: {
      id: typeof machineDoc?.machine_id === 'string'
        ? machineDoc.machine_id
        : (typeof job?.machine_context?.machine_instance_id === 'string' ? job.machine_context.machine_instance_id : null),
      display_name: typeof machineDoc?.display_name === 'string' ? machineDoc.display_name : null,
    },
    updated_at: typeof state?.updated_at === 'string'
      ? state.updated_at
      : (mtimeIso(path.join(runDir, 'job.json')) ?? mtimeIso(runDir) ?? ''),
    overall: overallOfState(state),
    stateOps,
    read_error: jobRes.error ?? stateRes.error ?? null,
  }
}

// 列表条目：页签卡片需要的全部字段（ops 压成 index/name/type/status 紧凑形，
// planned run 没有 runstate，退用 job.operations 的草案工序）。
function runSummary(sessionDir, runId) {
  const base = readRun(sessionDir, runId)
  const jobOps = (base.job && Array.isArray(base.job.operations)) ? base.job.operations : []
  const ops = base.state !== null
    ? base.stateOps.map((o, i) => ({
      index: Number.isSafeInteger(o?.index) ? o.index : i,
      name: typeof o?.name === 'string' ? o.name : `op ${i}`,
      type: typeof o?.type === 'string' ? o.type : '',
      status: typeof o?.status === 'string' ? o.status : null,
    }))
    : jobOps.map((op, i) => ({
      index: i,
      name: typeof op?.new_name === 'string' ? op.new_name : (typeof op?.type === 'string' ? op.type : `op ${i}`),
      type: typeof op?.type === 'string' ? op.type : '',
      status: null,
    }))
  const counts = { ok: 0, generated: 0, empty: 0, error: 0 }
  for (const op of ops) {
    if (op.status !== null && Object.hasOwn(counts, op.status)) counts[op.status] += 1
  }
  const { delivered, delivery } = scanDelivery(base.runDir)
  return {
    run_id: runId,
    part_id: typeof base.job?.part_id === 'string' ? base.job.part_id : null,
    machine: base.machine,
    updated_at: base.updated_at,
    overall: base.overall,
    ops,
    ops_counts: { ...counts, total: ops.length },
    delivered,
    delivery,
    ...(base.read_error !== null ? { read_error: `run 目录部分文件无法解析：${base.read_error}` } : {}),
  }
}

// 详情：runstate 全文 + job.json 摘要 + delivery 清单 + 开包实数 NC 条目名。
function runDetail(sessionDir, runId) {
  const base = readRun(sessionDir, runId)
  const job = base.job
  const jobOps = (job && Array.isArray(job.operations)) ? job.operations : []
  const { delivered, delivery } = scanDelivery(base.runDir)
  const nc = delivered ? ncNamesOf(base.runDir) : { nc_files: [] }
  return {
    run_id: runId,
    part_id: typeof job?.part_id === 'string' ? job.part_id : null,
    machine: base.machine,
    out_dir: typeof job?.out_dir === 'string' ? job.out_dir : null,
    post_name: typeof job?.post_name === 'string' ? job.post_name : null,
    suffix: typeof base.state?.suffix === 'string' ? base.state.suffix : null,
    updated_at: base.updated_at,
    overall: base.overall,
    delivered,
    delivery,
    ...nc,
    job: job === null ? null : {
      part_id: job.part_id ?? null,
      prt: job.prt ?? null,
      out_dir: job.out_dir ?? null,
      post_name: job.post_name ?? null,
      work_copy: job.work_copy === true,
      machine_context: job.machine_context ?? null,
      operations: jobOps.map((op, i) => ({
        index: i,
        type: op?.type ?? null,
        new_name: op?.new_name ?? null,
        template: op?.template ?? null,
      })),
    },
    runstate: base.state,
    ...(base.read_error !== null ? { read_error: `run 目录部分文件无法解析：${base.read_error}` } : {}),
  }
}

// req.url 路径形态见文件头。delivery 子路径整体委托既有下载 handler（同一文件里
// 的白名单/realpath 纪律不在这里复制）。
export function createRunsRouteHandler() {
  const deliveryHandler = createDeliveryRouteHandler()
  return (req, res) => {
    let url
    try {
      url = new URL(req.url ?? '', 'http://localhost')
    } catch {
      sendJson(res, 400, { ok: false, message: 'URL 无法解析。' })
      return
    }
    let pathname = ''
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      sendJson(res, 400, { ok: false, message: 'URL 无法解析。' })
      return
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, message: '仅支持 GET。' })
      return
    }
    const dshHome = process.env.DSH_HOME
    if (!dshHome) {
      sendJson(res, 500, { ok: false, message: 'DSH_HOME 未设置，无法定位 run 目录。' })
      return
    }
    const runsRoot = path.join(dshHome, 'cam-runs')

    // 列表：GET /camind/api/cam/runs?session=<id>
    if (pathname === ROUTE_PREFIX || pathname === `${ROUTE_PREFIX}/`) {
      const session = url.searchParams.get('session') ?? ''
      if (!SESSION_PATTERN.test(session)) {
        sendJson(res, 400, { ok: false, message: 'session 参数缺失或不合法（只接受字母/数字/下划线/连字符）。' })
        return
      }
      const sessionDir = path.join(runsRoot, session)
      if (!sessionDir.startsWith(runsRoot + path.sep)) {
        sendJson(res, 403, { ok: false, message: '路径越界，已拒绝。' })
        return
      }
      if (!existsSync(sessionDir)) {
        sendJson(res, 200, { ok: true, session, runs: [] })
        return
      }
      let entries = []
      try {
        entries = readdirSync(sessionDir, { withFileTypes: true })
      } catch (error) {
        sendJson(res, 500, { ok: false, message: `run 目录读取失败：${error.message}` })
        return
      }
      const runs = entries
        .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
        .map((entry) => runSummary(sessionDir, entry.name))
      runs.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
      sendJson(res, 200, { ok: true, session, runs })
      return
    }

    const segments = pathname.slice(ROUTE_PREFIX.length + 1).split('/')
    const [session, runId, marker] = segments

    // 交付下载：.../delivery/<file>（含 nc/<name>）——委托既有 handler。
    if (marker === 'delivery') {
      deliveryHandler(req, res)
      return
    }

    // 详情：GET /camind/api/cam/runs/<session>/<runId>
    if (segments.length !== 2 || !session || !runId) {
      sendJson(res, 400, { ok: false, message: '路径形态应为 /camind/api/cam/runs/<session>/<runId>。' })
      return
    }
    if (!SESSION_PATTERN.test(session)) {
      sendJson(res, 400, { ok: false, message: 'session 标识不合法。' })
      return
    }
    if (!RUN_ID_PATTERN.test(runId)) {
      sendJson(res, 400, { ok: false, message: 'runId 不合法。' })
      return
    }
    const sessionDir = path.join(runsRoot, session)
    const runDir = path.join(sessionDir, runId)
    if (!runDir.startsWith(runsRoot + path.sep)) {
      sendJson(res, 403, { ok: false, message: '路径越界，已拒绝。' })
      return
    }
    if (!existsSync(runDir)) {
      sendJson(res, 404, { ok: false, message: `run 不存在：${session}/${runId}。` })
      return
    }
    sendJson(res, 200, { ok: true, run: runDetail(sessionDir, runId) })
  }
}
