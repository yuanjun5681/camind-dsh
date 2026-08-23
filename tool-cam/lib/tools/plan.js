// cam_plan 模型工具 v1 —— 工序单的确定性校验 + 机床绑定 + 冻结落盘。
//
// v1 定位（与设计稿 §4.2 全量定义的偏差）：不内建自动排工艺规则引擎（旧 Camind
// planning/ 的规则不搬）——工序单草案由会话模型按 skill 起草，本工具只做：
//   1. 结构校验（camindbase_job "0" schema 必填、operations 三类型 + tap_holes、
//      new_name 含 {suffix} 占位且互不重复）；
//   2. 机床绑定（inject machineRegistry 直读档案，不经模型转手，§3 关键决策 3）：
//      刀具引用必须在冻结刀库（TOOL_NOT_LOADED 式阻断）、显式转速/进给超机床
//      上限阻断、刚性攻丝 feed = spindle × pitch；
//   3. 高风险声明核对：攻丝/沉窝类工序必须在 declarations 有对应书面声明；
//   4. 通过后冻结落盘 run 目录（job.json / declarations.json / machine_snapshot.json）。
// 校验错误全部一次性聚合报完（中文、可行动）。全自动规则排产属后续迭代。
//
// 与 camPipeline 的关系：v1 不调 proxy（纯本地校验 + 落盘）。job.json 的 prt 字段
// 写的是 proxy 侧的目标路径（input/<session>_<sha8>_<文件名>，命名约定同 cam_survey），
// 实际 /fs_upload 推送由 cam_run 执行时完成。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { normalizeRiskKind, opRiskKind } from '../risk.js'
import { resolvePart, safeRemoteName, safeSessionId } from './survey.js'

const SCHEMA_VERSION = '0'
const DEFAULT_POST = 'MILL_3_AXIS'

