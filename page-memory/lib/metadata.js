// LLM metadata backfill for knowledge entries (design §7.4).
// Entries uploaded or created without title/description land as
// metadata_status: pending; this module generates title / description /
// category / circuit_types / tags / aliases (检索别名，Contextual Retrieval
// 的写入侧增强：同义词、中英文、缩写等关键词召回钩子) with one hand-built
// llm.stream() call and merges the result back (never overwriting fields a
// user filled meanwhile). llm / agentDefaultModel are read defensively via
// ctx.get() — the page keeps working without them, entries just stay
// pending/failed.
// 经验条目（extract_memory 范本反推模式落的 pending draft）复用同一流程：
// 只生成 title / description / tags，正文三段式已由反推写好、不动。

const BODY_CLIP = 8000
const CATEGORIES = ['industry', 'process', 'circuit', 'enterprise', 'general']

const PROMPT = `你是知识库元数据提取器。分析用户给出的领域文档，只输出一个 JSON 对象（不要输出任何其他文字、不要用代码围栏）：
{"title": "简短标题", "description": "一句话描述（检索召回的关键，80字以内）", "category": "industry|process|circuit|enterprise|general 之一", "circuit_types": ["适用的电路类型，如 bgr/ldo/opa，不确定则空数组"], "tags": ["3-6个检索标签"], "aliases": ["5-10个检索别名：同义词、中英文对照、常见缩写/全称、领域惯用语，用于关键词召回，如 接地/GND/ground/地线"]}
category 取值含义：industry=行业规范、process=工艺规范、circuit=电路类型、enterprise=企业知识、general=通用。
文档内容如下：
`

const EXP_PROMPT = `你是经验库元数据提取器。分析用户给出的经验草稿（触发条件/情境/教训/做法），只输出一个 JSON 对象（不要输出任何其他文字、不要用代码围栏）：
{"title": "简短标题", "description": "一句话描述（检索召回的关键，80字以内）", "tags": ["3-6个检索标签"]}
经验内容如下：
`

function llmOf(ctx) {
  return typeof ctx.get === 'function' ? ctx.get('llm') : undefined
}

function defaultSelectionOf(ctx) {
  if (typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get('agentDefaultModel')?.currentSelection?.()
  } catch {
    return undefined
  }
}

function parseMetadataJson(text, type = 'knowledge') {
  const match = /\{[\s\S]*\}/.exec(text)
  if (!match) throw new Error('模型输出中没有 JSON 对象。')
  const parsed = JSON.parse(match[0])
  const asList = (value, cap = 12) => (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, cap)
  const title = String(parsed.title ?? '').trim()
  const description = String(parsed.description ?? '').trim()
  if (!title || !description) throw new Error('模型输出的 JSON 缺少 title/description。')
  if (type === 'experience') {
    return { title, description, tags: asList(parsed.tags) }
  }
  return {
    title,
    description,
    category: CATEGORIES.includes(parsed.category) ? parsed.category : 'general',
    circuit_types: asList(parsed.circuit_types),
    tags: asList(parsed.tags),
    aliases: asList(parsed.aliases, 16),
  }
}

async function generateMetadata(ctx, id, text, type) {
  const llm = llmOf(ctx)
  const selection = defaultSelectionOf(ctx)
  if (!llm || typeof llm.stream !== 'function') throw new Error('llm 服务不可用。')
  if (!selection?.provider || !selection?.model) throw new Error('默认模型不可用（请在 Settings → Models 配置）。')
  const message = {
    id: `memory-metadata-${id}`,
    role: 'user',
    content: [{ type: 'text', text: (type === 'experience' ? EXP_PROMPT : PROMPT) + text.slice(0, BODY_CLIP) }],
    source: { kind: 'user' },
  }
  let output = ''
  const stream = llm.stream({ provider: selection.provider, model: selection.model, messages: [message], maxTokens: 1024 })
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') output += chunk.text
  }
  return { metadata: parseMetadataJson(output, type), model: selection.model }
}

export function createMetadataBackfill(ctx, memoryBank) {
  const inFlight = new Set()

  async function backfill(type, name) {
    try {
      const entry = memoryBank.readEntry(type, name)
      if (!entry || entry.frontmatter.metadata_status !== 'pending') return
      const sourceText = type === 'experience'
        ? [`触发：${entry.frontmatter.trigger ?? ''}`, `情境：${entry.sections?.situation ?? ''}`,
          `教训：${entry.sections?.lesson ?? ''}`, `做法：${entry.sections?.action ?? ''}`].join('\n')
        : entry.body
      const { metadata, model } = await generateMetadata(ctx, `${type}-${name}`, sourceText, type)
      // 不覆盖补全期间用户手填的字段：仍以 pending 为准，缺什么补什么
      const latest = memoryBank.readEntry(type, name)
      if (!latest || latest.frontmatter.metadata_status !== 'pending') return
      const patch = { metadata_status: 'ready', actor: `dsh-agent/${model}` }
      if (!String(latest.frontmatter.title ?? '').trim() || latest.frontmatter.title === name) patch.title = metadata.title
      if (!String(latest.frontmatter.description ?? '').trim()) patch.description = metadata.description
      patch.tags = Array.isArray(latest.frontmatter.tags) && latest.frontmatter.tags.length > 0 ? latest.frontmatter.tags : metadata.tags
      if (type !== 'experience') {
        patch.category = latest.frontmatter.category && latest.frontmatter.category !== 'general' ? latest.frontmatter.category : metadata.category
        patch.circuit_types = Array.isArray(latest.frontmatter.circuit_types) && latest.frontmatter.circuit_types.length > 0 ? latest.frontmatter.circuit_types : metadata.circuit_types
        patch.aliases = Array.isArray(latest.frontmatter.aliases) && latest.frontmatter.aliases.length > 0 ? latest.frontmatter.aliases : metadata.aliases
      }
      await memoryBank.updateEntry(undefined, type, name, patch)
    } catch (error) {
      console.warn(`[page-memory] 元数据补全失败（${type}/${name}）：${error.message}`)
      try {
        const latest = memoryBank.readEntry(type, name)
        if (latest && latest.frontmatter.metadata_status === 'pending') {
          await memoryBank.updateEntry(undefined, type, name, { metadata_status: 'failed' })
        }
      } catch (inner) {
        console.warn(`[page-memory] 标记 metadata_status=failed 失败（${type}/${name}）：${inner.message}`)
      }
    } finally {
      inFlight.delete(`${type}/${name}`)
    }
  }

  return function scheduleMetadataBackfill(type, name) {
    const key = `${type}/${name}`
    if (inFlight.has(key)) return
    inFlight.add(key)
    setTimeout(() => { void backfill(type, name) }, 0)
  }
}
