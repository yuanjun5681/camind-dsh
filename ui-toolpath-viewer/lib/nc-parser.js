// camind-ui-toolpath-viewer — NC toolpath parser (pure, dependency-free ESM).
//
// Self-written replacement for the GPL-licensed cnc-simulator parseGcode.js
// (see docs/cam-machining-design.md §7 P3: the old Camind viewer_assets ledger
// marks parseGcode.js / RenderPath.js GPL-3.0-or-later with proprietary
// external distribution blocked, and the dsh client bundle seed table carries
// no three.js — so both the parser and the renderer here are original code).
//
// Dialect: Fanuc-style postprocessor output (what the CAM-Agent proxy emits):
// `%` delimiters, O-word program numbers, N block numbers, `(...)` inline
// comments, `;` end-of-line comments, optional block skip `/`. Words are
// letter + signed decimal (e.g. `X-82.`); implied-decimal formats (X1 = 0.001)
// are NOT supported — modern posts always emit the point.
//
// Semantics implemented:
// - motion G0/G1/G2/G3, modal within a program (a bare `X.. Y..` line repeats
//   the active motion); arcs tessellated to line segments (IJK incremental
//   center, plus R form; helical third-axis lerps);
// - plane selection G17/G18/G19 (G17 exact; G18/G19 use the same math in the
//   (Z,X) / (Y,Z) frames — CCW viewed from the positive normal axis);
// - distance mode G90/G91 (arc center offsets IJK stay incremental either way,
//   per Fanuc; G90.1 absolute-center mode is only warned about);
// - units G20/G21 recorded in meta.units, coordinates passed through unscaled
//   (mixing unit systems in one file is not a viewer concern);
// - canned cycles G73/G74/G76/G81..G89: recorded in `cycles[]` and expanded
//   into approach / feed / retract segments (G81/G82 rapid-to-R then feed;
//   G83 peck with Q, rapid back to R between pecks; G73 high-speed peck with
//   a 1 mm pullback; G74/G84 tapping and G85/G89 feed retract; G86 rapid
//   retract). G76/G87/G88 stay a single R→Z feed plus a one-shot warning.
//   Modal re-execution on bare X/Y lines until G80 or a motion G code;
// - G28/G30 reference return: the intermediate point move is rendered as a
//   rapid; the final leg to the machine reference point has no program-space
//   coordinates and is skipped (documented, not simulated);
// - tool length/cutter comp (G40..G49), work offsets (G53..G59), spindle and
//   misc M codes: parsed and ignored (viewer shows programmed coordinates);
// - every segment records the modal feed (F word, units/min) active at emit
//   time (`feed`, null on rapids / before the first F) so the viewer can time
//   playback without re-walking modal state.
//
// Fault tolerance: a line that cannot be tokenized cleanly (unterminated
// comment, stray characters) is skipped whole and counted in meta.skipped —
// the parser never throws on NC content. Output is capped at `segmentCap`
// segments (meta.truncated set) so a hostile file cannot exhaust memory.
//
// The initial position is (0,0,0) — a viewer convention, real controls start
// wherever the machine happens to be; the first G90 move re-anchors anyway.

// ==== PARSER CORE BEGIN =====================================================
// This region is inlined verbatim into lib/client.js (hand-written client
// bundles are single-file: the dsh module loader resolves only bare package
// ids and seed words, never relative paths). Keep both copies byte-identical;
// verify with: diff <(sed -n '/PARSER CORE BEGIN/,/PARSER CORE END/p' \
//   lib/nc-parser.js) <(sed -n '/PARSER CORE BEGIN/,/PARSER CORE END/p' \
//   lib/client.js)

const WORD_RE = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g

// Group 9 canned cycles (G80 cancels). Labels feed the viewer HUD.
const CANNED_CYCLES = {
  73: '高速啄钻',
  74: '左旋攻丝',
  76: '精镗',
  81: '钻孔',
  82: '锪孔',
  83: '啄钻',
  84: '攻丝',
  85: '镗孔',
  86: '镗孔',
  87: '背镗',
  88: '镗孔',
  89: '镗孔',
}

const TAU = Math.PI * 2

function isG(g, code) {
  return Math.abs(g - code) < 0.01
}