// v1 工序类型白名单（jobspec 三类型 + 高风险攻丝显式类型 tap_holes）。
const OP_TYPES = {
  copy_postprocess: ['template', 'new_name'],
  from_scratch_workpiece_op: ['new_name', 'geometry'],
  face_select_generate: ['template', 'new_name'],
  tap_holes: ['new_name', 'hole_centers', 'attack_dia', 'pitch'],
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function json(payload) {
  return JSON.stringify(payload, null, 2)
}

// runId：时间戳 + 件号（可读即可）；同秒撞名追加 -2/-3…
function allocateRunDir(runsRoot, sessionId, partId) {
  const now = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const safePart = String(partId).replace(/[^A-Za-z0-9_-]/g, '_') || 'part'
  let runId = `${stamp}-${safePart}`
  let n = 2
  while (existsSync(path.join(runsRoot, sessionId, runId))) {
    runId = `${stamp}-${safePart}-${n}`
    n += 1
  }
  const dir = path.join(runsRoot, sessionId, runId)
  mkdirSync(dir, { recursive: true })
  return { runId, dir }
}

export function registerCamPlan(ctx, { machineRegistry, uploads }) {
  ctx.tools.register({
    name: 'cam_plan',
    description:
      'CAM 排工艺 v1：对模型起草的工序单做确定性校验 + 机床绑定 + 冻结落盘（不自动排工艺、不调 NX）。'
      + '调用前应先 cam_survey 读件、问齐高风险书面声明（declarations）、查 search_memory 同类经验。'
      + '校验内容：operations 结构（三类型 + tap_holes，new_name 必须含 {suffix} 占位且互不重复）、'
      + '刀具引用必须逐字命中机床刀库（库里没有直接阻断）、显式转速/进给不得超机床上限'
      + '（拿不准就留空，交材料规则解析）、刚性攻丝 feed = spindle × pitch、'
      + '攻丝/沉窝工序必须有对应 declarations 声明。全部问题一次性聚合返回；'
      + '通过后落盘 run 目录（job.json + declarations.json + machine_snapshot.json）并返回 run_id。',
    parameters: {
      type: 'object',
      properties: {
        part_id: { type: 'string', description: '件号（报告与 run 目录命名用）' },
        part: { type: 'string', description: '当前会话已上传的 3D 零件文件名（同 cam_survey 的 part 入参）' },
        machine_id: { type: 'string', description: '目标机床 id（先 list_machines 确认；机床参数由工具直读档案，不经模型转手）' },
        declarations: {
          type: 'array',
          description: '用户的书面高风险声明，如 [{kind:"tapping",detail:"M8 攻丝 2 处"}]；kind 取值 tapping/countersink（或中文 攻丝/沉窝）',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['kind', 'detail'],
          },
        },
        operations: {
          type: 'array',
          description:
            '模型起草的工序数组。类型白名单：copy_postprocess(template,new_name) / '
            + 'from_scratch_workpiece_op(new_name,geometry) / face_select_generate(template,new_name) / '
            + 'tap_holes(new_name,hole_centers,attack_dia,pitch)。new_name 必须含 {suffix} 占位；'
            + '刀具用 tool_assembly_id（或刀库控制刀号 tool 如 T6）逐字引用；'
            + 'spindle/feed 拿不准留空；攻丝/沉窝类在 declarations 里要有对应声明。',
          items: { type: 'object' },
        },
        post_name: { type: 'string', description: `后处理器名，默认 ${DEFAULT_POST}` },
        out_dir: { type: 'string', description: 'proxy 侧输出目录（相对 base_dir），默认 output/<part_id>' },
        prepare: {
          type: 'object',
          description:
            '可选 prepare 段（裸件引导，cam_run 在 work copy 上执行）：'
            + '{init_setup: true 或 {tool_diameter?, ensure_tool?}}——零件没有 CAM setup '
            + '（裸件）且工序单含 from_scratch_workpiece_op 时给出；件内已有 setup/模板工序时省略。',
        },
      },
      required: ['part_id', 'part', 'machine_id', 'operations'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const errors = []

      // ---- 入参粗检 -------------------------------------------------------
      const partId = typeof args?.part_id === 'string' ? args.part_id.trim() : ''
      if (!partId) errors.push('part_id 缺失或为空。')
      const machineId = typeof args?.machine_id === 'string' ? args.machine_id.trim() : ''
      if (!machineId) errors.push('machine_id 缺失或为空（先 list_machines 看车间有哪些机床）。')
      const postName = typeof args?.post_name === 'string' && args.post_name.trim() ? args.post_name.trim() : DEFAULT_POST
      const outDir = typeof args?.out_dir === 'string' && args.out_dir.trim()
        ? args.out_dir.trim()
        : `output/${partId || '<part_id>'}`

      // ---- 上传件解析（同 cam_survey） ------------------------------------
      const requestedPart = typeof args?.part === 'string' ? args.part.trim() : ''
      let partRef = null
      if (!requestedPart) {
        errors.push('part 缺失或为空：请给出当前会话已上传的 3D 文件名。')
      } else {
        let resolved
        try {
          resolved = resolvePart(uploads, exec, requestedPart)
        } catch (error) {
          return json({ status: 'error', stage: 'resolve_upload', msg: `读取上传清单失败：${error.message}` })
        }
        if (resolved.error) return resolved.error
        partRef = resolved
      }

      // ---- 机床档案读取（machineRegistry 直读，不经模型转手） --------------
      let machine = null
      if (machineId) {
        try {
          machine = machineRegistry.get(machineId)
        } catch (error) {
          errors.push(error.message)
        }
      }

      // ---- operations 结构校验 --------------------------------------------
      const ops = Array.isArray(args?.operations) ? args.operations : null
      if (!ops || ops.length === 0) {
        errors.push('operations 缺失或为空数组：工序单至少要有一道写明白的工序。')
      }
      const names = new Set()
      if (ops) {
        for (let i = 0; i < ops.length; i += 1) {
          const op = ops[i]
          const label = `operations[${i}]`
          if (!op || typeof op !== 'object' || Array.isArray(op)) {
            errors.push(`${label} 必须是对象。`)
            continue
          }
          const required = OP_TYPES[op.type]
          if (!required) {
            errors.push(`${label} type 未知：${JSON.stringify(op.type)}（v1 支持：${Object.keys(OP_TYPES).join('、')}）`)
            continue
          }
          const missing = required.filter((key) => op[key] === undefined || op[key] === null || op[key] === '')
          if (missing.length > 0) errors.push(`${label}（type=${op.type}）缺必填字段：${missing.join('、')}`)
          const name = typeof op.new_name === 'string' ? op.new_name : ''
          if (name) {
            if (!name.includes('{suffix}')) {
              errors.push(`${label} new_name「${name}」缺少 {suffix} 占位（重复执行会在 CAM 工作站内撞名）。`)
            }
            if (names.has(name)) errors.push(`${label} new_name 重复：${name}（工序名必须互不重复）。`)
            names.add(name)
          }
          for (const key of ['spindle', 'feed', 'depth', 'pitch']) {
            if (op[key] !== undefined && op[key] !== null && !isPositiveNumber(op[key])) {
              errors.push(`${label}.${key} 必须是正数。`)
            }
          }
        }
      }

      // ---- 机床绑定校验（档案有效才做） ------------------------------------
      if (machine && ops) {
        const pockets = Array.isArray(machine.magazine?.pockets) ? machine.magazine.pockets : []
        const controlIds = new Set(pockets.map((p) => p?.control_tool_id).filter(Boolean))
        const assemblyIds = new Set(
          pockets.map((p) => p?.tool?.tool_assembly_id).filter(Boolean),
        )
        const rpmMax = machine.spindle?.rpm_max
        const rpmMin = machine.spindle?.rpm_min
        const feedMax = machine.kinematics?.max_cut_feed_mm_min

        for (let i = 0; i < ops.length; i += 1) {
          const op = ops[i]
          if (!op || typeof op !== 'object' || Array.isArray(op) || !OP_TYPES[op.type]) continue
          const label = `operations[${i}]（${op.new_name ?? op.type}）`

          // 刀具引用：tool_assembly_id / 控制刀号必须逐字命中冻结刀库，否则阻断。
          if (op.tool_assembly_id !== undefined && op.tool_assembly_id !== null) {
            if (!assemblyIds.has(op.tool_assembly_id)) {
              errors.push(
                `${label} 引用的刀具装配号「${op.tool_assembly_id}」不在 ${machineId} 的刀库里（TOOL_NOT_LOADED）。`
                + `刀库现有：${[...assemblyIds].join('、') || '（空）'}。库里没有的刀不要编造——先与人确认装刀。`,
              )
            }
          }
          if (op.tool !== undefined && op.tool !== null) {
            if (!controlIds.has(op.tool) && !assemblyIds.has(op.tool)) {
              errors.push(
                `${label} 引用的刀号「${op.tool}」不在 ${machineId} 的刀库里（TOOL_NOT_LOADED）。`
                + `控制刀号现有：${[...controlIds].join('、') || '（空）'}。`,
              )
            }
          }

          // 显式转速/进给超机床上限直接阻断；留空交材料规则解析，不拦。
          if (isPositiveNumber(op.spindle)) {
            if (typeof rpmMax === 'number' && op.spindle > rpmMax) {
              errors.push(`${label} 显式转速 ${op.spindle} rpm 超过 ${machineId} 主轴上限 ${rpmMax} rpm。`)
            }
            if (typeof rpmMin === 'number' && op.spindle < rpmMin) {
              errors.push(`${label} 显式转速 ${op.spindle} rpm 低于 ${machineId} 主轴下限 ${rpmMin} rpm。`)
            }
          }
          if (isPositiveNumber(op.feed) && typeof feedMax === 'number' && op.feed > feedMax) {
            errors.push(`${label} 显式进给 ${op.feed} mm/min 超过 ${machineId} 切削进给上限 ${feedMax} mm/min。`)
          }

          // 刚性攻丝：转速进给都显式给出时必须满足 feed = spindle × pitch。
          if (opRiskKind(op) === 'tapping' && isPositiveNumber(op.pitch)
            && isPositiveNumber(op.spindle) && isPositiveNumber(op.feed)) {
            const expected = op.spindle * op.pitch
            if (Math.abs(op.feed - expected) > Math.max(0.5, expected * 0.005)) {
              errors.push(
                `${label} 刚性攻丝进给不满足 feed = spindle × pitch：`
                + `spindle ${op.spindle} × pitch ${op.pitch} = ${expected} mm/min，实给 feed ${op.feed}。`
                + '不确定转速时只给 pitch，转速与进给留空交材料规则处理。',
              )
            }
          }
        }
      }

      // ---- 高风险声明核对 ---------------------------------------------------
      const declarations = Array.isArray(args?.declarations) ? args.declarations : []
      for (let i = 0; i < declarations.length; i += 1) {
        const d = declarations[i]
        if (!d || typeof d !== 'object' || typeof d.kind !== 'string' || !d.kind.trim()
          || typeof d.detail !== 'string' || !d.detail.trim()) {
          errors.push(`declarations[${i}] 必须是含非空 kind 与 detail 的对象（如 {kind:"tapping", detail:"M8 攻丝 2 处"}）。`)
        }
      }
      const declaredKinds = new Set(
        declarations.map((d) => normalizeRiskKind(d?.kind)).filter(Boolean),
      )
      if (ops) {
        const missing = []
        for (let i = 0; i < ops.length; i += 1) {
          const op = ops[i]
          if (!op || typeof op !== 'object' || Array.isArray(op)) continue
          const kind = opRiskKind(op)
          if (kind && !declaredKinds.has(kind)) {
            const kindLabel = kind === 'tapping' ? '攻丝' : '沉窝'
            missing.push(`operations[${i}]（${op.new_name ?? op.type}）：${kindLabel}工序缺 ${kind} 类书面声明`)
          }
        }
        if (missing.length > 0) {
          errors.push(
            '高风险工序缺少用户书面声明（无声明不得进入执行）：\n'
            + missing.map((m) => `  · ${m}`).join('\n')
            + '\n请先在对话里向用户问齐（可用 ask_user_question 预填 cam_survey 的候选清单），'
            + '确认后把声明写进 declarations 重新调用。',
          )
        }
      }

      // ---- prepare 段（可选，裸件引导；cam_run 在 work copy 上执行） ----------
      let prepare
      if (args?.prepare !== undefined && args?.prepare !== null) {
        if (typeof args.prepare !== 'object' || Array.isArray(args.prepare)) {
          errors.push('prepare 必须是对象（如 {init_setup: true}）。')
        } else {
          const init = args.prepare.init_setup
          const initOk = init === undefined || init === true || init === false
            || (typeof init === 'object' && init !== null && !Array.isArray(init))
          if (!initOk) {
            errors.push('prepare.init_setup 必须是 true/false 或对象（{tool_diameter?, ensure_tool?}）。')
          } else if (init) {
            prepare = { init_setup: init }
          }
        }
      }

      // ---- 聚合报错或落盘 ---------------------------------------------------
      if (errors.length > 0) {
        return json({
          status: 'error',
          stage: 'validate',
          msg: `cam_plan 校验不通过（共 ${errors.length} 项，全部列出）：`,
          errors,
        })
      }

      const dshHome = process.env.DSH_HOME
      if (!dshHome) {
        return json({ status: 'error', stage: 'persist', msg: 'DSH_HOME 未设置，run 目录无法落盘。' })
      }
      const sessionId = safeSessionId(exec?.agent?.id)
      const { runId, dir } = allocateRunDir(path.join(dshHome, 'cam-runs'), sessionId, partId)

      const sha8 = createHash('sha256').update(partRef.file.absolute).digest('hex').slice(0, 8)
      const remoteRel = `input/${sessionId}_${sha8}_${safeRemoteName(partRef.file.name)}`
      const job = {
        camindbase_job: SCHEMA_VERSION,
        part_id: partId,
        prt: remoteRel,
        prt_local: partRef.file.absolute,
        out_dir: outDir,
        post_name: postName,
        work_copy: true,
        machine_context: {
          machine_instance_id: machineId,
          expected_profile_revision: machine.version ?? null,
          expected_magazine_revision: machine.magazine_version ?? null,
        },
        operations: ops,
        ...(prepare ? { prepare } : {}),
      }
      const snapshot = machineRegistry.snapshot(machineId)
      writeFileSync(path.join(dir, 'job.json'), `${JSON.stringify(job, null, 2)}\n`)
      writeFileSync(path.join(dir, 'declarations.json'), `${JSON.stringify({
        part_id: partId,
        machine_id: machineId,
        declared_at: new Date().toISOString(),
        declarations,
      }, null, 2)}\n`)
      writeFileSync(path.join(dir, 'machine_snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`)

      return json({
        status: 'ok',
        run_id: runId,
        run_dir: dir,
        files: ['job.json', 'declarations.json', 'machine_snapshot.json'],
        machine: {
          machine_id: machineId,
          display_name: machine.display_name,
          profile_revision: machine.version,
          magazine_revision: machine.magazine_version ?? null,
        },
        operations: ops.map((op, i) => ({
          index: i,
          type: op.type,
          new_name: op.new_name,
          tool_assembly_id: op.tool_assembly_id ?? op.tool ?? null,
          risk: opRiskKind(op),
        })),
        notes: [
          'job.json 的 prt 是 proxy 侧目标路径、prt_local 是本地原件绝对路径；实际上传由 cam_run 执行时完成（本工具不调 proxy）。',
          'machine_snapshot.json 为冻结快照：之后改机床档案不影响本 run。',
          'declarations.json 是用户书面声明留档，cam_run 的闸门将读盘核对（不认对话记忆）。',
        ],
      })
    },
  })
}
