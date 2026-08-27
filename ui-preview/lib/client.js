// camind-ui-preview browser bundle — hand-written, no build step.
// Session content preview, extracted from ui-shell (2026-08-26, ui-shell diet):
//  1. Host route client: GET /camind/api/preview/sessions/<id>/file (JSON
//     description or raw bytes with raw=1), same discipline as the old
//     ui-shell route it replaces.
//  2. "预览" conversation view (id preview, order 20, after 对话/轨迹): the
//     preview target lives in this bundle's store (single latest target per
//     browser, tagged with sessionId; other sessions' tabs show an empty hint).
//     Two target kinds: `path` (workspace/upload:// ref, fetched via the Host
//     route) and `content` (caller already holds the text — e.g. an NC program
//     extracted by tool-cam's delivery route; rendered straight from memory).
//  3. `filePreview` cordis service: other plugins' preview entries (ui-shell
//     workbench, CAM runs, upload lists) call preview(sessionId, path) or
//     previewContent(sessionId, name, content), which stores the target AND
//     switches the official conversation view to this tab. Tab switching rides
//     the slots service instance's internal hostFace().storeOf() — 0.1.1-rc.2
//     exposes no public API for it; the call is fully defensive (failure = no
//     switch, the tab itself keeps working).
//  4. NC toolpath: this bundle declares the keyed slot `cam.nc.preview`
//     (scope root, moved from ui-shell) on the view registration; .nc targets
//     render through its `toolpath-viewer` entry (camind-ui-toolpath-viewer)
//     when registered, falling back to plain text otherwise.
// Markdown rides MarkdownText from the official primitives seed. Styles are
// scoped and token-driven (--dsw-alias-*) so the view follows shell themes and
// stays independent of ui-shell's stylesheet.
window.__ModuleLoader__.load({ id: 'camind-ui-preview', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useEffect, useState, useSyncExternalStore } = React
const { MarkdownText } = require('@deepseek-ai/dsh-client-ui-primitives')

// --- stylesheet (dsw-alias tokens; no ui-shell vars) ----------------------------

const previewCss = `
.campv-view { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.campv-view *, .campv-view *::before, .campv-view *::after { box-sizing: border-box; }
.campv-chrome { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.campv-head {
  flex: none; min-height: 44px; display: flex; align-items: center; gap: 12px;
  padding: 8px 10px 8px 16px; border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.campv-head-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.campv-head-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.campv-head-text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.campv-head-actions { flex: none; display: flex; align-items: center; gap: 4px; }
.campv-head-actions a {
  flex: none; display: inline-flex; align-items: center; justify-content: center; height: 28px;
  padding: 0 8px; border-radius: 8px; color: var(--dsw-alias-state-business-primary);
  font-size: 12px; text-decoration: none;
}
.campv-head-actions a:hover { background: var(--dsw-alias-interactive-bg-hover); }
.campv-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.campv-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.campv-empty, .campv-error { padding: 28px 16px; font-size: 13px; line-height: 1.6; text-align: center; }
.campv-empty { color: var(--dsw-alias-label-tertiary); }
.campv-error { color: var(--dsw-alias-state-error-primary); }
.campv-text {
  flex: 1; min-height: 0; margin: 0; padding: 16px 20px; overflow: auto;
  background: var(--dsw-alias-markdown-code-block); color: var(--dsw-alias-label-primary);
  font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre;
}
.campv-markdown { flex: 1; min-height: 0; overflow: auto; padding: 28px clamp(24px, 4vw, 56px) 64px; }
.campv-markdown > * > :first-child { margin-top: 0; }
.campv-media { flex: 1; min-height: 0; display: grid; place-items: center; padding: 12px; overflow: auto; }
.campv-media img { max-width: 100%; max-height: 100%; object-fit: contain; }
.campv-pdf { flex: 1; min-height: 0; width: 100%; border: 0; background: #fff; }
.campv-binary { padding: 48px 24px; color: var(--dsw-alias-label-secondary); font-size: 13px; text-align: center; }
.campv-binary a { color: var(--dsw-alias-state-business-primary); }
.campv-truncated { flex: none; padding: 8px 16px; border-top: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-state-warn-label); font-size: 12px; }
/* Hide the composer while the preview tab is the active view: the official
   conversation root carries [data-phase] and the composer seat
   [data-composer-seat] (hash-free anchors, same trick as ui-home's HeroShell
   hiding). :has() self-scopes the rule — switching tabs unmounts .campv-view
   and the composer returns. Upstream DOM changes need a recheck (upgrade SOP). */
[data-phase]:has(.campv-view) [data-composer-seat] { display: none; }
/* Wide-table hover jitter fix: official MarkdownText swaps overflow-x hidden
   (resting, padding-bottom = scrollbar width) → auto (hover, padding 0). That
   assumes classic scrollbars consume layout height; on macOS overlay bars they
   don't, so the resting padding is a bare placeholder and every hover toggles
   it — shifting everything below the table (~8px). Force the bar always-on in
   the preview: overlay bars paint nothing at rest, classic bars are already
   laid out — hovering no longer moves content on either platform. (Scoped to
   the preview view; chat markdown is upstream's own domain.) */
.campv-view .campv-markdown .md-table-wide,
.campv-view .campv-markdown .md-table-wide:hover,
.campv-view .campv-markdown .md-table-wide:focus-visible {
  overflow-x: auto;
  padding-bottom: 0;
}
`

if (typeof document !== 'undefined' && document.querySelector('style[data-campv]') === null) {
  const tag = document.createElement('style')
  tag.dataset.campv = ''
  tag.textContent = previewCss
  document.head.appendChild(tag)
}

// --- preview target store ---------------------------------------------------------
// target: { kind: 'path', sessionId, path } | { kind: 'content', sessionId, name, content }
let snapshot = { target: undefined }
const listeners = new Set()
function publish(next) {
  snapshot = next
  for (const listener of listeners) listener()
}
function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function getSnapshot() {
  return snapshot
}

// --- Host route client --------------------------------------------------------------

function fileUrl(sessionId, path) {
  return `/camind/api/preview/sessions/${encodeURIComponent(sessionId)}/file`
}

async function fetchPreview(sessionId, path) {
  const response = await fetch(`${fileUrl(sessionId)}?path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`)
  return body
}

function rawFileUrl(sessionId, path) {
  return `${fileUrl(sessionId)}?raw=1&path=${encodeURIComponent(path)}`
}

// --- tab activation (internal surface, defensive; see header note) --------------------

let slotsRef = null

function activateConversationView(sessionId, viewId) {
  try {
    const slots = slotsRef
    if (!slots || typeof slots.entriesOfSlot !== 'function' || typeof slots.hostFace !== 'function') return
    const chatEntry = slots.entriesOfSlot('conversation.view').find((item) => item.options?.id === 'chat')
    if (chatEntry === undefined) return
    slots.hostFace().storeOf?.(chatEntry, sessionId)?.actions?.setView?.(viewId)
  } catch {
    // Degradation path: stay on the current view; the preview tab still works.
  }
}

// --- NC toolpath viewer (keyed slot cam.nc.preview, declared below on the view entry) ---

function isNcName(name) {
  return String(name ?? '').toLowerCase().endsWith('.nc')
}

function useToolpathViewer() {
  const [component, setComponent] = useState(null)
  useEffect(() => {
    const slots = slotsRef
    if (!slots || typeof slots.entriesOfSlot !== 'function') return
    const update = () => {
      const entry = slots.entriesOfSlot('cam.nc.preview').find((item) => item.options?.key === 'toolpath-viewer')
      setComponent(() => entry?.component ?? null)
    }
    update()
    return slots.subscribe('cam.nc.preview', update)
  }, [])
  return component
}

// Text body with the NC hook: .nc targets go through the toolpath viewer when
// registered (plain text fallback otherwise).
function NcOrText({ name, text }) {
  const Viewer = useToolpathViewer()
  if (Viewer !== null && isNcName(name)) {
    return h('div', { className: 'campv-pane' }, h(Viewer, { content: text ?? '', fileName: name }))
  }
  return h('div', { className: 'campv-pane' }, h('pre', { className: 'campv-text' }, h('code', null, text)))
}

function useBlobUrl(text) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (text === undefined) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    setUrl(next)
    return () => {
      URL.revokeObjectURL(next)
      setUrl(null)
    }
  }, [text])
  return url
}

