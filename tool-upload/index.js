// camind-tool-upload — session-scoped upload access for every Agent mode.
// Browser transfer stays in ui-shell; this plugin exposes only safe list/read operations.

import { registerListUploadedFiles } from './tools/list-uploaded-files.js'
import { registerReadUploadedFile } from './tools/read-uploaded-file.js'
import { createUploadService } from './lib/service.js'

export const name = 'tool-upload'
export const inject = ['tools']

export function apply(ctx) {
  // attachments/sessions 是宿主官方服务：官方 composer 上传落盘在 attachments/v1
  //（桌面端只有这条路），service.js 把它们桥进 uploads 列举/解析。
  const uploads = createUploadService({ ctx })
  ctx.provide('uploads', uploads)
  registerListUploadedFiles(ctx, uploads)
  registerReadUploadedFile(ctx, uploads)
  console.log('[tool-upload] provided uploads service; registered: list_uploaded_files, read_uploaded_file')
}
