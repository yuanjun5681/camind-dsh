// camind-ui-toolpath-viewer browser bundle — hand-written, no build step.
// NC toolpath preview: registers a renderer into the keyed `cam.nc.preview`
// seat (key `toolpath-viewer`). The seat is declared by consumers (the
// tool-cam delivery card, future deliverables-tab previews) with owner props
// { content, fileName } — NC program text plus its display name; when no
// consumer declares the slot this plugin stays fully inert, so unlike
// camind-ui-brand it needs no /camind pathname guard (the official shell
// never declares `cam.nc.*`).
//
// Everything below is original code. The old Camind viewer_assets port was
// rejected on license grounds: its cnc-simulator core (parseGcode.js,
// RenderPath.js) is GPL-3.0-or-later and the asset ledger blocks proprietary
// external distribution (asset_licenses.json: CONDITIONAL_GPL_PATH). The dsh
// client seed table (react / react-dom / cordis / dsh-client-ui-slots /
// dsh-client-ui-primitives — verified in dsh-client-web getStaticModules())
// carries no three.js, and hand-written bundles cannot add npm dependencies,
// so the renderer is a minimal self-written WebGL lines viewer (~250 lines):
// interleaved position+color buffer, one gl.LINES draw, spherical orbit /
// dolly / pan, Z-up world. Rendering is presentation-only — no material
// removal, no simulation (docs/cam-machining-design.md §7 P3).
//
// Playback (referenced from the old Camind viewer's time-axis animation,
// reimplemented): each segment is timed as distance / modal feed (units/min →
// seconds; rapids at a fixed assumed rate), giving a cumulative end-times
// array. Overlay chrome (play / scrub / speed / layer toggles) sits on the
// canvas like a video player; XYZ / line / F HUD is a corner overlay. Past
// segments draw dimmer than the current cut, future dimmer still. Source is a
// right-hand drawer (closed by default); click a 3D segment or an alert chip
// to open it and land on the NC line. Progress is a ratio — estimated minutes
// are a tooltip, not presented as machine cycle time. Parser warnings
// (skipped lines, S0, truncation, G20) are clickable chips in the header.
// segment of a clicked line, and playback highlights the current source row.
//
// The NC parser (parseNc) is a verbatim inline of lib/nc-parser.js between
// the PARSER CORE markers: hand-written bundles are single-file (the dsh
// module loader's require resolves only seed words and bare package ids,
// never relative paths — see dsh-client-modules makeRequire), and the lib/
// copy exists so the parser can be import-tested from Node. Keep both copies
// byte-identical (diff command inside the marked region header).
window.__ModuleLoader__.load({ id: "camind-ui-toolpath-viewer", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useEffect, useMemo, useRef, useState } = React
const { Button } = require('camind-ui-foundation')

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


// --- minimal WebGL lines renderer -------------------------------------------
// Self-written, no vendor code (GPL constraint above). One interleaved
// position+color buffer, one gl.LINES draw call, on-demand redraws only.
// World is Z-up (CNC convention). Line width stays 1 — wider lines are
// unsupported by most WebGL implementations.

const FOV = (45 * Math.PI) / 180

const KIND_COLORS = {
  rapid: [0.898, 0.329, 0.294], // #e5534b red — non-cutting travel
  feed: [0.302, 0.624, 1.0], // #4d9fff blue — cutting feed
  arc: [0.345, 0.827, 0.922], // #58d3eb cyan — arc feed
  cycle: [0.898, 0.639, 0.294], // #e5a34b amber — canned-cycle cutting
}
const KIND_INDEX = { rapid: 0, feed: 1, arc: 2, cycle: 3 }
const BOX_COLOR = [0.24, 0.27, 0.32]
const MARKER_COLOR = [1, 1, 1] // tool-tip cross
const AXIS_COLORS = [
  [0.788, 0.365, 0.345], // X
  [0.365, 0.659, 0.396], // Y
  [0.353, 0.498, 0.769], // Z
]
const VIEW_BG = [0.078, 0.094, 0.121, 1] // #14181f — fixed dark viewport

function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2)
  const out = new Float32Array(16)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) / (near - far)
  out[11] = -1
  out[14] = (2 * far * near) / (near - far)
  return out
}

function vec3Normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

function vec3Cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function mat4LookAt(eye, center, up) {
  const z = vec3Normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  const x = vec3Normalize(vec3Cross(up, z))
  const y = vec3Cross(z, x)
  const out = new Float32Array(16)
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2])
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2])
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2])
  out[15] = 1
  return out
}

// Column-major multiply: out = a * b.
function mat4Multiply(a, b) {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = sum
    }
  }
  return out
}

const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aKind;
uniform mat4 uMVP;
varying vec3 vColor;
varying float vKind;
void main() {
  vColor = aColor;
  vKind = aKind;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`

const FRAG_SRC = `
precision mediump float;
varying vec3 vColor;
varying float vKind;
uniform float uBright;
uniform vec4 uKindMask;
void main() {
  float show = 1.0;
  if (vKind >= -0.5) {
    if (vKind < 0.5) show = uKindMask.x;
    else if (vKind < 1.5) show = uKindMask.y;
    else if (vKind < 2.5) show = uKindMask.z;
    else show = uKindMask.w;
  }
  if (show < 0.5) discard;
  gl_FragColor = vec4(vColor * uBright, 1.0);
}`

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

function createProgram(gl) {
  const program = gl.createProgram()
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERT_SRC))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`)
  }
  return program
}

