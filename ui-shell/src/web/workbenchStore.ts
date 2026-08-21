/**
 * ui-shell 工作台与文件预览弹层的轻量外部状态。
 * 会话事实仍归官方 runtime；这里只保存纯展示状态，不复制 conversation store。
 * preview 只驱动 shell.overlay 里的弹层，不切换工作台 tab、不强制打开工作台。
 */
import type { WorkspaceFile, WorkspaceUploadBatch } from '@shared/protocol'

export type WorkbenchTab = 'input' | 'deliverables'

export interface WorkbenchSnapshot {
  open: boolean
  tab: WorkbenchTab
  preview?: { sessionId: string; path: string }
  uploads: Readonly<Record<string, readonly WorkspaceFile[]>>
  pendingUploads: Readonly<Record<string, readonly WorkspaceUploadBatch[]>>
  deliverables: Readonly<Record<string, readonly string[]>>
}

let snapshot: WorkbenchSnapshot = {
  open: true,
  tab: 'input',
  uploads: {},
  pendingUploads: {},
  deliverables: {},
}

const listeners = new Set<() => void>()

function publish(next: WorkbenchSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

export function getWorkbenchSnapshot(): WorkbenchSnapshot {
  return snapshot
}

export function subscribeWorkbench(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const workbenchActions = {
  open(tab: WorkbenchTab = snapshot.tab) {
    publish({ ...snapshot, open: true, tab })
  },
  close() {
    publish({ ...snapshot, open: false })
  },
  toggle() {
    publish({ ...snapshot, open: !snapshot.open })
  },
  select(tab: WorkbenchTab) {
    publish({ ...snapshot, open: true, tab })
  },
  addUploads(sessionId: string, files: readonly WorkspaceFile[]) {
    const previous = snapshot.uploads[sessionId] ?? []
    const byPath = new Map(previous.map((file) => [file.path, file]))
    for (const file of files) byPath.set(file.path, file)
    publish({
      ...snapshot,
      uploads: { ...snapshot.uploads, [sessionId]: [...byPath.values()] },
    })
  },
  addPendingUpload(sessionId: string, batch: WorkspaceUploadBatch) {
    const previous = snapshot.pendingUploads[sessionId] ?? []
    const next = [...previous.filter((item) => item.batchId !== batch.batchId), batch]
    publish({
      ...snapshot,
      pendingUploads: { ...snapshot.pendingUploads, [sessionId]: next },
    })
  },
  setPendingUploads(sessionId: string, batches: readonly WorkspaceUploadBatch[]) {
    publish({
      ...snapshot,
      pendingUploads: { ...snapshot.pendingUploads, [sessionId]: [...batches] },
    })
  },
  addDeliverables(sessionId: string, paths: readonly string[]) {
    const previous = snapshot.deliverables[sessionId] ?? []
    const next = [...new Set([...previous, ...paths])]
    if (next.length === previous.length && next.every((path, index) => previous[index] === path)) return
    publish({
      ...snapshot,
      deliverables: { ...snapshot.deliverables, [sessionId]: next },
    })
  },
  preview(sessionId: string, path: string) {
    publish({ ...snapshot, preview: { sessionId, path } })
  },
  closePreview() {
    if (!snapshot.preview) return
    publish({ ...snapshot, preview: undefined })
  },
}
