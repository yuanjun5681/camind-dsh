// OKF 记忆条目的 YAML frontmatter 解析与序列化（YAML 子集，无外部依赖）。
// 支持的范围就是本服务产出的结构：顶层 mapping；值为标量、行内列表 [a, b]、
// 行内 mapping { k: v }、块列表（标量或扁平 mapping）或块 mapping。
// 序列化输出保证可被本解析器读回；手写编辑只要同样保持在该子集内即可。

export function splitFrontmatter(markdown) {
  const text = String(markdown ?? '')
  if (!text.startsWith('---\n')) return { frontmatter: null, body: text }
  const end = text.indexOf('\n---\n', 4)
  if (end !== -1) return { frontmatter: text.slice(4, end), body: text.slice(end + 5).replace(/^\n+/, '') }
  if (text.endsWith('\n---')) return { frontmatter: text.slice(4, -4), body: '' }
  return { frontmatter: null, body: text }
}

export function composeFrontmatter(frontmatter, body) {
  const fm = serializeFrontmatter(frontmatter)
  // body 首尾空白归一：与 splitFrontmatter 的去前导换行配套，保证写-读-再写幂等
  const text = `${String(body ?? '').trim()}\n`
  return `---\n${fm}---\n\n${text}`
}

export function parseFrontmatter(text) {
  const lines = String(text ?? '').split('\n')
  const [value, next] = parseMapping(lines, 0, 0)
  for (let i = next; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') throw new Error(`frontmatter 第 ${i + 1} 行无法解析：${lines[i].trim()}`)
  }
  return value
}

function indentOf(line) {
  let n = 0
  while (n < line.length && line[n] === ' ') n += 1
  return n
}

function nextContentLine(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') return i
  }
  return null
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*):(\s+(.*))?$/

function parseMapping(lines, start, indent) {
  const out = {}
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i += 1; continue }
    const cur = indentOf(line)
    if (cur < indent) break
    if (cur > indent) throw new Error(`frontmatter 第 ${i + 1} 行缩进异常`)
    const m = KEY_RE.exec(line.slice(indent))
    if (!m) throw new Error(`frontmatter 第 ${i + 1} 行不是 key: value 形式：${line.trim()}`)
    const key = m[1]
    const rest = m[3]
    if (rest !== undefined && rest.trim() !== '') {
      out[key] = parseInline(rest)
      i += 1
      continue
    }
    const j = nextContentLine(lines, i + 1)
    if (j === null || indentOf(lines[j]) <= indent) { out[key] = null; i += 1; continue }
    if (lines[j].slice(indentOf(lines[j])).startsWith('-')) {
      const [seq, ni] = parseSequence(lines, j, indentOf(lines[j]))
      out[key] = seq
      i = ni
    } else {
      const [map, ni] = parseMapping(lines, j, indentOf(lines[j]))
      out[key] = map
      i = ni
    }
  }
  return [out, i]
}

function parseSequence(lines, start, indent) {
  const out = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i += 1; continue }
    const cur = indentOf(line)
    if (cur < indent) break
    if (cur > indent) throw new Error(`frontmatter 第 ${i + 1} 行缩进异常`)
    const content = line.slice(indent)
    if (!content.startsWith('-')) break
    const rest = content.slice(1).trimStart()
    if (rest === '') throw new Error(`frontmatter 第 ${i + 1} 行列表项为空`)
    const km = rest.startsWith('{') || rest.startsWith('[') ? null : KEY_RE.exec(rest)
    if (km) {
      // `- key: value` 形式，后续更深缩进行并入同一 mapping 项
      const item = {}
      item[km[1]] = km[3] !== undefined && km[3].trim() !== '' ? parseInline(km[3]) : null
      const j = nextContentLine(lines, i + 1)
      if (j !== null && indentOf(lines[j]) > indent) {
        const [more, ni] = parseMapping(lines, j, indentOf(lines[j]))
        Object.assign(item, more)
        i = ni
      } else {
        i += 1
      }
      out.push(item)
      continue
    }
    out.push(parseInline(rest))
    i += 1
  }
  return [out, i]
}

function parseInline(raw) {
  const s = raw.trim()
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    return inner === '' ? [] : splitTopLevel(inner).map(parseInline)
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim()
    const out = {}
    if (inner === '') return out
    for (const part of splitTopLevel(inner)) {
      const m = /^([^:]+):([\s\S]*)$/.exec(part)
      if (!m) throw new Error(`flow mapping 项无法解析：${part.trim()}`)
      const key = parseScalar(m[1].trim())
      out[String(key)] = parseInline(m[2])
    }
    return out
  }
  return parseScalar(s)
}

function splitTopLevel(inner) {
  const parts = []
  let depth = 0
  let quote = null
  let cur = ''
  for (let idx = 0; idx < inner.length; idx += 1) {
    const ch = inner[idx]
    if (quote) {
      cur += ch
      if (quote === '"' && ch === '\\' && idx + 1 < inner.length) { cur += inner[idx + 1]; idx += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '[' || ch === '{') depth += 1
    if (ch === ']' || ch === '}') depth -= 1
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim() !== '') parts.push(cur)
  return parts
}

function parseScalar(raw) {
  const s = raw.trim()
  if (s === '' || s === 'null' || s === '~') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (s.startsWith('"')) {
    try { return JSON.parse(s) } catch { return s.slice(1, -1) }
  }
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10)
  if (/^-?\d*\.\d+$/.test(s)) return Number.parseFloat(s)
  return s
}

export function serializeFrontmatter(obj) {
  const lines = []
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (value === undefined) continue
    emit(lines, key, value, 0)
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isScalar(value) {
  return value === null || typeof value !== 'object'
}

function isFlatMap(value) {
  return isPlainObject(value) && Object.values(value).every(isScalar)
}

function emit(lines, key, value, indent) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) { lines.push(`${pad}${key}: []`); return }
    if (value.every(isScalar)) {
      lines.push(`${pad}${key}: [${value.map(formatScalar).join(', ')}]`)
      return
    }
    lines.push(`${pad}${key}:`)
    for (const item of value) {
      if (isFlatMap(item)) {
        lines.push(`${pad}  - ${flowMap(item)}`)
      } else if (isPlainObject(item)) {
        lines.push(`${pad}  -`)
        for (const [k, v] of Object.entries(item)) emit(lines, k, v, indent + 4)
      } else {
        lines.push(`${pad}  - ${formatScalar(item)}`)
      }
    }
    return
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) { lines.push(`${pad}${key}: {}`); return }
    if (isFlatMap(value)) { lines.push(`${pad}${key}: ${flowMap(value)}`); return }
    lines.push(`${pad}${key}:`)
    for (const [k, v] of Object.entries(value)) emit(lines, k, v, indent + 2)
    return
  }
  lines.push(`${pad}${key}: ${formatScalar(value)}`)
}

function flowMap(obj) {
  const inner = Object.entries(obj).map(([k, v]) => `${k}: ${formatScalar(v)}`).join(', ')
  return `{ ${inner} }`
}

function formatScalar(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  const s = String(value)
  return isPlainSafe(s) ? s : JSON.stringify(s)
}

function isPlainSafe(s) {
  if (s === '') return false
  if (/^\s|\s$/.test(s)) return false
  if (/^(true|false|null|~)$/i.test(s)) return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return false
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false
  if (s.includes(': ') || s.includes(' #') || s.endsWith(':')) return false
  if (/[\n\r\t]/.test(s)) return false
  return true
}
