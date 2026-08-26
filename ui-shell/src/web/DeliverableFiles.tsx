/**
 * 交付物 turn-tail：复用官方 deliverables 投影数据，点击打开全局文件预览弹层。
 * priority 由注册方设为负值，存在产出时接管官方 chain，避免同一轮重复画两行。
 */
import { useEffect } from 'react'
import { previewFile } from './previewClient'
import { workbenchActions } from './workbenchStore'

export type DeliverablesData = {
  produced: readonly { seq: number; path: string }[]
}

export type TurnTailOwner = {
  turn: { data: ReadonlyMap<string, unknown> }
  seq: number
}

export function selectPreviewableDeliverables(owner: TurnTailOwner): readonly string[] | null {
  const data = owner.turn.data.get('deliverables') as DeliverablesData | undefined
  if (!data?.produced) return null
  const paths: string[] = []
  const seen = new Set<string>()
  for (const item of data.produced) {
    if (!item || typeof item.path !== 'string' || item.seq > owner.seq || seen.has(item.path)) continue
    seen.add(item.path)
    paths.push(item.path)
  }
  return paths.length ? paths : null
}

export function DeliverableFiles({ matched, sessionId }: { matched: readonly string[]; sessionId: string }) {
  useEffect(() => {
    workbenchActions.addDeliverables(sessionId, matched)
  }, [matched, sessionId])

  return (
    <div className="custom-deliverables-row">
      <span className="custom-deliverables-label">产出</span>
      <div className="custom-deliverables-files">
        {matched.map((path) => (
          <button
            type="button"
            className="custom-file-chip"
            title={`预览 ${path}`}
            key={path}
            onClick={() => previewFile(sessionId, path)}
          >
            {path.split(/[\\/]/u).at(-1) || path}
          </button>
        ))}
      </div>
    </div>
  )
}
