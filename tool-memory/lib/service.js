// memoryBank Cordis 服务：$DSH_HOME/memory/ 下 OKF bundle 的解析、校验、CRUD 与检索。
// 知识库 knowledge/<name>.md（type: Knowledge）与经验库 experience/exp-*.md（type: Experience）。
// 磁盘 markdown 是唯一真相源；写操作 best-effort 自动 git commit（失败仅告警）；只读操作不 git init。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { composeFrontmatter, parseFrontmatter, splitFrontmatter } from './frontmatter.js'

const TYPES = {
  knowledge: { dir: 'knowledge', okf: 'Knowledge', maxBytes: 512 * 1024 },
  experience: { dir: 'experience', okf: 'Experience', maxBytes: 256 * 1024 },
}
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
const EXP_NAME_RE = /^exp-[a-z0-9][a-z0-9-]{0,58}$/
const RESERVED_NAMES = new Set(['index', 'log'])
const CATEGORIES = ['industry', 'process', 'circuit', 'enterprise', 'general']
const STATUSES = ['draft', 'stable', 'deprecated']
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 500
// 范本原件归档：$DSH_HOME/memory/reference/<sha8>_<文件名>.prt（经验条目的 refs 指向这里）。
const REF_DIR = 'reference'
const REF_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,140}\.prt$/i
const SIGNATURE_KEY_RE = /^[a-z0-9_]{1,24}$/

function fail(message) {
  throw new Error(message)
}

function asStringList(value) {
  if (value === undefined || value === null) return []
  const list = Array.isArray(value) ? value : [value]
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))]
}

function kebabize(text) {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug.slice(0, 48).replace(/-+$/g, '')
}

