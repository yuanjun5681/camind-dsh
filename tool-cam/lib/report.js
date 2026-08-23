// 交付报告与加工设定单拼装（纯函数，无 IO、不依赖 dsh 运行时，可脱离单测）。
// 语义参考旧 Camind backend/app/services/cam/report.py（build_delivery_report /
// build_setup_sheet），但不照搬体量：v1 只保留签字人/车间真正要看的章节——
// 交付报告：概要 / 工序逐项结论（含每项决定来源）/ 高风险声明留档 / NC 清单与
// 对账 / 检查结论（未过如实写未决项）/ 备注；设定单：机床 / 夹具与工件坐标系 /
// 冻结刀库引用 / 后处理器 / 转速进给上限 / 工序顺序 / 装夹与安全。
// 翻面验证、特征核对、工件四视图、PDF 与刀路查看器均属后续迭代（设计稿 §4.2 偏差注记）。

const OP_TYPE_CN = {
  copy_postprocess: '模板工序',
  from_scratch_workpiece_op: '型腔开粗（自建）',
  face_select_generate: '面铣（选面）',
  tap_holes: '攻丝',
}

const OP_STATUS_CN = {
  ok: '完成',
  generated: '缺NC',
  empty: '空刀路',
  error: '失败',
  pending: '未执行',
}

const OVERALL_CN = {
  ok: 'ok（全部工序 NC 在盘且对账一致）',
  incomplete: 'incomplete（交付不完整，fail-closed）',
  error: 'error（有工序失败）',
}

export function opTypeCn(type) {
  return OP_TYPE_CN[type] ?? type ?? '—'
}

export function opStatusCn(status) {
  return OP_STATUS_CN[status] ?? status ?? '—'
}

function stampOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now())
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function basenameOf(p) {
  const text = String(p)
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return slash >= 0 ? text.slice(slash + 1) : text
}

function toolRefOf(op) {
  return op?.tool_assembly_id ?? op?.tool ?? null
}

// job.operations 与 runstate.ops 按 index 对齐出 (序号, op定义, 执行终态行)。
function joinOps(job, state) {
  const ops = Array.isArray(job?.operations) ? job.operations : []
  const stateOps = Array.isArray(state?.ops) ? state.ops : []
  const byIndex = new Map(stateOps.map((o) => [o?.index, o]))
  return ops.map((op, i) => ({ index: i, op, st: byIndex.get(i) ?? {} }))
}

// 冻结刀库查找：tool_assembly_id 或控制刀号逐字命中 pocket。
function findPocket(machine, ref) {
  const pockets = Array.isArray(machine?.magazine?.pockets) ? machine.magazine.pockets : []
  return pockets.find((p) => p?.tool?.tool_assembly_id === ref || p?.control_tool_id === ref) ?? null
}

// ---- 交付报告（签字人视角） ------------------------------------------------

