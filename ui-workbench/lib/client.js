// camind-ui-workbench browser bundle — hand-written, no build step.
// 一级 conversation.view 工作台：输入 / 交付物 / 加工 + 中央预览与 Agent 面板。
// /camind、官方 /web 与桌面端共享注册，缺失的正式规划能力用明确占位呈现。
// 数据源：ui-preview 的 /camind/api/preview/sessions/:id/files（上传/附件/桌面引用）+ tool-cam 的
// /camind/api/cam/runs（加工时间线）+ 官方 uiConversation 投影（交付物）。
// 预览按钮经 ui-preview 的 filePreview 服务留在工作台画布。
// 样式自含，token 走 --dsw-alias-*（不依赖 ui-shell/foundation）。
window.__ModuleLoader__.load({ id: "camind-ui-workbench", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useEffect, useState } = React
const { Button, IconGaugeOutlineRegular, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

const VIEW_ID = 'workbench'
const INPUTS_API = '/camind/api/preview/sessions'
const RUNS_API = '/camind/api/cam/runs'

// --- stylesheet ------------------------------------------------------------------

const benchCss = `
[data-conversation-scroll]:has(.wb-main) { overflow:hidden; }
[data-slot="conversation.session"] > :has(> [data-slot="conversation.view"] > .wb-main) { flex:1 1 0; min-height:0; overflow:auto; }
.wb-main { display:flex; flex:1; flex-direction:column; height:100%; min-height:0; color:var(--dsw-alias-label-primary); container-type:inline-size; }
.wb-main * { box-sizing:border-box; }
.wb-main-head, .wb-agent header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-main-head > span, .wb-hint { font-size:12px; color:var(--dsw-alias-label-tertiary); }
.wb-scene { display:flex; flex:1; min-height:0; position:relative; }
.wb-left { width:260px; flex:none; border-right:1px solid var(--dsw-alias-border-l2); overflow:auto; }
.wb-inspector { width:240px; flex:none; border-left:1px solid var(--dsw-alias-border-l2); overflow:auto; }
.wb-canvas { display:flex; flex:1; min-width:0; min-height:0; overflow:auto; background:var(--dsw-alias-bg-layer-2); }
.wb-preview-stage { display:flex; flex:1; min-width:0; min-height:0; }
.wb-preview-stage[hidden] { display:none; }
.wb-placeholder { padding:24px; margin:auto; max-width:560px; line-height:1.7; }
.wb-placeholder h3 { margin:0 0 12px; font-size:16px; }
.wb-placeholder small { color:var(--dsw-alias-label-tertiary); }
.wb-agent { flex:none; border-top:1px solid var(--dsw-alias-border-l2); }
.wb-agent details, .wb-hint { margin:8px 12px; }
.wb-response { max-height:100px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.6; padding:8px 0; }
.wb-agent header span { flex:1; font-size:12px; }
.wb-main .campv-view { min-height:0; }
@container (max-width:800px) { .wb-left { width:210px; } .wb-inspector { position:absolute; right:0; top:0; bottom:0; z-index:5; background:var(--dsw-alias-bg-base); box-shadow:0 2px 8px #0003; } }
@container (max-width:560px) { .wb-left { position:absolute; left:0; top:0; bottom:0; z-index:4; background:var(--dsw-alias-bg-base); } }
.wb { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
.wb *, .wb *::before, .wb *::after { box-sizing: border-box; }
.wb-tabs { flex: none; display: flex; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.wb-tab { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 8px; cursor: pointer; }
.wb-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wb-tab.active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); font-weight: 600; }
.wb-body { flex: 1; min-height: 0; overflow-y: auto; }
.wb-section { padding: 10px 12px; }
.wb-empty { padding: 28px 16px; font-size: 13px; line-height: 1.6; text-align: center; color: var(--dsw-alias-label-tertiary); }
.wb-facts { margin: 0 0 10px; display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; font-size: 12px; }
.wb-facts > div { display: contents; }
.wb-facts dt { color: var(--dsw-alias-label-tertiary); }
.wb-facts dd { margin: 0; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.wb-h3 { margin: 12px 0 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); font-weight: 600; }
.wb-file-list { display: flex; flex-direction: column; gap: 2px; }
.wb-file { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: left; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
.wb-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wb-file > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-file small { flex: none; color: var(--dsw-alias-label-tertiary); }
.wb-deliverable { display: flex; flex-direction: column; gap: 1px; min-width: 0; width: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; padding: 6px; border-radius: 6px; cursor: pointer; }
.wb-deliverable:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wb-deliverable-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-deliverable-dir { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.camrun-list { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; }
.camrun-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); padding: 10px 11px; }
.camrun-head { width: 100%; min-width: 0; display: flex; align-items: center; gap: 8px; }
.camrun-badge { flex: none; border-radius: 999px; padding: 2px 9px; font-size: 12px; line-height: 17px; }
.camrun-badge-ok { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.camrun-badge-warn { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
.camrun-badge-err { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.camrun-badge-muted { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }
.camrun-badge-run { color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent); }
.camrun-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.camrun-live { margin: 8px 0 0; color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 1.55; }
.camrun-tl { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
.camrun-tl > li { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 13px; }
.camrun-tl-time { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.camrun-tl-icon { flex: none; width: 13px; text-align: center; }
.camrun-tl > li[data-tone="ok"] .camrun-tl-icon { color: var(--dsw-alias-state-success-primary); }
.camrun-tl > li[data-tone="warn"] .camrun-tl-icon { color: var(--dsw-alias-state-warn-primary); }
.camrun-tl > li[data-tone="err"] .camrun-tl-icon { color: var(--dsw-alias-state-error-primary); }
.camrun-tl > li[data-tone="run"] .camrun-tl-icon { color: var(--dsw-alias-state-business-primary); }
.camrun-tl > li[data-tone="muted"] .camrun-tl-icon { color: var(--dsw-alias-label-tertiary); }
.camrun-tl-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow-wrap: anywhere; }
.camrun-tl-sub { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.camrun-tl-err { color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
.camrun-section-title { margin: 12px 0 6px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.camrun-facts { margin: 8px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; font-size: 12px; }
.camrun-facts > div { display: contents; }
.camrun-facts dt { color: var(--dsw-alias-label-tertiary); }
.camrun-facts dd { margin: 0; overflow-wrap: anywhere; }
.camrun-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.55; }
.camrun-warn { margin: 8px 0 0; color: var(--dsw-alias-state-warn-primary); font-size: 12px; line-height: 1.55; }
.camrun-files { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.camrun-file { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.camrun-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.camrun-file small { flex: none; color: var(--dsw-alias-label-tertiary); }
.camrun-file-actions { flex: none; display: flex; gap: 8px; }
.camrun-file-actions a, .camrun-file-actions button { border: 0; padding: 0; background: transparent; color: var(--dsw-alias-state-business-primary); font-size: 12px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.camrun-file-actions button:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.camrun-op-list { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.camrun-op-list li { display: flex; align-items: baseline; gap: 7px; min-width: 0; font-size: 13px; }
.camrun-op-dot { width: 8px; height: 8px; flex: none; display: inline-block; border-radius: 50%; background: var(--dsw-alias-label-tertiary); align-self: center; }
.camrun-op-dot[data-status="ok"] { background: var(--dsw-alias-state-success-primary); }
.camrun-op-dot[data-status="generated"], .camrun-op-dot[data-status="empty"] { background: var(--dsw-alias-state-warn-primary); }
.camrun-op-dot[data-status="error"] { background: var(--dsw-alias-state-error-primary); }
.camrun-op-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.camrun-op-status { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.camrun-op-error { flex: none; max-width: 100%; color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
`

// --- shared helpers -----------------------------------------------------------------

let applyCtx = null

function previewService() {
  return applyCtx?.get('filePreview')
}

function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function basenameOf(p) {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return slash >= 0 ? p.slice(slash + 1) : p
}

function dirnameOf(p) {
  const t = String(p).replaceAll('\\', '/')
  const i = t.lastIndexOf('/')
  return i > 0 ? t.slice(0, i) : ''
}

function clockLabel(iso) {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleTimeString('zh-CN', { hour12: false })
}

function timeLabel(iso) {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

function durLabel(startIso, endIso) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

// --- 输入 tab ---------------------------------------------------------------------------

function InputTab({ sessionId }) {
  const sessions = applyCtx?.get('sessions')
  const row = sessions?.list.getSnapshot().byId[sessionId]
  const cwd = row?.cwd
  const running = row?.running === true
  const [state, setState] = useState({ phase: 'loading', files: [] })
  useEffect(() => {
    const controller = new AbortController()
    let timer
    setState({ phase: 'loading', files: [] })
    const refresh = async () => {
      try {
        const res = await fetch(`${INPUTS_API}/${encodeURIComponent(sessionId)}/files`, { headers: { Accept: 'application/json' }, signal: controller.signal })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
        if (!controller.signal.aborted) setState({ phase: 'ready', files: body.files ?? [] })
      } catch (error) {
        if (!controller.signal.aborted) setState({ phase: 'error', files: [], message: error instanceof Error ? error.message : String(error) })
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 3000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId])

  return h('div', { className: 'wb-section' },
    h('dl', { className: 'wb-facts' },
      h('div', null, h('dt', null, '工作目录'), h('dd', { title: cwd }, cwd || '未设置')),
      h('div', null, h('dt', null, '状态'), h('dd', null, running ? '运行中' : '空闲'))),
    h('h3', { className: 'wb-h3' }, '输入文件'),
    state.phase === 'loading' && h('div', { className: 'wb-empty' }, '读取输入文件…'),
    state.phase === 'error' && h('div', { className: 'wb-empty' }, `输入文件读取失败：${state.message}`),
    state.phase === 'ready' && (state.files.length === 0
      ? h('div', { className: 'wb-empty' }, '当前会话尚无上传文件或已发送的本地文件引用。')
      : h('div', { className: 'wb-file-list' }, state.files.map((file) => h('button', {
          type: 'button',
          key: file.path,
          className: 'wb-file',
          title: file.message || file.displayPath || file.path,
          disabled: file.available === false,
          onClick: () => previewService()?.preview(sessionId, file.path),
        }, h('span', null, file.name), h('small', null,
          file.available === false ? file.message : `${file.source === 'reference' ? '本地引用 · ' : ''}${bytesLabel(file.size)}`))))))
}

// --- 交付物 tab --------------------------------------------------------------------------

// DSH 0.2 records produced/presented files in turn data, not legacy tool call cards.
function deliverablesOfChat(chat) {
  const paths = new Set()
  for (const id of chat?.timeline.turnOrder ?? []) {
    const data = chat.timeline.turns.get(id)?.data.get('deliverables')
    for (const file of [...data?.produced ?? [], ...data?.presented ?? []]) {
      if (typeof file.path === 'string') paths.add(file.path)
    }
  }
  return [...paths]
}

function DeliverablesTab({ sessionId }) {
  const [paths, setPaths] = useState([])
  const [cam, setCam] = useState({ files: [], error: '' })
  useEffect(() => {
    let cancelled = false, timer
    const refresh = async () => {
      try {
        const result = await runsApi(sessionId)
        if (!cancelled) setCam({ files: (result.runs ?? []).flatMap(run => run.delivery.map(file => ({ ...file, runId: run.run_id }))), error: '' })
      } catch (error) { if (!cancelled) setCam({ files: [], error: error.message }) }
      finally { if (!cancelled) timer = setTimeout(refresh, 5000) }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionId])
  useEffect(() => {
    let dispose
    try {
      const binding = applyCtx?.get('uiConversation')?.binding(sessionId)
      if (!binding) return
      const source = binding.target('chat')
      const sync = () => setPaths(deliverablesOfChat(source.getSnapshot()))
      dispose = source.subscribe(sync)
      sync()
    } catch { /* 会话绑定未就绪时保持空列表 */ }
    return dispose
  }, [sessionId])

  return h('div', { className: 'wb-section' },
    cam.error && h('p', { role: 'alert' }, `CAM 文件列表读取失败：${cam.error}`),
    cam.files.length > 0 && h(React.Fragment, null, h('h3', { className: 'wb-h3' }, 'CAM 输出文件（不是放行结论）'),
      cam.files.map(file => h(DeliveryFileRow, { key: `${file.runId}/${file.name}`, sessionId, runId: file.runId, file }))),
    paths.length === 0 && cam.files.length === 0
      ? h('div', { className: 'wb-empty' }, '当前已加载的会话轮次还没有产出文件。')
      : h('div', { className: 'wb-file-list' }, paths.filter(p => !cam.files.some(file => p === `delivery/${file.runId}/${file.name}`)).map((p) => h('button', {
          type: 'button',
          key: p,
          className: 'wb-deliverable',
          title: p,
          onClick: () => previewService()?.preview(sessionId, p),
        },
          h('span', { className: 'wb-deliverable-name' }, basenameOf(p)),
          dirnameOf(p) ? h('span', { className: 'wb-deliverable-dir' }, `${dirnameOf(p)}/`) : null))))
}

// --- 加工 tab（自 tool-cam 迁入合并） ---------------------------------------------------------

const OVERALL_VIEW = {
  ok: { label: '通过', modifier: 'ok' },
  incomplete: { label: '含未决项', modifier: 'warn' },
  error: { label: '失败', modifier: 'err' },
  planned: { label: '未执行', modifier: 'muted' },
}
const RUNNING_VIEW = { label: '执行中', modifier: 'run' }
const OP_STATUS_LABELS = { ok: '完成', generated: '缺 NC', empty: '空刀路', error: '失败', skip: '跳过（沿用）', interrupted: '中断' }
const OP_TYPE_LABELS = { copy_postprocess: '模板复制', from_scratch_workpiece_op: '从零建工序' }
const STAGE_TEXT = {
  ensure_ready: '开工检查（CAM 工作站健康门禁）',
  upload: '上传零件到工作台',
  work_copy: '复制工作副本（主模型不被写）',
  prepare: '加工准备（建 CAM setup）',
  check: '收尾自检（NC 对账 + 空刀路）',
}
const TERMINAL_STAGES = new Set(['done', 'failed', 'aborted'])

function opStatusLabel(status) {
  return status === null ? '未执行' : OP_STATUS_LABELS[status] ?? status
}

function foldTimeline(history) {
  const rows = []
  const open = new Map()
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
        const stale = open.get(entry.index)
        if (stale !== undefined) stale.status = 'interrupted'
        const row = { key, kind: 'op', ts: entry.ts, index: entry.index, name, action: entry.action }
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

function stageRowView(row) {
  switch (row.stage) {
    case 'ops':
      return { icon: '✓', text: `开始逐序执行（共 ${row.total ?? '?'} 道）`, tone: 'ok' }
    case 'upload':
      return { icon: '✓', text: row.skipped === true ? '上传零件（proxy 侧已有，跳过）' : STAGE_TEXT.upload, tone: 'ok' }
    case 'done': {
      const view = OVERALL_VIEW[row.status ?? ''] ?? OVERALL_VIEW.planned
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

function opRowTone(status) {
  if (status === undefined) return 'run'
  if (status === 'ok') return 'ok'
  if (status === 'skip') return 'muted'
  if (status === 'error') return 'err'
  return 'warn'
}

function opRowIcon(status) {
  if (status === undefined) return '●'
  if (status === 'ok') return '✓'
  if (status === 'skip') return '−'
  if (status === 'error') return '✗'
  return '!'
}

async function runsApi(sessionId, runId) {
  const suffix = runId === undefined ? `?session=${encodeURIComponent(sessionId)}` : `/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}`
  const response = await fetch(RUNS_API + suffix, { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
  return body
}

function deliveryFileUrl(sessionId, runId, name) {
  return `${RUNS_API}/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}/delivery/${name.split('/').map(encodeURIComponent).join('/')}`
}

function DeliveryFileRow({ sessionId, runId, file }) {
  const isMarkdown = file.name.toLowerCase().endsWith('.md')
  return h('div', { className: 'camrun-file' },
    h('span', { className: 'camrun-file-name', title: file.name }, file.name),
    h('small', null, bytesLabel(file.bytes)),
    h('span', { className: 'camrun-file-actions' },
      isMarkdown && h('button', {
        type: 'button',
        title: '预览会话工作区镜像（镜像缺失时会报文件不存在，可改用下载）',
        onClick: () => previewService()?.preview(sessionId, `delivery/${runId}/${file.name}`),
      }, '预览'),
      h('a', { href: deliveryFileUrl(sessionId, runId, file.name) }, '下载')))
}

function NcToolpathButton({ sessionId, runId, name }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState()
  return h(React.Fragment, null,
    h('button', {
      type: 'button',
      disabled: busy,
      title: '在工作台画布查看刀路',
      onClick: () => {
        setBusy(true)
        setError(undefined)
        void fetch(deliveryFileUrl(sessionId, runId, `nc/${name}`), { headers: { Accept: 'text/plain' } })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            previewService()?.previewContent(sessionId, name, await response.text())
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false))
      },
    }, '查看刀路'),
    error !== undefined && h('span', { className: 'camrun-op-error' }, `读取失败：${error}`))
}

function Timeline({ rows, runstate, opsTotal, active, now }) {
  const lastKey = rows[rows.length - 1]?.key
  return h('ul', { className: 'camrun-tl' }, rows.map((row) => {
    const isLast = row.key === lastKey
    if (row.kind === 'stage') {
      const view = stageRowView(row)
      const running = active && isLast
      return h('li', { key: row.key, 'data-tone': running ? 'run' : view.tone },
        h('span', { className: 'camrun-tl-time' }, clockLabel(row.ts)),
        h('span', { className: 'camrun-tl-icon' }, running ? '●' : view.icon),
        h('span', { className: 'camrun-tl-body' }, h('span', null, running ? `${view.text}…` : view.text)))
    }
    const op = runstate?.ops?.[row.index]
    const running = row.status === undefined
    const duration = !running && row.endTs !== undefined ? durLabel(row.ts, row.endTs) : null
    const elapsed = running ? durLabel(row.ts, new Date(now).toISOString()) : null
    const timeout = typeof op?.timeout_seconds === 'number' ? `限时约 ${Math.max(1, Math.round(op.timeout_seconds / 60))} 分钟` : null
    return h('li', { key: row.key, 'data-tone': opRowTone(row.status) },
      h('span', { className: 'camrun-tl-time' }, clockLabel(row.ts)),
      h('span', { className: 'camrun-tl-icon' }, opRowIcon(row.status)),
      h('span', { className: 'camrun-tl-body' },
        h('span', null,
          `工序 ${row.index + 1}/${opsTotal} ${row.name}`,
          row.action === 'post' && '（补后处理）',
          row.action === 'full' && op?.type !== undefined && OP_TYPE_LABELS[op.type] !== undefined && `（${OP_TYPE_LABELS[op.type]}）`),
        h('span', { className: 'camrun-tl-sub' },
          running
            ? `计算中…${elapsed !== null ? ` 已运行 ${elapsed}` : ''}${timeout !== null ? ` · ${timeout}` : ''}`
            : `${opStatusLabel(row.status ?? null)}${duration !== null ? ` · ${duration}` : ''}`),
        row.status !== undefined && !['ok', 'skip', 'interrupted'].includes(row.status) && op?.error !== undefined && op.error !== ''
          && h('span', { className: 'camrun-tl-err' }, op.error),
        row.status === 'ok' && op?.nc_files !== undefined && op.nc_files.length > 0
          && h('span', { className: 'camrun-tl-sub' }, `NC：${op.nc_files.map(basenameOf).join('、')}`)))
  }))
}

function CamRunCard({ sessionId, run }) {
  const [detailState, setDetailState] = useState(null)
  useEffect(() => {
    let cancelled = false
    setDetailState((prev) => prev ?? { phase: 'loading' })
    void runsApi(sessionId, run.run_id).then((result) => {
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
  let runningOp
  if (active) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]
      if (row.kind === 'op' && row.status === undefined) { runningOp = row; break }
    }
  }

  const machine = run.machine.display_name ?? run.machine.id
  const overallView = active ? RUNNING_VIEW : (OVERALL_VIEW[run.overall] ?? OVERALL_VIEW.planned)
  const opsTotal = runstate?.ops?.length ?? run.ops.length
  const runningOpTimeout = runningOp !== undefined ? runstate?.ops?.[runningOp.index]?.timeout_seconds : undefined
  const runningElapsed = runningOp !== undefined ? durLabel(runningOp.ts, new Date(now).toISOString()) : null
  const check = runstate?.check
  const checkWarn = check !== undefined
    && (check.listing_ok === false || (check.missing?.length ?? 0) > 0 || (check.empty_ops?.length ?? 0) > 0)

  return h('section', { className: 'camrun-card' },
    h('div', { className: 'camrun-head' },
      h('span', { className: `camrun-badge camrun-badge-${overallView.modifier}` }, overallView.label),
      h('span', { className: 'camrun-title', title: run.run_id }, run.run_id),
      h(Button, { type: 'button', disabled: !run.preview_available, title: run.preview_available ? '按工序检查模型与NC轨迹' : '此批次缺少源模型版本与完整工位变换，仍可单独查看NC', onClick: () => previewService()?.previewRun(sessionId, run.run_id) }, '加工检查')),
    h('dl', { className: 'camrun-facts' },
      run.part_id !== null && h('div', null, h('dt', null, '件号'), h('dd', null, run.part_id)),
      machine !== null && h('div', null, h('dt', null, '机床'), h('dd', null, machine)),
      detail?.post_name != null && h('div', null, h('dt', null, '后处理器'), h('dd', null, detail.post_name)),
      detail?.out_dir != null && h('div', null, h('dt', null, '输出目录'), h('dd', { title: detail.out_dir }, detail.out_dir)),
      h('div', null, h('dt', null, '更新'), h('dd', null, timeLabel(run.updated_at)))),
    active && h('p', { className: 'camrun-live' },
      runningOp !== undefined
        ? `正在执行工序 ${runningOp.index + 1}/${opsTotal} ${runningOp.name}`
          + (runningElapsed !== null ? ` · 已运行 ${runningElapsed}` : '')
          + (typeof runningOpTimeout === 'number' ? ` · 限时约 ${Math.max(1, Math.round(runningOpTimeout / 60))} 分钟` : '')
        : `正在执行：${lastRow?.kind === 'stage' ? (STAGE_TEXT[lastRow.stage] ?? lastRow.stage) : ''}…`),
    run.read_error !== undefined && h('p', { className: 'camrun-warn' }, run.read_error),
    run.overall === 'planned' && h('p', { className: 'camrun-note' }, '尚未执行——在会话中让 Agent 对该 run_id 调用 cam_run 首跑。'),
    !active && (run.overall === 'incomplete' || run.overall === 'error')
      && h('p', { className: 'camrun-note' }, '本 run 未全过——可让 Agent 以 cam_run（resume=true）续跑，run_id 不变。'),
    detailState?.phase === 'loading' && h('p', { className: 'camrun-note' }, '读取 run 详情…'),
    detailState?.phase === 'error' && h('p', { className: 'camrun-warn' }, `详情读取失败：${detailState.message}`),
    rows.length > 0 && h(Timeline, { rows, runstate, opsTotal, active, now }),
    detail !== null && rows.length === 0 && runstate?.ops !== undefined && runstate.ops.length > 0 && h(React.Fragment, null,
      h('p', { className: 'camrun-note' }, '本 run 由旧版本落盘（无过程时间线），仅工序终态：'),
      h('ul', { className: 'camrun-op-list' }, runstate.ops.map((op) => h('li', { key: op.index },
        h('span', { className: 'camrun-op-dot', 'data-status': op.status }),
        h('span', { className: 'camrun-op-name', title: op.type }, op.name),
        h('span', { className: 'camrun-op-status' }, opStatusLabel(op.status)),
        op.error !== undefined && op.error !== '' && h('span', { className: 'camrun-op-error' }, op.error))))),
    check !== undefined && h('p', { className: checkWarn ? 'camrun-warn' : 'camrun-note' },
      `自检：NC 对账 期望 ${check.expected ?? '?'} / 实数 ${check.found ?? '?'}`,
      (check.missing?.length ?? 0) > 0 ? `，缺 ${check.missing?.join('、')}` : '，一致',
      (check.empty_ops?.length ?? 0) > 0 && `；空刀路：${check.empty_ops?.join('、')}`,
      check.listing_ok === false && '（out_dir 列举失败，判不出）'),
    run.delivery.length > 0 && h('div', { className: 'camrun-files' },
      run.delivery.map((file) => h(DeliveryFileRow, { key: file.name, sessionId, runId: run.run_id, file }))),
    detail !== null && detail.nc_error !== undefined && h('p', { className: 'camrun-warn' }, detail.nc_error),
    detail !== null && detail.delivered && detail.nc_files.length > 0 && h(React.Fragment, null,
      h('h4', { className: 'camrun-section-title' }, `NC 程序（${detail.nc_files.length}）`),
      h('div', { className: 'camrun-files' }, detail.nc_files.map((name) => h('div', { key: name, className: 'camrun-file' },
        h('span', { className: 'camrun-file-name', title: name }, name),
        h('span', { className: 'camrun-file-actions' },
          h('a', { href: deliveryFileUrl(sessionId, run.run_id, `nc/${name}`) }, '下载'),
          h(NcToolpathButton, { sessionId, runId: run.run_id, name })))))))
}

function CamRunsTab({ sessionId }) {
  const [state, setState] = useState({ phase: 'loading', runs: [] })
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await runsApi(sessionId)
        if (!cancelled) setState({ phase: 'ready', runs: result.runs ?? [] })
      } catch (error) {
        if (!cancelled) setState({ phase: 'error', runs: [], message: error instanceof Error ? error.message : String(error) })
      }
    }
    setState({ phase: 'loading', runs: [] })
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId])

  if (state.phase === 'loading') return h('div', { className: 'wb-empty' }, '读取 CAM run 列表…')
  if (state.phase === 'error') return h('div', { className: 'wb-empty' }, `CAM run 列表读取失败：${state.message}`)
  if (state.runs.length === 0) {
    return h('div', { className: 'wb-empty' }, '本会话还没有 CAM run——cam_plan 落盘后出现在这里（数据源是 run 目录，与会话事件无关）。')
  }
  return h('div', { className: 'camrun-list' }, state.runs.map((run) => h(CamRunCard, { key: run.run_id, sessionId, run })))
}

// --- tab body + registration -----------------------------------------------------------

const SUBTABS = [
  { id: 'input', label: '输入' },
  { id: 'deliverables', label: '交付物' },
  { id: 'cam', label: '加工' },
]

function WorkbenchTab({ sessionId, useTabInfo }) {
  const navTab = useTabInfo?.((info) => info.tab.navigation.params?.tab)
  const [tab, setTab] = useState(SUBTABS.some(sub => sub.id === navTab) ? navTab : 'input')
  return h('div', { className: 'wb' },
    h('div', { className: 'wb-tabs', role: 'tablist' },
      SUBTABS.map((sub) => h('button', {
        type: 'button',
        role: 'tab',
        key: sub.id,
        'aria-selected': tab === sub.id,
        className: tab === sub.id ? 'wb-tab active' : 'wb-tab',
        onClick: () => setTab(sub.id),
      }, sub.label))),
    h('div', { className: 'wb-body' },
      !sessionId && h('div', { className: 'wb-empty' }, '选择或新建会话后显示工作区信息。'),
      sessionId && tab === 'input' && h(InputTab, { sessionId }),
      sessionId && tab === 'deliverables' && h(DeliverablesTab, { sessionId }),
      sessionId && tab === 'cam' && h(CamRunsTab, { sessionId })))
}

// shortcut: use the upstream internal store bridge until DSH exposes public view navigation.
function conversationStore(sessionId) {
  const slots = applyCtx?.slots
  const entry = slots?.entriesOfSlot('conversation.session')[0]
  const binding = applyCtx?.get('sessions')?.binding(sessionId)
  return entry && binding?.ctx ? slots.hostFace().storeOf(entry, { key: sessionId, ctx: binding.ctx }) : undefined
}

function openView(sessionId, view) {
  conversationStore(sessionId)?.actions?.setView(view)
  if (view === VIEW_ID) collapseLegacySidebar()
}

function collapseLegacySidebar() {
  const sidebar = applyCtx?.get('sidebarRight')
  const active = sidebar?.active()
  if (active?.kind === 'cam-workbench') sidebar.close(active.id)
  if (sidebar?.isExpanded()) sidebar.toggleExpanded()
}

function BenchHeaderButton({ sessionId }) {
  useEffect(() => {
    const controller = new AbortController()
    let timer
    const check = async () => {
      try {
        const store = conversationStore(sessionId)
        if (!store || store.getSnapshot().view !== null) return
        const response = await fetch(`${INPUTS_API}/${encodeURIComponent(sessionId)}/files`, { signal: controller.signal })
        if (!response.ok) return
        const body = await response.json()
        if (!controller.signal.aborted && store.getSnapshot().view === null && body.files?.some(file => file.available !== false && /\.prt$/i.test(file.name))) openView(sessionId, VIEW_ID)
      } catch { /* Keep manual navigation available if input discovery is unavailable. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(check, 3000) }
    }
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId])
  return h(Tooltip, { label: '打开加工工作台', delayMs: 500 },
    h(Button, {
      variant: 'ghost', size: 'sm', icon: h(IconGaugeOutlineRegular, { size: 14 }),
      onClick: () => openView(sessionId, VIEW_ID),
    }, '工作台'))
}

function sessionInput(sessionId) {
  const scope = applyCtx?.get('sessions')?.scope(sessionId)
  return scope?.get('conversation')?.input.for(scope)
}

function selectionClipboard(ref) {
  return `[CAM_SELECTION]\n${ref}\n[/CAM_SELECTION]`
}

async function addSelectionToDraft(sessionId, reference) {
  const input = sessionInput(sessionId)
  if (!input) throw new Error('原生输入框未就绪，请稍后重试')
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain') throw new Error('输入框正在提交或处理命令，请稍后添加引用')
  const ref = JSON.stringify({ session_id: sessionId, kind: reference.kind, path: reference.path,
    source_sha256: reference.source_sha256, geometry_sha256: reference.geometry_sha256, fids: reference.fids })
  if (state.occurrences.some(item => item.source === 'cam-selection' && item.ref === ref)) { input.focus(); return }
  // The native editor counts each chip as one detect character, not its clipboard expansion.
  const end = state.draft.length - state.occurrences.reduce((n, item) => n + item.length - 1, 0)
  const label = `${reference.fids.slice(0, 3).join('、')}${reference.fids.length > 3 ? ` 等 ${reference.fids.length} 面` : ''} · ${reference.source_sha256.slice(0, 8)}`
  if (!input.insertReference({ source: 'cam-selection', ref, label, appearance: 'file', clipboardText: selectionClipboard(ref) }, { start: end, end, draftRev: state.draftRev })) throw new Error('草稿已变更，请重新添加引用')
  input.focus()
}

function CapabilityPlaceholder({ title, children }) {
  return h('section', { className: 'wb-placeholder' }, h('h3', null, title), h('p', null, children), h('small', null, '功能待接入 · 不参与加工放行'))
}

function AgentPanel({ sessionId }) {
  const [state, setState] = useState({ running: false, streaming: false, text: '' })
  useEffect(() => {
    const sessions = applyCtx?.get('sessions')
    const source = applyCtx?.get('uiConversation')?.binding(sessionId).target('chat')
    const sync = () => {
      const chat = source?.getSnapshot()?.legacy
      const latest = chat?.partial ?? [...(chat?.nodes ?? [])].reverse().find(node => node.kind === 'assistant')
      setState({ running: sessions?.list.getSnapshot().byId[sessionId]?.running === true, streaming: Boolean(chat?.partial),
        text: (latest?.blocks ?? []).filter(block => block.kind === 'text').map(block => block.text).join('\n') })
    }
    const disposeConversation = source?.subscribe(sync)
    sync()
    const disposeSessions = sessions?.list.subscribe(sync)
    return () => { disposeConversation?.(); disposeSessions?.() }
  }, [sessionId])
  return h('section', { className: 'wb-agent', 'aria-label': 'Agent 当前响应' },
    h('header', null, h('strong', null, 'Agent'), h('span', { role: 'status' }, state.running ? '会话执行中 · 详细进度见加工记录' : '等待指令'),
      h(Button, { onClick: () => openView(sessionId, 'chat') }, '查看对话')),
    h('details', { open: state.streaming }, h('summary', null, state.streaming ? '公开回复生成中' : '最新公开回复'), h('div', { className: 'wb-response' }, state.text || (state.streaming ? '正在等待公开回复…' : '暂无公开回复。'))),
    h('p', { className: 'wb-hint' }, '使用下方原生输入框提问。选面可添加为版本化引用，发送时重新核对；引用不是加工授权。'))
}

function WorkbenchView({ sessionId }) {
  useEffect(() => { collapseLegacySidebar() }, [sessionId])
  const [left, setLeft] = useState(true), [right, setRight] = useState(false), [stage, setStage] = useState('view')
  const Preview = previewService()?.View
  useEffect(() => previewService()?.subscribe(sessionId, () => setStage('view')), [sessionId])
  return h('div', { className: 'wb-main' },
    h('header', { className: 'wb-main-head' }, h('strong', null, '加工工作台'), h('span', null, '首期界面 · 沿用现有执行审批'),
      h(Button, { onClick: () => setLeft(!left), 'aria-pressed': left }, '输入与加工'),
      h(Button, { onClick: () => setRight(!right), 'aria-pressed': right }, '检视面板')),
    h('nav', { className: 'wb-tabs', 'aria-label': '工作台内容' },
      [['view', '模型 / 图纸 / 文档'], ['confirm', '确认向导'], ['operations', '工序表']].map(([id, label]) => h('button', {
        type: 'button', key: id, className: stage === id ? 'wb-tab active' : 'wb-tab', 'aria-pressed': stage === id, onClick: () => setStage(id),
      }, label))),
    h('div', { className: 'wb-scene' },
      left && h('aside', { className: 'wb-left', 'aria-label': '输入与加工记录' }, h(WorkbenchTab, { sessionId })),
      h('main', { className: 'wb-canvas' },
        h('div', { className: 'wb-preview-stage', hidden: stage !== 'view' }, Preview ? h(Preview, { sessionId, embedded: true, onReference: reference => addSelectionToDraft(sessionId, reference) }) : h(CapabilityPlaceholder, { title: '文件预览未加载' }, '请启用内容预览插件。')),
        stage === 'confirm' && h(CapabilityPlaceholder, { title: '动态确认向导' }, '将从 PRT、DWG 和加工要求生成缺项、冲突及有依据的推荐。目前请在下方输入框补充要求，仍使用现有审批。'),
        stage === 'operations' && h(CapabilityPlaceholder, { title: '结构化工序表' }, '正式工序草案、依赖和版本编辑待接入。现有执行工序与真实结果可在左侧“加工”查看。')),
      right && h('aside', { className: 'wb-inspector', 'aria-label': '对象检视' }, h(CapabilityPlaceholder, { title: '对象与加工中心' }, '版本化面引用、工序参数编辑与加工中心摘要待接入。模型属性与临时选面仍可使用查看器已有工具。'))),
    h(AgentPanel, { sessionId }))
}

function apply(ctx) {
  applyCtx = ctx
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-ui-workbench', '')
    style.textContent = benchCss
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-workbench: stylesheet')

  ctx.effect(() => ctx.get('inputTriggers').registerSource({
    trigger: '@', name: 'cam-selection', candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: selectionClipboard,
      async serialize(ref, signal) {
        const reference = JSON.parse(ref)
        const checkSession = () => { if (ctx.get('sidebarRight').mounted.getSnapshot() !== reference.session_id) throw new Error('选面引用不属于当前会话，请重新选面') }
        checkSession()
        const query = new URLSearchParams({ path: reference.path, sha: reference.source_sha256, geometry: reference.geometry_sha256, fids: reference.fids.join(',') })
        const response = await fetch(`/camind/api/models/sessions/${encodeURIComponent(reference.session_id)}/selection?${query}`, { signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.message || `引用核对失败：HTTP ${response.status}`)
        checkSession()
        return `${selectionClipboard(JSON.stringify({ ...body, session_id: reference.session_id }))}\n请用 read_model_selection 核对引用，再结合问题回答；精确量测需 NX。`
      },
    },
    openReference({ sessionId }, { ref }) {
      const reference = JSON.parse(ref)
      if (reference.session_id !== sessionId) return false
      previewService()?.preview(sessionId, reference.path)
      return true
    },
  }), 'ui-workbench: native selection references')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: VIEW_ID, order: -10, label: () => '工作台',
    inject: sessionId => ({ sessionId }),
  }, WorkbenchView))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench',
    order: 29,
    inject: sessionId => ({ sessionId }),
  }, BenchHeaderButton))
}

exports.name = 'ui-workbench-client'
exports.inject = ['slots', 'sessions', 'uiConversation', 'filePreview', 'sidebarRight', 'conversation', 'inputTriggers']
exports.apply = apply

return module.exports; } });