// Flatten segments into an interleaved [x,y,z,r,g,b,kind] vertex array, plus
// the bounding-box wireframe and a muted RGB axis triad at the world origin.
// kind is KIND_INDEX or -1 (always visible: box / axes / marker).
function buildScene(parsed) {
  const { segments, bounds } = parsed
  const verts = []
  const push = (p, c, kind) => verts.push(p[0], p[1], p[2], c[0], c[1], c[2], kind)
  for (const s of segments) {
    const color = KIND_COLORS[s.kind] ?? KIND_COLORS.feed
    const kind = KIND_INDEX[s.kind] ?? 1
    push(s.from, color, kind)
    push(s.to, color, kind)
  }
  const { min, max } = bounds
  const corner = (x, y, z) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]]
  const edges = [
    [[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 1, 0]], [[1, 1, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 0]],
    [[0, 0, 1], [1, 0, 1]], [[1, 0, 1], [1, 1, 1]], [[1, 1, 1], [0, 1, 1]], [[0, 1, 1], [0, 0, 1]],
    [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]], [[1, 1, 0], [1, 1, 1]], [[0, 1, 0], [0, 1, 1]],
  ]
  for (const [a, b] of edges) {
    push(corner(...a), BOX_COLOR, -1)
    push(corner(...b), BOX_COLOR, -1)
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1
  const axisLen = diag * 0.15
  for (let axis = 0; axis < 3; axis++) {
    const tip = [0, 0, 0]
    tip[axis] = axisLen
    push([0, 0, 0], AXIS_COLORS[axis], -1)
    push(tip, AXIS_COLORS[axis], -1)
  }
  return { data: new Float32Array(verts), count: verts.length / 7, pathCount: segments.length * 2 }
}

// Playback timing (viewer-level approximation): feed/arc/cycle moves run at
// the segment's modal F word (units/min → seconds); rapids run at a fixed
// assumed rate — real rapid speed is machine data the viewer does not have.
const RAPID_RATE = 8000 // units/min
const DEFAULT_FEED = 500 // units/min when the program never sets F
function computeTiming(parsed) {
  const endTimes = new Float64Array(parsed.segments.length)
  let acc = 0
  for (let i = 0; i < parsed.segments.length; i++) {
    const s = parsed.segments[i]
    const dist = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2])
    const rate = s.kind === 'rapid' ? RAPID_RATE : (s.feed ?? DEFAULT_FEED)
    acc += (dist / Math.max(rate, 1e-6)) * 60
    endTimes[i] = acc
  }
  return { endTimes, totalTime: acc }
}

