/**
 * 路径/字节展示小工具（原 FilePreviewBody.tsx 的导出项；预览本体已拆到
 * camind-ui-preview，这些与预览无关的纯函数留在 ui-shell 自用）。
 */

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/u).at(-1) || path
}

/** 相对路径的所在目录；根下文件返回空字符串。展示时用正斜杠。 */
export function fileDirFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const cut = normalized.lastIndexOf('/')
  return cut > 0 ? normalized.slice(0, cut) : ''
}
