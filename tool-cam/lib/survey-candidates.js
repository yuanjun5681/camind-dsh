// 疑似高风险候选推导（cam_survey v1，简单可解释版）。
// 规则来源：旧 Camind backend/app/services/cam/planning/tapping.py 的
// _auto_tapping_from_geometry（孔径 ≈ ISO 公制粗牙攻丝底孔 → 疑似攻丝）与
// countersink.py（锥面 → 疑似沉窝/锪锥孔）。底孔表照抄旧 Camind
// services/cam/data/thread_specs.json（M2..M12 粗牙）。
//
// ★ 定位：候选供人确认，非判定。通孔在攻丝底孔径上有歧义（通丝孔 or 螺栓
// 过孔/铰孔），纯几何不敢判——标 ambiguous，如实说明。

const TAP_DRILL_TABLE = [
  { thread: 'M2', drill: 1.6 },
  { thread: 'M2.5', drill: 2.05 },
  { thread: 'M3', drill: 2.5 },
  { thread: 'M4', drill: 3.3 },
  { thread: 'M5', drill: 4.2 },
  { thread: 'M6', drill: 5.0 },
  { thread: 'M8', drill: 6.8 },
  { thread: 'M10', drill: 8.5 },
  { thread: 'M12', drill: 10.2 },
]

// 直径匹配容差（旧 Camind dia_tol 默认 0.4，这里略收）。
const DIA_TOL = 0.35
// 开口面判定：孔端 z 与最高/最低水平面的贴合容差（同旧 Camind z_tol）。
const Z_TOL = 1.5

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function round(value, digits) {
  return Number(num(value)?.toFixed(digits))
}

// survey → { holeSource, tapping, countersink, disclaimer }。
// 孔数据源优先 survey.faces.small_hole_candidates（worker 出的完整去重小孔表），
// 老 survey 没有该键时回退 cylinder_sample（竖直、非锥）。
export function deriveRiskCandidates(survey) {
  const faces = survey && typeof survey.faces === 'object' && survey.faces ? survey.faces : {}
  let holeSource = 'small_hole_candidates'
  let holes = Array.isArray(faces.small_hole_candidates) ? faces.small_hole_candidates : null
  if (!holes) {
    holeSource = 'cylinder_sample'
    holes = (Array.isArray(faces.cylinder_sample) ? faces.cylinder_sample : [])
      .filter((c) => c?.is_vertical && !c?.is_cone)
  }
  const topZ = num(faces.top_planar_z)
  const botZ = num(faces.bottom_planar_z)

  const tapping = []
  const seen = new Set()
  for (const hole of holes) {
    const dia = num(hole?.diameter)
    const cx = num(hole?.cx)
    const cy = num(hole?.cy)
    if (dia === null || cx === null || cy === null) continue
    let best = null
    for (const spec of TAP_DRILL_TABLE) {
      const diff = Math.abs(dia - spec.drill)
      if (diff <= DIA_TOL && (best === null || diff < best.diff)) best = { ...spec, diff }
    }
    if (best === null) continue
    const key = `${best.thread}@${cx.toFixed(1)},${cy.toFixed(1)}`
    if (seen.has(key)) continue
    seen.add(key)
    const zmin = num(hole?.zmin)
    const zmax = num(hole?.zmax)
    const opensTop = topZ !== null && zmax !== null && Math.abs(zmax - topZ) <= Z_TOL
    const opensBot = botZ !== null && zmin !== null && Math.abs(zmin - botZ) <= Z_TOL
    const through = opensTop && opensBot
    tapping.push({
      kind: 'tapping_candidate',
      thread: best.thread,
      tap_drill_diameter: best.drill,
      measured_diameter: round(dia, 2),
      center: [round(cx, 3), round(cy, 3)],
      depth: zmin !== null && zmax !== null ? round(Math.abs(zmax - zmin), 1) : null,
      opening: through ? 'through' : opensBot && !opensTop ? 'bottom' : 'top',
      ambiguous: through,
      reason: through
        ? `孔径 ≈ ${best.thread} 攻丝底孔 Ø${best.drill}，但为通孔，也可能是螺栓过孔/铰孔——需人工确认是否攻丝。`
        : `孔径 ≈ ${best.thread} 攻丝底孔 Ø${best.drill}（公制粗牙），疑似攻丝孔。`,
    })
  }

  // 锥面 → 疑似沉窝/锪锥孔候选（角度/大端直径以 survey 实际返回字段为准，
  // 原样带出供人核对）。
  const countersink = (Array.isArray(faces.cone_sample) ? faces.cone_sample : []).map((cone) => ({
    kind: 'countersink_candidate',
    geometry: cone,
    reason: '检测到锥面，疑似沉窝/锪锥孔（也可能是一般锥形特征）——需人工确认。',
  }))

  return {
    holeSource,
    tapping,
    countersink,
    disclaimer: '以上候选由几何规则推导，供人工确认，不构成判定；高风险工序（攻丝/沉窝）未经书面声明不得进入执行。',
  }
}
