// dsh renderer seat: verified geometry buffers feed the migrated TS GeomView.
import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { GeomView } from './viewer/geom_view.ts'
import { Mesh, Edges, parseManifest, StandardView } from './core/index.ts'
const h = React.createElement
const MAX = 128 * 1024 * 1024
function endpoint(sessionId: string, path: string) {
  return `/camind/api/models/sessions/${encodeURIComponent(sessionId)}/model?path=${encodeURIComponent(path)}`
}
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json()
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`)
  return body
}
// Count while streaming, before concatenation; gzip bombs never allocate an unbounded output.
async function bounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX) throw new Error('模型数据超过 128 MiB')
      chunks.push(value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
async function loadEntry(base: string, entry: any, signal: AbortSignal) {
  const split = base.indexOf('?')
  const response = await fetch(`${base.slice(0, split)}/${encodeURIComponent(entry.name)}${base.slice(split)}`, { signal })
  if (!response.ok || !response.body) throw new Error(`网格下载失败：HTTP ${response.status}`)
  const raw = await bounded(response.body)
  if (raw.length !== entry.bytes) throw new Error('网格长度与清单不符')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource)), x => x.toString(16).padStart(2, '0')).join('')
  if (digest !== entry.sha256) throw new Error('网格 SHA256 校验失败')
  return entry.encoding === 'gzip' ? bounded(new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))) : raw
}
export function ModelViewer({ sessionId, path }: { sessionId: string; path: string }) {
  const canvas = useRef<HTMLCanvasElement>(null), view = useRef<GeomView | null>(null)
  const [state, setState] = useState<any>({ state: 'loading' })
  const [error, setError] = useState(''), [face, setFace] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>, observer: ResizeObserver | undefined
    setError(''); setFace(''); setState({ state: 'loading' })
    const base = endpoint(sessionId, path)
    async function poll() {
      try {
        const next = await json(base, { signal: controller.signal })
        if (controller.signal.aborted) return
        setState(next)
        if (next.state === 'running') { timer = setTimeout(poll, 1500); return }
        if (next.state === 'error') throw new Error(next.message)
        if (next.state !== 'ready') return
        const manifest = parseManifest(JSON.stringify(next.manifest))
        const meshEntry = manifest.files.find(f => f.role === 'mesh' && f.lod === 'fine')!
        const edgeEntry = manifest.files.find(f => f.role === 'edges')!
        const mesh = Mesh.parse(await loadEntry(base, meshEntry, controller.signal), meshEntry.name)
        const edges = Edges.parse(await loadEntry(base, edgeEntry, controller.signal), manifest.faceCount, edgeEntry.name)
        if (mesh.faceCount() !== manifest.faceCount || mesh.lod() !== 1 || edges.edgeCount() !== manifest.edgeCount) throw new Error('模型计数与清单不符')
        if (controller.signal.aborted || !canvas.current) return
        const renderer = GeomView.create(canvas.current)
        if (!renderer) throw new Error('当前设备不支持 WebGL2')
        view.current = renderer
        renderer.callbacks.renderingFailed = setError
        renderer.callbacks.faceClicked = subject => setFace(`${subject.fid} · ${subject.surfaceType} · ${subject.areaMm2.toFixed(2)} mm²`)
        renderer.setPart(manifest.partRef, next.faces, manifest.bodies ?? [])
        renderer.setOriginOffset(manifest.originOffset as [number, number, number])
        renderer.setMesh(mesh); renderer.setEdges(edges)
        observer = new ResizeObserver(() => renderer.requestRender())
        observer.observe(canvas.current)
      } catch (e: any) { if (!controller.signal.aborted) setError(e.message) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer); observer?.disconnect(); view.current?.dispose(); view.current = null }
  }, [sessionId, path, revision])
  const prepare = async () => {
    setError(''); setState({ state: 'running', stage: '检查 NX 状态' })
    try { await json(`${endpoint(sessionId, path)}&confirm=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setRevision(x => x + 1) }
    catch (e: any) { setError(e.message) }
  }
  const ready = state.state === 'ready' && !error
  return h('div', { className: 'cmv' },
    h('div', { className: 'cmv-tools' },
      h(Button, { onClick: () => view.current?.fitView(), disabled: !ready }, '适配'),
      h(Button, { onClick: () => view.current?.setStandardView(StandardView.Iso), disabled: !ready }, '等轴'),
      h(Button, { onClick: () => view.current?.setStandardView(StandardView.Top), disabled: !ready }, '俯视'),
      h(Button, { onClick: () => { const v = view.current; if (v) v.setEdgesVisible(!v.edgesVisible()) }, disabled: !ready }, '边线'),
      ready ? h('span', null, `${state.faces.length} 面 · ${state.triangles.toLocaleString()} 三角片 · mm`) : null),
    h('div', { className: 'cmv-stage' },
      h('canvas', { ref: canvas, onContextMenu: (e: any) => e.preventDefault(), 'aria-label': 'PRT 三维模型：左键旋转，右键平移，滚轮缩放，单击选面' }),
      error ? h('div', { className: 'cmv-message', role: 'alert' }, error) : null,
      !error && !ready ? h('div', { className: 'cmv-message' },
        state.state === 'missing' ? h(React.Fragment, null,
          h('p', null, '尚未生成三维预览。导出会在 NX 打开独立副本并写入面标识，源文件不变；标记副本可能留在 NX 会话中。'),
          h(Button, { onClick: prepare }, '确认并生成三维预览')) : (state.stage || '正在加载三维模型…')) : null),
    h('div', { className: 'cmv-foot' }, face || '左键旋转 · 右键 / Shift 平移 · 滚轮缩放 · 单击选面 · 双击适配'),
    state.manifest?.warnings?.length ? h('div', { className: 'cmv-foot' }, `导出告警：${JSON.stringify(state.manifest.warnings)}`) : null)
}
export const name = 'camind-ui-model-viewer'
export const inject = ['slots']
export function apply(ctx: any) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = '[data-phase]:has(.cmv) [data-composer-seat]{display:none}.cmv{flex:1;min-height:0;display:flex;flex-direction:column}.cmv-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.cmv-tools span,.cmv-foot{font-size:12px;color:var(--dsw-alias-label-secondary)}.cmv-stage{position:relative;flex:1;min-height:240px;background:#1b1e24}.cmv-stage canvas{position:absolute;width:100%;height:100%;touch-action:none}.cmv-message{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:#eee;text-align:center;font-size:13px}.cmv-foot{padding:6px 12px}'
    document.head.append(style)
    return () => style.remove()
  })
  ctx.slots.inject('cam.model.preview', () => ctx.slots.register({ name: 'cam.model.preview', key: 'model-viewer' }, ModelViewer))
}
