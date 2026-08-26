/**
 * 工作台「加工」页签：按 session 展示 CAM run 的完整加工过程时间线（无折叠）。
 * 数据源 = run 目录磁盘落盘（tool-cam 只读路由 GET /camind/api/cam/runs）：
 * runstate.history（cam_run 每阶段带 ts 落盘，resume 续跑往后追加）渲染竖向
 * 时间线；op 记录的起止时间算耗时，执行中的序显示「已运行 X / 限时约 Y 分钟」；
 * runstate.check 渲染收尾自检结论。旧版本落盘的 runstate 无 history，回退工序
 * 终态列表。不读会话事件投影——免疫 cam/* 事件会话重启拒绝重载的上游限制
 * （设计稿 §4.4），也能展示中断后可 resume 续跑的 run。
 * 组件只在页签激活时挂载：列表 5s 轮询；详情随 updated_at 前移重拉；执行中的
 * 卡片 1s 走表刷新「已运行」。
 *
 * 「查看刀路」已迁入 camind-ui-preview（2026-08-26）：按钮经 delivery 路由取
 * NC 文本后调 previewClient.previewContent，「预览」标签页渲染刀路（NC 查看器
 * 席位 cam.nc.preview 与该插件声明，camind-ui-toolpath-viewer 注册）；本组件
 * 不再内嵌查看器。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  CamRunDetail,
  CamRunHistoryEntry,
  CamRunOverall,
  CamRunSummary,
  CamRunstate,
} from '@shared/protocol'
import { api } from './api'
import { bytesLabel } from './format'
import { previewContent, previewFile } from './previewClient'
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore'

const OVERALL_VIEW: Record<CamRunOverall, { label: string; modifier: string }> = {
  ok: { label: '通过', modifier: 'ok' },
  incomplete: { label: '含未决项', modifier: 'warn' },
  error: { label: '失败', modifier: 'err' },
  planned: { label: '未执行', modifier: 'muted' },
}
const RUNNING_VIEW = { label: '执行中', modifier: 'run' }

const OP_STATUS_LABELS: Record<string, string> = {
  ok: '完成',
  generated: '缺 NC',
  empty: '空刀路',
  error: '失败',
  skip: '跳过（沿用）',
  interrupted: '中断',
}

const OP_TYPE_LABELS: Record<string, string> = {
  copy_postprocess: '模板复制',
  from_scratch_workpiece_op: '从零建工序',
}

const STAGE_TEXT: Record<string, string> = {
  ensure_ready: '开工检查（CAM 工作站健康门禁）',
  upload: '上传零件到工作台',
  work_copy: '复制工作副本（主模型不被写）',
  prepare: '加工准备（建 CAM setup）',
  check: '收尾自检（NC 对账 + 空刀路）',
}

const TERMINAL_STAGES = new Set(['done', 'failed', 'aborted'])

function opStatusLabel(status: string | null): string {
  return status === null ? '未执行' : OP_STATUS_LABELS[status] ?? status
}

function timeLabel(iso: string): string {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

/** HH:MM:SS（时间线行首用）。 */
function clockLabel(iso: string): string {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleTimeString('zh-CN', { hour12: false })
}

