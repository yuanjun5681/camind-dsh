// Unified WebGL2 machining preview: one scene, independent visibility/selection/playback, no CAM execution.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { GeomView } from './viewer/geom_view.ts'
import { Mesh, Edges, parseManifest, Projection, StandardView, meshBounds, RigidTransform, v3 } from './core/index.ts'
import { ModelControls } from './controls.ts'
import { makeProgram, atTime, buildScene, programBounds } from './scene.ts'
import type { Program } from './scene.ts'
import { viewerCss } from './styles.ts'
const h = React.createElement
const MAX = 128 * 1024 * 1024
type SelectionReference = { kind: 'faces'; path: string; source_sha256: string; geometry_sha256: string; fids: string[] }
type ReferenceHandler = (reference: SelectionReference) => Promise<void>
function base(sessionId: string) { return `/camind/api/models/sessions/${encodeURIComponent(sessionId)}` }
function endpoint(sessionId: string, path: string) { return `${base(sessionId)}/model?path=${encodeURIComponent(path)}` }
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init), body = await response.json()
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`)
  return body
}
async function bounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) throw new Error('模型数据超过 128 MiB'); chunks.push(value) } }
  finally { await reader.cancel(); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
async function loadEntry(url: string, entry: any, signal: AbortSignal) {
  const split = url.indexOf('?')
  const response = await fetch(`${url.slice(0, split)}/${encodeURIComponent(entry.name)}${url.slice(split)}`, { signal })
  if (!response.ok || !response.body) throw new Error(`网格下载失败：HTTP ${response.status}`)
  const raw = await bounded(response.body)
  if (raw.length !== entry.bytes) throw new Error('网格长度与清单不符')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource)), x => x.toString(16).padStart(2, '0')).join('')
  if (digest !== entry.sha256) throw new Error('网格 SHA256 校验失败')
  return entry.encoding === 'gzip' ? bounded(new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))) : raw
}
function SourceDrawer({ program, line, follow, onFollow, onSeek, onClose }: { program: Program; line: number; follow: boolean; onFollow: (v: boolean) => void; onSeek: (line: number) => void; onClose: () => void }) {
  const rows = useMemo(() => program.content.split('\n'), [program])
  const scroll = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0), [requested, setRequested] = useState('')
  useEffect(() => { setTop(0); if (scroll.current) scroll.current.scrollTop = 0 }, [program])
  useEffect(() => { if (follow && scroll.current) scroll.current.scrollTop = Math.max(0, (line - 5) * 20) }, [line, follow, program])
  const start = Math.max(0, Math.floor(top / 20) - 10), end = Math.min(rows.length, start + 100)
  return h('aside', { className: 'cmv-source', 'aria-label': 'NC源码' },
    h('div', { className: 'cmv-source-head' }, h('strong', null, program.file), h(Button, { onClick: () => onFollow(!follow), 'aria-pressed': follow }, '跟随刀位'), h(Button, { onClick: onClose }, '关闭源码'),
      h('form', { onSubmit: (e: React.FormEvent) => { e.preventDefault(); const n = Number(requested); if (Number.isInteger(n) && n >= 1 && n <= rows.length) { onSeek(n); if (scroll.current) scroll.current.scrollTop = Math.max(0, (n - 5) * 20) } } }, h(Input, { type: 'number', min: 1, max: rows.length, 'aria-label': '源码行号', placeholder: '行号', value: requested, onChange: (e: any) => setRequested(e.target.value) }), h(Button, { type: 'submit' }, '定位'))),
    h('div', { ref: scroll, className: 'cmv-source-lines', tabIndex: 0, onScroll: (e: any) => setTop(e.currentTarget.scrollTop), onWheel: () => onFollow(false), onPointerDown: () => onFollow(false), onKeyDown: (e: any) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) onFollow(false) } },
      h('div', { style: { height: rows.length * 20, position: 'relative', minWidth: 'max-content' } }, h('div', { style: { position: 'absolute', top: start * 20, minWidth: '100%' } }, rows.slice(start, end).map((text, i) => h('button', { key: start + i, type: 'button', className: 'cmv-source-line', 'aria-current': start + i + 1 === line, onClick: () => onSeek(start + i + 1) }, `${String(start + i + 1).padStart(5)}  ${text}`))))))
}
function SceneView({ sessionId, path, programs, expectedSha, notice, contextTools, onReference }: { sessionId?: string; path?: string; programs: Program[]; expectedSha?: string; notice?: string; contextTools?: React.ReactNode; onReference?: ReferenceHandler }) {
  const canvas = useRef<HTMLCanvasElement>(null), marker = useRef<HTMLDivElement>(null), axes = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<GeomView | null>(null), [state, setState] = useState<any>({ state: 'loading' }), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const [activeId, setActive] = useState(''), [visible, setVisible] = useState<string[]>([]), [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1)
  const [selecting, setSelecting] = useState(false), [source, setSource] = useState(false), [details, setDetails] = useState(false), [follow, setFollow] = useState(true), [layers, setLayers] = useState(false), [expanded, setExpanded] = useState(false)
  const [projection, setProjection] = useState<number>(Projection.Orthographic)
  const [display, setDisplay] = useState({ model: true, edges: true, rapid: true, cutting: true, future: true, through: false, axes: false })
  const active = programs.find(p => p.id === activeId)
  const position = active ? atTime(active, time) : null
  const scene = useMemo(() => buildScene(programs, visible, activeId, display.rapid, display.cutting), [programs, visible, activeId, display.rapid, display.cutting])
  const markerPoint = useRef<number[] | null>(null)
  markerPoint.current = active && visible.includes(active.id) && position?.point ? (() => { const p = active.toPackage.apply(v3(...position.point as [number, number, number])); return [p.x, p.y, p.z] })() : null
  useEffect(() => { setActive(programs[0]?.id ?? ''); setVisible(programs.map(p => p.id)); setTime(programs[0]?.duration ?? 0); setPlaying(false); setSource(false) }, [programs])
  useEffect(() => {
    const controller = new AbortController()
    let renderer: GeomView | null = null, observer: ResizeObserver | undefined, timer: ReturnType<typeof setTimeout>
    setView(null); setError(''); setState({ state: 'loading' })
    async function load() {
      try {
        let next: any = { state: 'ready' }, mesh: Mesh | undefined, edges: Edges | undefined, manifest: ReturnType<typeof parseManifest> | undefined
        if (path && sessionId) {
          const url = endpoint(sessionId, path)
          next = await json(url, { signal: controller.signal })
          if (controller.signal.aborted) return
          if (next.state !== 'ready') { setState(next); if (next.state === 'running') timer = setTimeout(load, 1500); return }
          manifest = parseManifest(JSON.stringify(next.manifest))
          const m = manifest.files.find(f => f.role === 'mesh' && f.lod === 'fine')!, e = manifest.files.find(f => f.role === 'edges')!
          mesh = Mesh.parse(await loadEntry(url, m, controller.signal), m.name)
          edges = Edges.parse(await loadEntry(url, e, controller.signal), manifest.faceCount, e.name)
          if (mesh.faceCount() !== manifest.faceCount || mesh.lod() !== 1 || edges.edgeCount() !== manifest.edgeCount) throw new Error('模型计数与清单不符')
        }
        if (controller.signal.aborted || !canvas.current) return
        renderer = GeomView.create(canvas.current)
        if (!renderer) throw new Error('当前设备不支持 WebGL2；可从文件入口查看原始 NC 文本')
        renderer.callbacks.renderingFailed = setError
        if (manifest && mesh && edges) { renderer.setPart(manifest.partRef, next.faces, manifest.bodies ?? []); renderer.setOriginOffset(manifest.originOffset as [number, number, number]); renderer.setMesh(mesh); renderer.setEdges(edges) }
        observer = new ResizeObserver(() => renderer?.requestRender()); observer.observe(canvas.current)
        setState(next); setView(renderer); setProjection(Projection.Orthographic)
      } catch (e: any) { if (!controller.signal.aborted) setError(e.message) }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer); observer?.disconnect(); renderer?.dispose() }
  }, [sessionId, path, revision])
  useEffect(() => {
    if (!view) return
    if (expectedSha && state.sha !== expectedSha) { view.clearToolpath(); setError('加工批次与画布中的源模型版本不匹配'); return }
    const camera = view.getCamera(), target = { ...camera.target() }, distance = camera.distance(), yaw = camera.yaw(), pitch = camera.pitch()
    view.setStationTransform(new RigidTransform()); view.setToolpath(scene.geometry); view.setPlaybackRange(scene.activeStart, scene.activeEnd)
    // Pure-NC GeomView normally auto-fits on each path update; visibility/selection changes must not move the user's camera.
    if (view.hasRendered()) { camera.setTarget(target); camera.setDistance(distance); camera.setAngles(yaw, pitch) }
    view.callbacks.segmentClicked = index => {
      const range = scene.ranges.find(r => index >= r.start && index < r.end), p = programs.find(p => p.id === range?.id)
      if (!p) return
      setActive(p.id); setTime(p.times[scene.locals[index]]); setPlaying(false); setSource(true); setDetails(false); setFollow(true)
    }
    return () => { delete view.callbacks.segmentClicked }
  }, [view, scene, programs, expectedSha, state.sha])
  useEffect(() => {
    if (!view) return
    view.setPickMode(selecting ? 'face' : 'path'); view.setModelVisible(display.model); view.setEdgesVisible(display.model && display.edges)
    view.setToolpathOnTop(display.through); view.setFutureSegmentsVisible(display.future)
  }, [view, selecting, display])
  useEffect(() => {
    if (!view) return
    let lo = scene.activeStart, hi = scene.activeEnd
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (scene.locals[mid] < (position?.index ?? 0)) lo = mid + 1; else hi = mid }
    view.setPlayheadSegment(active && time >= active.duration ? scene.activeEnd : lo)
    view.requestRender()
  }, [view, scene, time, active])
  useEffect(() => {
    if (!view) return
    const drawMarker = () => {
      const element = marker.current, point = markerPoint.current
      if (!element || !point) { if (element) element.style.display = 'none'; return }
      const w = view.canvas.clientWidth, height = view.canvas.clientHeight, matrix = view.getCamera().viewProjection(w / Math.max(1, height))
      const values = [point[0], point[1], point[2], 1], clip = [0, 1, 2, 3].map(row => values.reduce((sum, v, k) => sum + matrix.at(row, k) * v, 0))
      const x = clip[0] / clip[3], y = clip[1] / clip[3], z = clip[2] / clip[3]
      element.style.display = clip[3] > 0 && Math.abs(x) <= 1 && Math.abs(y) <= 1 && Math.abs(z) <= 1 ? 'block' : 'none'
      element.style.left = `${(x + 1) * w / 2}px`; element.style.top = `${(1 - y) * height / 2}px`
      if (axes.current && active) {
        axes.current.style.display = display.axes ? 'block' : 'none'
        const length = view.getCamera().halfHeightAtTarget() * 0.18
        const project = (point: number[]) => {
          const p = active.toPackage.apply(v3(...point as [number, number, number])), values = [p.x, p.y, p.z, 1]
          const clip = [0, 1, 2, 3].map(row => values.reduce((sum, v, k) => sum + matrix.at(row, k) * v, 0))
          return [(clip[0] / clip[3] + 1) * w / 2, (1 - clip[1] / clip[3]) * height / 2]
        }
        const origin = project([0, 0, 0])
        axes.current.querySelectorAll('g').forEach((group, i) => {
          const end = project([0, 1, 2].map(k => k === i ? length : 0)), line = group.querySelector('line')!, label = group.querySelector('text')!
          for (const [name, value] of Object.entries({ x1: origin[0], y1: origin[1], x2: end[0], y2: end[1] })) line.setAttribute(name, String(value))
          label.setAttribute('x', String(end[0] + 4)); label.setAttribute('y', String(end[1]));
        })
      }
    }
    view.callbacks.frameRendered = drawMarker; view.requestRender()
    return () => { delete view.callbacks.frameRendered }
  }, [view, active, display.axes])
  useEffect(() => {
    if (!playing || !active) return
    let frame: number, previous = performance.now()
    const tick = (now: number) => { const delta = Math.min((now - previous) / 1000, 0.25) * speed; previous = now; setTime(t => Math.min(active.duration, t + delta)); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, active, speed])
  useEffect(() => { if (active && time >= active.duration) setPlaying(false) }, [time, active])
  const changeActive = (p: Program) => { setActive(p.id); setVisible(ids => ids.includes(p.id) ? ids : [...ids, p.id]); setPlaying(false); setTime(p.duration) }
  const togglePlay = () => { if (!active || !visible.includes(active.id) || !active.parsed.segments.length) return; if (time >= active.duration) setTime(0); setPlaying(value => !value) }
  const step = (direction: number) => { if (!active) return; setPlaying(false); const next = Math.max(0, Math.min(active.parsed.segments.length, (position?.index ?? 0) + direction)); setTime(active.times[next]) }
  const seekLine = (line: number) => { if (!active) return; const index = active.parsed.segments.findIndex(s => s.line >= line); setPlaying(false); if (index >= 0) setTime(active.times[index]) }
  const prepare = async () => {
    if (!sessionId || !path) return
    setError(''); setState({ state: 'running', stage: '检查 NX 状态' })
    try { await json(`${endpoint(sessionId, path)}&confirm=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setRevision(x => x + 1) } catch (e: any) { setError(e.message) }
  }
  // Viewing a PRT without a geometry package auto-starts the NX export once per
  // (session, source sha); the server-side preflight checks stay the real gate.
  const autoPrepare = useRef('')
  useEffect(() => {
    if (!sessionId || !path || error || state?.state !== 'missing') return
    const key = `${sessionId}/${state.sha}`
    if (autoPrepare.current === key) return
    autoPrepare.current = key
    void prepare()
  }, [state, sessionId, path, error])
  const ready = !!view && state.state === 'ready' && !error, line = active?.parsed.segments[position?.index ?? 0]?.line ?? 0
  const playingEnabled = ready && !!active?.parsed.segments.length && visible.includes(activeId)
  const alerts = active ? [...active.parsed.meta.warnings.map(text => ({ text, line: Number(text.match(/第\s*(\d+)\s*行/)?.[1] ?? 1) })), ...active.parsed.meta.skipped.slice(0, 20).map(s => ({ text: `第${s.line}行跳过：${s.reason}`, line: s.line }))] : []
  const keydown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setSelecting(false); setLayers(false); setSource(false); setDetails(false); setExpanded(false); return }
    if ((e.target as HTMLElement).tagName !== 'CANVAS') return
    if (e.code === 'Space') { e.preventDefault(); togglePlay() }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1) }
  }
  return h('div', { className: `cmv${expanded ? ' cmv-expanded' : ''}`, onKeyDown: keydown },
    h('div', { className: 'cmv-tools' }, contextTools,
      h('select', { 'aria-label': '标准视图', disabled: !ready, defaultValue: '', onChange: (e: any) => { if (e.target.value !== '') view?.setStandardView(Number(e.target.value) as any); e.target.value = '' } }, h('option', { value: '' }, '标准视图'), ...Object.entries(StandardView).map(([name, value], i) => h('option', { key: name, value }, ['等轴', '俯视', '仰视', '前视', '后视', '右视', '左视'][i]))),
      h('select', { 'aria-label': '投影方式', disabled: !ready, value: projection, onChange: (e: any) => { view?.setProjection(Number(e.target.value) as any); setProjection(Number(e.target.value)) } }, h('option', { value: Projection.Orthographic }, '正交'), h('option', { value: Projection.Perspective }, '透视')),
      h('select', { 'aria-label': '适配范围', disabled: !ready, defaultValue: '', onChange: (e: any) => { let bounds = e.target.value === 'model' && view?.meshOf() ? meshBounds(view.meshOf()!) : e.target.value === 'active' && active ? programBounds(active) : undefined;
        if (e.target.value === 'all' && display.axes && active && view) {
          const original = view.getCamera().sceneBounds(), origin = active.toPackage.apply(v3(0, 0, 0));
          bounds = { min: v3(Math.min(original.min.x, origin.x), Math.min(original.min.y, origin.y), Math.min(original.min.z, origin.z)), max: v3(Math.max(original.max.x, origin.x), Math.max(original.max.y, origin.y), Math.max(original.max.z, origin.z)) };
        }
        view?.fitView(bounds); e.target.value = '' } }, h('option', { value: '' }, '适配'), h('option', { value: 'all' }, '全部'), path ? h('option', { value: 'model' }, '模型') : null, active ? h('option', { value: 'active' }, '当前工序') : null),
      h(Button, { onClick: () => setLayers(v => !v), disabled: !ready, 'aria-expanded': layers }, '显示'),
      path ? h(Button, { onClick: () => { setSelecting(v => !v); setSource(false); setDetails(false); setPlaying(false) }, disabled: !ready, 'aria-pressed': selecting }, '选择面') : null,
      h(Button, { onClick: () => setExpanded(value => !value), disabled: !ready, 'aria-pressed': expanded }, expanded ? '退出扩大' : '扩大视区')),
    notice ? h('div', { className: 'cmv-note', role: 'status' }, notice) : null,
    h('div', { className: 'cmv-body' },
      programs.length > 1 || path && programs.length ? h('nav', { className: 'cmv-ops', 'aria-label': '工序导航' },
        h(Button, { disabled: !active, onClick: () => { setVisible(active ? [active.id] : []); setPlaying(false) } }, '仅当前'),
        h(Button, { disabled: !active, onClick: () => setVisible(programs.filter(p => p.station === active?.station).map(p => p.id)) }, '本工位全部'),
        ...[...new Set(programs.map(p => p.station))].map(station => h('section', { key: station }, h('strong', null, `工位 ${station}`), ...programs.filter(p => p.station === station).map(p => h('div', { key: p.id, className: 'cmv-op' }, h('input', { type: 'checkbox', 'aria-label': `显示 ${p.name}`, checked: visible.includes(p.id), onChange: (e: any) => { if (!e.target.checked && p.id === activeId) setPlaying(false); setVisible(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id)) } }), h('button', { type: 'button', 'aria-current': p.id === activeId, onClick: () => changeActive(p), title: p.file }, p.name)))))) : null,
      h('div', { className: 'cmv-stage' },
        h('canvas', { ref: canvas, tabIndex: 0, onContextMenu: (e: any) => e.preventDefault(), 'aria-label': '加工三维视区：左键旋转，右键或Shift平移，滚轮缩放，双击适配；空格播放，左右键单步' }),
        h('div', { ref: marker, className: 'cmv-marker', title: '程序刀位标记（不是刀具实体）' }),
        active ? h('svg', { ref: axes, className: 'cmv-axes', 'aria-label': `${active.station} 工位坐标轴`, style: { display: 'none' } }, ...['#f25c5c', '#70cf8e', '#4d9fff'].map((color, i) => h('g', { key: i }, h('line', { stroke: color, strokeWidth: 2 }), h('text', { fill: color, fontSize: 12 }, `${active.station} ${['X', 'Y', 'Z'][i]}`)))) : null,
        ready && active ? h('div', { className: 'cmv-hud' }, `${active.file} · 第${line}行\n${active.station} · ${active.parsed.meta.units}\n${position?.point ? position.point.map((v, i) => `${['X', 'Y', 'Z'][i]} ${v.toFixed(3)}`).join('  ') : '无运动段'}\nF ${active.parsed.segments[position?.index ?? 0]?.feed ?? '—'}`) : null,
        layers ? h('div', { className: 'cmv-layers', 'aria-label': '显示图层' }, ...Object.entries(display).filter(([key]) => path || !['model', 'edges'].includes(key)).map(([key, checked]) => h('label', { key }, h('input', { type: 'checkbox', checked, onChange: (e: any) => setDisplay(d => ({ ...d, [key]: e.target.checked })) }), ` ${{ model: '工件', edges: '边线', rapid: '快移（红）', cutting: '切削（蓝/青/琥珀）', future: '淡显未走轨迹', through: '刀路穿透显示', axes: '工位坐标轴' }[key]}`)), h(Button, { onClick: () => setLayers(false) }, '关闭显示设置')) : null,
        error ? h('div', { className: 'cmv-message', role: 'alert' }, error) : null,
        !error && !ready ? h('div', { className: 'cmv-message' }, state.state === 'missing'
          ? (autoPrepare.current === `${sessionId}/${state.sha}`
            ? h('p', null, '正在自动准备三维预览：NX 将打开独立标记副本，不覆盖原 PRT…')
            : h(React.Fragment, null, h('p', null, '尚未生成三维预览。NX 将打开独立标记副本，不覆盖原 PRT；成功后只关闭本次预览副本。'), h(Button, { variant: 'primary', onClick: prepare }, '确认并生成三维预览')))
          : state.state === 'error'
            ? h(React.Fragment, null, h('p', null, state.message), state.retryable
              ? h(Button, { variant: 'primary', onClick: prepare }, '重试生成三维预览')
              : h('p', null, '请核实 NX 执行状态、排除问题后重启服务再试。'))
            : state.message || state.stage || '正在加载…') : null),
      ready && selecting && view ? h(ModelControls, { view, onReference: onReference && sessionId && path ? async fids => {
        const query = new URLSearchParams({ path, sha: state.sha, geometry: state.geometry_sha256, fids: fids.join(',') })
        const reference = await json(`${base(sessionId)}/selection?${query}`)
        await onReference(reference)
      } : undefined }) : null,
      source && active ? h(SourceDrawer, { program: active, line, follow, onFollow: setFollow, onSeek: seekLine, onClose: () => setSource(false) }) : null,
      ready && details ? h('aside', { className: 'cmv-details', 'aria-label': '预览详情' }, h('strong', null, '预览详情'), h('pre', null, JSON.stringify({ source_sha256: state.sha ?? null, model_faces: state.faces?.length ?? null, model_triangles: state.triangles ?? null, operation: active?.name, nc_file: active?.file, nc_units: active?.parsed.meta.units, segments: active?.parsed.segments.length, estimate_seconds: active?.duration, coordinate_frame: path ? 'package_to_nc' : 'NC原始坐标', station: active?.station, part_to_nc: path ? active?.toPackage.inverse() : null, source_face: active?.fid ?? null }, null, 2)), h(Button, { onClick: () => setDetails(false) }, '关闭详情')) : null),
    h('div', { className: 'cmv-footer' }, h('span', null, active ? `${active.name} · ${active.station} · ${path ? '来源与对齐信息已校验' : 'NC原始坐标'}${display.through ? ' · 穿透显示' : ''}` : state.faces ? `${state.faces.length} 面 · ${state.triangles.toLocaleString()} 三角片 · mm` : 'NC 轨迹预览'),
      h(Button, { onClick: () => { setDetails(v => !v); setSource(false); setSelecting(false) }, disabled: !ready, 'aria-expanded': details }, '详情'),
      active ? h(Button, { onClick: () => { setSource(v => !v); setSelecting(false); setDetails(false) }, disabled: !ready, 'aria-expanded': source }, '源码') : null),
    active ? h('div', { className: 'cmv-playbar' }, h(Button, { onClick: () => step(-1), disabled: !playingEnabled }, '上一步'), h(Button, { onClick: togglePlay, disabled: !playingEnabled }, playing ? '暂停' : '播放'), h(Button, { onClick: () => step(1), disabled: !playingEnabled }, '下一步'),
      h('input', { type: 'range', 'aria-label': '当前工序播放进度', min: 0, max: active.duration || 1, step: 'any', value: time, disabled: !playingEnabled, onChange: (e: any) => { setPlaying(false); setTime(Number(e.target.value)) } }),
      h('select', { 'aria-label': '播放速度', value: speed, onChange: (e: any) => setSpeed(Number(e.target.value)) }, ...[0.25, 0.5, 1, 2, 4, 8].map(v => h('option', { key: v, value: v }, `${v}×`))), h('span', { title: '按程序F估算；快移假定8000、缺F假定500单位/分钟，不含换刀/加减速/停留' }, `${Math.round(active.duration ? time / active.duration * 100 : 0)}% · 估算轨迹回放`)) : null,
    alerts.length ? h('div', { className: 'cmv-alerts' }, ...alerts.slice(0, 30).map((a, i) => h('button', { key: i, type: 'button', onClick: () => { setSource(true); setSelecting(false); setFollow(true); seekLine(a.line) } }, a.text))) : null,
    state.manifest?.warnings?.length ? h('div', { className: 'cmv-note' }, `模型导出告警：${JSON.stringify(state.manifest.warnings)}`) : null,
    active ? h('div', { className: 'cmv-footer' }, '程序轨迹近似预览；刀位标记可穿过遮挡。不是材料去除、碰撞检查或机床仿真。') : null)
}
export function ModelViewer({ sessionId, path, runId, onReference }: { sessionId: string; path?: string; runId?: string; onReference?: ReferenceHandler }) {
  const [selectedRun, setRun] = useState(runId ?? ''), [runs, setRuns] = useState<any[]>([]), [joint, setJoint] = useState<any>(null), [notice, setNotice] = useState('')
  useEffect(() => { setRun(runId ?? ''); setJoint(null); setNotice('') }, [sessionId, path, runId])
  useEffect(() => {
    const controller = new AbortController()
    const requested = path ?? joint?.model_path
    if (requested) void json(`${base(sessionId)}/runs?path=${encodeURIComponent(requested)}`, { signal: controller.signal }).then(data => setRuns(data.runs), e => { if (!controller.signal.aborted) setNotice(e.message) })
    return () => controller.abort()
  }, [sessionId, path, joint?.model_path])
  useEffect(() => {
    const controller = new AbortController()
    setJoint(null); setNotice('')
    if (selectedRun) void json(`${base(sessionId)}/runs/${encodeURIComponent(selectedRun)}`, { signal: controller.signal }).then(data => { if (data.state !== 'ready') { setNotice(data.message); return }; setJoint(data) }, e => { if (!controller.signal.aborted) setNotice(e.message) })
    return () => controller.abort()
  }, [sessionId, selectedRun])
  const prepared = useMemo(() => {
    try {
      const programs: Program[] = joint ? joint.operations.map((op: any) => makeProgram(op, joint.stations.find((s: any) => s.name === op.station))) : []
      if (programs.reduce((n, p) => n + p.parsed.segments.length, 0) > 1_000_000) throw new Error('批次刀路合计超过100万段')
      return { programs, error: '' }
    } catch (e: any) { return { programs: [] as Program[], error: e.message } }
  }, [joint])
  const modelPath = path ?? joint?.model_path
  const choices = runs.some(r => r.run_id === selectedRun) || !selectedRun ? runs : [{ run_id: selectedRun, available: true }, ...runs]
  if (!modelPath) return h('div', { className: 'cmv' }, h('div', { className: 'cmv-note', role: 'status' }, notice || '正在读取加工批次…'))
  return h(SceneView, { key: `${sessionId}/${modelPath}`, sessionId, path: modelPath, programs: prepared.programs, expectedSha: joint?.source_sha256, notice: prepared.error || notice, onReference,
    contextTools: h('select', { 'aria-label': '加工批次', value: selectedRun, onChange: (e: any) => setRun(e.target.value) }, h('option', { value: '' }, '仅模型'), ...choices.map(r => h('option', { key: r.run_id, value: r.run_id }, `${r.run_id}${r.available ? '' : '（缺对齐信息）'}`))) })
}
export function ToolpathViewer({ content, fileName }: { content: string; fileName: string }) {
  const programs = useMemo(() => [makeProgram({ id: '0', name: fileName, file: fileName, content })], [content, fileName])
  return h(SceneView, { key: fileName, programs })
}
export const name = 'camind-ui-model-viewer'
export const inject = ['slots']
export function apply(ctx: any) {
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = viewerCss; document.head.append(style); return () => style.remove() })
  ctx.slots.inject('cam.model.preview', () => ctx.slots.register({ name: 'cam.model.preview', key: 'model-viewer' }, ModelViewer))
  ctx.slots.inject('cam.nc.preview', () => ctx.slots.register({ name: 'cam.nc.preview', key: 'toolpath-viewer' }, ToolpathViewer))
}