function firstSentence(text, max = 80) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const m = /^(.{10,}?[。！？.!?])(?=\s|$)/.exec(flat)
  const sentence = m ? m[1] : flat
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1)}…`
}

// 特征签名：扁平 string 键值对（材料/孔数档/工序类型/关键尺寸档等，OKF 合法扩展键），
// 检索「元数据粗排」阶段做逐键精确过滤，语义重排不变。
// 写路径严格（strict：非法即报错），读路径宽松（脏键静默跳过，挡住手编条目炸列表）。
function cleanSignature(value, { strict = false } = {}) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    if (strict) fail('signature 必须是扁平键值对对象。')
    return null
  }
  const out = {}
  for (const [rawKey, rawVal] of Object.entries(value)) {
    const key = String(rawKey).trim().toLowerCase()
    const val = String(rawVal ?? '').trim()
    if (!SIGNATURE_KEY_RE.test(key) || !val) {
      if (strict && key && val) fail(`signature 键非法：${rawKey}（小写字母/数字/下划线，≤24 字符）`)
      continue
    }
    out[key] = val.slice(0, 48)
    if (Object.keys(out).length > 12) {
      if (strict) fail('signature 键数超过上限（12）。')
      break
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

export function renderExperienceBody(situation, lesson, action) {
  return `**情境**：${String(situation ?? '').trim()}\n\n**教训**：${String(lesson ?? '').trim()}\n\n**做法**：${String(action ?? '').trim()}\n`
}

export function parseExperienceBody(body) {
  const text = String(body ?? '')
  const pick = (label, rest) => {
    const re = new RegExp(`\\*\\*${label}\\*\\*：([\\s\\S]*?)(?=\\n\\*\\*(?:${rest})\\*\\*：|$)`)
    return (re.exec(text)?.[1] ?? '').trim()
  }
  return {
    situation: pick('情境', '教训|做法'),
    lesson: pick('教训', '做法'),
    action: pick('做法', '情境|教训'),
  }
}

export function createMemoryBankService({ gitRepository, memoryRoot } = {}) {
  const root = memoryRoot ?? (process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'memory') : null)
  let repoReady = false

  function requireRoot() {
    if (!root) fail('DSH_HOME 未设置，记忆库不可用。')
    return root
  }

  // refs：归档原件的 bundle 相对路径列表（条目是索引、原件是附件）；
  // 只接受 reference/<文件名>.prt 且原件必须已在盘上（先 archiveReference 再引用）。
  function checkRefs(value) {
    const refs = asStringList(value)
    for (const ref of refs) {
      if (!ref.startsWith(`${REF_DIR}/`) || !REF_FILE_RE.test(ref.slice(REF_DIR.length + 1))) {
        fail(`refs 只接受 ${REF_DIR}/<文件名>.prt 形式的 bundle 相对路径：${ref}`)
      }
      if (!existsSync(path.join(requireRoot(), ref))) fail(`refs 引用的原件不存在：${ref}`)
    }
    return refs
  }

  function dirOf(type) {
    return path.join(requireRoot(), TYPES[type].dir)
  }

  function fileOf(type, name) {
    return path.join(dirOf(type), `${name}.md`)
  }

  function assertName(type, name) {
    const re = type === 'experience' ? EXP_NAME_RE : NAME_RE
    if (typeof name !== 'string' || !re.test(name) || RESERVED_NAMES.has(name)) {
      fail(`${type === 'experience' ? '经验' : '知识'}条目名非法：${name}（kebab-case${type === 'experience' ? '，且必须 exp- 前缀' : '，且禁止 exp- 前缀'}）`)
    }
    if (type === 'knowledge' && name.startsWith('exp-')) fail(`知识条目名禁止 exp- 前缀：${name}`)
  }

  function parseEntryFile(type, name, file) {
    const markdown = readFileSync(file, 'utf8')
    const { frontmatter, body } = splitFrontmatter(markdown)
    if (frontmatter === null) fail(`条目缺少 YAML frontmatter：${name}`)
    const fm = parseFrontmatter(frontmatter) ?? {}
    if (typeof fm.type !== 'string' || fm.type.trim() === '') fail(`条目 frontmatter 缺少 type：${name}`)
    return { name, type, frontmatter: fm, body: body ?? '', markdown }
  }

  function summaryOf(type, name, fm, file) {
    const mtime = statSync(file).mtimeMs
    const summary = {
      name,
      type,
      title: typeof fm.title === 'string' ? fm.title : name,
      description: typeof fm.description === 'string' ? fm.description : '',
      tags: asStringList(fm.tags),
      circuit_types: asStringList(fm.circuit_types),
      status: STATUSES.includes(fm.status) ? fm.status : 'stable',
      updated_at: typeof fm.generated?.at === 'string' ? fm.generated.at : new Date(mtime).toISOString(),
    }
    if (type === 'knowledge') {
      summary.category = CATEGORIES.includes(fm.category) ? fm.category : 'general'
      summary.metadata_status = ['pending', 'ready', 'failed'].includes(fm.metadata_status) ? fm.metadata_status : 'ready'
      summary.aliases = asStringList(fm.aliases)
    } else {
      summary.trigger = typeof fm.trigger === 'string' ? fm.trigger : ''
      summary.confidence = typeof fm.confidence === 'number' ? fm.confidence : null
      summary.evidence_count = Array.isArray(fm.evidence) ? fm.evidence.length : 0
      summary.metadata_status = ['pending', 'ready', 'failed'].includes(fm.metadata_status) ? fm.metadata_status : 'ready'
      const signature = cleanSignature(fm.signature)
      if (signature) summary.signature = signature
      const refs = asStringList(fm.refs).filter((ref) => ref.startsWith(`${REF_DIR}/`))
      if (refs.length > 0) summary.refs = refs
    }
    return summary
  }

  function scanEntries(typeFilter) {
    if (!root) return []
    const types = typeFilter ? [typeFilter] : Object.keys(TYPES)
    const out = []
    for (const type of types) {
      const dir = path.join(root, TYPES[type].dir)
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md')) continue
        const name = file.slice(0, -3)
        if (RESERVED_NAMES.has(name)) continue
        const absolute = path.join(dir, file)
        try {
          const entry = parseEntryFile(type, name, absolute)
          out.push({ summary: summaryOf(type, name, entry.frontmatter, absolute), entry })
        } catch (error) {
          console.warn(`[tool-memory] 跳过无法解析的条目 ${type}/${name}：${error.message}`)
        }
      }
    }
    return out
  }

  function scoreOf({ summary, entry }, terms) {
    let score = 0
    let titleDesc = 0
    let bodyHit = 0
    const titleDescText = `${summary.name}\n${summary.title}\n${summary.description}`.toLowerCase()
    const bodyText = entry.body.toLowerCase()
    for (const term of terms) {
      if (summary.circuit_types.some((item) => item.toLowerCase().includes(term))) score += 10
      if (summary.tags.some((item) => item.toLowerCase().includes(term))) score += 3
      if ((summary.aliases ?? []).some((item) => item.toLowerCase().includes(term))) score += 2
      if (titleDescText.includes(term)) titleDesc += 1
      if (bodyText.includes(term)) bodyHit += 1
    }
    return score + Math.min(titleDesc, 5) + Math.min(bodyHit, 2)
  }

  function listEntries(filter = {}) {
    const terms = String(filter.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const statusFilter = filter.status && STATUSES.includes(filter.status) ? filter.status : null
    const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? Math.min(filter.limit, MAX_LIMIT) : DEFAULT_LIMIT
    let rows = scanEntries(filter.type && TYPES[filter.type] ? filter.type : null)
    rows = rows.filter(({ summary }) => {
      if (filter.status === 'all') return true
      if (statusFilter) return summary.status === statusFilter
      return summary.status !== 'deprecated'
    })
    if (filter.category) rows = rows.filter(({ summary }) => summary.category === filter.category)
    if (filter.tag) rows = rows.filter(({ summary }) => summary.tags.includes(filter.tag))
    if (filter.circuit_type) rows = rows.filter(({ summary }) => summary.circuit_types.includes(filter.circuit_type))
    // 特征签名精确过滤（设计稿 §5.2）：提供的键逐键完全匹配（大小写不敏感）；
    // 无 signature 的条目（含全部知识条目）在给出签名过滤时一律排除。
    if (filter.signature && typeof filter.signature === 'object') {
      const wanted = cleanSignature(filter.signature, { strict: true })
      if (wanted) {
        const pairs = Object.entries(wanted).map(([k, v]) => [k, v.toLowerCase()])
        rows = rows.filter(({ entry }) => {
          const sig = cleanSignature(entry.frontmatter?.signature)
          if (!sig) return false
          return pairs.every(([k, v]) => String(sig[k] ?? '').toLowerCase() === v)
        })
      }
    }
    const scored = rows.map((row) => ({
      ...row.summary,
      score: terms.length === 0 ? 0 : scoreOf(row, terms),
    }))
    if (terms.length > 0) {
      scored.sort((a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at))
      return scored.filter((row) => row.score > 0).slice(0, limit)
    }
    scored.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return scored.slice(0, limit)
  }

  function readEntry(type, name) {
    if (!TYPES[type]) fail(`未知条目类型：${type}`)
    assertName(type, name)
    const file = fileOf(type, name)
    if (!existsSync(file)) return null
    const entry = parseEntryFile(type, name, file)
    const result = { ...entry, summary: summaryOf(type, name, entry.frontmatter, file) }
    if (type === 'experience') result.sections = parseExperienceBody(entry.body)
    return result
  }

  async function ensureRepo() {
    if (repoReady || !gitRepository) return
    repoReady = true
    try {
      await gitRepository.initRepository({ repoRoot: requireRoot(), bootstrapGlobs: ['*.md'] })
    } catch (error) {
      console.warn(`[tool-memory] 记忆库 git 初始化失败（忽略，不影响读写）：${error.message}`)
    }
  }

  async function autoCommit(message) {
    if (!gitRepository) return
    try {
      await gitRepository.commit({ worktreePath: requireRoot(), message, addGlobs: ['*.md'] })
    } catch (error) {
      console.warn(`[tool-memory] 记忆库自动提交失败（忽略，不影响读写）：${error.message}`)
    }
  }

  function rebuildIndexes() {
    try {
      mkdirSync(path.join(requireRoot(), 'knowledge'), { recursive: true })
      mkdirSync(path.join(requireRoot(), 'experience'), { recursive: true })
      const knowledge = scanEntries('knowledge').map(({ summary }) => summary)
      const experience = scanEntries('experience').map(({ summary }) => summary)
      const rootIndex = path.join(requireRoot(), 'index.md')
      if (!existsSync(rootIndex)) {
        writeFileSync(rootIndex, composeFrontmatter({ okf_version: '0.2' }, [
          '# Subdirectories',
          '',
          '* [knowledge](knowledge/index.md) - 知识库：人工维护的领域事实与规范。',
          '* [experience](experience/index.md) - 经验库：从工作中提炼的情境化教训（候选需人工审核）。',
          '',
        ].join('\n')))
      }
      writeFileSync(path.join(dirOf('knowledge'), 'index.md'), [
        '# Knowledge',
        '',
        ...knowledge.map((item) => `* [${item.title}](${item.name}.md) - ${item.description || item.name}`),
        '',
      ].join('\n'))
      writeFileSync(path.join(dirOf('experience'), 'index.md'), [
        '# Experience',
        '',
        ...experience.map((item) => `* [${item.title}](${item.name}.md) - ${item.description || item.name}`),
        '',
      ].join('\n'))
    } catch (error) {
      console.warn(`[tool-memory] 重建 index.md 失败（忽略）：${error.message}`)
    }
  }

  async function writeEntry(type, name, frontmatter, body, message) {
    mkdirSync(dirOf(type), { recursive: true })
    const markdown = composeFrontmatter(frontmatter, body)
    const bytes = Buffer.byteLength(markdown, 'utf8')
    if (bytes > TYPES[type].maxBytes) {
      fail(`条目超过大小上限（${TYPES[type].maxBytes / 1024}KB）：${name}`)
    }
    await ensureRepo()
    writeFileSync(fileOf(type, name), markdown)
    rebuildIndexes()
    await autoCommit(message)
  }

  function uniqueName(type, base) {
    let candidate = base
    let n = 2
    while (existsSync(fileOf(type, candidate))) {
      candidate = `${base}-${n}`
      n += 1
    }
    return candidate
  }

  async function saveKnowledge(exec, fields = {}) {
    const title = String(fields.title ?? '').trim()
    const description = String(fields.description ?? '').trim()
    const body = String(fields.body ?? '').trim()
    if (!title) fail('title 不能为空。')
    if (!description) fail('description 不能为空（检索召回依赖它）。')
    if (!body) fail('body 不能为空。')
    const actor = fields.actor ?? 'dsh-agent/unknown'
    const explicit = typeof fields.name === 'string' && fields.name.trim() !== ''
    const name = explicit ? fields.name.trim() : uniqueName('knowledge', kebabize(title) || 'entry')
    assertName('knowledge', name)
    const existing = existsSync(fileOf('knowledge', name)) ? readEntry('knowledge', name) : null
    if (!explicit && existing) fail(`条目已存在：${name}`)
    const frontmatter = {
      ...(existing?.frontmatter ?? {}),
      type: 'Knowledge',
      title,
      description,
      tags: asStringList(fields.tags),
      category: CATEGORIES.includes(fields.category) ? fields.category : 'general',
      circuit_types: asStringList(fields.circuit_types),
      aliases: fields.aliases !== undefined ? asStringList(fields.aliases) : asStringList(existing?.frontmatter?.aliases),
      status: existing?.frontmatter?.status ?? 'stable',
      metadata_status: 'ready',
      generated: { by: actor, at: new Date().toISOString() },
    }
    await writeEntry('knowledge', name, frontmatter, body, `feat(memory): ${existing ? 'update' : 'create'} knowledge ${name}`)
    return { name, created: !existing }
  }

  async function updateEntry(_exec, type, name, patch = {}) {
    if (!TYPES[type]) fail(`未知条目类型：${type}`)
    const entry = readEntry(type, name)
    if (!entry) fail(`条目不存在：${type}/${name}`)
    const actor = patch.actor ?? 'human:user'
    const frontmatter = { ...entry.frontmatter }
    for (const key of ['title', 'description', 'trigger', 'metadata_status']) {
      if (patch[key] !== undefined) frontmatter[key] = String(patch[key])
    }
    if (patch.category !== undefined) frontmatter.category = CATEGORIES.includes(patch.category) ? patch.category : 'general'
    if (patch.tags !== undefined) frontmatter.tags = asStringList(patch.tags)
    if (patch.circuit_types !== undefined) frontmatter.circuit_types = asStringList(patch.circuit_types)
    if (patch.aliases !== undefined) frontmatter.aliases = asStringList(patch.aliases)
    let body = entry.body
    if (type === 'experience') {
      if (patch.situation !== undefined || patch.lesson !== undefined || patch.action !== undefined) {
        const current = parseExperienceBody(entry.body)
        body = renderExperienceBody(
          patch.situation ?? current.situation,
          patch.lesson ?? current.lesson,
          patch.action ?? current.action,
        )
      }
      if (frontmatter.status === 'stable') frontmatter.status = 'draft'
    }
    if (patch.body !== undefined) body = String(patch.body)
    frontmatter.generated = { by: actor, at: new Date().toISOString() }
    await writeEntry(type, name, frontmatter, body, `chore(memory): update ${type} ${name}`)
    return { name }
  }

  async function deleteEntry(_exec, type, name) {
    if (!TYPES[type]) fail(`未知条目类型：${type}`)
    assertName(type, name)
    const file = fileOf(type, name)
    if (!existsSync(file)) return false
    await ensureRepo()
    unlinkSync(file)
    rebuildIndexes()
    await autoCommit(`chore(memory): delete ${type} ${name}`)
    return true
  }

  async function extractExperience(exec, fields = {}) {
    const pending = fields.metadata_status === 'pending'
    const title = String(fields.title ?? '').trim()
    const trigger = String(fields.trigger ?? '').trim()
    const situation = String(fields.situation ?? '').trim()
    const lesson = String(fields.lesson ?? '').trim()
    const action = String(fields.action ?? '').trim()
    // pending（范本反推）模式允许 title 留空：占位为条目名，由元数据补全流程后补
    // （backfill 仅在 title 为空或等于条目名时覆盖）。
    const required = pending
      ? [['trigger', trigger], ['situation', situation], ['lesson', lesson], ['action', action]]
      : [['title', title], ['trigger', trigger], ['situation', situation], ['lesson', lesson], ['action', action]]
    for (const [label, value] of required) {
      if (!value) fail(`${label} 不能为空。`)
    }
    const signature = cleanSignature(fields.signature, { strict: true })
    const refs = checkRefs(fields.refs)
    const now = new Date()
    const ym = now.toISOString().slice(0, 7)
    const slug = kebabize(title) || 'lesson'
    let name = null
    for (let n = 1; n < 100 && name === null; n += 1) {
      const candidate = `exp-${ym}-${slug}-${String(n).padStart(2, '0')}`
      if (!existsSync(fileOf('experience', candidate))) name = candidate
    }
    if (!name) fail('无法分配经验条目名（当月序号已满）。')
    const sessionId = typeof exec?.agent?.id === 'string' && exec.agent.id ? exec.agent.id : 'unknown'
    const frontmatter = {
      type: 'Experience',
      title: title || name,
      description: fields.description !== undefined ? String(fields.description).trim() : firstSentence(lesson),
      tags: asStringList(fields.tags),
      circuit_types: asStringList(fields.circuit_types),
      trigger,
      confidence: 0.55,
      evidence: [{ source: 'session', ref: sessionId, outcome: 'pass', at: now.toISOString().slice(0, 10) }],
      status: 'draft',
      metadata_status: pending ? 'pending' : 'ready',
      generated: { by: fields.actor ?? 'dsh-agent/unknown', at: now.toISOString() },
    }
    if (signature) frontmatter.signature = signature
    if (refs.length > 0) frontmatter.refs = refs
    await writeEntry('experience', name, frontmatter, renderExperienceBody(situation, lesson, action), `feat(experience): distill ${name}`)
    return { name }
  }

  async function importKnowledge(_exec, { filename, content } = {}) {
    const rawName = String(filename ?? '').trim()
    if (!/\.(md|txt)$/i.test(rawName)) fail(`只支持 .md/.txt 文档：${rawName}`)
    const text = String(content ?? '')
    if (!text.trim()) fail(`文档内容为空：${rawName}`)
    if (Buffer.byteLength(text, 'utf8') > TYPES.knowledge.maxBytes) {
      fail(`文档超过大小上限（${TYPES.knowledge.maxBytes / 1024}KB）：${rawName}`)
    }
    const name = uniqueName('knowledge', kebabize(rawName.replace(/\.(md|txt)$/i, '')) || 'entry')
    assertName('knowledge', name)
    let parsed = {}
    let body = text
    const { frontmatter, body: parsedBody } = splitFrontmatter(text)
    if (frontmatter !== null) {
      try {
        parsed = parseFrontmatter(frontmatter) ?? {}
        body = parsedBody
      } catch {
        parsed = {}
        body = text
      }
    }
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : name
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
    const frontmatterOut = {
      ...parsed,
      type: 'Knowledge',
      title,
      description,
      tags: asStringList(parsed.tags),
      category: CATEGORIES.includes(parsed.category) ? parsed.category : 'general',
      circuit_types: asStringList(parsed.circuit_types),
      aliases: asStringList(parsed.aliases),
      status: STATUSES.includes(parsed.status) ? parsed.status : 'stable',
      metadata_status: description ? 'ready' : 'pending',
      generated: { by: 'human:user', at: new Date().toISOString() },
    }
    await writeEntry('knowledge', name, frontmatterOut, body, `feat(memory): import knowledge ${name}`)
    return { name, metadata_status: frontmatterOut.metadata_status }
  }

  async function setExperienceStatus(_exec, name, target, actor = 'human:user') {
    if (!['stable', 'deprecated'].includes(target)) fail(`不支持的目标状态：${target}`)
    const entry = readEntry('experience', name)
    if (!entry) fail(`经验条目不存在：${name}`)
    const frontmatter = { ...entry.frontmatter, status: target }
    if (target === 'stable') {
      frontmatter.verified = [...(Array.isArray(entry.frontmatter.verified) ? entry.frontmatter.verified : []), { by: actor, at: new Date().toISOString() }]
    }
    await writeEntry('experience', name, frontmatter, entry.body, `chore(memory): ${target === 'stable' ? 'promote' : 'deprecate'} ${name}`)
    return { name, status: target }
  }

  function safeReferenceBase(name) {
    const base = path.basename(String(name ?? '')).replace(/[^A-Za-z0-9._-]+/g, '_')
    const stem = base.replace(/\.prt$/i, '').replace(/^[^A-Za-z0-9]+/, '')
    return `${stem.slice(0, 100) || 'part'}.prt`
  }

  async function autoCommitRefs(message) {
    if (!gitRepository) return
    try {
      await gitRepository.commit({ worktreePath: requireRoot(), message, addGlobs: [REF_DIR] })
    } catch (error) {
      console.warn(`[tool-memory] 范本原件自动提交失败（忽略，不影响读写）：${error.message}`)
    }
  }

  // 归档 .prt 范本原件到 reference/<sha8>_<文件名>.prt（内容哈希前缀去重，同名同内容复用），
  // best-effort 自动 git commit（范本原件随记忆库 git 版本化，设计稿 §1 决策 4）。
  async function archiveReference(_exec, { sourceAbs, originalName } = {}) {
    const source = String(sourceAbs ?? '')
    if (!source || !existsSync(source)) fail(`范本原件不存在：${sourceAbs}`)
    if (!/\.prt$/i.test(source)) fail(`范本原件只支持 .prt：${originalName ?? source}`)
    const bytes = readFileSync(source)
    const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    const base = `${sha8}_${safeReferenceBase(originalName ?? source)}`
    mkdirSync(path.join(requireRoot(), REF_DIR), { recursive: true })
    const target = path.join(requireRoot(), REF_DIR, base)
    const existed = existsSync(target)
    if (!existed) {
      writeFileSync(target, bytes)
      await ensureRepo()
      await autoCommitRefs(`feat(memory): archive reference ${base}`)
    }
    return { ref: `${REF_DIR}/${base}`, archived: !existed, sha8, bytes: bytes.length }
  }

  return Object.freeze({
    root: () => root,
    categories: () => [...CATEGORIES],
    listEntries,
    search: (filter = {}) => listEntries(filter),
    readEntry,
    saveKnowledge,
    importKnowledge,
    updateEntry,
    deleteEntry,
    extractExperience,
    setExperienceStatus,
    archiveReference,
  })
}