function fmtTime(t) {
  const s = Math.max(0, Math.round(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Spherical orbit state fitted to the parsed bounds (Z-up world).
function fitView(bounds) {
  const { min, max } = bounds
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(1e-3, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)
  return {
    theta: -Math.PI / 4,
    phi: 1.05, // from +Z; clamped away from the poles while dragging
    dist: (radius * 1.35) / Math.tan(FOV / 2),
    target: center,
    radius,
  }
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value))
}

// --- viewer card chrome -------------------------------------------------------
// Scoped classes (tpv- prefix); chrome follows the shell theme via the
// official --dsw-alias-* tokens, the viewport itself stays a fixed dark
// CAD-style canvas so path colors keep their meaning in either theme.

const VIEWER_CSS = `
.tpv-card {
  position: relative;
  border: 1px solid var(--camind-border-default, var(--dsw-alias-border-l2));
  border-radius: var(--camind-radius-card, 12px);
  overflow: hidden;
  background: var(--camind-surface-layer, var(--dsw-alias-bg-layer-1, transparent));
  height: 100%;
  display: flex;
  flex-direction: column;
  outline: none;
}
.tpv-chip {
  flex: none; margin: 0; padding: 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 7px;
  font: inherit; font-size: 11px; line-height: 16px;
  cursor: pointer;
  background: rgba(20, 24, 31, 0.72);
  color: rgba(232, 234, 237, 0.85);
}
.tpv-chip[data-level="danger"] { color: #f0a8a4; }
.tpv-chip[data-level="warning"] { color: #e5c07b; }
.tpv-chip:hover { color: #e8eaed; background: rgba(255, 255, 255, 0.08); }
.tpv-stage { position: relative; flex: 1 1 0; min-height: 380px; background: #14181f; }
.tpv-view { position: absolute; inset: 0; }
.tpv-view canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  display: block; touch-action: none; cursor: grab;
}
.tpv-view canvas:active { cursor: grabbing; }
.tpv-overlay {
  position: absolute; z-index: 2;
  display: flex; align-items: center; gap: 4px;
}
.tpv-views { top: 10px; left: 10px; flex-wrap: wrap; max-width: calc(100% - 160px); }
.tpv-hud {
  top: 10px; right: 10px;
  flex-direction: column; align-items: flex-end; gap: 0;
  padding: 6px 8px;
  background: rgba(20, 24, 31, 0.78);
  color: #e8eaed;
  font-family: var(--camind-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px; line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: pre;
  pointer-events: none;
}
.tpv-hud-meta { color: rgba(232, 234, 237, 0.7); margin-top: 4px; }
.tpv-anim {
  left: 10px; right: 10px; bottom: 10px;
  padding: 6px 8px; gap: 8px;
  background: rgba(20, 24, 31, 0.82);
  font-size: 11px; color: rgba(232, 234, 237, 0.85);
}
.tpv-stage.is-source-open .tpv-anim { right: min(320px, 42%); }
.tpv-stage.is-source-open .tpv-hud { right: calc(min(320px, 42%) + 10px); }
.tpv-play { flex: none; min-width: 3.2em; }
.tpv-slider { flex: 1 1 auto; min-width: 48px; accent-color: #4d9fff; }
.tpv-pct {
  flex: none; min-width: 3.2em; text-align: right;
  font-family: var(--camind-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-variant-numeric: tabular-nums;
}
.tpv-speed {
  flex: none;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 7px;
  background: transparent; color: rgba(232, 234, 237, 0.85); font-size: 12px;
}
.tpv-ghost, .tpv-layer {
  flex: none; margin: 0; padding: 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 7px;
  background: transparent; color: rgba(232, 234, 237, 0.55);
  font: inherit; font-size: 11px; line-height: 16px; cursor: pointer;
}
.tpv-ghost:hover, .tpv-layer:hover { color: #e8eaed; background: rgba(255, 255, 255, 0.08); }
.tpv-ghost.is-on, .tpv-layer.is-on {
  color: #e8eaed; background: rgba(255, 255, 255, 0.14);
}
.tpv-fallback {
  padding: 16px 12px; font-size: 12px; line-height: 1.7;
  color: var(--camind-color-text-secondary, var(--dsw-alias-label-secondary)); background: #14181f;
}
.tpv-drawer {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 3;
  width: min(320px, 42%);
  display: flex; flex-direction: column;
  background: var(--camind-surface-code, var(--dsw-alias-markdown-code-block, #1b1f27));
  border-left: 1px solid var(--camind-border-default, var(--dsw-alias-border-l2));
  color: var(--camind-color-text, var(--dsw-alias-label-primary));
}
.tpv-drawer-head {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--camind-border-default, var(--dsw-alias-border-l2));
}
.tpv-search {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px;
  border: 1px solid var(--camind-border-default, var(--dsw-alias-border-l2)); border-radius: 7px;
  background: transparent; color: inherit; font: inherit; font-size: 12px;
}
.tpv-source {
  flex: 1 1 0; min-height: 0; overflow: auto;
  font-family: var(--camind-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px; line-height: 18px;
}
.tpv-source:focus-visible {
  outline: 2px solid var(--camind-color-accent, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.tpv-src-line {
  display: flex; gap: 8px; width: 100%;
  margin: 0; padding: 0 10px;
  border: 0; background: transparent; color: inherit;
  text-align: left; cursor: pointer;
  font: inherit; line-height: 18px;
  white-space: pre;
}
.tpv-src-line:hover { background: var(--camind-surface-hover, var(--dsw-alias-interactive-bg-hover)); }
.tpv-src-line.is-active {
  background: var(--camind-surface-active, var(--dsw-alias-interactive-bg-active, var(--camind-surface-hover)));
  color: var(--camind-color-text, var(--dsw-alias-label-primary));
}
.tpv-src-line:focus-visible {
  outline: 2px solid var(--camind-color-accent, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.tpv-src-n {
  flex: none; width: 3.2em; text-align: right;
  color: var(--camind-color-text-tertiary, var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)));
}
.tpv-src-t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
`

const SOURCE_LINE_CAP = 10000
const DISCLAIMER = '刀路预览用于核对 NC 轨迹，不替代机床干跑、夹具/碰撞检查和人工复核。'

function lineFromText(text) {
  const match = /第\s*(\d+)\s*行/.exec(text)
  return match ? Number(match[1]) : null
}

function collectAlerts(parsed, sourceTruncated) {
  if (!parsed || parsed.error) return []
  const items = []
  const seen = new Set()
  const push = (level, text, line) => {
    if (seen.has(text)) return
    seen.add(text)
    items.push({ level, text, line: line ?? lineFromText(text) })
  }
  if (parsed.meta.truncated) push('danger', '轨迹段数达到上限，显示已截断')
  if (parsed.meta.spindle === 0) {
    const hit = (parsed.meta.warnings || []).find((row) => /S0/.test(row))
    push('danger', 'S0 主轴转速', lineFromText(hit || ''))
  }
  if (parsed.meta.units === 'inch') {
    const hit = (parsed.meta.warnings || []).find((row) => /G20/.test(row))
    push('warning', 'G20 英制未换算', lineFromText(hit || ''))
  }
  if (parsed.stats.skipped > 0) {
    const first = (parsed.meta.skipped || [])[0]
    push('warning', `跳过 ${parsed.stats.skipped} 行`, first?.line)
  }
  if (sourceTruncated) push('warning', `源码仅显示前 ${SOURCE_LINE_CAP} 行`)
  for (const warning of parsed.meta.warnings || []) {
    if (/S0/.test(warning) || /轨迹段数达到上限/.test(warning) || /G20/.test(warning)) continue
    push('warning', warning)
  }
  return items.slice(0, 16)
}

function indexSourceLines(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const truncated = lines.length > SOURCE_LINE_CAP
  return { lines: truncated ? lines.slice(0, SOURCE_LINE_CAP) : lines, truncated, total: lines.length }
}

// Owner props (consumer contract): { content, fileName } — NC text + name.
function ToolpathViewer({ content, fileName }) {
  const cardRef = useRef(null)
  const hostRef = useRef(null)
  const sourceRef = useRef(null)
  const controlsRef = useRef(null)
  const sliderRef = useRef(null)
  const pctRef = useRef(null)
  const coordsRef = useRef(null)
  const metaRef = useRef(null)
  const hudLineRef = useRef(0)
  const activeSrcRef = useRef(null)
  const markSourceLineRef = useRef(null)
  const openSourceRef = useRef(null)
  const layersRef = useRef({ rapid: true, cut: true })
  const [glError, setGlError] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [layers, setLayers] = useState({ rapid: true, cut: true })
  const [query, setQuery] = useState('')

  layersRef.current = layers
  openSourceRef.current = () => setSourceOpen(true)

  const source = useMemo(() => indexSourceLines(content), [content])

  const markSourceLine = (lineNo) => {
    if (!Number.isFinite(lineNo) || lineNo < 1) return
    hudLineRef.current = lineNo
    const root = sourceRef.current
    if (!root) return
    const prev = activeSrcRef.current
    if (prev && Number(prev.dataset.ln) === lineNo) return
    if (prev) {
      prev.classList.remove('is-active')
      prev.removeAttribute('aria-current')
    }
    const el = root.querySelector(`[data-ln="${lineNo}"]`)
    activeSrcRef.current = el
    if (el) {
      el.classList.add('is-active')
      el.setAttribute('aria-current', 'true')
      el.scrollIntoView({ block: 'nearest' })
    }
  }
  markSourceLineRef.current = markSourceLine

  const parsed = useMemo(() => {
    if (typeof content !== 'string' || content.trim() === '') return null
    try {
      const result = parseNc(content)
      if (result.bounds) {
        result.anim = computeTiming(result)
        const firstSegByLine = new Map()
        for (let i = 0; i < result.segments.length; i++) {
          const ln = result.segments[i].line
          if (!firstSegByLine.has(ln)) firstSegByLine.set(ln, i)
        }
        result.firstSegByLine = firstSegByLine
      }
      return result
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [content])

  const alerts = useMemo(() => collectAlerts(parsed, source.truncated), [parsed, source.truncated])

  useEffect(() => {
    setGlError(null)
    setPlaying(false)
    setSourceOpen(false)
    activeSrcRef.current = null
    hudLineRef.current = 0
  }, [content])

  useEffect(() => {
    if (sourceOpen) markSourceLineRef.current?.(hudLineRef.current)
  }, [sourceOpen])

  useEffect(() => {
    if (!parsed || parsed.error || !parsed.bounds) return undefined
    const host = hostRef.current
    if (!host) return undefined

    const canvas = document.createElement('canvas')
    host.appendChild(canvas)
    let gl = null
    try {
      gl = canvas.getContext('webgl', { antialias: true }) ?? canvas.getContext('experimental-webgl')
      if (!gl) throw new Error('WebGL context unavailable')
    } catch (error) {
      setGlError(error instanceof Error ? error.message : String(error))
      return () => { canvas.remove() }
    }

    let program
    try {
      program = createProgram(gl)
    } catch (error) {
      setGlError(error instanceof Error ? error.message : String(error))
      return () => { canvas.remove() }
    }
    gl.useProgram(program)

    const scene = buildScene(parsed)
    const anim = parsed.anim
    let axisWidth = 6
    for (const p of [parsed.bounds.min, parsed.bounds.max]) {
      for (const n of p) axisWidth = Math.max(axisWidth, n.toFixed(2).length)
    }
    const padAxis = (n) => n.toFixed(2).padStart(axisWidth, ' ')
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, scene.data, gl.STATIC_DRAW)
    const stride = 28
    const aPos = gl.getAttribLocation(program, 'aPos')
    const aColor = gl.getAttribLocation(program, 'aColor')
    const aKind = gl.getAttribLocation(program, 'aKind')
    gl.enableVertexAttribArray(aPos)
    gl.enableVertexAttribArray(aColor)
    if (aKind >= 0) gl.enableVertexAttribArray(aKind)
    const bindAttribs = () => {
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0)
      gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 12)
      if (aKind >= 0) gl.vertexAttribPointer(aKind, 1, gl.FLOAT, false, stride, 24)
    }
    bindAttribs()
    const dynVbo = gl.createBuffer()
    const dynData = new Float32Array(8 * 7)
    gl.bindBuffer(gl.ARRAY_BUFFER, dynVbo)
    gl.bufferData(gl.ARRAY_BUFFER, dynData.byteLength, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    const uMVP = gl.getUniformLocation(program, 'uMVP')
    const uBright = gl.getUniformLocation(program, 'uBright')
    const uKindMask = gl.getUniformLocation(program, 'uKindMask')
    gl.clearColor(...VIEW_BG)
    gl.enable(gl.DEPTH_TEST)

    const view = fitView(parsed.bounds)
    let progress = 0
    let speed = 10
    let isPlaying = false
    let rafId = 0
    let lastTs = 0
    let mvpCache = null

    function kindMask() {
      const layers = layersRef.current
      const cut = layers.cut ? 1 : 0
      return [layers.rapid ? 1 : 0, cut, cut, cut]
    }
    function kindShown(kind) {
      const layers = layersRef.current
      return kind === 'rapid' ? layers.rapid : layers.cut
    }

    function tick(ts) {
      if (!isPlaying) return
      const dt = lastTs === 0 ? 0 : (ts - lastTs) / 1000
      lastTs = ts
      progress += dt * speed
      if (progress >= anim.totalTime) {
        progress = anim.totalTime
        isPlaying = false
        setPlaying(false)
      }
      draw()
      if (isPlaying) rafId = requestAnimationFrame(tick)
    }
    function play() {
      if (isPlaying) return
      if (progress >= anim.totalTime) progress = 0
      isPlaying = true
      lastTs = 0
      rafId = requestAnimationFrame(tick)
    }
    function pause() {
      isPlaying = false
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
    }
    function scrubRatio(ratio) {
      progress = clamp(ratio, 0, 1) * anim.totalTime
      if (!isPlaying) draw()
    }
    function jumpToIndex(index) {
      const n = parsed.segments.length
      if (index == null || index < 0 || n === 0) return
      progress = anim.endTimes[Math.min(index, n - 1)]
      draw()
    }
    function jumpToLine(lineNo) {
      const segs = parsed.segments
      let index = parsed.firstSegByLine.get(lineNo)
      if (index == null) {
        for (let i = 0; i < segs.length; i++) {
          if (segs[i].line >= lineNo) { index = i; break }
        }
      }
      if (index == null) {
        markSourceLineRef.current?.(lineNo)
        return
      }
      jumpToIndex(index)
    }
    function segmentAt(t) {
      const segments = parsed.segments
      let lo = 0
      let hi = segments.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (anim.endTimes[mid] < t) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    function step(dir) {
      const n = parsed.segments.length
      if (!n) return
      if (isPlaying) {
        pause()
        setPlaying(false)
      }
      let index = segmentAt(progress)
      if (index >= n) index = n - 1
      jumpToIndex(clamp(index + dir, 0, n - 1))
    }
    function setPreset(name) {
      const fitted = fitView(parsed.bounds)
      if (name === 'top') {
        view.theta = 0
        view.phi = 0.08
        view.dist = fitted.dist
        view.target = fitted.target.slice()
        view.radius = fitted.radius
      } else {
        Object.assign(view, fitted)
      }
      draw()
    }

    controlsRef.current = {
      reset: () => setPreset('iso'),
      setPreset,
      play,
      pause,
      scrubRatio,
      jumpToLine,
      step,
      setSpeed: (value) => { speed = value },
      setLayers: () => { if (!isPlaying) draw() },
    }

    function eyePosition() {
      const sp = Math.sin(view.phi)
      return [
        view.target[0] + view.dist * sp * Math.cos(view.theta),
        view.target[1] + view.dist * sp * Math.sin(view.theta),
        view.target[2] + view.dist * Math.cos(view.phi),
      ]
    }
    function viewUp() {
      return view.phi < 0.3 ? [0, 1, 0] : [0, 0, 1]
    }

    function updateHud(t, tip, seg) {
      const ratio = anim.totalTime > 0 ? t / anim.totalTime : 0
      if (sliderRef.current) sliderRef.current.value = String(Math.round(ratio * 1000))
      if (pctRef.current) pctRef.current.textContent = `${Math.round(ratio * 100)}%`
      if (coordsRef.current) {
        coordsRef.current.textContent = `X ${padAxis(tip[0])}\nY ${padAxis(tip[1])}\nZ ${padAxis(tip[2])}`
      }
      if (metaRef.current) {
        const feed = seg.feed != null ? ` · F${seg.feed}` : ''
        metaRef.current.textContent = `行 ${seg.line}${feed}`
      }
      markSourceLineRef.current?.(seg.line)
    }

    function projectPoint(mvp, p, w, hgt) {
      const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12]
      const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13]
      const z = mvp[2] * p[0] + mvp[6] * p[1] + mvp[10] * p[2] + mvp[14]
      const ww = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15]
      if (Math.abs(ww) < 1e-9) return null
      const ndcZ = z / ww
      if (ndcZ < -1 || ndcZ > 1) return null
      return [(x / ww * 0.5 + 0.5) * w, (1 - (y / ww * 0.5 + 0.5)) * hgt]
    }
    function pickSegment(cssX, cssY) {
      if (!mvpCache) return null
      const w = canvas.width
      const hgt = canvas.height
      const px = cssX * w / Math.max(1, canvas.clientWidth)
      const py = cssY * hgt / Math.max(1, canvas.clientHeight)
      const limit = 14 * (w / Math.max(1, canvas.clientWidth))
      const limit2 = limit * limit
      let best = -1
      let bestD = limit2
      const segs = parsed.segments
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]
        if (!kindShown(s.kind)) continue
        const a = projectPoint(mvpCache, s.from, w, hgt)
        const b = projectPoint(mvpCache, s.to, w, hgt)
        if (!a || !b) continue
        const abx = b[0] - a[0]
        const aby = b[1] - a[1]
        const len = abx * abx + aby * aby
        const t = len < 1e-8 ? 0 : clamp(((px - a[0]) * abx + (py - a[1]) * aby) / len, 0, 1)
        const dx = px - (a[0] + abx * t)
        const dy = py - (a[1] + aby * t)
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = i }
      }
      return best < 0 ? null : best
    }

    function draw() {
      const w = canvas.width
      const hgt = canvas.height
      if (!w || !hgt) return
      gl.viewport(0, 0, w, hgt)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      const near = Math.max(view.dist / 200, 0.01)
      const far = view.dist * 10 + view.radius * 8
      const proj = mat4Perspective(FOV, w / hgt, near, far)
      const mvp = mat4Multiply(proj, mat4LookAt(eyePosition(), view.target, viewUp()))
      mvpCache = mvp
      gl.uniformMatrix4fv(uMVP, false, mvp)
      gl.uniform4fv(uKindMask, kindMask())

      const segments = parsed.segments
      const t = clamp(progress, 0, anim.totalTime)
      const index = segmentAt(t)
      const pathVerts = scene.pathCount
      const overview = !isPlaying && t === 0
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      bindAttribs()
      if (overview) {
        gl.uniform1f(uBright, 0.92)
        gl.drawArrays(gl.LINES, 0, pathVerts)
      } else {
        const futureStart = Math.min((index + 1) * 2, pathVerts)
        if (futureStart < pathVerts) {
          gl.uniform1f(uBright, 0.34)
          gl.drawArrays(gl.LINES, futureStart, pathVerts - futureStart)
        }
        if (index > 0) {
          gl.uniform1f(uBright, 0.7)
          gl.drawArrays(gl.LINES, 0, index * 2)
        }
      }
      gl.uniform1f(uBright, 0.4)
      gl.drawArrays(gl.LINES, pathVerts, scene.count - pathVerts)

      const seg = segments[Math.min(index, segments.length - 1)]
      let tip
      if (index >= segments.length) {
        tip = seg.to
      } else {
        const start = index === 0 ? 0 : anim.endTimes[index - 1]
        const dur = anim.endTimes[index] - start
        const frac = dur > 0 ? clamp((t - start) / dur, 0, 1) : 1
        tip = [
          seg.from[0] + (seg.to[0] - seg.from[0]) * frac,
          seg.from[1] + (seg.to[1] - seg.from[1]) * frac,
          seg.from[2] + (seg.to[2] - seg.from[2]) * frac,
        ]
      }
      const showCurrent = kindShown(seg.kind)
      const segColor = KIND_COLORS[seg.kind] ?? KIND_COLORS.feed
      const markerLen = view.radius * 0.03
      const kind = KIND_INDEX[seg.kind] ?? 1
      let o = 0
      const put = (p, c, k) => {
        dynData[o++] = p[0]; dynData[o++] = p[1]; dynData[o++] = p[2]
        dynData[o++] = c[0]; dynData[o++] = c[1]; dynData[o++] = c[2]
        dynData[o++] = k
      }
      const started = index < segments.length && t > (index === 0 ? 0 : anim.endTimes[index - 1])
      put(started && showCurrent ? seg.from : tip, segColor, showCurrent ? kind : -1)
      put(tip, segColor, showCurrent ? kind : -1)
      for (let axis = 0; axis < 3; axis++) {
        const a = [...tip]
        const b = [...tip]
        a[axis] -= markerLen
        b[axis] += markerLen
        put(a, MARKER_COLOR, -1)
        put(b, MARKER_COLOR, -1)
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, dynVbo)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dynData)
      bindAttribs()
      gl.uniform1f(uBright, 1)
      gl.drawArrays(gl.LINES, 0, 8)
      updateHud(t, tip, seg)
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(host.clientWidth * dpr))
      const hgt = Math.max(1, Math.round(host.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== hgt) {
        canvas.width = w
        canvas.height = hgt
      }
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    let drag = null
    const onPointerDown = (event) => {
      cardRef.current?.focus({ preventScroll: true })
      canvas.setPointerCapture(event.pointerId)
      drag = {
        x: event.clientX, y: event.clientY,
        ox: event.clientX, oy: event.clientY,
        sx: event.offsetX, sy: event.offsetY,
        pan: event.button === 2 || event.shiftKey,
        moved: false,
      }
    }
    const onPointerMove = (event) => {
      if (!drag) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      drag.x = event.clientX
      drag.y = event.clientY
      if (!drag.moved && Math.hypot(event.clientX - drag.ox, event.clientY - drag.oy) > 4) drag.moved = true
      if (!drag.moved) return
      if (drag.pan) {
        const scale = (2 * view.dist * Math.tan(FOV / 2)) / Math.max(1, canvas.height)
        const eye = eyePosition()
        const dir = vec3Normalize([view.target[0] - eye[0], view.target[1] - eye[1], view.target[2] - eye[2]])
        const right = vec3Normalize(vec3Cross(dir, viewUp()))
        const up = vec3Cross(right, dir)
        for (let i = 0; i < 3; i++) {
          view.target[i] += (-right[i] * dx + up[i] * dy) * scale
        }
      } else {
        view.theta -= dx * 0.008
        view.phi = clamp(view.phi - dy * 0.008, 0.05, Math.PI - 0.05)
      }
      draw()
    }
    const onPointerUp = (event) => {
      if (drag && !drag.moved && event.button === 0) {
        const hit = pickSegment(drag.sx, drag.sy)
        if (hit != null) {
          if (isPlaying) { pause(); setPlaying(false) }
          jumpToIndex(hit)
          openSourceRef.current?.()
        }
      }
      drag = null
    }
    const onWheel = (event) => {
      event.preventDefault()
      view.dist = clamp(view.dist * Math.exp(event.deltaY * 0.0012), view.radius / 100, view.radius * 100)
      draw()
    }
    const onContextMenu = (event) => { event.preventDefault() }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)

    resize()

    return () => {
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      controlsRef.current = null
      pause()
      gl.deleteBuffer(vbo)
      gl.deleteBuffer(dynVbo)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  }, [parsed])

  const failed = parsed && parsed.error
  const hasPath = Boolean(parsed && !failed && parsed.bounds)
  const estimate = hasPath && parsed.anim.totalTime > 0
    ? `按进给估算约 ${fmtTime(parsed.anim.totalTime)}，非机床循环时间`
    : ''

  const togglePlay = () => {
    const controls = controlsRef.current
    if (!controls) return
    if (playing) {
      controls.pause?.()
      setPlaying(false)
    } else {
      controls.play?.()
      setPlaying(true)
    }
  }

  const jumpFromSource = (lineNo) => {
    if (controlsRef.current?.jumpToLine) controlsRef.current.jumpToLine(lineNo)
    else markSourceLine(lineNo)
  }

  const inspectLine = (lineNo) => {
    if (lineNo) {
      setSourceOpen(true)
      jumpFromSource(lineNo)
    }
  }

  const onSourceClick = (event) => {
    const row = event.target.closest('[data-ln]')
    if (!row) return
    jumpFromSource(Number(row.dataset.ln))
  }

  const onSourceKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
    event.preventDefault()
    const current = hudLineRef.current || 1
    if (event.key === 'ArrowDown') jumpFromSource(Math.min(source.lines.length, current + 1))
    else if (event.key === 'ArrowUp') jumpFromSource(Math.max(1, current - 1))
    else jumpFromSource(current)
  }

  const onCardKeyDown = (event) => {
    if (event.target.closest('input, textarea, select')) return
    if (event.target.closest('.tpv-source') && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) return
    if (event.key === ' ') {
      event.preventDefault()
      togglePlay()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      controlsRef.current?.step?.(1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      controlsRef.current?.step?.(-1)
    }
  }

  const toggleLayer = (key) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      layersRef.current = next
      queueMicrotask(() => controlsRef.current?.setLayers?.())
      return next
    })
  }

  const searchSource = (dir) => {
    const q = query.trim().toLowerCase()
    if (!q || !source.lines.length) return
    const n = source.lines.length
    const from = hudLineRef.current || 1
    for (let k = 1; k <= n; k++) {
      const line = ((from - 1 + k * dir) % n + n) % n + 1
      if (source.lines[line - 1].toLowerCase().includes(q)) {
        inspectLine(line)
        return
      }
    }
  }

  return h('div', {
    className: 'tpv-card',
    'data-camind-toolpath-viewer': '',
    ref: cardRef,
    tabIndex: 0,
    onKeyDown: onCardKeyDown,
    'aria-label': fileName ? `刀路查看器 ${fileName}` : '刀路查看器',
    title: DISCLAIMER,
  },
    glError
      ? h('div', { className: 'tpv-fallback' },
          `当前环境无法创建 WebGL 上下文（${glError}），刀路预览不可用；NC 文件本身不受影响。`)
      : !parsed
        ? h('div', { className: 'tpv-fallback' }, '无刀路内容。')
        : failed
          ? h('div', { className: 'tpv-fallback' }, `解析失败：${parsed.error}`)
          : !hasPath
            ? h('div', { className: 'tpv-fallback' }, '未解析到刀路运动（该程序不含可渲染的移动）。')
            : h('div', { className: 'tpv-stage' + (sourceOpen ? ' is-source-open' : '') },
                h('div', { className: 'tpv-view', ref: hostRef }),
                h('div', { className: 'tpv-overlay tpv-views' },
                  h('button', { type: 'button', className: 'tpv-ghost', onClick: () => controlsRef.current?.setPreset?.('top') }, '俯视'),
                  h('button', { type: 'button', className: 'tpv-ghost', onClick: () => controlsRef.current?.setPreset?.('iso') }, '等轴'),
                  h('button', { type: 'button', className: 'tpv-ghost', onClick: () => controlsRef.current?.reset?.() }, '复位'),
                  source.lines.length
                    ? h('button', {
                        type: 'button',
                        className: 'tpv-ghost' + (sourceOpen ? ' is-on' : ''),
                        onClick: () => setSourceOpen((open) => !open),
                      }, sourceOpen ? '收起' : '源码')
                    : null,
                  alerts.slice(0, 4).map((item, index) =>
                    h('button', {
                      key: index,
                      type: 'button',
                      className: 'tpv-chip',
                      'data-level': item.level,
                      title: item.text,
                      onClick: () => inspectLine(item.line),
                    }, item.text))),
                h('div', { className: 'tpv-overlay tpv-hud' },
                  h('div', { ref: coordsRef }),
                  h('div', { className: 'tpv-hud-meta', ref: metaRef })),
                parsed.anim.totalTime > 0
                  ? h('div', { className: 'tpv-overlay tpv-anim' },
                      h('button', { type: 'button', className: 'tpv-ghost tpv-play' + (playing ? ' is-on' : ''), onClick: togglePlay }, playing ? '暂停' : '播放'),
                      h('input', {
                        type: 'range', className: 'tpv-slider', min: 0, max: 1000, defaultValue: 0, ref: sliderRef,
                        'aria-label': '刀路进度',
                        title: estimate,
                        onInput: (e) => controlsRef.current?.scrubRatio?.(Number(e.target.value) / 1000),
                      }),
                      h('span', { className: 'tpv-pct', ref: pctRef, title: estimate }, '0%'),
                      h('select', {
                        className: 'tpv-speed', defaultValue: '10', title: '播放速度', 'aria-label': '播放速度',
                        onChange: (e) => controlsRef.current?.setSpeed?.(Number(e.target.value)),
                      },
                        h('option', { value: '1' }, '×1'),
                        h('option', { value: '10' }, '×10'),
                        h('option', { value: '60' }, '×60')),
                      h('button', {
                        type: 'button',
                        className: 'tpv-layer' + (layers.rapid ? ' is-on' : ''),
                        'aria-pressed': layers.rapid ? 'true' : 'false',
                        onClick: () => toggleLayer('rapid'),
                      }, '快移'),
                      h('button', {
                        type: 'button',
                        className: 'tpv-layer' + (layers.cut ? ' is-on' : ''),
                        'aria-pressed': layers.cut ? 'true' : 'false',
                        onClick: () => toggleLayer('cut'),
                      }, '切削'))
                  : null,
                sourceOpen && source.lines.length
                  ? h('div', { className: 'tpv-drawer' },
                      h('div', { className: 'tpv-drawer-head' },
                        h('input', {
                          className: 'tpv-search',
                          value: query,
                          placeholder: '搜索并回车',
                          'aria-label': '搜索 NC 源码',
                          onChange: (e) => setQuery(e.target.value),
                          onKeyDown: (e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              searchSource(e.shiftKey ? -1 : 1)
                            }
                          },
                        }),
                        h(Button, { variant: 'outline', size: 'sm', onClick: () => setSourceOpen(false) }, '关闭')),
                      h('div', {
                        className: 'tpv-source',
                        ref: sourceRef,
                        role: 'listbox',
                        tabIndex: 0,
                        'aria-label': 'NC 源码，点击或方向键跳到对应刀位',
                        onClick: onSourceClick,
                        onKeyDown: onSourceKeyDown,
                      }, source.lines.map((text, index) =>
                        h('button', {
                          key: index,
                          type: 'button',
                          className: 'tpv-src-line',
                          'data-ln': String(index + 1),
                          role: 'option',
                          tabIndex: -1,
                        },
                          h('span', { className: 'tpv-src-n' }, String(index + 1)),
                          h('span', { className: 'tpv-src-t' }, text || ' ')))))
                  : null))
}

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-ui-toolpath-viewer', '')
    style.textContent = VIEWER_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  // slots.inject waits for a consumer to declare the keyed seat; without one
  // (viewer-less composition) this registration never happens and nothing
  // renders — the consumer side simply skips its preview entry.
  ctx.slots.inject('cam.nc.preview', () =>
    ctx.slots.register({
      name: 'cam.nc.preview',
      key: 'toolpath-viewer',
    }, ToolpathViewer))
}

exports.name = 'ui-toolpath-viewer-client'
exports.inject = ['slots']
exports.apply = apply

return module.exports; } });
