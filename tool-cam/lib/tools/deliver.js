// cam_deliver 模型工具 v1 —— 交付打包：NC 回收 + 中文交付报告 + 加工设定单。
//
// 前置（闸门前置核对见 lib/gate.js，本工具被执行即说明已签字放行）：
// run 目录已有 job.json 与 runstate.json（cam_plan 落盘 + cam_run 跑过）。
//
// 流程（语义移植旧 Camind flows/cam_job/flow.py _fetch + services/cam/report.py，
// 不照搬体量）：
//   1. /fs_zip 打包 job.out_dir 的 *.nc 回收到 run 目录 delivery/nc_batch.zip：
//      sha256 端到端校验在 camPipeline 内做（不符整体拒收、报错不落盘）；
//      **开包实数 .nc**（不信 X-CAM-Files 头——真机事故在案：头=9 实为 22 字节
//      空包）与 runstate ok 工序的 NC 逐名对账，不符 → 交付结论标 incomplete
//      并在报告写清，不静默；
//   2. delivery_report.md（lib/report.js：件号/机床/后处理器/工序逐项结论含
//      每项决定来源[runstate 终态 / machine_snapshot 冻结值 / declarations
//      留档]/NC 清单与对账/检查结论/备注）——检查未过（incomplete/error）也
//      生成，结论章节如实写未决项；
//   3. setup_sheet.md（machine_snapshot + job 渲染：机床号/夹具与工件坐标系/
//      冻结刀库引用/后处理器/转速进给上限/工序顺序）；
//   4. append cam/delivered 会话事件（交付包清单 + delivery 目录 + overall）；
//   5. 返回交付摘要（文件清单/路径/overall/中文建议）。
// 刀路查看器 v1 不做（旧 Camind 的 cnc-simulator 资产包太重，P3 迭代），
// 报告备注里写明。
//
// 传输级失败（连不上/sha256 不符/zip 开不了包）一律 error 返回且不落盘任何
// 文件（fail-closed）；只有「回收成功但内容/终态不符」才出包并标 incomplete。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { resolveRunDir } from '../gate.js'
import { buildDeliveryReport, buildSetupSheet, opStatusCn } from '../report.js'
import { overallOf, reconcileNc } from './run.js'
import { safeSessionId } from './survey.js'

function json(payload) {
  return JSON.stringify(payload, null, 2)
}

function basenameOf(p) {
  const text = String(p)
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return slash >= 0 ? text.slice(slash + 1) : text
}

function readJson(file) {
  try {
    return { value: JSON.parse(readFileSync(file, 'utf8')) }
  } catch (error) {
    return { error: error.message }
  }
}

// 最小 ZIP 中央目录读取（只取条目名，不解压）：从尾部扫 EOCD（PK\x05\x06），
// 按其记录的中央目录偏移逐条读 PK\x01\x02 的名字字段。X-CAM-Files 头不可信，
// 对账必须开包实数（旧 Camind 纪律）。ZIP64/加密包不支持（NC 包量级到不了，
// 真遇到时报「开不了包」fail-closed，不会误判）。
export function zipEntryNames(bytes) {
  const EOCD_SIG = 0x06054b50
  const CDIR_SIG = 0x02014b50
  const min = Math.max(0, bytes.length - 22 - 65536)
  let eocd = -1
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 ZIP 中央目录结尾记录（不是有效 zip）')
  const count = bytes.readUInt16LE(eocd + 10)
  let offset = bytes.readUInt32LE(eocd + 16)
  const names = []
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CDIR_SIG) {
      throw new Error('ZIP 中央目录损坏')
    }
    const nameLen = bytes.readUInt16LE(offset + 28)
    const extraLen = bytes.readUInt16LE(offset + 30)
    const commentLen = bytes.readUInt16LE(offset + 32)
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLen).toString('utf8'))
    offset += 46 + nameLen + extraLen + commentLen
  }
  return names
}

