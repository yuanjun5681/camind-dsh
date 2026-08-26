/**
 * 内容预览入口桥：预览功能已拆为独立插件 camind-ui-preview（Host 预览路由 +
 * 主对话区「预览」标签页 + filePreview 客户端服务）。本模块把 ui-shell 各
 * 「预览」按钮的调用转发给该服务；插件缺席（profile 未挂载）时静默降级——
 * 按钮还在，点了无反应。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

interface FilePreviewService {
  preview(sessionId: string, path: string): void
  previewContent(sessionId: string, name: string, content: string): void
}

let ctxRef: ClientContext | null = null

/** customShell.apply 启动时绑定一次（root ctx，ctx.get 为运行时活查）。 */
export function bindPreviewClient(ctx: ClientContext): void {
  ctxRef = ctx
}

function service(): FilePreviewService | undefined {
  return ctxRef?.get('filePreview') as FilePreviewService | undefined
}

export function previewFile(sessionId: string, path: string): void {
  service()?.preview(sessionId, path)
}

/** 内容模式预览：调用方已持有文本（如 delivery 路由开包取出的 NC），「预览」标签页直接渲染。 */
export function previewContent(sessionId: string, name: string, content: string): void {
  service()?.previewContent(sessionId, name, content)
}
