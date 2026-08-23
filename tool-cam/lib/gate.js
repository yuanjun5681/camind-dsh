// cam_run / cam_deliver 硬闸门（设计稿 docs/cam-machining-design.md §4.3）——
// tools/pre-execute 瀑布监听器，只拦这两个工具，其余一律 next() 秒过。
//
// 红线：闸门只认 run 目录落盘文件（job.json + declarations.json + runstate.json），
// 不认对话记忆。cam_run：高风险工序（tap_holes 类型或带 risk 标记，口径与
// cam_plan 落盘侧共用 lib/risk.js）逐项对 declarations：缺失 → deny + 中文缺失
// 清单（模型拿清单回去问人，问齐后需重新 cam_plan 落盘——会产生新 run_id）；
// 齐全 → ask + 签字卡文案。cam_deliver：run 目录/job.json 缺失 → deny（先
// cam_plan），runstate.json 缺失 → deny（先 cam_run）；否则一律 ask 签字卡
// （件号/机床/工序数/检查 overall/NC 个数；检查未全过时醒目标注「检查未全过，
// 交付含未决项」——fail-closed 的判定权交签字人）。ask 由 tools 管线自动路由
// approval 缝（无应答方/策略 never → 平台自动转 deny，fail-closed 是平台行为；
// 批准一次性有效，approval/asked + approval/decided 审计由平台写 session 日志）。
//
// cordis waterfall 语义（本版本源码实证）：next() 不接受值——放行必须
// return next()；deny/ask 必须**直接 return 决策对象、不调用 next()**
// （veto 语义：不调 next 即截断链条，含内建默认 allow）。next({kind:'deny'})
// 在本版本不会线程化该值。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizeRiskKind, opRiskKind, riskKindLabel } from './risk.js'
import { overallOf } from './tools/run.js'
import { safeSessionId } from './tools/survey.js'

// run_id 只允许 cam_plan 分配出的字符集（防路径穿越）。
// delivery-route.js 的下载路由复用同一口径。
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

function deny(reason) {
  return { kind: 'deny', reason }
}

// run 目录解析：$DSH_HOME/cam-runs/<session>/<run_id>/，含越界防御。
// 返回 { dir } 或 { error: <decision> }。
export function resolveRunDir(dshHome, sessionId, runId) {
  if (!RUN_ID_PATTERN.test(runId)) {
    return { error: deny(`run_id「${runId}」不合法：只接受字母/数字/下划线/连字符（cam_plan 返回的值）。`) }
  }
  const runsRoot = path.join(dshHome, 'cam-runs')
  const dir = path.join(runsRoot, sessionId, runId)
  if (!dir.startsWith(runsRoot + path.sep)) {
    return { error: deny(`run_id「${runId}」解析越界，已拒绝。`) }
  }
  return { dir }
}

// 纯决策函数（与 cordis 接线分离，可脱离 dsh 运行时单测）。
// 返回 PreToolDecision：{kind:'allow'} 不会从这里产生——非 cam_run 在接线层
// 就 next() 了；本函数只产出 deny / ask。
export function evaluateCamRunGate({ dshHome, sessionId, runId }) {
  if (!dshHome) return deny('DSH_HOME 未设置，闸门无法核对 run 目录（fail-closed）。')
  const resolved = resolveRunDir(dshHome, sessionId, runId)
  if (resolved.error) return resolved.error
  const { dir } = resolved

  const jobPath = path.join(dir, 'job.json')
  const declPath = path.join(dir, 'declarations.json')
  const missing = [jobPath, declPath].filter((p) => !existsSync(p))
  if (missing.length > 0) {
    return deny(
      `cam_run 被闸门拦下：run 目录 ${dir} 不完整（缺 ${missing.map((p) => path.basename(p)).join('、')}）。`
      + '请先用 cam_plan 校验并落盘工序单（它会返回 run_id），再对返回的 run_id 调用 cam_run。',
    )
  }

  let job
  let declarationsDoc
  try {
    job = JSON.parse(readFileSync(jobPath, 'utf8'))
    declarationsDoc = JSON.parse(readFileSync(declPath, 'utf8'))
  } catch (error) {
    return deny(`cam_run 被闸门拦下：run 目录文件无法解析（${error.message}）。请重新 cam_plan 落盘后再试。`)
  }

  const ops = Array.isArray(job?.operations) ? job.operations : []
  const declaredKinds = new Set(
    (Array.isArray(declarationsDoc?.declarations) ? declarationsDoc.declarations : [])
      .map((d) => normalizeRiskKind(d?.kind))
      .filter(Boolean),
  )
  const missingDecls = []
  let riskCount = 0
  for (let i = 0; i < ops.length; i += 1) {
    const kind = opRiskKind(ops[i])
    if (!kind) continue
    riskCount += 1
    if (!declaredKinds.has(kind)) {
      missingDecls.push(`operations[${i}]（${ops[i]?.new_name ?? ops[i]?.type}）：${riskKindLabel(kind)}工序缺 ${kind} 类书面声明`)
    }
  }
  if (missingDecls.length > 0) {
    return deny(
      'cam_run 被闸门拦下：高风险工序缺少用户书面声明（闸门只认 run 目录落盘文件，不认对话记忆）：\n'
      + missingDecls.map((m) => `  · ${m}`).join('\n')
      + '\n请先在对话里向用户问齐（可用 ask_user_question 预填 cam_survey 的候选清单），'
      + '然后把声明写进 cam_plan 的 declarations 重新落盘——注意重新 cam_plan 会产生新的 run_id，'
      + '请对新 run_id 调用 cam_run。',
    )
  }

  const partId = job?.part_id ?? '未知'
  const machineId = job?.machine_context?.machine_instance_id ?? '未知'
  return {
    kind: 'ask',
    reason:
      'CAM 远程执行签字（cam_run）：\n'
      + `  件号：${partId}\n`
      + `  机床：${machineId}\n`
      + `  工序数：${ops.length}\n`
      + `  高风险工序：${riskCount} 项（书面声明已落盘核对齐全）\n`
      + `  run_id：${runId}\n`
      + '批准后将在 work copy 上远程执行（主模型不被写），完成后做 NC 对账与空刀路自检。',
  }
}

