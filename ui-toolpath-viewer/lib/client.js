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
// array. A play/pause button + scrub slider + speed select drive a time
// cursor; drawing renders whole segments up to the cursor plus the partial
// current segment and a tool-tip cross marker, with a T / XYZ / NC-line HUD
// (CAM-Agent's setStopAtTime semantics on our own parser/renderer — no GPL
// code involved).
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
      warn(`segment cap ${segmentCap} reached — output truncated`)
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
        warn(`line ${line}: R-form arc with zero chord (full circle needs IJK)`)
        return false
      }
      if (r < chord / 2 - 1e-9) {
        warn(`line ${line}: arc radius ${r} smaller than half chord ${chord / 2} — clamped`)
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
        warn(`line ${line}: arc without IJK center or R — skipped`)
        return false
      }
      cu = su + ou // Fanuc: center offsets stay incremental under G90 too
      cv = sv + ov
    }
    const radius = Math.hypot(su - cu, sv - cv)
    if (radius < 1e-9) {
      warn(`line ${line}: zero-radius arc — skipped`)
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

  // One canned-cycle call at (tx, ty): positioning rapid + recorded cycle +
  // a single R→Z feed line (peck/dwell substeps are NOT simulated).
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
    if (tx !== pos[0] || ty !== pos[1]) {
      pushSegment(pos, [tx, ty, pos[2]], 'rapid', line)
    }
    cycles.push({
      code: canned.code,
      label: CANNED_CYCLES[canned.code] ?? `G${canned.code}`,
      at: [tx, ty],
      r: rPlane,
      z: zDepth,
      line,
    })
    pushSegment([tx, ty, rPlane], [tx, ty, zDepth], 'cycle', line)
    pos = [tx, ty, returnInitial ? cannedInitialZ : rPlane]
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
      else if (isG(g, 20)) units = 'inch'
      else if (isG(g, 21)) units = 'mm'
      else if (isG(g, 90)) absolute = true
      else if (isG(g, 91)) absolute = false
      else if (isG(g, 90.1)) warn(`line ${lineNo}: G90.1 absolute arc centers unsupported (IJK stay incremental)`)
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
    if (params.S !== undefined) spindle = params.S
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
      if (params.X !== undefined || params.Y !== undefined) emitCanned(params, lineNo)
      return
    }

    // Inside canned mode, position-less Z/R edits apply to subsequent calls
    // (Fanuc semantics) — no motion, no re-execution.
    if (canned !== null && motionHere === null) {
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
  cycle: [0.898, 0.639, 0.294], // #e5a34b amber — canned cycle R->Z line
}
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
uniform mat4 uMVP;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`

const FRAG_SRC = `
precision mediump float;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`

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

// Flatten segments into an interleaved [x,y,z,r,g,b] vertex array, plus the
// bounding-box wireframe and a muted RGB axis triad at the world origin.
function buildScene(parsed) {
  const { segments, bounds } = parsed
  const verts = []
  const push = (p, c) => verts.push(p[0], p[1], p[2], c[0], c[1], c[2])
  for (const s of segments) {
    const color = KIND_COLORS[s.kind] ?? KIND_COLORS.feed
    push(s.from, color)
    push(s.to, color)
  }
  const { min, max } = bounds
  const corner = (x, y, z) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]]
  const edges = [
    [[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 1, 0]], [[1, 1, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 0]],
    [[0, 0, 1], [1, 0, 1]], [[1, 0, 1], [1, 1, 1]], [[1, 1, 1], [0, 1, 1]], [[0, 1, 1], [0, 0, 1]],
    [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]], [[1, 1, 0], [1, 1, 1]], [[0, 1, 0], [0, 1, 1]],
  ]
  for (const [a, b] of edges) {
    push(corner(...a), BOX_COLOR)
    push(corner(...b), BOX_COLOR)
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1
  const axisLen = diag * 0.15
  for (let axis = 0; axis < 3; axis++) {
    const tip = [0, 0, 0]
    tip[axis] = axisLen
    push([0, 0, 0], AXIS_COLORS[axis])
    push(tip, AXIS_COLORS[axis])
  }
  return { data: new Float32Array(verts), count: verts.length / 6, pathCount: segments.length * 2 }
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
/* height: 100% + flex column：确定高度宿主（ui-preview「预览」标签页面板）里
   卡片整体撑满、视区 flex:1 吃掉 head/foot 以外的高度；自动高度宿主（历史
   内嵌卡片）下 100% 退化为 auto，保持原内容高（视区 min-height 380）。 */
.tpv-card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, transparent);
  height: 100%;
  display: flex;
  flex-direction: column;
}
.tpv-head {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.tpv-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.tpv-file {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tpv-spacer { flex: 1; }
.tpv-warn { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, #b58830)); }
.tpv-btn {
  padding: 3px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 12px; cursor: pointer; transition: background 120ms ease;
}
.tpv-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/* height: 100% fills definite-height hosts (ui-preview「预览」标签页的面板)；
   min-height 保住自动高度宿主（历史内嵌卡片形态）下 380px 的既有形态。 */
.tpv-view { position: relative; flex: 1; min-height: 380px; background: #14181f; }
.tpv-view canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  display: block; touch-action: none; cursor: grab;
}
.tpv-view canvas:active { cursor: grabbing; }
.tpv-anim {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.tpv-anim > .tpv-btn { flex: none; min-width: 3.2em; }
.tpv-slider { flex: 1 1 auto; min-width: 60px; accent-color: #4d9fff; }
.tpv-ro {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  white-space: pre;
}
.tpv-speed {
  flex: none;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px;
}
.tpv-fallback {
  padding: 16px 12px; font-size: 12px; line-height: 1.7;
  color: var(--dsw-alias-label-secondary); background: #14181f;
}
.tpv-foot {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 6px 10px;
  font-size: 11px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.tpv-legend { display: inline-flex; align-items: center; gap: 4px; }
.tpv-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.tpv-hint { margin-left: auto; }
`

