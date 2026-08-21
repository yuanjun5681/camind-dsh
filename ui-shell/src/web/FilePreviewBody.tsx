/**
 * 会话文件预览内容：按 kind 渲染 text / markdown / image / pdf / binary。
 * 不含弹层或工作台外壳；拉取逻辑供 overlay 标题栏与正文共用。
 */
import { useEffect, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreview } from '@shared/protocol'
import { api } from './api'

function isMarkdownPreview(preview: FilePreview): boolean {
  if (preview.mediaType === 'text/markdown' || preview.mediaType === 'text/x-markdown') return true
  const name = preview.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown')
}

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

export function useFilePreview(sessionId?: string, path?: string): {
  preview?: FilePreview
  error?: string
} {
  const [preview, setPreview] = useState<FilePreview>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!sessionId || !path) {
      setPreview(undefined)
      setError(undefined)
      return
    }
    let cancelled = false
    setPreview(undefined)
    setError(undefined)
    void api.previewFile(sessionId, path).then((next) => {
      if (!cancelled) setPreview(next)
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [path, sessionId])

  return { preview, error }
}

export function FilePreviewBody({
  sessionId,
  preview,
  error,
}: {
  sessionId: string
  preview?: FilePreview
  error?: string
}) {
  if (error) return <div className="preview-error">{error}</div>
  if (!preview) return <div className="preview-empty">正在读取文件…</div>
  const rawUrl = api.rawFileUrl(sessionId, preview.path)

  return (
    <div className="preview-pane">
      {preview.kind === 'text' && isMarkdownPreview(preview) && (
        <div className="preview-markdown">
          <MarkdownText text={preview.text ?? ''} />
        </div>
      )}
      {preview.kind === 'text' && !isMarkdownPreview(preview) && (
        <pre className="preview-text"><code>{preview.text}</code></pre>
      )}
      {preview.kind === 'image' && (
        <div className="preview-media"><img src={rawUrl} alt={preview.name} /></div>
      )}
      {preview.kind === 'pdf' && (
        <iframe className="preview-pdf" src={rawUrl} title={preview.name} />
      )}
      {preview.kind === 'binary' && (
        <div className="preview-binary">
          <p>该文件不能以内联文本方式预览。</p>
          <a href={rawUrl} target="_blank" rel="noreferrer">在新窗口打开</a>
        </div>
      )}
      {preview.truncated && <div className="preview-truncated">文件较大，仅显示前 1 MB。</div>}
    </div>
  )
}
