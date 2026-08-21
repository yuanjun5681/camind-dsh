/**
 * Line-oriented diff for the shared DiffView. Callers pass two texts;
 * this module does not know Git, sessions, or workbench.
 */
export type DiffOpKind = 'equal' | 'delete' | 'insert'

export interface DiffOp {
  kind: DiffOpKind
  text: string
}

export interface SplitDiffRow {
  kind: 'equal' | 'delete' | 'insert' | 'replace'
  left: string | null
  right: string | null
  leftNumber: number | null
  rightNumber: number | null
}

const DP_CELL_LIMIT = 2_000_000

function splitLines(text: string | null): string[] {
  if (text == null) return []
  if (text === '') return ['']
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function lcsOps(left: string[], right: string[]): DiffOp[] {
  const n = left.length
  const m = right.length
  if (n * m > DP_CELL_LIMIT) {
    const ops: DiffOp[] = [
      ...left.map((text) => ({ kind: 'delete' as const, text })),
      ...right.map((text) => ({ kind: 'insert' as const, text })),
    ]
    return ops
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = left[i] === right[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      ops.push({ kind: 'equal', text: left[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'delete', text: left[i] })
      i += 1
    } else {
      ops.push({ kind: 'insert', text: right[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ kind: 'delete', text: left[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ kind: 'insert', text: right[j] })
    j += 1
  }
  return ops
}

export function diffOps(left: string | null, right: string | null): DiffOp[] {
  if (left == null && right == null) return []
  if (left == null) return splitLines(right).map((text) => ({ kind: 'insert', text }))
  if (right == null) return splitLines(left).map((text) => ({ kind: 'delete', text }))
  return lcsOps(splitLines(left), splitLines(right))
}

export function splitRows(ops: DiffOp[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let leftNumber = 1
  let rightNumber = 1
  let index = 0
  while (index < ops.length) {
    const op = ops[index]
    if (op.kind === 'equal') {
      rows.push({
        kind: 'equal',
        left: op.text,
        right: op.text,
        leftNumber: leftNumber++,
        rightNumber: rightNumber++,
      })
      index += 1
      continue
    }
    const deleted: DiffOp[] = []
    const inserted: DiffOp[] = []
    while (index < ops.length && ops[index].kind === 'delete') deleted.push(ops[index++])
    while (index < ops.length && ops[index].kind === 'insert') inserted.push(ops[index++])
    const count = Math.max(deleted.length, inserted.length)
    for (let offset = 0; offset < count; offset++) {
      const del = deleted[offset]
      const ins = inserted[offset]
      rows.push({
        kind: del && ins ? 'replace' : del ? 'delete' : 'insert',
        left: del ? del.text : null,
        right: ins ? ins.text : null,
        leftNumber: del ? leftNumber++ : null,
        rightNumber: ins ? rightNumber++ : null,
      })
    }
  }
  return rows
}

export function diffStats(ops: DiffOp[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const op of ops) {
    if (op.kind === 'insert') additions += 1
    if (op.kind === 'delete') deletions += 1
  }
  return { additions, deletions }
}