const LEGEND = [
  ['rapid', '快移'],
  ['feed', '切削'],
  ['arc', '圆弧'],
  ['cycle', '孔位'],
]

function cssColor(kind) {
  const c = KIND_COLORS[kind]
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
}

// Owner props (consumer contract): { content, fileName } — NC text + name.
function ToolpathViewer({ content, fileName }) {
  const hostRef = useRef(null)
  const controlsRef = useRef(null)
  const sliderRef = useRef(null)
  const timeRef = useRef(null)
  const coordsRef = useRef(null)
  const lineRef = useRef(null)
  const [glError, setGlError] = useState(null)
  const [playing, setPlaying] = useState(false)

  const parsed = useMemo(() => {
    if (typeof content !== 'string' || content.trim() === '') return null
    try {
      const result = parseNc(content)
      if (result.bounds) result.anim = computeTiming(result)
      return result
    } catch (error) {
      // parseNc is fail-safe by design; this only guards bundle-level faults.
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [content])

  // Clear a stale GL failure / playback state when new content arrives, so
  // the effect below gets a fresh canvas host to retry on. Declared first:
  // effects run in declaration order.
  useEffect(() => { setGlError(null); setPlaying(false) }, [content])

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
    // HUD strings keep a constant character width so the flex slider does
    // not grow/shrink as seconds, axis digits, or NC line numbers change.
    const timeWidth = fmtTime(anim.totalTime).length
    let axisWidth = 6
    for (const p of [parsed.bounds.min, parsed.bounds.max]) {
      for (const n of p) axisWidth = Math.max(axisWidth, n.toFixed(2).length)
    }
    let lineWidth = 1
    for (const s of parsed.segments) {
      lineWidth = Math.max(lineWidth, String(s.line).length)
    }
    const padAxis = (n) => n.toFixed(2).padStart(axisWidth, ' ')
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, scene.data, gl.STATIC_DRAW)
    const stride = 24 // 6 floats per vertex: position + color
    const aPos = gl.getAttribLocation(program, 'aPos')
    const aColor = gl.getAttribLocation(program, 'aColor')
    gl.enableVertexAttribArray(aPos)
    gl.enableVertexAttribArray(aColor)
    const bindAttribs = () => {
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0)
      gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 12)
    }
    bindAttribs()
    // Dynamic buffer: current partial segment (2 verts) + tool-tip marker
    // cross (6 verts), rewritten every animation frame.
    const dynVbo = gl.createBuffer()
    const dynData = new Float32Array(8 * 6)
    gl.bindBuffer(gl.ARRAY_BUFFER, dynVbo)
    gl.bufferData(gl.ARRAY_BUFFER, dynData.byteLength, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    const uMVP = gl.getUniformLocation(program, 'uMVP')
    gl.clearColor(...VIEW_BG)
    gl.enable(gl.DEPTH_TEST)

    const view = fitView(parsed.bounds)

    // Playback state: progress in seconds along the cumulative time axis.
    let progress = 0
    let speed = 10
    let isPlaying = false
    let rafId = 0
    let lastTs = 0

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
      if (progress >= anim.totalTime) progress = 0 // replay from the start
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

    controlsRef.current = {
      reset: () => {
        Object.assign(view, fitView(parsed.bounds))
        draw()
      },
      play,
      pause,
      scrubRatio,
      setSpeed: (value) => { speed = value },
    }

    function eyePosition() {
      const sp = Math.sin(view.phi)
      return [
        view.target[0] + view.dist * sp * Math.cos(view.theta),
        view.target[1] + view.dist * sp * Math.sin(view.theta),
        view.target[2] + view.dist * Math.cos(view.phi),
      ]
    }

    function updateHud(t, tip, seg) {
      if (sliderRef.current) sliderRef.current.value = String(Math.round((t / anim.totalTime) * 1000))
      if (timeRef.current) timeRef.current.textContent = `${fmtTime(t).padStart(timeWidth, ' ')} / ${fmtTime(anim.totalTime)}`
      if (coordsRef.current) coordsRef.current.textContent = `X ${padAxis(tip[0])}  Y ${padAxis(tip[1])}  Z ${padAxis(tip[2])}`
      if (lineRef.current) lineRef.current.textContent = `行 ${String(seg.line).padStart(lineWidth, ' ')}`
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
      const mvp = mat4Multiply(proj, mat4LookAt(eyePosition(), view.target, [0, 0, 1]))
      gl.uniformMatrix4fv(uMVP, false, mvp)

      const segments = parsed.segments
      const t = clamp(progress, 0, anim.totalTime)
      // Binary search: first segment whose end time covers t; everything
      // before it is drawn whole from the static buffer.
      let lo = 0
      let hi = segments.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (anim.endTimes[mid] < t) lo = mid + 1
        else hi = mid
      }
      const index = lo
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      bindAttribs()
      gl.drawArrays(gl.LINES, 0, index * 2)
      gl.drawArrays(gl.LINES, scene.pathCount, scene.count - scene.pathCount)

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
      const segColor = KIND_COLORS[seg.kind] ?? KIND_COLORS.feed
      const markerLen = view.radius * 0.03
      let o = 0
      const put = (p, c) => {
        dynData[o++] = p[0]; dynData[o++] = p[1]; dynData[o++] = p[2]
        dynData[o++] = c[0]; dynData[o++] = c[1]; dynData[o++] = c[2]
      }
      // Zero-length (invisible) when the current segment has not started yet.
      const started = index < segments.length && t > (index === 0 ? 0 : anim.endTimes[index - 1])
      put(started ? seg.from : tip, segColor)
      put(tip, segColor)
      for (let axis = 0; axis < 3; axis++) {
        const a = [...tip]
        const b = [...tip]
        a[axis] -= markerLen
        b[axis] += markerLen
        put(a, MARKER_COLOR)
        put(b, MARKER_COLOR)
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, dynVbo)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dynData)
      bindAttribs()
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

    // Orbit: drag rotates, wheel dollies, Shift-drag or right-drag pans.
    let drag = null
    const onPointerDown = (event) => {
      canvas.setPointerCapture(event.pointerId)
      drag = { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.shiftKey }
    }
    const onPointerMove = (event) => {
      if (!drag) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      drag.x = event.clientX
      drag.y = event.clientY
      if (drag.pan) {
        const scale = (2 * view.dist * Math.tan(FOV / 2)) / Math.max(1, canvas.height)
        const eye = eyePosition()
        const dir = vec3Normalize([view.target[0] - eye[0], view.target[1] - eye[1], view.target[2] - eye[2]])
        const right = vec3Normalize(vec3Cross(dir, [0, 0, 1]))
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
    const onPointerUp = () => { drag = null }
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
  const stats = parsed && !failed ? parsed.stats : null
  const hasPath = Boolean(parsed && !failed && parsed.bounds)

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

  return h('div', { className: 'tpv-card', 'data-camind-toolpath-viewer': '' },
    h('div', { className: 'tpv-head' },
      h('span', { className: 'tpv-title' }, '刀路查看器'),
      fileName ? h('span', { className: 'tpv-file' }, fileName) : null,
      h('span', { className: 'tpv-spacer' }),
      stats && stats.skipped > 0
        ? h('span', { className: 'tpv-warn' }, `跳过 ${stats.skipped} 行`)
        : null,
      hasPath && !glError
        ? h('button', {
            type: 'button',
            className: 'tpv-btn',
            onClick: () => controlsRef.current?.reset?.(),
          }, '复位视角')
        : null),
    glError
      ? h('div', { className: 'tpv-fallback' },
          `当前环境无法创建 WebGL 上下文（${glError}），刀路预览不可用；NC 文件本身不受影响。`)
      : !parsed
        ? h('div', { className: 'tpv-fallback' }, '无刀路内容。')
        : failed
          ? h('div', { className: 'tpv-fallback' }, `解析失败：${parsed.error}`)
          : !hasPath
            ? h('div', { className: 'tpv-fallback' }, '未解析到刀路运动（该程序不含可渲染的移动）。')
            : h('div', { className: 'tpv-view', ref: hostRef }),
    hasPath && !glError && parsed.anim.totalTime > 0
      ? h('div', { className: 'tpv-anim' },
          h('button', { type: 'button', className: 'tpv-btn', onClick: togglePlay }, playing ? '暂停' : '播放'),
          h('input', {
            type: 'range', className: 'tpv-slider', min: 0, max: 1000, defaultValue: 0, ref: sliderRef,
            onInput: (e) => controlsRef.current?.scrubRatio?.(Number(e.target.value) / 1000),
          }),
          h('span', { className: 'tpv-ro', ref: timeRef }),
          h('span', { className: 'tpv-ro', ref: coordsRef }),
          h('span', { className: 'tpv-ro', ref: lineRef }),
          h('select', {
            className: 'tpv-speed', defaultValue: '10', title: '播放速度',
            onChange: (e) => controlsRef.current?.setSpeed?.(Number(e.target.value)),
          },
            h('option', { value: '1' }, '×1'),
            h('option', { value: '10' }, '×10'),
            h('option', { value: '60' }, '×60')))
      : null,
    stats
      ? h('div', { className: 'tpv-foot' },
          LEGEND.map(([kind, label]) =>
            h('span', { key: kind, className: 'tpv-legend' },
              h('span', { className: 'tpv-dot', style: { background: cssColor(kind) } }),
              `${label} ${stats[kind]}`)),
          parsed.meta.units === 'inch' ? h('span', { className: 'tpv-warn' }, 'G20 英制') : null,
          h('span', { className: 'tpv-hint' }, '拖动旋转 · 滚轮缩放 · Shift/右键拖动平移'))
      : null)
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