// 整条交付流程。返回 summary 对象（工具层 json() 后给模型）；任何失败都归一成
// 中文可行动的 error 对象，不向模型抛异常栈。
export async function executeCamDeliver({ camPipeline, runDir, runId, note, emit }) {
  const fail = (stage, result, advice) => ({
    status: 'error',
    stage,
    error_type: result.errorType ?? 'local_io',
    msg: result.msg,
    ...(result.errorClass !== undefined ? { error_class: result.errorClass } : {}),
    ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
    ...(advice ? { advice } : {}),
  })

  // ---- 读盘（job/runstate 必在，declarations/machine_snapshot 可缺） ---------
  const jobRes = readJson(path.join(runDir, 'job.json'))
  if (jobRes.error) return fail('load', { msg: `job.json 无法解析：${jobRes.error}。请重新 cam_plan 落盘。` })
  const stateRes = readJson(path.join(runDir, 'runstate.json'))
  if (stateRes.error) return fail('load', { msg: `runstate.json 无法解析：${stateRes.error}。保险起见请人工检查 run 目录后重试。` })
  const job = jobRes.value
  const state = stateRes.value
  const declRes = readJson(path.join(runDir, 'declarations.json'))
  const machineRes = readJson(path.join(runDir, 'machine_snapshot.json'))
  const declarationsDoc = declRes.value ?? null
  const machine = machineRes.value ?? null

  const stateOps = Array.isArray(state?.ops) ? state.ops : []
  const expectedNames = stateOps
    .filter((o) => o?.status === 'ok')
    .flatMap((o) => (Array.isArray(o?.nc_files) ? o.nc_files : []).map(basenameOf))

  // ---- 1. /fs_zip 回收 NC（传输级失败 → error 不落盘） -----------------------
  const zipped = await camPipeline.zipDir(job.out_dir, ['*.nc'])
  if (zipped.status !== 'ok') {
    return fail('fetch', zipped,
      'NC 回收失败，交付未落盘任何文件（fail-closed）。可到 Windows 侧确认 proxy 与 out_dir 后重试 cam_deliver。')
  }
  let entryNames
  try {
    entryNames = zipEntryNames(zipped.data.bytes)
  } catch (error) {
    return fail('fetch', {
      errorType: 'bad_zip',
      msg: `NC 包已通过 sha256 校验但无法开包（${error.message}）——proxy 打包异常。`
        + `交付未落盘任何文件；请到 Windows 侧核对 ${job.out_dir} 后重试 cam_deliver。`,
    })
  }

  const deliveryDir = path.join(runDir, 'delivery')
  mkdirSync(deliveryDir, { recursive: true })
  const zipPath = path.join(deliveryDir, 'nc_batch.zip')
  writeFileSync(zipPath, zipped.data.bytes)

  // ---- 2. 开包实数对账（不信 X-CAM-Files 头） --------------------------------
  const ncNamesInZip = [...new Set(
    entryNames.filter((n) => !n.endsWith('/') && n.toLowerCase().endsWith('.nc')).map(basenameOf),
  )]
  const check = {
    listing_ok: true,
    ...reconcileNc({
      entries: ncNamesInZip.map((name) => ({ is_dir: false, name })),
      expectedNames,
    }),
    expectedNames,
    extra: ncNamesInZip.filter((n) => !expectedNames.includes(n)),
    zip_sha256: zipped.data.sha256,
  }

  // ---- 3. 汇总（与 cam_run 同一条 fail-closed 判定，复用 run.js 口径） -------
  const { overall, reason } = overallOf(stateOps, check)

  // ---- 4. 报告与设定单（检查未过也生成，结论章如实写未决项） -----------------
  const now = new Date()
  const reportPath = path.join(deliveryDir, 'delivery_report.md')
  writeFileSync(reportPath, buildDeliveryReport({
    job, state, machine, declarationsDoc, check, overall, reason, note, now,
  }))
  const setupPath = path.join(deliveryDir, 'setup_sheet.md')
  writeFileSync(setupPath, buildSetupSheet({ job, state, machine, now }))

  // ---- 5. 事件与摘要 ---------------------------------------------------------
  const files = [
    { path: zipPath, kind: 'nc_archive', bytes: zipped.data.bytes.length, sha256: zipped.data.sha256 },
    { path: reportPath, kind: 'delivery_report' },
    { path: setupPath, kind: 'setup_sheet' },
  ]
  emit('cam/delivered', {
    run_id: runId,
    overall,
    delivery_dir: deliveryDir,
    files: files.map((f) => ({ ...f })),
  })

  const summary = {
    status: 'ok',
    run_id: runId,
    overall,
    ...(reason ? { reason } : {}),
    delivery_dir: deliveryDir,
    files,
    nc: {
      out_dir: job.out_dir,
      expected: check.expected,
      found: check.found,
      missing: check.missing,
      extra: check.extra,
      zip_sha256: check.zip_sha256,
    },
    advice: [],
    notes: [
      '刀路查看器 v1 未提供（P3 迭代）：NC 查看/仿真请在车间侧工具进行。',
      '会话「交付物」页签与卡片渲染属 P3；当前交付物为 run 目录 delivery/ 下的文件。',
    ],
  }
  const notOk = stateOps.filter((o) => o?.status !== 'ok')
  if (overall === 'ok') {
    summary.advice.push('交付包三件齐备且对账一致（nc_batch.zip / delivery_report.md / setup_sheet.md）。请人工核对报告与设定单后交付车间；NC 上真机前须人工签字放行。')
  } else if (overall === 'incomplete') {
    summary.advice.push('交付含未决项（报告「检查结论」章已如实列出）。可 cam_run resume=true 补齐后重新 cam_deliver；按现状交付需人工确认（本工具每次调用都过签字闸门）。')
  } else {
    summary.advice.push(`有工序失败终态：${notOk.map((o) => `${o?.name}(${opStatusCn(o?.status)})`).join('、')}。修复后 cam_run resume=true 续跑，再重新 cam_deliver。`)
  }
  return summary
}

