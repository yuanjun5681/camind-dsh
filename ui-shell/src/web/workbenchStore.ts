/**
 * ui-shell 工作台的轻量外部状态。
 * 会话事实仍归官方 runtime；这里只保存纯展示状态，不复制 conversation store。
 * 内容预览（预览态 + 切页）已拆到 camind-ui-preview 插件，ui-shell 各预览
 * 按钮经 previewClient 桥调用其 filePreview 服务。
 */
import type { CamRunSummary, WorkspaceFile, WorkspaceUploadBatch } from '@shared/protocol'

export type WorkbenchTab = 'input' | 'deliverables' | 'cam'

export interface WorkbenchSnapshot {
  open: boolean
  tab: WorkbenchTab
  uploads: Readonly<Record<string, readonly WorkspaceFile[]>>
  pendingUploads: Readonly<Record<string, readonly WorkspaceUploadBatch[]>>
  deliverables: Readonly<Record<string, readonly string[]>>
  /** 「加工」页签：per session 的 CAM run 列表（CamRuns 组件轮询写入）。 */
  camRuns: Readonly<Record<string, readonly CamRunSummary[]>>
}

let snapshot: WorkbenchSnapshot = {
  open: true,
  tab: 'input',
  uploads: {},
  pendingUploads: {},
  deliverables: {},
  camRuns: {},
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
  setDeliverables(sessionId: string, paths: readonly string[]) {
    // 无头同步（DeliverablesSync）写回：内容没变就跳过 publish。
    const previous = snapshot.deliverables[sessionId] ?? []
    if (previous.length === paths.length && previous.every((path, index) => path === paths[index])) return
    publish({
      ...snapshot,
      deliverables: { ...snapshot.deliverables, [sessionId]: [...paths] },
    })
  },
  setCamRuns(sessionId: string, runs: readonly CamRunSummary[]) {
    // 5s 轮询写回：内容没变就跳过 publish，避免工作台无谓重渲染。
    const previous = snapshot.camRuns[sessionId]
    if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(runs)) return
    publish({
      ...snapshot,
      camRuns: { ...snapshot.camRuns, [sessionId]: [...runs] },
    })
  },
}