/** 两个 ISO 时间差 → 紧凑时长（27s / 11m45s / 1h02m）；判不出返回 null。 */
function durLabel(startIso: string, endIso: string): string | null {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** 执行中的卡片走表（刷新「已运行」）；null 时静止。 */
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

type DetailState =
  | { phase: 'loading' }
  | { phase: 'ready'; detail: CamRunDetail }
  | { phase: 'error'; message: string }

type TimelineRow =
  | { key: string; kind: 'stage'; ts: string; stage: string; status?: string; total?: number; skipped?: boolean; failedStage?: string; msg?: string }
  | { key: string; kind: 'op'; ts: string; index: number; name: string; action?: string; status?: string; endTs?: string }

/** runstate.history → 时间线行：op 的起（action）/止（status）两条折成一行。 */
function foldTimeline(history: CamRunHistoryEntry[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  const open = new Map<number, Extract<TimelineRow, { kind: 'op' }>>()
  history.forEach((entry, i) => {
    const key = `h${i}`
    if (entry.stage === 'op' && typeof entry.index === 'number') {
      const name = entry.name ?? `op ${entry.index}`
      if (entry.status !== undefined) {
        const started = open.get(entry.index)
        if (started !== undefined) {
          started.status = entry.status
          started.endTs = entry.ts
          open.delete(entry.index)
        } else {
          rows.push({ key, kind: 'op', ts: entry.ts, index: entry.index, name, status: entry.status, endTs: entry.ts })
        }
      } else {
        // 同一 index 已有未闭合的起始行 = 上次跑到一半进程死了（崩潰/中断）；
        // 旧行标「中断」，新行接续（resume 重跑的正常形态）。
        const stale = open.get(entry.index)
        if (stale !== undefined) stale.status = 'interrupted'
        const row: Extract<TimelineRow, { kind: 'op' }> = { key, kind: 'op', ts: entry.ts, index: entry.index, name, action: entry.action }
        rows.push(row)
        open.set(entry.index, row)
      }
      return
    }
    rows.push({
      key, kind: 'stage', ts: entry.ts, stage: entry.stage,
      status: entry.status, total: entry.total, skipped: entry.skipped,
      failedStage: entry.failed_stage, msg: entry.msg,
    })
  })
  return rows
}

function stageRowView(row: Extract<TimelineRow, { kind: 'stage' }>): { icon: string; text: string; tone: string } {
  switch (row.stage) {
    case 'ops':
      return { icon: '✓', text: `开始逐序执行（共 ${row.total ?? '?'} 道）`, tone: 'ok' }
    case 'upload':
      return { icon: '✓', text: row.skipped === true ? '上传零件（proxy 侧已有，跳过）' : STAGE_TEXT.upload, tone: 'ok' }
    case 'done': {
      const view = OVERALL_VIEW[(row.status ?? '') as CamRunOverall] ?? OVERALL_VIEW.planned
      return { icon: row.status === 'ok' ? '✓' : row.status === 'error' ? '✗' : '!', text: `执行完成：${view.label}`, tone: view.modifier }
    }
    case 'failed':
      return { icon: '✗', text: `失败于「${STAGE_TEXT[row.failedStage ?? ''] ?? row.failedStage ?? '?'}」：${row.msg ?? ''}`, tone: 'err' }
    case 'aborted':
      return { icon: '■', text: `已停止：${row.msg ?? ''}`, tone: 'warn' }
    default:
      return { icon: '✓', text: STAGE_TEXT[row.stage] ?? row.stage, tone: 'ok' }
  }
}

function opRowTone(status: string | undefined): string {
  if (status === undefined) return 'run'
  if (status === 'ok') return 'ok'
  if (status === 'skip') return 'muted'
  if (status === 'error') return 'err'
  return 'warn' // generated / empty
}

function opRowIcon(status: string | undefined): string {
  if (status === undefined) return '●'
  if (status === 'ok') return '✓'
  if (status === 'skip') return '−'
  if (status === 'error') return '✗'
  return '!'
}

function basenameOf(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return slash >= 0 ? p.slice(slash + 1) : p
}

function DeliveryFileRow({ sessionId, runId, file }: { sessionId: string; runId: string; file: { name: string; bytes: number } }) {
  const isMarkdown = file.name.toLowerCase().endsWith('.md')
  return (
    <div className="camrun-file">
      <span className="camrun-file-name" title={file.name}>{file.name}</span>
      <small>{bytesLabel(file.bytes)}</small>
      <span className="camrun-file-actions">
        {isMarkdown && (
          <button
            type="button"
            title="预览会话工作区镜像（镜像缺失时会报文件不存在，可改用下载）"
            onClick={() => previewFile(sessionId, `delivery/${runId}/${file.name}`)}
          >
            预览
          </button>
        )}
        <a href={api.camDeliveryFileUrl(sessionId, runId, file.name)}>下载</a>
      </span>
    </div>
  )
}

/** 「查看刀路」按钮：取 NC 文本 → 预览 tab（camind-ui-preview）渲染刀路。 */
function NcToolpathButton({ sessionId, runId, name }: { sessionId: string; runId: string; name: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <>
      <button
        type="button"
        disabled={busy}
        title="在「预览」标签页查看刀路"
        onClick={() => {
          setBusy(true)
          setError(undefined)
          void fetch(api.camDeliveryFileUrl(sessionId, runId, `nc/${name}`), { headers: { Accept: 'text/plain' } })
            .then(async (response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              previewContent(sessionId, name, await response.text())
            })
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false))
        }}
      >
        查看刀路
      </button>
      {error !== undefined && <span className="camrun-op-error">读取失败：{error}</span>}
    </>
  )
}