// cam_deliver 的纯决策函数（与 cordis 接线分离）：只认 run 目录落盘文件。
// 检查 overall 用与 cam_run 收尾同一条 fail-closed 判定（overallOf，复用
// run.js 口径，两处各写一份必然漂移）；NC 个数取 runstate ok 工序的记录数。
export function evaluateCamDeliverGate({ dshHome, sessionId, runId }) {
  if (!dshHome) return deny('DSH_HOME 未设置，闸门无法核对 run 目录（fail-closed）。')
  const resolved = resolveRunDir(dshHome, sessionId, runId)
  if (resolved.error) return resolved.error
  const { dir } = resolved

  const jobPath = path.join(dir, 'job.json')
  const statePath = path.join(dir, 'runstate.json')
  if (!existsSync(jobPath)) {
    return deny(
      `cam_deliver 被闸门拦下：run 目录 ${dir} 不存在或缺 job.json。`
      + '请先用 cam_plan 校验并落盘工序单（它会返回 run_id）。',
    )
  }
  if (!existsSync(statePath)) {
    return deny(
      `cam_deliver 被闸门拦下：${dir} 缺 runstate.json——本 run 还没执行过（或没执行完）。`
      + '请先对该 run_id 调用 cam_run 跑完，再 cam_deliver 交付。',
    )
  }

  let job
  let state
  try {
    job = JSON.parse(readFileSync(jobPath, 'utf8'))
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (error) {
    return deny(`cam_deliver 被闸门拦下：run 目录文件无法解析（${error.message}）。请人工检查 run 目录后再试。`)
  }

  const ops = Array.isArray(state?.ops) ? state.ops : []
  const { overall, reason } = overallOf(ops, null)
  const ncCount = ops
    .filter((o) => o?.status === 'ok')
    .flatMap((o) => (Array.isArray(o?.nc_files) ? o.nc_files : []))
    .length
  const partId = job?.part_id ?? '未知'
  const machineId = job?.machine_context?.machine_instance_id ?? '未知'
  const warn = overall === 'ok'
    ? ''
    : '⚠️ **检查未全过，交付含未决项**——fail-closed 的判定权交签字人：'
      + '交付报告会如实列出未决项，是否按现状交付由你决定。\n'
  return {
    kind: 'ask',
    reason:
      'CAM 交付签字（cam_deliver）：\n'
      + warn
      + `  件号：${partId}\n`
      + `  机床：${machineId}\n`
      + `  工序数：${ops.length}\n`
      + `  检查结论：${overall}${overall === 'ok' ? '（全部工序 NC 在盘）' : `（${reason ?? '有工序未达 ok'}）`}\n`
      + `  NC 个数：${ncCount}（runstate ok 工序记录）\n`
      + `  run_id：${runId}\n`
      + '批准后将从 proxy 侧 out_dir 打包回收 *.nc（sha256 校验 + 开包实数对账），'
      + '并在 run 目录生成 delivery/ 交付包（NC 批次 + 交付报告 + 加工设定单）。',
  }
}

export function registerCamGate(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name !== 'cam_run' && exec.name !== 'cam_deliver') return next()
    try {
      const runId = typeof exec.arguments?.run_id === 'string' ? exec.arguments.run_id.trim() : ''
      if (!runId) return deny(`${exec.name} 缺参数 run_id（cam_plan 落盘时返回的值）。`)
      const args = {
        dshHome: process.env.DSH_HOME ?? '',
        sessionId: safeSessionId(exec.agent?.id),
        runId,
      }
      return exec.name === 'cam_run' ? evaluateCamRunGate(args) : evaluateCamDeliverGate(args)
    } catch (error) {
      // 闸门自身异常一律 fail-closed（deny），不放过执行。
      return deny(`${exec.name} 闸门核对失败（${error.message}），已按 fail-closed 拒绝执行。`)
    }
  })
}