export function buildDeliveryReport({
  job, state, machine, declarationsDoc, check, overall, reason, note, now,
}) {
  const partId = job?.part_id ?? '（未填件号）'
  const machineId = job?.machine_context?.machine_instance_id ?? '未知'
  const machineLabel = machine?.display_name ? `${machineId}（${machine.display_name}）` : machineId
  const postName = job?.post_name ?? 'MILL_3_AXIS'
  const rows = joinOps(job, state)
  const declarations = Array.isArray(declarationsDoc?.declarations) ? declarationsDoc.declarations : []
  const expected = Array.isArray(check?.expectedNames) ? check.expectedNames : []
  const missing = Array.isArray(check?.missing) ? check.missing : []
  const extra = Array.isArray(check?.extra) ? check.extra : []
  const notOk = rows.filter(({ st }) => st?.status !== 'ok')

  let lines = [
    `# 加工交付报告：${partId}`,
    '',
    `> 生成时间 ${stampOf(now)}　run_id ${state?.run_id ?? '—'}　后处理器 ${postName}`,
    '',
    '## 一、概要',
    '',
    `- 件号：${partId}`,
    `- 机床：${machineLabel}`,
    `- 主模型：${job?.prt ?? '—'}（work copy：${state?.work_copy ?? '—'}，主模型不被写）`,
    `- 输出目录（proxy 侧）：${job?.out_dir ?? '—'}`,
    `- 工序数：${rows.length} 道`,
    `- 交付 NC：${check?.found ?? 0} 个（期望 ${check?.expected ?? expected.length} 个）`,
    `- 交付结论：**${OVERALL_CN[overall] ?? overall}**${reason ? `——${reason}` : ''}`,
    '',
    '## 二、工序逐项结论',
    '',
    '| # | 工序 | 类型 | 终态 | 刀具 | 转速/进给 | NC |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const { index, op, st } of rows) {
    const ncNames = (st?.nc_files ?? []).map(basenameOf).join('、') || '—'
    const spindleFeed = op?.spindle || op?.feed
      ? `${op?.spindle ?? '—'} rpm / ${op?.feed ?? '—'} mm/min`
      : '—（材料规则）'
    lines.push(
      `| ${index + 1} | ${st?.name ?? op?.new_name ?? '—'} | ${opTypeCn(op?.type)} | `
      + `${opStatusCn(st?.status)} | ${toolRefOf(op) ?? '—（沿用件内）'} | ${spindleFeed} | ${ncNames} |`,
    )
  }
  lines.push(...[
    '',
    '决定来源（每项结论以哪份落盘文件为准）：',
    '- 工序终态：`runstate.json`（cam_run 逐 op 原子落盘的执行终态）。',
    '- 刀具引用 / 显式转速进给：`job.json` 显式值，已经 `machine_snapshot.json` 冻结刀库'
      + '与转速/进给上限校验（cam_plan 落盘时冻结，之后改机床档案不影响本 run）。',
    '- 高风险声明：`declarations.json`（用户书面声明留档，闸门只认落盘文件，不认对话记忆）。',
    '',
    '## 三、高风险声明留档',
    '',
  ])
  if (declarations.length > 0) {
    lines.push(`声明时间：${declarationsDoc?.declared_at ?? '—'}`, '', '| 类别 | 内容 |', '|---|---|')
    for (const d of declarations) lines.push(`| ${d?.kind ?? '—'} | ${d?.detail ?? '—'} |`)
  } else {
    lines.push('- 本 run 无高风险声明记录（工序单不含攻丝/沉窝类工序，或未产生声明）。')
  }
  lines.push(...[
    '',
    '## 四、NC 清单与对账',
    '',
    `- 期望（runstate ok 工序记录）：${expected.length} 个${expected.length > 0 ? `：${expected.join('、')}` : ''}`,
    `- 回收包实数（打开 zip 数 .nc，**不信 X-CAM-Files 响应头**）：${check?.total_nc_in_dir ?? 0} 个`,
    `- 对账结论：${missing.length === 0 ? '一致' : `**不符——缺 ${missing.join('、')}**`}`
      + `${extra.length > 0 ? `；包内另有非本 run 期望的 .nc：${extra.join('、')}` : ''}`,
    `- 传输校验：zip sha256 \`${check?.zip_sha256 ?? '—'}\`（与响应头 X-CAM-SHA256 一致）`,
    '',
    '## 五、检查结论',
    '',
    `- 总结论：**${OVERALL_CN[overall] ?? overall}**`,
  ])
  if (reason) lines.push(`- 原因：${reason}`)
  if (overall !== 'ok') {
    lines.push('', '未决项（如实列出，是否按现状交付由签字人判定）：')
    for (const { op, st } of notOk) {
      lines.push(`- 工序 ${st?.name ?? op?.new_name ?? '?'}：${opStatusCn(st?.status)}${st?.error ? `——${st.error}` : ''}`)
    }
    if (missing.length > 0) lines.push(`- NC 对账缺：${missing.join('、')}`)
  }
  lines.push('', '## 六、备注', '')
  if (note) lines.push(`- 交付备注：${note}`)
  lines.push(
    '- 刀路查看器本迭代未提供（旧 Camind 的 cnc-simulator 资产包太重，留 P3）：NC 查看/仿真请在车间侧工具进行。',
    '- 安全提示：所有 NC 上真机前必须人工签字放行；程序数须与工序数对账一致。',
  )
  return `${lines.join('\n')}\n`
}

// ---- 加工设定单（车间视角） ------------------------------------------------

