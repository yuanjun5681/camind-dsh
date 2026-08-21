// Model-facing tool: save a domain knowledge entry (takes effect immediately).

import { toolDefinition } from '../lib/tool.js'

export function registerSaveMemory(ctx, memoryBank) {
  ctx.tools.register(toolDefinition(
    'save_memory',
    '把稳定的领域知识保存到知识库（立即生效）。知识是领域事实与规范：工艺规则、电路类型规范、企业约定、可复用的设计结论等。如果要保存的是「什么情境下踩过什么坑、正确做法是什么」的教训，改用 extract_memory。同名条目覆盖即更新。',
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: '条目名（kebab-case）；缺省从 title 派生，重名自动加序号' },
        title: { type: 'string', description: '显示标题' },
        description: { type: 'string', description: '一句话描述，是检索召回的关键，必须给出' },
        category: { type: 'string', enum: ['industry', 'process', 'circuit', 'enterprise', 'general'], description: '分类：行业规范/工艺规范/电路类型/企业知识/通用，默认 general' },
        circuit_types: { type: 'array', items: { type: 'string' }, description: '适用电路类型（如 ["bgr"]），最强检索信号' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        aliases: { type: 'array', items: { type: 'string' }, description: '检索别名：同义词、中英文对照、常见缩写/全称（如 ["接地", "GND", "ground"]），提升关键词召回' },
        body: { type: 'string', description: 'markdown 正文（知识全文）' },
      },
      required: ['title', 'description', 'body'],
    },
    async (args) => {
      try {
        const result = await memoryBank.saveKnowledge(undefined, {
          name: args?.name,
          title: args?.title,
          description: args?.description,
          category: args?.category,
          circuit_types: args?.circuit_types,
          tags: args?.tags,
          aliases: args?.aliases,
          body: args?.body,
        })
        return `已${result.created ? '保存' : '更新'}知识条目 ${result.name}（${memoryBank.root()}/knowledge/${result.name}.md，status: stable，立即生效）。`
      } catch (error) {
        return `保存知识条目失败：${error.message}`
      }
    },
  ))
}
