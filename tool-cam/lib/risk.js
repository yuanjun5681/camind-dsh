// 高风险类别归一 —— cam_plan（校验落盘）与 cam_run 闸门（读盘核对）共用同一张
// 别名表与同一条判定，两处各写一份必然漂移（设计稿 §4.3：闸门只认落盘文件，
// 但「什么算高风险、什么算声明」的口径必须与落盘侧逐字一致）。

// operations 的 risk 标记 / declarations 的 kind 共用同一张别名表。
const RISK_KINDS = {
  tapping: ['tapping', '攻丝'],
  countersink: ['countersink', 'counterbore', '沉窝', '锪孔', '锪锥孔'],
}

export function normalizeRiskKind(value) {
  const text = String(value ?? '').trim().toLowerCase()
  for (const [kind, aliases] of Object.entries(RISK_KINDS)) {
    if (aliases.some((a) => a.toLowerCase() === text)) return kind
  }
  return null
}

// 工序的高风险类别：攻丝显式类型天然是 tapping；其余看可选 risk 标记。
export function opRiskKind(op) {
  if (op?.type === 'tap_holes') return 'tapping'
  return normalizeRiskKind(op?.risk)
}

export function riskKindLabel(kind) {
  return kind === 'tapping' ? '攻丝' : '沉窝'
}