function Timeline({ rows, runstate, opsTotal, active, now }: {
  rows: TimelineRow[]
  runstate: CamRunstate | null
  opsTotal: number
  active: boolean
  now: number
}) {
  const lastKey = rows[rows.length - 1]?.key
  return (
    <ul className="camrun-tl">
      {rows.map((row) => {
        const isLast = row.key === lastKey
        if (row.kind === 'stage') {
          const view = stageRowView(row)
          const running = active && isLast
          return (
            <li key={row.key} data-tone={running ? 'run' : view.tone}>
              <span className="camrun-tl-time">{clockLabel(row.ts)}</span>
              <span className="camrun-tl-icon">{running ? '●' : view.icon}</span>
              <span className="camrun-tl-body">
                <span>{running ? `${view.text}…` : view.text}</span>
              </span>
            </li>
          )
        }
        const op = runstate?.ops?.[row.index]
        const running = row.status === undefined
        const duration = !running && row.endTs !== undefined ? durLabel(row.ts, row.endTs) : null
        const elapsed = running ? durLabel(row.ts, new Date(now).toISOString()) : null
        const timeout = typeof op?.timeout_seconds === 'number' ? `限时约 ${Math.max(1, Math.round(op.timeout_seconds / 60))} 分钟` : null
        return (
          <li key={row.key} data-tone={opRowTone(row.status)}>
            <span className="camrun-tl-time">{clockLabel(row.ts)}</span>
            <span className="camrun-tl-icon">{opRowIcon(row.status)}</span>
            <span className="camrun-tl-body">
              <span>
                工序 {row.index + 1}/{opsTotal} {row.name}
                {row.action === 'post' && '（补后处理）'}
                {row.action === 'full' && op?.type !== undefined && OP_TYPE_LABELS[op.type] !== undefined && `（${OP_TYPE_LABELS[op.type]}）`}
              </span>
              <span className="camrun-tl-sub">
                {running
                  ? `计算中…${elapsed !== null ? ` 已运行 ${elapsed}` : ''}${timeout !== null ? ` · ${timeout}` : ''}`
                  : `${opStatusLabel(row.status ?? null)}${duration !== null ? ` · ${duration}` : ''}`}
              </span>
              {row.status !== undefined && !['ok', 'skip', 'interrupted'].includes(row.status) && op?.error !== undefined && op.error !== '' && (
                <span className="camrun-tl-err">{op.error}</span>
              )}
              {row.status === 'ok' && op?.nc_files !== undefined && op.nc_files.length > 0 && (
                <span className="camrun-tl-sub">NC：{op.nc_files.map(basenameOf).join('、')}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function CamRunCard({
  sessionId,
  run,
  viewerComponent,
}: {
  sessionId: string
  run: CamRunSummary
}) {
  const [detailState, setDetailState] = useState<DetailState | null>(null)

  // 无折叠：挂载即拉详情；列表轮询发现 updated_at 前移（cam_run 落盘）自动重拉。
  useEffect(() => {
    let cancelled = false
    setDetailState((prev) => prev ?? { phase: 'loading' })
    void api.camRunDetail(sessionId, run.run_id).then((result) => {
      if (!cancelled) setDetailState({ phase: 'ready', detail: result.run })
    }).catch((error) => {
      if (!cancelled) setDetailState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [run.updated_at, run.run_id, sessionId])

  const detail = detailState?.phase === 'ready' ? detailState.detail : null
  const runstate = detail?.runstate ?? null
  const rows = runstate?.history !== undefined && runstate.history.length > 0 ? foldTimeline(runstate.history) : []
  const lastRow = rows[rows.length - 1]
  const active = rows.length > 0 && !(lastRow?.kind === 'stage' && TERMINAL_STAGES.has(lastRow.stage))
  const now = useNow(active ? 1000 : null)
  // 执行中且未闭合的最后一道序（lib ES2022 无 findLast，倒序扫）。
  let runningOp: Extract<TimelineRow, { kind: 'op' }> | undefined
  if (active) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]
      if (row.kind === 'op' && row.status === undefined) { runningOp = row; break }
    }
  }

  const machine = run.machine.display_name ?? run.machine.id
  const overallView = active ? RUNNING_VIEW : (OVERALL_VIEW[run.overall] ?? OVERALL_VIEW.planned)
  const opsTotal = runstate?.ops?.length ?? run.ops.length
  const runningOpTimeout = runningOp !== undefined
    ? runstate?.ops?.[runningOp.index]?.timeout_seconds
    : undefined
  const runningElapsed = runningOp !== undefined
    ? durLabel(runningOp.ts, new Date(now).toISOString())
    : null
  const check = runstate?.check
  const checkWarn = check !== undefined
    && (check.listing_ok === false || (check.missing?.length ?? 0) > 0 || (check.empty_ops?.length ?? 0) > 0)

  return (
    <section className="camrun-card">
      <div className="camrun-head">
        <span className={`camrun-badge camrun-badge-${overallView.modifier}`}>{overallView.label}</span>
        <span className="camrun-title" title={run.run_id}>{run.run_id}</span>
      </div>
      <dl className="camrun-facts">
        {run.part_id !== null && <div><dt>件号</dt><dd>{run.part_id}</dd></div>}
        {machine !== null && <div><dt>机床</dt><dd>{machine}</dd></div>}
        {detail?.post_name != null && <div><dt>后处理器</dt><dd>{detail.post_name}</dd></div>}
        {detail?.out_dir != null && <div><dt>输出目录</dt><dd title={detail.out_dir}>{detail.out_dir}</dd></div>}
        <div><dt>更新</dt><dd>{timeLabel(run.updated_at)}</dd></div>
      </dl>
      {active && (
        <p className="camrun-live">
          {runningOp !== undefined
            ? `正在执行工序 ${runningOp.index + 1}/${opsTotal} ${runningOp.name}`
              + (runningElapsed !== null ? ` · 已运行 ${runningElapsed}` : '')
              + (typeof runningOpTimeout === 'number' ? ` · 限时约 ${Math.max(1, Math.round(runningOpTimeout / 60))} 分钟` : '')
            : `正在执行：${lastRow?.kind === 'stage' ? (STAGE_TEXT[lastRow.stage] ?? lastRow.stage) : ''}…`}
        </p>
      )}
      {run.read_error !== undefined && <p className="camrun-warn">{run.read_error}</p>}
      {run.overall === 'planned' && (
        <p className="camrun-note">尚未执行——在会话中让 Agent 对该 run_id 调用 cam_run 首跑。</p>
      )}
      {!active && (run.overall === 'incomplete' || run.overall === 'error') && (
        <p className="camrun-note">本 run 未全过——可让 Agent 以 cam_run（resume=true）续跑，run_id 不变。</p>
      )}

      {detailState?.phase === 'loading' && <p className="camrun-note">读取 run 详情…</p>}
      {detailState?.phase === 'error' && <p className="camrun-warn">详情读取失败：{detailState.message}</p>}
      {rows.length > 0 && <Timeline rows={rows} runstate={runstate} opsTotal={opsTotal} active={active} now={now} />}
      {detail !== null && rows.length === 0 && runstate?.ops !== undefined && runstate.ops.length > 0 && (
        <>
          <p className="camrun-note">本 run 由旧版本落盘（无过程时间线），仅工序终态：</p>
          <ul className="camrun-op-list">
            {runstate.ops.map((op) => (
              <li key={op.index}>
                <span className="camrun-op-dot" data-status={op.status} />
                <span className="camrun-op-name" title={op.type}>{op.name}</span>
                <span className="camrun-op-status">{opStatusLabel(op.status)}</span>
                {op.error !== undefined && op.error !== '' && <span className="camrun-op-error">{op.error}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {check !== undefined && (
        <p className={checkWarn ? 'camrun-warn' : 'camrun-note'}>
          自检：NC 对账 期望 {check.expected ?? '?'} / 实数 {check.found ?? '?'}
          {(check.missing?.length ?? 0) > 0 ? `，缺 ${check.missing?.join('、')}` : '，一致'}
          {(check.empty_ops?.length ?? 0) > 0 && `；空刀路：${check.empty_ops?.join('、')}`}
          {check.listing_ok === false && '（out_dir 列举失败，判不出）'}
        </p>
      )}

      {run.delivery.length > 0 && (
        <div className="camrun-files">
          {run.delivery.map((file) => (
            <DeliveryFileRow key={file.name} sessionId={sessionId} runId={run.run_id} file={file} />
          ))}
        </div>
      )}
      {detail !== null && detail.nc_error !== undefined && <p className="camrun-warn">{detail.nc_error}</p>}
      {detail !== null && detail.delivered && detail.nc_files.length > 0 && (
        <>
          <h4 className="camrun-section-title">NC 程序（{detail.nc_files.length}）</h4>
          <div className="camrun-files">
            {detail.nc_files.map((name) => (
              <div key={name} className="camrun-file">
                <span className="camrun-file-name" title={name}>{name}</span>
                <span className="camrun-file-actions">
                  <a href={api.camDeliveryFileUrl(sessionId, run.run_id, `nc/${name}`)}>下载</a>
                  <NcToolpathButton sessionId={sessionId} runId={run.run_id} name={name} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export function CamRuns({ sessionId }: { sessionId: string }) {
  const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot)
  const runs = snapshot.camRuns[sessionId] ?? []
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()

  // 页签激活（本组件挂载）期间：立即拉一次 + 5s 轮询；内容没变 store 不 publish。
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await api.camRuns(sessionId)
        if (cancelled) return
        workbenchActions.setCamRuns(sessionId, result.runs)
        setError(undefined)
        setLoaded(true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      }
    }
    setLoaded(false)
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId])

  if (!loaded) return <div className="workbench-empty">读取 CAM run 列表…</div>
  if (error !== undefined) return <div className="workbench-empty">CAM run 列表读取失败：{error}</div>
  if (runs.length === 0) {
    return <div className="workbench-empty">本会话还没有 CAM run——cam_plan 落盘后出现在这里（数据源是 run 目录，与会话事件无关）。</div>
  }
  return (
    <div className="workbench-section camrun-list">
      {runs.map((run) => (
        <CamRunCard key={run.run_id} sessionId={sessionId} run={run} />
      ))}
    </div>
  )
}