export function buildSetupSheet({ job, state, machine, now }) {
  const partId = job?.part_id ?? '（未填件号）'
  const machineId = job?.machine_context?.machine_instance_id ?? '未知'
  const rows = joinOps(job, state)

  let lines = [
    `# 加工设定单：${partId}`,
    '',
    `> 生成时间 ${stampOf(now)}　run_id ${state?.run_id ?? '—'}`,
    '',
    '## 机床',
    '',
    `- 机床号：${machineId}`,
  ]
  if (machine) {
    lines.push(
      `- 名称：${machine.display_name ?? '—'}（${machine.identity?.manufacturer ?? ''} ${machine.identity?.model ?? ''}）`,
      `- 控制器：${[machine.controller?.vendor, machine.controller?.family, machine.controller?.model].filter(Boolean).join(' ') || '—'}`,
    )
  } else {
    lines.push('- ⚠️ 本 run 无 machine_snapshot.json（非本版本 cam_plan 落盘）——以下机床相关项缺失，上机前必须人工核对。')
  }

  lines.push('', '## 夹具与工件坐标系', '')
  const fixtures = Array.isArray(machine?.fixtures) ? machine.fixtures : []
  if (fixtures.length > 0) {
    lines.push('| 夹具 | 名称 | 默认工件坐标系 | 用途 |', '|---|---|---|---|')
    for (const f of fixtures) {
      lines.push(`| ${f?.fixture_id ?? '—'} | ${f?.name ?? '—'} | ${f?.default_offset ?? '—'} | ${f?.usage ?? '—'} |`)
    }
  } else {
    lines.push('- 档案未登记夹具：上机前必须补充确认夹具、工件坐标系与安全间隙。')
  }

  lines.push('', '## 刀具引用（冻结刀库）', '')
  const referenced = rows.filter(({ op }) => toolRefOf(op))
  if (referenced.length > 0) {
    lines.push('| 工序 | 引用 | 刀位 | 库内刀具 | 直径(mm) | 实测状态 |', '|---|---|---|---|---|---|')
    for (const { index, op, st } of referenced) {
      const ref = toolRefOf(op)
      const pocket = findPocket(machine, ref)
      if (!machine) {
        lines.push(`| ${index + 1} ${st?.name ?? op?.new_name ?? ''} | ${ref} | — | — | — | 无冻结快照，人工核对 |`)
      } else if (!pocket) {
        lines.push(`| ${index + 1} ${st?.name ?? op?.new_name ?? ''} | ${ref} | — | — | — | 不在冻结刀库（不应发生：cam_plan 已拦），人工核对 |`)
      } else {
        lines.push(
          `| ${index + 1} ${st?.name ?? op?.new_name ?? ''} | ${ref} | ${pocket.control_tool_id ?? `P${pocket.pocket}`} | `
          + `${pocket.tool?.name ?? '—'} | ${pocket.tool?.cutting_diameter_mm ?? '—'} | `
          + `${pocket.measured ? '有实测' : '无实测，上机前人工复核'} |`,
        )
      }
    }
  } else {
    lines.push('- 工序单未显式引用刀具（模板工序沿用件内刀具），上机前人工核对件内刀。')
  }

  lines.push('', '## 后处理器', '', `- 工序单指定：${job?.post_name ?? 'MILL_3_AXIS'}`)
  if (machine?.post) {
    const status = machine.post.qualification_status ?? '—'
    lines.push(
      `- 档案登记：${machine.post.id ?? '—'}（${machine.post.nx_version ?? '—'}），资格认定：${status}`
        + `${status === 'DRAFT' ? '（**未完成资格认定，上机前必须人工复核所出 NC**）' : ''}`,
    )
  }

  lines.push('', '## 转速/进给上限（冻结档案）', '')
  if (machine) {
    lines.push(
      `- 主轴：${machine.spindle?.rpm_min ?? '—'} ～ ${machine.spindle?.rpm_max ?? '—'} rpm`,
      `- 切削进给上限：${machine.kinematics?.max_cut_feed_mm_min ?? '—'} mm/min`,
    )
  } else {
    lines.push('- 无冻结快照：以现场机床铭牌与工艺卡为准。')
  }

  lines.push('', '## 工序顺序', '', '| # | 工序 | 类型 | 刀具 |', '|---|---|---|---|')
  for (const { index, op, st } of rows) {
    lines.push(`| ${index + 1} | ${st?.name ?? op?.new_name ?? '—'} | ${opTypeCn(op?.type)} | ${toolRefOf(op) ?? '—（沿用件内）'} |`)
  }

  lines.push(...[
    '',
    '## 装夹与安全',
    '',
    '- 核对工件坐标系、夹具、刀长与安全间隙后方可上机。',
    '- 首件试切并完成人工签字后方可批量加工。',
    '',
    '操作员：________　复核：________　日期：________',
  ])
  return `${lines.join('\n')}\n`
}
