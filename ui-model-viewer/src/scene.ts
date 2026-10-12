// Pure scene assembly: parse each NC independently; invert its own verified station into package space.
import { parseNc } from './core/nc/parser.ts'
import type { NcParseResult } from './core/nc/parser.ts'
import { RigidTransform, v3 } from './core/math.ts'
import type { BoundingBox } from './core/math.ts'
export type Program = { id: string; name: string; file: string; station: string; content: string; fid?: string; parsed: NcParseResult; toPackage: RigidTransform; times: Float64Array; duration: number }
export function makeProgram(op: any, station?: any): Program {
  const parsed = parseNc(op.content, { segmentCap: 1_000_000 })
  if (station) {
    if (parsed.meta.units !== 'mm' || parsed.meta.truncated || parsed.meta.skipped.length) throw new Error(`${op.file}：单位非毫米或程序解析不完整，不能联合显示`)
    // These codes change coordinates the display parser does not evaluate. Never guess their placement.
    for (const raw of op.content.split('\n')) {
      const line = raw.replace(/\([^)]*\)/g, '').split(';')[0]
      for (const match of line.matchAll(/G\s*([+-]?(?:\d+\.?\d*|\.\d+))/gi)) {
        const g = Number(match[1])
        if (![0, 1, 2, 3, 4, 17, 21, 28, 30, 40, 41, 42, 43, 44, 49, 54, 55, 56, 57, 58, 59, 61, 64, 73, 74, 76, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 91.1, 94, 98, 99].includes(g) || (g >= 54 && g <= 59 && `G${g}` !== station.name)) throw new Error(`${op.file}：含未支持或未绑定的指令 G${g}，不能联合显示`)
      }
      if (/[ABC]\s*[+-]?(?:\d|\.)/i.test(line)) throw new Error(`${op.file}：含旋转轴运动，当前仅支持三轴轨迹`)
    }
  }
  const transform = new RigidTransform()
  if (station) { transform.r = station.part_to_nc.r.map((row: number[]) => [...row]); transform.t = [...station.part_to_nc.t] }
  const times = new Float64Array(parsed.segments.length + 1)
  parsed.segments.forEach((s, i) => {
    const distance = Math.hypot(...s.to.map((v, k) => v - s.from[k]))
    const rate = s.kind === 'rapid' ? 8000 : s.feed && s.feed > 0 ? s.feed : 500
    times[i + 1] = times[i] + distance / rate * 60
  })
  return { ...op, station: station?.name ?? 'NC原始坐标', parsed, toPackage: transform.inverse(), times, duration: times[times.length - 1] }
}
export function atTime(program: Program, time: number) {
  const { times, parsed } = program
  if (!parsed.segments.length) return { index: 0, fraction: 0, point: null }
  let lo = 0, hi = parsed.segments.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (times[mid + 1] <= time) lo = mid + 1; else hi = mid }
  const index = Math.min(lo, parsed.segments.length - 1), s = parsed.segments[index]
  const fraction = Math.max(0, Math.min(1, (time - times[index]) / Math.max(times[index + 1] - times[index], 1e-9)))
  return { index, fraction, point: s.from.map((v, k) => v + (s.to[k] - v) * fraction) }
}
const COLORS = { rapid: [242, 92, 92], feed: [77, 159, 255], arc: [88, 211, 235], cycle: [240, 180, 60] }
export function buildScene(programs: Program[], visible: string[], activeId: string, rapid: boolean, cutting: boolean) {
  const ordered = [...programs.filter(p => p.id !== activeId), ...programs.filter(p => p.id === activeId)].filter(p => visible.includes(p.id))
  const chosen = ordered.map(p => ({ p, indices: p.parsed.segments.flatMap((s, i) => (s.kind === 'rapid' ? rapid : cutting) ? [i] : []) }))
  const count = chosen.reduce((n, row) => n + row.indices.length, 0)
  if (count > 1_000_000) throw new Error('可见刀路合计超过100万段')
  const positions = new Float32Array(count * 6), colors = new Uint8Array(count * 8), lines: number[] = [], locals = new Uint32Array(count)
  const ranges: { id: string; start: number; end: number }[] = []
  let index = 0, activeStart = count, activeEnd = count
  for (const { p, indices } of chosen) {
    const start = index
    for (const local of indices) {
      const s = p.parsed.segments[local], color = COLORS[s.kind]
      for (const [vertex, point] of [s.from, s.to].entries()) {
        const v = p.toPackage.apply(v3(...point as [number, number, number]))
        positions.set([v.x, v.y, v.z], index * 6 + vertex * 3)
        colors.set([...color.map((value, k) => p.id === activeId ? value : Math.round([27, 30, 36][k] + (value - [27, 30, 36][k]) * 0.3)), 255], index * 8 + vertex * 4)
      }
      lines.push(s.line); locals[index] = local; index++
    }
    ranges.push({ id: p.id, start, end: index })
    if (p.id === activeId) { activeStart = start; activeEnd = index }
  }
  return { geometry: { positions, colors, lines }, locals, ranges, activeStart, activeEnd }
}
export function programBounds(program: Program): BoundingBox | undefined {
  const b = program.parsed.bounds
  if (!b) return
  const points = Array.from({ length: 8 }, (_, i) => program.toPackage.apply(v3(...b.min.map((v, k) => i & (1 << k) ? b.max[k] : v) as [number, number, number])))
  return { min: v3(...[0, 1, 2].map(k => Math.min(...points.map(v => [v.x, v.y, v.z][k]))) as [number, number, number]), max: v3(...[0, 1, 2].map(k => Math.max(...points.map(v => [v.x, v.y, v.z][k]))) as [number, number, number]) }
}
