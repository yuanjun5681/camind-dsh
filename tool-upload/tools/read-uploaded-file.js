// Model-facing bounded reader for text or base64 upload content.

import { toolDefinition } from '../lib/tool.js'

const DEFAULT_LIMIT = 32 * 1024
const MAX_LIMIT = 64 * 1024

export function registerReadUploadedFile(ctx, uploads) {
  ctx.tools.register(toolDefinition(
    'read_uploaded_file',
    '分段读取当前会话上传目录中的文件，也可读取 ZIP 自动解压后的文件。先用 list_uploaded_files 获取 path；路径按上传清单校验，不能读取其他会话或 .dsh 中的其他数据。',
    {
      type: 'object',
      properties: {
        batch_id: { type: 'string', description: '可选；省略时使用最近上传批次' },
        path: { type: 'string', description: 'list_uploaded_files 返回的文件 path' },
        offset: { type: 'integer', minimum: 0, description: '字节偏移，默认 0' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `读取字节数，最大 ${MAX_LIMIT}` },
        encoding: { type: 'string', enum: ['auto', 'utf8', 'base64'], description: '默认 auto；二进制自动返回 base64' },
      },
      required: ['path'],
    },
    async (args, exec) => {
      try {
        const { batch, file, bytes } = uploads.readFile(exec, args?.batch_id, args?.path)
        const offset = Number.isInteger(args?.offset) && args.offset >= 0 ? args.offset : 0
        const limit = Number.isInteger(args?.limit) ? Math.min(args.limit, MAX_LIMIT) : DEFAULT_LIMIT
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + limit))
        const requestedEncoding = args?.encoding ?? 'auto'
        const encoding = requestedEncoding === 'auto'
          ? (chunk.includes(0) || file.media_type === 'application/octet-stream' ? 'base64' : 'utf8')
          : requestedEncoding
        return JSON.stringify({
          batch_id: batch.batch_id,
          path: file.path,
          media_type: file.media_type,
          size: bytes.length,
          offset,
          bytes_read: chunk.length,
          eof: offset + chunk.length >= bytes.length,
          encoding,
          content: chunk.toString(encoding === 'base64' ? 'base64' : 'utf8'),
        }, null, 2)
      } catch (error) {
        return JSON.stringify({ error: error.message }, null, 2)
      }
    },
  ))
}
