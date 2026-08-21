// camind-tool-memory — OKF 记忆库（知识库 + 经验库）。
// 提供 Cordis memoryBank 服务（page-memory 经 inject 复用），并注册 4 个模型工具。

import { createMemoryBankService } from './lib/service.js'
import { createQueryExpander } from './lib/expand.js'
import { createMemoryReranker } from './lib/rerank.js'
import { registerExtractMemory } from './tools/extract-memory.js'
import { registerReadMemory } from './tools/read-memory.js'
import { registerSaveMemory } from './tools/save-memory.js'
import { registerSearchMemory } from './tools/search-memory.js'

export const name = 'tool-memory'
export const inject = ['tools', 'gitRepository']

export function apply(ctx) {
  const memoryBank = createMemoryBankService({ gitRepository: ctx.gitRepository })
  ctx.provide('memoryBank', memoryBank)

  registerSearchMemory(ctx, memoryBank, {
    rerank: createMemoryReranker(ctx),
    expand: createQueryExpander(ctx),
  })
  registerReadMemory(ctx, memoryBank)
  registerSaveMemory(ctx, memoryBank)
  registerExtractMemory(ctx, memoryBank)

  console.log(
    `[tool-memory] loaded (root=${memoryBank.root() ?? 'DSH_HOME 未设置，写入不可用'})；` +
    'registered: search_memory, read_memory, save_memory, extract_memory',
  )
}
