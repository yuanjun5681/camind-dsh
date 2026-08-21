// Query expansion for search_memory（阶段 0：LLM multi-query 改写）。
// 把查询改写成 3-4 个检索变体（同义词、中英文、缩写/全称、领域惯用语），
// 供阶段 1 元数据打分分别召回后 RRF 融合——治「同义词召回不到」。
// llm 不可用或输出无法解析时返回 null，调用方退化为原查询单路召回。

import { llmReady, parseJsonArray, streamText } from './llm.js'

const MAX_VARIANTS = 4

export function createQueryExpander(ctx) {
  return async function expand(query) {
    const ready = llmReady(ctx)
    if (!ready || !query) return null
    const prompt = [
      '你在为电路设计领域的记忆库检索做查询改写。给定查询，生成 3-4 个检索变体帮助关键词召回：',
      '- 同义词/近义词、中英文对照（如 接地/GND/ground/地线）',
      '- 常见缩写与全称（如 BGR/带隙基准、LDO/低压差线性稳压器）',
      '- 电路领域惯用说法',
      `原查询：${query}`,
      '只输出一个 JSON 数组，例如 ["接地", "GND", "ground network"]，不要输出任何其他内容。',
    ].join('\n')
    try {
      const text = await streamText(ready.llm, ready.selection, {
        id: `memory-expand-${Date.now()}`,
        prompt,
        maxTokens: 256,
      })
      const parsed = parseJsonArray(text)
      if (!parsed) return null
      const seen = new Set([query.trim().toLowerCase()])
      const variants = []
      for (const item of parsed) {
        const variant = String(item ?? '').trim()
        if (!variant || variant.length > 60 || seen.has(variant.toLowerCase())) continue
        seen.add(variant.toLowerCase())
        variants.push(variant)
        if (variants.length >= MAX_VARIANTS) break
      }
      return variants.length > 0 ? variants : null
    } catch (error) {
      console.warn(`[tool-memory] 查询改写失败（退化为原查询）：${error.message}`)
      return null
    }
  }
}
