// Model-facing tool: read one memory entry in full by type and name.

import { toolDefinition } from '../lib/tool.js'

export function registerReadMemory(ctx, memoryBank) {
  ctx.tools.register(toolDefinition(
    'read_memory',
    '按类型和名称读取记忆库条目全文（知识或经验的完整 markdown，含 frontmatter 与正文）。当 search_memory 返回的摘要看起来相关时使用。',
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['knowledge', 'experience'], description: '条目类型' },
        name: { type: 'string', description: '条目名（search_memory 结果中的 name，如 bgr-rules 或 exp-2026-08-xxx-01）' },
      },
      required: ['type', 'name'],
    },
    async (args) => {
      try {
        const entry = memoryBank.readEntry(args?.type, args?.name)
        if (!entry) return `条目不存在：${args?.type}/${args?.name}（可用 search_memory 重新搜索确认名称）。`
        return entry.markdown
      } catch (error) {
        return `读取记忆条目失败：${error.message}`
      }
    },
  ))
}
