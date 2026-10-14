// Presentation only: keep requirement values/units intact; never infer machining facts.
export function requirementDraft(task) {
  const items = [], seen = new Set()
  const add = (id, group, text) => {
    text = text.trim()
    if (!text || seen.has(text)) return
    seen.add(text); items.push({ id, group, text })
  }
  for (const [index, entry] of (task.requirements ?? []).entries()) {
    const source = entry.source
    if (entry.stale || !source) continue
    if (source.kind === 'drawing' ? source.sha256 !== task.inputs.dwg?.sha256 : source.kind === 'user' ? !task.answers[source.answer_id]?.resolved || task.answers[source.answer_id]?.value !== entry.value : true) continue
    let text = typeof entry.text === 'string' ? entry.text : typeof entry.value === 'string' ? entry.value : ''
    if (/^(?:件名|零件名称|图号|模号|版本|数量|比例|制图|审核|批准|接件审图|任务目标)\s*[：:]/.test(text)) continue
    text = text.replace(/[（(](?:标题栏|图框)\s+[A-Za-z_ /.-]+[）)]/g, '').replace(/[（(](?:同一)?实体\s+[\da-fA-F、/–— -]+[）)]/g, '').replace(/[，,]\s*实体\s+[\da-fA-F、/–— -]+/g, '')
    const group = /需核对|待确认|待提供|暂按|候选|无法确定|未核验|未确认/.test(text) ? 'agreements' : /材料|材质|热处理|硬度/.test(text) ? 'material' : /^(?:加工范围|不加工|排除|工序范围)/.test(text) ? 'scope' : /关键尺寸|公差|螺纹|沉窝|倒角|粗糙度/.test(text) && !/技术要求|慢丝|颜色/.test(text) ? 'precision' : 'special'
    add(`requirement:${index}`, group, text)
  }
  for (const question of task.questions ?? []) {
    if (question.scope && question.scope !== 'review') continue
    const answer = task.answers[question.id]
    if (!answer?.resolved || typeof answer.value !== 'string' || answer.value.trim() === '暂不确定') continue
    add(`answer:${question.id}`, 'agreements', answer.value.replace(/^建议[：:]?\s*/, ''))
  }
  return items
}
