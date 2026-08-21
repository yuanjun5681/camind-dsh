// Model-facing tool: search the OKF memory bank (knowledge + experience).
// Three-stage retrieval: stage 0 LLM query expansion (multi-query), stage 1
// metadata scoring per variant fused with RRF (pool backfilled with recent
// entries when keyword recall is thin), stage 2 LLM listwise rerank.
// Every LLM stage fails soft: expansion falls back to the bare query,
// rerank falls back to the RRF/metadata order.

import { toolDefinition } from '../lib/tool.js'

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 50
const POOL_MIN = 20
const POOL_MAX = 50
const RRF_K = 60

export function registerSearchMemory(ctx, memoryBank, { rerank, expand } = {}) {
  ctx.tools.register(toolDefinition(
    'search_memory',
    '搜索记忆库（知识库 + 经验库）。知识库是人工维护的领域事实与规范（工艺规则、电路类型规范、企业约定等）；经验库是从过往工作提炼的情境化教训（draft=候选、stable=已采纳）。做设计、写代码或做决策前，先搜索是否已有相关知识和教训。检索带查询改写与语义重排，同义词、中英文、改写表达都能命中；如果结果仍不理想，换同义词、电路类型或更短的关键词多搜几次（如「电源」「GND」「power」）。返回匹配摘要列表（不含正文），摘要看相关时用 read_memory 读全文。',
    {
      type: 'object',
      properties: {
        q: { type: 'string', description: '关键词，空白分隔；匹配名称/标题/描述/标签/电路类型/正文' },
        type: { type: 'string', enum: ['knowledge', 'experience'], description: '只搜某一类，默认两类都搜' },
        status: { type: 'string', enum: ['draft', 'stable', 'deprecated'], description: '按生命周期过滤；默认排除 deprecated' },
        tag: { type: 'string', description: '按标签过滤' },
        circuit_type: { type: 'string', description: '按电路类型过滤（如 bgr、ldo）' },
        limit: { type: 'integer', description: '返回条数上限，默认 8，最大 50' },
      },
    },
    async (args) => {
      try {
        const limit = Number.isInteger(args?.limit) && args.limit > 0 ? Math.min(args.limit, MAX_LIMIT) : DEFAULT_LIMIT
        const q = String(args?.q ?? '').trim()
        const filter = { type: args?.type, status: args?.status, tag: args?.tag, circuit_type: args?.circuit_type }
        if (!q) {
          const entries = memoryBank.listEntries({ ...filter, limit })
          if (entries.length === 0) return '记忆库还是空的。后续工作中得到值得沉淀的领域事实或教训时，可分别用 save_memory / extract_memory 保存。'
          return JSON.stringify({ memory_root: memoryBank.root(), ranked_by: 'metadata', entries }, null, 2)
        }

        // 阶段 0：LLM 查询改写（失败退化为原查询单路）
        const variants = (typeof expand === 'function' ? await expand(q) : null) ?? []
        const queries = [q, ...variants]

        // 阶段 1：每个变体各自元数据打分召回，RRF 融合成候选池
        const fused = new Map()
        for (const variant of queries) {
          memoryBank.search({ ...filter, q: variant, limit: POOL_MAX }).forEach((entry, rank) => {
            const key = `${entry.type}/${entry.name}`
            const item = fused.get(key) ?? { entry, rrf: 0 }
            item.rrf += 1 / (RRF_K + rank + 1)
            fused.set(key, item)
          })
        }
        let pool = [...fused.values()]
          .sort((a, b) => b.rrf - a.rrf)
          .map((item) => item.entry)
          .slice(0, POOL_MAX)
        // 关键词召回太薄时用近期条目补足，给阶段 2 救回语义相关条目的机会
        if (pool.length < POOL_MIN) {
          const inPool = new Set(pool.map((entry) => `${entry.type}/${entry.name}`))
          for (const entry of memoryBank.listEntries({ ...filter, limit: POOL_MAX })) {
            if (pool.length >= POOL_MAX) break
            const key = `${entry.type}/${entry.name}`
            if (!inPool.has(key)) {
              inPool.add(key)
              pool.push(entry)
            }
          }
        }

        // 阶段 2：LLM listwise 语义精排（失败回退 RRF 序）
        let entries = pool
        let rankedBy = 'metadata'
        if (typeof rerank === 'function' && pool.length >= 3) {
          const reranked = await rerank(q, pool)
          if (reranked) {
            entries = reranked
            rankedBy = 'llm'
          }
        }
        entries = entries.slice(0, limit)
        if (entries.length === 0) {
          return '没有找到匹配的记忆。可换同义词或电路类型再搜；如果后续工作中得到了值得沉淀的领域事实或教训，可分别用 save_memory / extract_memory 保存。'
        }
        const result = { memory_root: memoryBank.root(), ranked_by: rankedBy, entries }
        if (variants.length > 0) result.expanded_queries = variants
        return JSON.stringify(result, null, 2)
      } catch (error) {
        return `搜索记忆库失败：${error.message}`
      }
    },
  ))
}
