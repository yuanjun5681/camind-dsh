// LLM second-stage reranker for search_memory（两阶段检索：元数据粗排 + LLM listwise 精排）。
// 粗排候选池交给模型按语义相关性重排——用词不同但语义相关的条目的救回路径。
// llm / agentDefaultModel 经共享防御层读取（lib/llm.js），
// 任何失败返回 null，调用方静默回退到元数据排序。

import { llmReady, parseJsonArray, streamText } from './llm.js'

function parseRanking(text, count) {
  const ids = parseJsonArray(text)
  if (!ids) return null
  const seen = new Set()
  const order = []
  for (const id of ids) {
    const n = Number(id)
    if (!Number.isInteger(n) || n < 1 || n > count || seen.has(n)) continue
    seen.add(n)
    order.push(n - 1)
  }
  return order.length === 0 ? null : order
}

export function createMemoryReranker(ctx) {
  return async function rerank(query, candidates) {
    if (!query || candidates.length < 3) return null
    const ready = llmReady(ctx)
    if (!ready) return null
    const lines = candidates.map((entry, index) =>
      `${index + 1}. [${entry.type}/${entry.status}] ${entry.name} — ${entry.title}：${entry.description}` +
      `（tags: ${(entry.tags ?? []).join(', ') || '无'}；circuit_types: ${(entry.circuit_types ?? []).join(', ') || '无'}；aliases: ${(entry.aliases ?? []).join(', ') || '无'}）`)
    const prompt = [
      '你在为记忆库检索结果按与查询的相关性排序。',
      `查询：${query}`,
      '',
      '候选条目：',
      ...lines,
      '',
      '要求：语义相关即算相关（用词不必相同，同义词、中英文、改写表达都算）；按相关性从高到低输出编号；明显无关的编号可以不出现。',
      '只输出一个 JSON 数组，例如 [3, 1, 2]，不要输出任何其他内容。',
    ].join('\n')
    try {
      const text = await streamText(ready.llm, ready.selection, {
        id: `memory-rerank-${Date.now()}`,
        prompt,
        maxTokens: 512,
      })
      const order = parseRanking(text, candidates.length)
      if (!order) return null
      const inOrder = new Set(order)
      return [...order.map((i) => candidates[i]), ...candidates.filter((_, i) => !inOrder.has(i))]
    } catch (error) {
      console.warn(`[tool-memory] LLM 重排失败（回退元数据排序）：${error.message}`)
      return null
    }
  }
}