// Plane frames: arc math runs in (u, v) with CCW viewed from +normal.
// G17: u=X v=Y (offsets I,J) · G18: u=Z v=X (offsets K,I) · G19: u=Y v=Z (J,K).
const PLANES = {
  17: { u: 0, v: 1, n: 2, ou: 'I', ov: 'J' },
  18: { u: 2, v: 0, n: 1, ou: 'K', ov: 'I' },
  19: { u: 1, v: 2, n: 0, ou: 'J', ov: 'K' },
}

function parseNc(text, options = {}) {
  const segmentCap = options.segmentCap ?? 1_000_000
  const segments = []
  const cycles = []
  const skipped = []
  const warnings = []
  const tools = []
  let program = null
  let truncated = false
  let min = null
  let max = null

  const stats = { rapid: 0, feed: 0, arc: 0, cycle: 0, skipped: 0 }

  // Modal state.
  let pos = [0, 0, 0]
  let motion = null // 0 | 1 | 2 | 3
  let plane = 17
  let absolute = true // G90
  let units = 'mm' // G21
  let returnInitial = true // G98 (vs G99 return to R plane)
  let canned = null // { code, z, r, q, p, f } — raw words from the start block
  let cannedInitialZ = 0
  let feed = null
  let spindle = null
  let pendingTool = null
  let warnedS0 = false
  let warnedCyclePlane = false
  let warnedSimpleCycle = false

  function warn(message) {
    if (warnings.length < 200) warnings.push(message)
  }

  function growBounds(p) {
    if (!min) {
      min = [...p]
      max = [...p]
      return
    }
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i]
      if (p[i] > max[i]) max[i] = p[i]
    }
  }

  function pushSegment(from, to, kind, line) {
    if (truncated) return
    if (from[0] === to[0] && from[1] === to[1] && from[2] === to[2]) return
    if (segments.length >= segmentCap) {
      truncated = true
      warn(`轨迹段数达到上限 ${segmentCap}，显示已截断`)
      return
    }
    // `feed` snapshots the modal F word (units/min) for playback timing;
    // null on rapids and before the first F.
    segments.push({ from: [...from], to: [...to], kind, line, feed: kind === 'rapid' ? null : feed })
    stats[kind] += 1
    growBounds(from)
    growBounds(to)
  }

  // Axis-word target under the active distance mode; omitted axes hold.
  function targetPoint(params) {
    const next = [...pos]
    for (const [axis, letter] of [[0, 'X'], [1, 'Y'], [2, 'Z']]) {
      const value = params[letter]
      if (value === undefined) continue
      next[axis] = absolute ? value : pos[axis] + value
    }
    return next
  }

  function hasAxisWord(params) {
    return params.X !== undefined || params.Y !== undefined || params.Z !== undefined
  }

  // Tessellate one G2/G3 block into 'arc' segments. Returns false when the
  // arc is degenerate (recorded by the caller as a skipped block).
  function emitArc(cw, params, line) {
    const frame = PLANES[plane]
    const end = targetPoint(params)
    const start = pos
    const su = start[frame.u]
    const sv = start[frame.v]
    const eu = end[frame.u]
    const ev = end[frame.v]
    let cu
    let cv
    if (params.R !== undefined) {
      const r = Math.abs(params.R)
      const dx = eu - su
      const dy = ev - sv
      const chord = Math.hypot(dx, dy)
      if (chord === 0) {
        warn(`第 ${line} 行：R 圆弧弦长为 0，整圆请用 IJK`)
        return false
      }
      if (r < chord / 2 - 1e-9) {
        warn(`第 ${line} 行：圆弧半径 ${r} 小于半弦 ${chord / 2}，已钳制`)
      }
      const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2))
      const mx = (su + eu) / 2
      const my = (sv + ev) / 2
      // Left unit normal of travel; CW minor arcs sit on the right, CCW minor
      // on the left, negative R flips to the major arc.
      const lx = -dy / chord
      const ly = dx / chord
      const sign = (cw ? -1 : 1) * (params.R >= 0 ? 1 : -1)
      cu = mx + sign * h * lx
      cv = my + sign * h * ly
    } else {
      const ou = params[frame.ou] ?? 0
      const ov = params[frame.ov] ?? 0
      if (ou === 0 && ov === 0) {
        warn(`第 ${line} 行：圆弧缺少 IJK 圆心或 R，已跳过`)
        return false
      }
      cu = su + ou // Fanuc: center offsets stay incremental under G90 too
      cv = sv + ov
    }
    const radius = Math.hypot(su - cu, sv - cv)
    if (radius < 1e-9) {
      warn(`第 ${line} 行：零半径圆弧，已跳过`)
      return false
    }
    const a0 = Math.atan2(sv - cv, su - cu)
    let a1 = Math.atan2(ev - cv, eu - cu)
    const fullCircle = su === eu && sv === ev && params.R === undefined
    let sweep
    if (fullCircle) {
      sweep = cw ? -TAU : TAU
    } else if (cw) {
      while (a1 >= a0) a1 -= TAU
      sweep = a1 - a0
    } else {
      while (a1 <= a0) a1 += TAU
      sweep = a1 - a0
    }
    // Chord-error-driven step (0.05 in file units), clamped to sane angles.
    const step = Math.min(Math.PI / 6, Math.max(Math.PI / 45, 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 0.05 / radius)))))
    const steps = Math.min(720, Math.max(4, Math.ceil(Math.abs(sweep) / step)))
    const n0 = start[frame.n]
    const dn = end[frame.n] - n0 // helical third axis lerps across the sweep
    let prev = start
    for (let i = 1; i <= steps; i++) {
      const angle = a0 + (sweep * i) / steps
      const p = [...start]
      p[frame.u] = cu + radius * Math.cos(angle)
      p[frame.v] = cv + radius * Math.sin(angle)
      p[frame.n] = n0 + (dn * i) / steps
      pushSegment(prev, p, 'arc', line)
      prev = p
    }
    pos = end // land exactly on the programmed endpoint
    return true
  }

  // Fanuc group-9 cycle at (tx, ty). Cutting legs use kind `cycle` (amber);
  // positioning and chip-clear retracts are rapids. G76/G87/G88 stay a single
  // R→Z feed — their boring sub-moves are not a viewer concern.
  const TAP_OR_BORE_FEED_OUT = new Set([74, 84, 85, 89])
  const SIMPLE_BORE = new Set([76, 87, 88])

  function emitCanned(params, line) {
    const next = targetPoint(params)
    const tx = next[0]
    const ty = next[1]
    let rPlane
    let zDepth
    if (absolute) {
      rPlane = canned.r ?? pos[2]
      zDepth = canned.z ?? pos[2]
    } else {
      rPlane = cannedInitialZ + (canned.r ?? 0)
      zDepth = rPlane + (canned.z ?? 0)
    }
    const code = canned.code
    cycles.push({
      code,
      label: CANNED_CYCLES[code] ?? `G${code}`,
      at: [tx, ty],
      r: rPlane,
      z: zDepth,
      line,
    })

    if (plane !== 17 && !warnedCyclePlane) {
      warnedCyclePlane = true
      warn(`第 ${line} 行：固定循环在 G${plane} 平面按 XY 孔位展开，请复核`)
    }

    if (tx !== pos[0] || ty !== pos[1]) {
      pushSegment(pos, [tx, ty, pos[2]], 'rapid', line)
      pos = [tx, ty, pos[2]]
    }

    const retractZ = returnInitial ? cannedInitialZ : rPlane

    if (SIMPLE_BORE.has(code)) {
      if (!warnedSimpleCycle) {
        warnedSimpleCycle = true
        warn(`G${code} ${CANNED_CYCLES[code]}按 R→Z 简化显示，镗孔子步未展开`)
      }
      if (pos[2] !== rPlane) {
        pushSegment(pos, [tx, ty, rPlane], 'rapid', line)
        pos = [tx, ty, rPlane]
      }
      pushSegment([tx, ty, rPlane], [tx, ty, zDepth], 'cycle', line)
      if (zDepth !== retractZ) pushSegment([tx, ty, zDepth], [tx, ty, retractZ], 'rapid', line)
      pos = [tx, ty, retractZ]
      return
    }

    if (pos[2] !== rPlane) {
      pushSegment(pos, [tx, ty, rPlane], 'rapid', line)
      pos = [tx, ty, rPlane]
    }

    const q = Math.abs(canned.q ?? 0)
    const pecking = (code === 83 || code === 73) && q > 0 && rPlane !== zDepth
    if (pecking) {
      const down = rPlane > zDepth
      let zc = rPlane
      let peckAt = rPlane
      let guard = 0
      while (guard < 10000) {
        guard += 1
        const zn = down ? Math.max(peckAt - q, zDepth) : Math.min(peckAt + q, zDepth)
        pushSegment([tx, ty, zc], [tx, ty, zn], 'cycle', line)
        pos = [tx, ty, zn]
        peckAt = zn
        if (Math.abs(zn - zDepth) < 1e-9) break
        if (code === 83) {
          pushSegment([tx, ty, zn], [tx, ty, rPlane], 'rapid', line)
          zc = rPlane
        } else {
          const up = down ? Math.min(zn + 1, rPlane) : Math.max(zn - 1, rPlane)
          pushSegment([tx, ty, zn], [tx, ty, up], 'rapid', line)
          zc = up
        }
      }
    } else {
      pushSegment([tx, ty, rPlane], [tx, ty, zDepth], 'cycle', line)
      pos = [tx, ty, zDepth]
    }

    if (pos[2] !== retractZ) {
      const kind = TAP_OR_BORE_FEED_OUT.has(code) ? 'cycle' : 'rapid'
      pushSegment(pos, [tx, ty, retractZ], kind, line)
    }
    pos = [tx, ty, retractZ]
  }

  function handleLine(rawText, lineNo) {
    let line = rawText.replace(/\r/g, '')
    // Comments: `(...)` inline pairs, `;` to end of line.
    let stripped = ''
    let depth = 0
    for (const ch of line) {
      if (ch === '(') {
        depth += 1
        if (depth > 1) { skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: 'nested comment' }); stats.skipped += 1; return }
        continue
      }
      if (ch === ')') {
        if (depth === 0) { skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: 'unmatched )' }); stats.skipped += 1; return }
        depth = 0
        continue
      }
      if (ch === ';' && depth === 0) break
      if (depth === 0) stripped += ch
    }
    if (depth !== 0) { skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: 'unterminated comment' }); stats.skipped += 1; return }
    line = stripped.trim()
    if (line === '' || line === '%') return
    if (line.startsWith('/')) line = line.replace(/^\/+\s*/, '') // optional block skip

    // Tokenize into words and require full coverage — leftover characters make
    // the whole line a counted skip (fail closed on dialect drift).
    const words = []
    let covered = 0
    for (const match of line.matchAll(WORD_RE)) {
      const gap = line.slice(covered, match.index)
      if (gap.trim() !== '') {
        skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: `stray characters ${JSON.stringify(gap.trim())}` })
        stats.skipped += 1
        return
      }
      covered = match.index + match[0].length
      words.push([match[1].toUpperCase(), Number.parseFloat(match[2])])
    }
    if (line.slice(covered).trim() !== '') {
      skipped.push({ line: lineNo, text: line.trim().slice(0, 120), reason: `stray characters ${JSON.stringify(line.slice(covered).trim())}` })
      stats.skipped += 1
      return
    }
    if (words.length === 0) return

    const gCodes = []
    const mCodes = []
    const params = {}
    for (const [letter, value] of words) {
      if (letter === 'G') gCodes.push(value)
      else if (letter === 'M') mCodes.push(value)
      else if (letter === 'N') continue // block number
      else if (letter === 'O') { program = program ?? String(Math.trunc(value)) }
      else params[letter] = value // last word wins
    }

    // Modal pre-pass (order-independent for the supported subset).
    let motionHere = null
    let cannedHere = null
    let refReturn = false
    for (const g of gCodes) {
      if (isG(g, 17)) plane = 17
      else if (isG(g, 18)) plane = 18
      else if (isG(g, 19)) plane = 19
      else if (isG(g, 20)) {
        if (units !== 'inch') warn(`第 ${lineNo} 行：G20 英制按文件数值绘制，未换算毫米`)
        units = 'inch'
      }
      else if (isG(g, 21)) units = 'mm'
      else if (isG(g, 90)) absolute = true
      else if (isG(g, 91)) absolute = false
      else if (isG(g, 90.1)) warn(`第 ${lineNo} 行：G90.1 绝对圆心不支持，IJK 仍按增量处理`)
      else if (isG(g, 98)) returnInitial = true
      else if (isG(g, 99)) returnInitial = false
      else if (isG(g, 80)) canned = null
      else if (isG(g, 28) || isG(g, 30)) refReturn = true
      else if (isG(g, 0) || isG(g, 1) || isG(g, 2) || isG(g, 3)) motionHere = Math.trunc(g)
      else if (CANNED_CYCLES[Math.trunc(g)] !== undefined && Math.abs(g - Math.trunc(g)) < 0.01) cannedHere = Math.trunc(g)
      // G40..G49 comp, G53..G59 offsets, G61/G64, G94/G95: parsed and ignored —
      // the viewer renders programmed coordinates.
    }

    if (params.F !== undefined) feed = params.F
    if (params.S !== undefined) {
      spindle = params.S
      if (params.S === 0 && !warnedS0) {
        warnedS0 = true
        warn(`第 ${lineNo} 行：S0 主轴转速为 0，必须回到 NC 复核`)
      }
    }
    if (params.T !== undefined) pendingTool = params.T
    if (mCodes.some((m) => Math.trunc(m) === 6) && pendingTool !== null) {
      tools.push(pendingTool)
      pendingTool = null
    }

    // G28/G30: rapid to the intermediate point only; the final leg targets the
    // machine reference point, which has no program-space coordinates.
    if (refReturn) {
      if (hasAxisWord(params)) {
        const next = targetPoint(params)
        pushSegment(pos, next, 'rapid', lineNo)
        pos = next
      }
      return
    }

    if (motionHere !== null) {
      motion = motionHere
      canned = null // a group-1 G code cancels any active canned cycle
    }

    if (cannedHere !== null) {
      canned = {
        code: cannedHere,
        z: params.Z,
        r: params.R,
        q: params.Q,
        p: params.P,
        f: params.F ?? feed,
      }
      cannedInitialZ = pos[2]
      // Fanuc executes the defining block at the current/modal XY.
      emitCanned(params, lineNo)
      return
    }

    // Inside canned mode, position-less Z/R/Q edits apply to subsequent calls
    // (Fanuc semantics) — no motion, no re-execution.
    if (canned !== null && motionHere === null) {
      if (params.Q !== undefined) canned.q = params.Q
      if (params.P !== undefined) canned.p = params.P
      if (params.X !== undefined || params.Y !== undefined) {
        emitCanned(params, lineNo)
        return
      }
      if (params.Z !== undefined || params.R !== undefined) {
        if (params.Z !== undefined) canned.z = params.Z
        if (params.R !== undefined) canned.r = params.R
        return
      }
    }

    if (!hasAxisWord(params)) return // pure modal / M-code block
    if (motion === null) {
      skipped.push({ line: lineNo, text: rawText.trim().slice(0, 120), reason: 'axis words without an active motion mode' })
      stats.skipped += 1
      return
    }

    const next = targetPoint(params)
    if (motion === 0) {
      pushSegment(pos, next, 'rapid', lineNo)
      pos = next
    } else if (motion === 1) {
      pushSegment(pos, next, 'feed', lineNo)
      pos = next
    } else {
      emitArc(motion === 2, params, lineNo) // degenerate arcs warn inside
    }
  }

  const lines = String(text ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    try {
      handleLine(lines[i], i + 1)
    } catch (error) {
      // Belt and braces: parsing must never throw on NC content.
      skipped.push({ line: i + 1, text: lines[i].trim().slice(0, 120), reason: `parser error: ${error instanceof Error ? error.message : String(error)}` })
      stats.skipped += 1
    }
  }

  return {
    meta: {
      program,
      units,
      tools,
      lines: lines.length,
      skipped,
      warnings,
      truncated,
      feed,
      spindle,
    },
    segments,
    cycles,
    bounds: min ? { min, max } : null,
    stats,
  }
}

// ==== PARSER CORE END =======================================================

export { parseNc, CANNED_CYCLES }
