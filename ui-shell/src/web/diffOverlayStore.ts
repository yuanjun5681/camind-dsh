/**
 * Global diff overlay state. Any UI surface can open it; it is not owned by
 * Workbench. Documents are two texts plus labels — callers fetch however they like.
 */
export type DiffKind = 'added' | 'modified' | 'deleted'

export type DiffDocument = {
  path: string
  leftLabel: string
  rightLabel: string
  left: string | null
  right: string | null
  kind?: DiffKind
  additions?: number | null
  deletions?: number | null
  truncated?: boolean
}

export type DiffFileRef = {
  path: string
  kind?: DiffKind
  additions?: number | null
  deletions?: number | null
  load: () => Promise<Pick<DiffDocument, 'left' | 'right' | 'truncated' | 'kind'>>
}

export type DiffOverlayOpen = {
  leftLabel: string
  rightLabel: string
  files: readonly DiffFileRef[]
  activePath: string
}

export type DiffOverlaySnapshot = {
  open: DiffOverlayOpen | null
  document?: DiffDocument
  loading: boolean
  error?: string
}

let snapshot: DiffOverlaySnapshot = {
  open: null,
  loading: false,
}

const listeners = new Set<() => void>()
let loadSeq = 0

function publish(next: DiffOverlaySnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

export function getDiffOverlaySnapshot(): DiffOverlaySnapshot {
  return snapshot
}

export function subscribeDiffOverlay(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function loadActive(open: DiffOverlayOpen, path: string) {
  const seq = ++loadSeq
  const file = open.files.find((item) => item.path === path)
  if (!file) {
    publish({ open, loading: false, error: `没有文件：${path}` })
    return
  }
  publish({ open, loading: true, error: undefined, document: undefined })
  try {
    const loaded = await file.load()
    if (seq !== loadSeq) return
    publish({
      open,
      loading: false,
      document: {
        path: file.path,
        leftLabel: open.leftLabel,
        rightLabel: open.rightLabel,
        left: loaded.left,
        right: loaded.right,
        kind: loaded.kind ?? file.kind,
        additions: file.additions,
        deletions: file.deletions,
        truncated: loaded.truncated,
      },
    })
  } catch (err) {
    if (seq !== loadSeq) return
    publish({
      open,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export const diffOverlayActions = {
  open(next: DiffOverlayOpen) {
    const activePath = next.files.some((file) => file.path === next.activePath)
      ? next.activePath
      : next.files[0]?.path
    if (!activePath) return
    const open = { ...next, activePath }
    void loadActive(open, activePath)
  },
  select(path: string) {
    if (!snapshot.open) return
    if (snapshot.open.activePath === path && snapshot.document) return
    const open = { ...snapshot.open, activePath: path }
    void loadActive(open, path)
  },
  close() {
    loadSeq += 1
    if (!snapshot.open) return
    publish({ open: null, loading: false })
  },
}

declare global {
  interface Window {
    __camindDiff__?: typeof diffOverlayActions
  }
}

if (typeof window !== 'undefined') {
  window.__camindDiff__ = diffOverlayActions
}
