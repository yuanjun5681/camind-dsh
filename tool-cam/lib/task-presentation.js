// Deterministic human-facing task projections; suggestions never become confirmations.
export const SETUP_LABELS = { material: '材料与状态', stock: '毛坯尺寸与已加工面', datum: '定位基准与工件坐标系', fixture: '夹具与避让限制' }
export function planningFields(task) {
  const fields = Object.entries(SETUP_LABELS).map(([id, prompt]) => {
    const questions = task.questions.filter(q => q.scope === 'planning' && (q.field === id || q.id === id))
    const answer = task.answers[id], entry = task.setup[id]
    const recommendation = questions.find(q => q.conflict)?.recommendation ?? questions.find(q => q.recommendation)?.recommendation ?? entry?.value ?? ''
    return { id, prompt, recommendation, value: answer?.value ?? entry?.value ?? '',
      resolved: Boolean(answer?.resolved && questions.every(q => task.answers[q.id]?.resolved)),
      source: entry?.source?.kind ?? 'recommendation', questions,
      conflict: questions.some(q => q.conflict === true) }
  })
  const extra = task.questions.filter(q => q.scope === 'planning' && !q.field && !Object.hasOwn(SETUP_LABELS, q.id))
  return { fields, extra }
}
export function reviewChanges(task, draft) {
  const old = task.review_confirmation?.requirement_summary?.items
  if (!old) return []
  const changes = []
  for (const id of new Set([...old.map(i => i.id), ...draft.map(i => i.id)])) {
    const before = old.find(i => i.id === id)?.text ?? '', after = draft.find(i => i.id === id)?.text ?? ''
    if (before !== after) changes.push({ id, before, after })
  }
  return changes
}
export function schemeChanges(task) {
  const old = task.last_authorization
  if (!old) return []
  const rows = []
  const add = (label, before, after) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) rows.push({ label, before: before ?? '无', after: after ?? '无' })
  }
  add('机床', old.machine_id, task.machine_id); add('后处理器', old.post_name, task.post_name)
  for (const [id, label] of Object.entries(SETUP_LABELS)) add(label, old.setup?.[id]?.value, task.setup[id]?.value)
  for (const id of new Set([...old.operations.map(op => op.id), ...task.operations.map(op => op.id)])) {
    const before = old.operations.find(op => op.id === id), after = task.operations.find(op => op.id === id)
    if (!before || !after) { add(`工序 ${id}`, before ? '已有工序' : '无', after ? '新增工序' : '已移除'); continue }
    for (const [field, label] of Object.entries({ sequence: '顺序', station: '工位', type: '方法', tool: 'NX 刀具', tool_assembly_id: '刀库引用', spindle: '转速', feed: '进给', depends_on: '依赖', inspection: '检验项', geometry: '加工对象', parent: '父坐标组' })) add(`${id} ${label}`, before[field], after[field])
  }
  if (JSON.stringify(old.prepare) !== JSON.stringify(task.prepare)) rows.push({ label: '加工初始化', before: '上次初始化方案', after: '初始化参数已改变，请核对当前工序及刀具设置' })
  return rows
}

export function taskPhase(task, review, blockers) {
  if (task.active_run) {
    if (task.active_run.state === 'unknown') return '执行状态未知'
    return task.stop_requested ? '停止确认中' : '执行中'
  }
  const delivery = task.deliveries.at(-1)
  if (delivery?.revision === task.revision) return delivery.status === 'released' ? '已放行' : '问题包已交付，未放行'
  if (!task.operations.length) return review.status === 'complete' ? '审图完成' : review.status === 'empty' ? '待接件' : '审图待确认'
  if (blockers.length) return '方案待补充'
  const latest = task.runs.filter(run => run.revision === task.revision && run.result && run.authorization === task.authorization?.fingerprint).at(-1)
  if (latest) return latest.result.overall === 'ok' ? 'NC 已生成，待打包' : 'NC 生成未完成，待处理'
  return task.authorization ? '已授权，待生成 NC' : '待授权'
}
