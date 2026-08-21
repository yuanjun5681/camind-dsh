/**
 * Global code-diff overlay on shell.overlay. Any surface can open it via
 * diffOverlayActions / window.__camindDiff__. Not owned by Workbench.
 */
import { useState, useSyncExternalStore } from 'react'
import { IconCloseOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { DiffView, type DiffViewMode } from './DiffView'
import {
  diffOverlayActions,
  getDiffOverlaySnapshot,
  subscribeDiffOverlay,
} from './diffOverlayStore'

const KIND_LABEL: Record<string, string> = {
  added: '新增',
  deleted: '删除',
}

export function DiffOverlay() {
  const snapshot = useSyncExternalStore(subscribeDiffOverlay, getDiffOverlaySnapshot)
  const [mode, setMode] = useState<DiffViewMode>('split')
  const open = snapshot.open
  if (!open) return null

  const doc = snapshot.document
  const title = doc?.path || open.activePath
  const kindLabel = doc?.kind ? KIND_LABEL[doc.kind] : undefined
  const add = typeof doc?.additions === 'number' && doc.additions > 0
  const del = typeof doc?.deletions === 'number' && doc.deletions > 0

  return (
    <Modal
      open
      onClose={() => diffOverlayActions.close()}
      title={title}
      closeLabel="关闭对比"
      headless
      className="file-preview-dialog"
    >
      <div className="file-preview-chrome diff-overlay">
        <header className="file-preview-head">
          <div className="file-preview-head-text">
            <strong title={title}>{title}</strong>
            <span>
              {doc ? `${doc.leftLabel} → ${doc.rightLabel}` : '正在读取…'}
              {kindLabel ? ` · ${kindLabel}` : ''}
            </span>
          </div>
          <div className="file-preview-head-actions">
            {add ? <span className="workbench-repo-add">+{doc?.additions}</span> : null}
            {del ? <span className="workbench-repo-del">−{doc?.deletions}</span> : null}
            <div className="diff-mode-toggle" role="group" aria-label="对比方式">
              <button type="button" className={mode === 'split' ? 'active' : undefined} onClick={() => setMode('split')}>
                分栏
              </button>
              <button type="button" className={mode === 'unified' ? 'active' : undefined} onClick={() => setMode('unified')}>
                统一
              </button>
            </div>
            <button type="button" aria-label="关闭对比" onClick={() => diffOverlayActions.close()}>
              <IconCloseOutline16 size={14} />
            </button>
          </div>
        </header>
        {open.files.length > 1 && (
          <nav className="diff-file-tabs" aria-label="变更文件">
            {open.files.map((file) => (
              <button
                type="button"
                key={file.path}
                className={file.path === open.activePath ? 'active' : undefined}
                onClick={() => diffOverlayActions.select(file.path)}
              >
                {file.path}
              </button>
            ))}
          </nav>
        )}
        <div className="file-preview-stage">
          {snapshot.error && <div className="preview-error">{snapshot.error}</div>}
          {snapshot.loading && !snapshot.error && <div className="preview-empty">正在读取对比…</div>}
          {!snapshot.loading && !snapshot.error && doc && (
            <>
              <DiffView
                left={doc.left}
                right={doc.right}
                leftLabel={doc.leftLabel}
                rightLabel={doc.rightLabel}
                mode={mode}
              />
              {doc.truncated ? <div className="preview-truncated">文件较大，仅对比前 512 KB。</div> : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
