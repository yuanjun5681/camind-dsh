/**
 * 项目专属右侧工作台：展示会话输入上下文、交付物列表与 CAM run（「加工」页签）。
 * 它是 custom root 的兄弟列，不占用官方 details（工具调用详情）slot。
 * 文件内容预览走全局 overlay，不在本列内渲染。
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import { CamRuns } from './CamRuns'
import { bytesLabel, fileDirFromPath, fileNameFromPath } from './format'
import { previewFile } from './previewClient'
import {
  getWorkbenchSnapshot,
  subscribeWorkbench,
  workbenchActions,
  type WorkbenchTab,
} from './workbenchStore'

export type WorkbenchSession = {
  id: string
  displayTitle?: string
  title?: string
  cwd?: string
  running?: boolean
}

const TABS: readonly { id: WorkbenchTab; label: string }[] = [
  { id: 'input', label: '输入' },
  { id: 'deliverables', label: '交付物' },
  { id: 'cam', label: '加工' },
]

function Empty({ children }: { children: string }) {
  return <div className="workbench-empty">{children}</div>
}

export function Workbench({ session }: { session?: WorkbenchSession }) {
  const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot)
  const sessionId = session?.id
  const uploads = sessionId ? snapshot.uploads[sessionId] ?? [] : []
  const deliverables = sessionId ? snapshot.deliverables[sessionId] ?? [] : []

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void api.sessionUploads(sessionId).then((result) => {
      if (!cancelled) workbenchActions.addUploads(sessionId, result.files)
    }).catch(() => {
      // 磁盘批次读失败时保持空列表；上传成功后仍会写入 store。
    })
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <aside className="workbench" aria-label="项目工作台">
      <div className="workbench-head">
        <div>
          <strong>工作台</strong>
          {session && <span title={session.cwd}>{session.displayTitle || session.title || session.id}</span>}
        </div>
        <button type="button" onClick={() => workbenchActions.close()} aria-label="关闭工作台">×</button>
      </div>
      <div className="workbench-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={snapshot.tab === tab.id}
            className={snapshot.tab === tab.id ? 'active' : undefined}
            key={tab.id}
            onClick={() => workbenchActions.select(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="workbench-body">
        {!sessionId && <Empty>选择或新建会话后显示工作区信息。</Empty>}
        {sessionId && snapshot.tab === 'input' && (
          <div className="workbench-section">
            <dl className="workbench-facts">
              <div><dt>工作目录</dt><dd title={session.cwd}>{session.cwd || '未设置'}</dd></div>
              <div><dt>状态</dt><dd>{session.running ? '运行中' : '空闲'}</dd></div>
            </dl>
            <h3>本次上传</h3>
            {uploads.length === 0 ? <Empty>尚未通过 Composer 上传文件。</Empty> : (
              <div className="workbench-file-list">
                {uploads.map((file) => (
                  <button type="button" key={file.path} onClick={() => previewFile(sessionId, file.path)}>
                    <span>{file.name}</span><small>{bytesLabel(file.size)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {sessionId && snapshot.tab === 'cam' && <CamRuns sessionId={sessionId} />}
        {sessionId && snapshot.tab === 'deliverables' && (
          <div className="workbench-section">
            {deliverables.length === 0 ? <Empty>当前已加载的会话轮次还没有产出文件。</Empty> : (
              <div className="workbench-deliverable-list">
                {deliverables.map((path) => {
                  const name = fileNameFromPath(path)
                  const dir = fileDirFromPath(path)
                  return (
                    <button
                      type="button"
                      className="workbench-deliverable"
                      title={path}
                      key={path}
                      onClick={() => previewFile(sessionId, path)}
                    >
                      <span className="workbench-deliverable-name">{name}</span>
                      {dir ? <span className="workbench-deliverable-dir">{dir}/</span> : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
