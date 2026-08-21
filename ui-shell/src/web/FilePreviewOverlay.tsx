/**
 * 全局文件预览弹层：注册到 shell.overlay。
 * 复用官方 Modal 的 mask / Esc / portal；对话框铺满视口，仅留窄边距。
 */
import { useSyncExternalStore } from 'react'
import { IconCloseOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { api } from './api'
import {
  FilePreviewBody,
  bytesLabel,
  fileNameFromPath,
  useFilePreview,
} from './FilePreviewBody'
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore'

export function FilePreviewOverlay() {
  const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot)
  const target = snapshot.preview
  const { preview, error } = useFilePreview(target?.sessionId, target?.path)
  if (!target) return null

  const title = fileNameFromPath(preview?.path || target.path)
  const displayPath = preview?.path ?? target.path
  const relocated = Boolean(preview && preview.path.replaceAll('\\', '/') !== target.path.replaceAll('\\', '/'))
  const rawUrl = api.rawFileUrl(target.sessionId, displayPath)
  const meta = preview
    ? `${relocated ? '已发布 · ' : ''}${preview.path} · ${bytesLabel(preview.size)} · ${preview.mediaType}`
    : target.path

  return (
    <Modal
      open
      onClose={() => workbenchActions.closePreview()}
      title={title}
      closeLabel="关闭预览"
      headless
      className="file-preview-dialog"
    >
      <div className="file-preview-chrome">
        <header className="file-preview-head">
          <div className="file-preview-head-text">
            <strong title={displayPath}>{title}</strong>
            <span title={meta}>{meta}</span>
          </div>
          <div className="file-preview-head-actions">
            <a href={rawUrl} target="_blank" rel="noreferrer">新窗口打开</a>
            <button type="button" aria-label="关闭预览" onClick={() => workbenchActions.closePreview()}>
              <IconCloseOutline16 size={14} />
            </button>
          </div>
        </header>
        <div className="file-preview-stage">
          <FilePreviewBody sessionId={target.sessionId} preview={preview} error={error} />
        </div>
      </div>
    </Modal>
  )
}
