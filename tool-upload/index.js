// camind-tool-upload — session-scoped upload access for every Agent mode.
// Browser transfer stays in ui-shell; this plugin exposes only safe list/read operations.

import { registerListUploadedFiles } from './tools/list-uploaded-files.js'
import { registerReadUploadedFile } from './tools/read-uploaded-file.js'
import { createUploadService } from './lib/service.js'

export const name = 'tool-upload'
export const inject = ['tools']

export function apply(ctx) {
  const uploads = createUploadService()
  ctx.provide('uploads', uploads)
  registerListUploadedFiles(ctx, uploads)
  registerReadUploadedFile(ctx, uploads)
  console.log('[tool-upload] provided uploads service; registered: list_uploaded_files, read_uploaded_file')
}
