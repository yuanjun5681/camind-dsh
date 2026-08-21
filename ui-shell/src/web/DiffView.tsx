/**
 * Shared line-diff surface. Callers pass two texts and labels; this view
 * does not fetch, and does not know Workbench or Git.
 */
import { useMemo } from 'react'
import { diffOps, diffStats, splitRows } from './diffLines'

export type DiffViewMode = 'split' | 'unified'

export type DiffViewProps = {
  left: string | null
  right: string | null
  leftLabel?: string
  rightLabel?: string
  mode?: DiffViewMode
}

export function DiffView({
  left,
  right,
  leftLabel = '之前',
  rightLabel = '之后',
  mode = 'split',
}: DiffViewProps) {
  const ops = useMemo(() => diffOps(left, right), [left, right])
  const rows = useMemo(() => splitRows(ops), [ops])
  const stats = useMemo(() => diffStats(ops), [ops])

  if (ops.length === 0) {
    return <div className="diff-view-empty">没有可对比的内容。</div>
  }

  if (mode === 'unified') {
    return (
      <div className="diff-view unified" data-diff-view="unified">
        <div className="diff-view-unified-head">
          <span>{leftLabel} → {rightLabel}</span>
          <span className="diff-view-stats">
            {stats.additions > 0 ? <span className="workbench-repo-add">+{stats.additions}</span> : null}
            {stats.deletions > 0 ? <span className="workbench-repo-del">−{stats.deletions}</span> : null}
          </span>
        </div>
        <pre className="diff-view-body">
          {ops.map((op, index) => {
            const mark = op.kind === 'insert' ? '+' : op.kind === 'delete' ? '−' : ' '
            return (
              <span className={`diff-line ${op.kind}`} key={index}>
                <span className="diff-gutter">{mark}</span>
                <span className="diff-code">{op.text}</span>
              </span>
            )
          })}
        </pre>
      </div>
    )
  }

  return (
    <div className="diff-view split" data-diff-view="split">
      <div className="diff-split-head">
        <div>{leftLabel}</div>
        <div>{rightLabel}</div>
      </div>
      <div className="diff-split-body">
        {rows.map((row, index) => (
          <div className={`diff-split-row ${row.kind}`} key={index}>
            <div className={`diff-cell left ${row.left == null ? 'empty' : row.kind}`}>
              <span className="diff-gutter">{row.leftNumber ?? ''}</span>
              <span className="diff-code">{row.left ?? ''}</span>
            </div>
            <div className={`diff-cell right ${row.right == null ? 'empty' : row.kind}`}>
              <span className="diff-gutter">{row.rightNumber ?? ''}</span>
              <span className="diff-code">{row.right ?? ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