export function registerCamDeliver(ctx, camPipeline) {
  ctx.tools.register({
    name: 'cam_deliver',
    description:
      'CAM 交付打包：把 run 的执行结果变成交付物。/fs_zip 回收 proxy 侧 out_dir 的 *.nc '
      + '到 run 目录 delivery/nc_batch.zip（sha256 端到端校验；打开 zip 实数 .nc 与 runstate '
      + '记录逐名对账，不信响应头文件数），并生成中文交付报告 delivery_report.md 与加工设定单 '
      + 'setup_sheet.md。前置：同一 run_id 必须先 cam_run 跑完（本工具读 runstate.json）；'
      + '检查未全过（incomplete/error）也会出包、报告如实写未决项，是否交付由签字人判定。'
      + '刀路查看器 v1 未提供（P3）。',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'cam_plan 返回、且已 cam_run 执行过的 run_id' },
        note: { type: 'string', description: '可选交付备注，写进交付报告「备注」章' },
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
      const note = typeof args?.note === 'string' && args.note.trim() ? args.note.trim() : undefined
      const dshHome = process.env.DSH_HOME
      if (!dshHome) return json({ status: 'error', stage: 'args', msg: 'DSH_HOME 未设置，无法定位 run 目录。' })
      const resolvedDir = resolveRunDir(dshHome, safeSessionId(exec?.agent?.id), runId)
      if (resolvedDir.error) return json({ status: 'error', stage: 'args', msg: resolvedDir.error.reason })
      const runDir = resolvedDir.dir
      if (!existsSync(path.join(runDir, 'job.json'))) {
        return json({ status: 'error', stage: 'args', msg: `run 目录 ${runDir} 不存在或缺 job.json。请先用 cam_plan 落盘工序单（它会返回 run_id）。` })
      }
      if (!existsSync(path.join(runDir, 'runstate.json'))) {
        return json({ status: 'error', stage: 'args', msg: `run 目录 ${runDir} 缺 runstate.json——本 run 还没执行过。请先调用 cam_run 跑完，再 cam_deliver 交付。` })
      }

      const session = exec?.agent?.session
      const emit = (type, payload) => {
        try {
          session?.append(type, payload)
        } catch {
          // 会话事件是观测面，session 拆离等失败不得影响交付本体。
        }
      }
      return json(await executeCamDeliver({ camPipeline, runDir, runId, note, emit }))
    },
  })
}