// --- preview body -------------------------------------------------------------------

function isMarkdownPreview(preview) {
  if (preview.mediaType === 'text/markdown' || preview.mediaType === 'text/x-markdown') return true
  const name = String(preview.name ?? '').toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown')
}

function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileNameFromPath(path) {
  const parts = String(path).split(/[\\/]/)
  return parts[parts.length - 1] || String(path)
}

function useFilePreview(sessionId, path) {
  const [preview, setPreview] = useState(undefined)
  const [error, setError] = useState(undefined)
  useEffect(() => {
    if (!sessionId || !path) {
      setPreview(undefined)
      setError(undefined)
      return
    }
    let cancelled = false
    setPreview(undefined)
    setError(undefined)
    fetchPreview(sessionId, path).then((next) => {
      if (!cancelled) setPreview(next)
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [path, sessionId])
  return { preview, error }
}

// Path-mode .nc that an older Host still reports as binary: fetch raw bytes
// and hand them to the toolpath viewer (current Host maps .nc as text).
function NcRawBody({ sessionId, preview }) {
  const [text, setText] = useState(undefined)
  const [fetchError, setFetchError] = useState(undefined)
  useEffect(() => {
    let cancelled = false
    setText(undefined)
    setFetchError(undefined)
    fetch(rawFileUrl(sessionId, preview.path)).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.text()
      if (!cancelled) setText(body)
    }).catch((err) => {
      if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [preview.path, sessionId])
  if (fetchError) return h('div', { className: 'campv-error' }, fetchError)
  if (text === undefined) return h('div', { className: 'campv-empty' }, '正在读取文件…')
  return h(NcOrText, { name: preview.name, text })
}

function FilePreviewBody({ sessionId, preview, error }) {
  if (error) return h('div', { className: 'campv-error' }, error)
  if (!preview) return h('div', { className: 'campv-empty' }, '正在读取文件…')
  const raw = rawFileUrl(sessionId, preview.path)
  const ncName = isNcName(preview.name)
  return h('div', { className: 'campv-pane' },
    preview.kind === 'text' && isMarkdownPreview(preview)
      ? h('div', { className: 'campv-markdown' }, h(MarkdownText, { text: preview.text ?? '' }))
      : null,
    preview.kind === 'text' && !isMarkdownPreview(preview)
      ? h(NcOrText, { name: preview.name, text: preview.text })
      : null,
    preview.kind === 'image'
      ? h('div', { className: 'campv-media' }, h('img', { src: raw, alt: preview.name }))
      : null,
    preview.kind === 'pdf'
      ? h('iframe', { className: 'campv-pdf', src: raw, title: preview.name })
      : null,
    preview.kind === 'binary' && ncName
      ? h(NcRawBody, { sessionId, preview })
      : null,
    preview.kind === 'binary' && !ncName
      ? h('div', { className: 'campv-binary' },
        h('p', null, '该文件不能以内联文本方式预览。'),
        h('a', { href: raw, target: '_blank', rel: 'noreferrer' }, '在新窗口打开'))
      : null,
    preview.truncated ? h('div', { className: 'campv-truncated' }, '文件较大，仅显示前 1 MB。') : null)
}

// --- the view -------------------------------------------------------------------------

function FilePreviewView({ sessionId }) {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  const target = snap.target?.sessionId === sessionId ? snap.target : undefined
  const isPath = target?.kind === 'path'
  const { preview, error } = useFilePreview(isPath ? target.sessionId : undefined, isPath ? target.path : undefined)
  const blobUrl = useBlobUrl(target?.kind === 'content' ? target.content : undefined)

  if (target === undefined) {
    return h('div', { className: 'campv-view' },
      h('div', { className: 'campv-empty' }, '尚未预览文件——在「交付物」「加工」页签或输入区文件列表点「预览」，内容显示在这里。'))
  }

  const contentMode = target.kind === 'content'
  const title = contentMode ? target.name : fileNameFromPath(preview?.path || target.path)
  const displayPath = contentMode ? target.name : (preview?.path ?? target.path)
  const relocated = !contentMode && Boolean(preview && String(preview.path).replaceAll('\\', '/') !== String(target.path).replaceAll('\\', '/'))
  const meta = contentMode
    ? `${bytesLabel(new Blob([target.content]).size)} · 内容预览`
    : preview
      ? `${relocated ? '已发布 · ' : ''}${preview.path} · ${bytesLabel(preview.size)} · ${preview.mediaType}`
      : target.path
  const openUrl = contentMode ? blobUrl : rawFileUrl(target.sessionId, displayPath)

  return h('div', { className: 'campv-view' },
    h('div', { className: 'campv-chrome' },
      h('header', { className: 'campv-head' },
        h('div', { className: 'campv-head-text' },
          h('strong', { title: displayPath }, title),
          h('span', { title: meta }, meta)),
        h('div', { className: 'campv-head-actions' },
          openUrl !== null
            ? h('a', { href: openUrl, target: '_blank', rel: 'noreferrer' }, '新窗口打开')
            : null)),
      h('div', { className: 'campv-stage' },
        contentMode
          ? h(NcOrText, { name: target.name, text: target.content })
          : h(FilePreviewBody, { sessionId: target.sessionId, preview, error }))))
}

// --- registration ------------------------------------------------------------------------

function apply(ctx) {
  // The activation helper reaches the slots service instance (which carries the
  // internal hostFace); stashed module-locally for the filePreview service.
  slotsRef = ctx.slots

  ctx.provide('filePreview', {
    // 路径模式：预览会话工作区 / upload:// 引用（经 Host 路由取数）。
    preview(sessionId, path) {
      const id = String(sessionId ?? '')
      const target = String(path ?? '')
      if (!id || !target) return
      publish({ target: { kind: 'path', sessionId: id, path: target } })
      activateConversationView(id, 'preview')
    },
    // 内容模式：调用方已持有文本（如 tool-cam delivery 路由开包取出的 NC），
    // 不经 Host 路由，直接渲染；.nc 走刀路查看器席位。
    previewContent(sessionId, name, content) {
      const id = String(sessionId ?? '')
      const fileName = String(name ?? '')
      if (!id || !fileName) return
      publish({ target: { kind: 'content', sessionId: id, name: fileName, content: String(content ?? '') } })
      activateConversationView(id, 'preview')
    },
  })

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'preview',
    order: 20,
    label: () => '预览',
    // NC 刀路查看器席位（原 ui-shell root entry，随「查看刀路」迁入预览插件）：
    // camind-ui-toolpath-viewer 经 inject 注册 key toolpath-viewer，本插件
    // 直读注册表渲染（owner props { content, fileName }）。
    children: { 'cam.nc.preview': { kind: 'keyed', scope: 'root' } },
    inject: (sessionId) => ({ sessionId }),
  }, FilePreviewView))
}

exports.name = 'camind-ui-preview'
exports.inject = ['slots']
exports.apply = apply

return module.exports; } });
