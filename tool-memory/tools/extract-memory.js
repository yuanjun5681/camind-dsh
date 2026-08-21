// Model-facing tool: distill a lesson from the current session into a draft experience entry.

import { toolDefinition } from '../lib/tool.js'

export function registerExtractMemory(ctx, memoryBank) {
  ctx.tools.register(toolDefinition(
    'extract_memory',
    '从当前会话的工作中提炼一条经验（什么情境、什么教训、正确做法），保存为候选（draft），需人工在记忆库页面审核采纳后才生效。完成一项非平凡任务、修复隐蔽问题或验证某种做法有效后调用。如果是稳定的领域事实/规范，改用 save_memory。',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '经验标题（一句话概括教训）' },
        trigger: { type: 'string', description: '触发条件：什么情况下适用这条经验' },
        situation: { type: 'string', description: '情境：当时的问题/现象是什么' },
        lesson: { type: 'string', description: '教训：一句话结论' },
        action: { type: 'string', description: '做法：正确的做法是什么' },
        circuit_types: { type: 'array', items: { type: 'string' }, description: '适用电路类型（可空）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签（可空）' },
      },
      required: ['title', 'trigger', 'situation', 'lesson', 'action'],
    },
    async (args, exec) => {
      try {
        const result = await memoryBank.extractExperience(exec, {
          title: args?.title,
          trigger: args?.trigger,
          situation: args?.situation,
          lesson: args?.lesson,
          action: args?.action,
          circuit_types: args?.circuit_types,
          tags: args?.tags,
        })
        return `已保存为候选经验 ${result.name}（${memoryBank.root()}/experience/${result.name}.md，status: draft），需在记忆库页面人工审核采纳后生效。`
      } catch (error) {
        return `提取经验失败：${error.message}`
      }
    },
  ))
}
