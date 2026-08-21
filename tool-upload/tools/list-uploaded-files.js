// Model-facing upload catalog tool, always scoped to the calling session.

import { toolDefinition } from '../lib/tool.js'

function publicBatch(batch) {
  return {
    batch_id: batch.batch_id,
    created_at: batch.created_at,
    files: batch.files.map(({ absolute: _absolute, ...file }) => file),
  }
}

export function registerListUploadedFiles(ctx, uploads) {
  ctx.tools.register(toolDefinition(
    'list_uploaded_files',
    '列出当前会话自己的上传批次及文件，包括 ZIP 自动解压后的文件。消息中出现“本轮上传批次”“刚上传”或“上传文件”时先调用；不能查看其他会话。batch_id 省略时返回最近批次。',
    {
      type: 'object',
      properties: {
        batch_id: { type: 'string', description: '可选的上传批次 ID' },
        all_batches: { type: 'boolean', description: '为 true 时列出当前会话全部批次，默认 false' },
      },
    },
    async (args, exec) => {
      try {
        if (args?.all_batches) return JSON.stringify({ batches: uploads.listBatches(exec).map(publicBatch) }, null, 2)
        const batch = args?.batch_id ? uploads.loadBatch(exec, args.batch_id) : uploads.latestBatch(exec)
        return JSON.stringify(batch ? publicBatch(batch) : { batches: [], message: '当前会话没有上传文件。' }, null, 2)
      } catch (error) {
        return JSON.stringify({ error: error.message }, null, 2)
      }
    },
  ))
}
