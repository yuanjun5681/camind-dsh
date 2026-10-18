// DWG/DXF preview: descriptor -> DraftPane v2 messages and selection -> reference candidates.
import React, { useEffect, useRef, useState } from 'react'
import { DraftPane, type PaneViewerMessage } from './draft/draft_pane.ts'
import { descriptorProvenance, drawingReferences, validateDescriptor, type DrawingDescriptor, type DrawingReferenceCandidate } from './adapter.ts'
import { drawingCss } from './styles.ts'

const h = React.createElement
type ReferenceHandler = (reference: DrawingReferenceCandidate | null) => void | Promise<void>
type Loaded = Extract<PaneViewerMessage, { type: 'loaded' }>
type DrawingTarget = DrawingReferenceCandidate['target']
type DrawingRect = { x: number; y: number; width: number; height: number }
type DrawingInsets = { top: number; right: number; bottom: number; left: number }
export interface DrawingController {
  fit: () => void
  zoom: (factor: number) => void
  pan: (dx: number, dy: number) => void
  locateTarget: (target: DrawingTarget, zoom?: boolean) => void
  setSelection: (targets: DrawingTarget[], notify?: boolean) => void
  clearSelection: (notify?: boolean) => void
  zoomToRect: (rect: DrawingRect) => void
  setViewportInsets: (insets: DrawingInsets) => void
  setColorMode: (mode: 'readable' | 'original') => void
}
interface DrawingAdapterProps {
  descriptor: DrawingDescriptor
  controller: DrawingController | null
  selection: readonly DrawingTarget[]
  viewportRef: React.RefObject<HTMLDivElement | null>
  degraded: Loaded['degraded'] | null
  onReference?: ReferenceHandler
}
type DrawingAdapter = (props: DrawingAdapterProps) => React.ReactElement

export function DrawingPreview({ descriptor, onReference, adapter }: { descriptor: DrawingDescriptor; onReference?: ReferenceHandler; adapter?: DrawingAdapter }): React.ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const middleDrag = useRef<{ x: number; y: number } | null>(null)
  const callback = useRef<ReferenceHandler | undefined>(onReference)
  callback.current = onReference
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [degraded, setDegraded] = useState<Loaded['degraded'] | null>(null)
  const [error, setError] = useState('')
  const [controller, setController] = useState<DrawingController | null>(null)
  const [selection, setSelectionState] = useState<DrawingTarget[]>([])

  useEffect(() => {
    middleDrag.current = null
    setLoaded(null); setDegraded(null); setError(''); setController(null); setSelectionState([])
    const container = host.current
    if (!container) return
    let disposed = false
    container.textContent = '' // B 失败不得把保留的 A 错标为 B
    let pane: DraftPane | null = null, suppressReferences = 0
    try {
      validateDescriptor(descriptor)
      const provenance = descriptorProvenance(descriptor)
      const fail = (message: unknown) => {
        if (!disposed) setError(message instanceof Error ? message.message : String(message))
      }
      pane = new DraftPane(container, (msg) => {
        if (disposed) return
        if (msg.type === 'loaded') { setLoaded(msg); setDegraded(msg.degraded) }
        else if (msg.type === 'stats') setDegraded(previous => ({
          geometryDecimated: msg.stats.lastStep > 1,
          textTruncated: msg.stats.textsOverflow > 0,
          skippedTypes: previous?.skippedTypes ?? [],
        }))
        else if (msg.type === 'error') fail(msg.message)
        else if (msg.type === 'selectionChanged') {
          const targets = msg.targets.map(target => ({ ...target }))
          setSelectionState(targets)
          if (suppressReferences) return
          if (targets.length === 0) {
            void (async () => {
              try { await callback.current?.(null) }
              catch (e) { fail(e) }
            })()
            return
          }
          setError('')
          for (const reference of drawingReferences(descriptor, targets)) {
            void (async () => {
              try { await callback.current?.(reference) }
              catch (e) { fail(e) }
            })()
          }
        }
      })
      const currentPane = pane
      const dpr = () => Math.min(window.devicePixelRatio || 1, 2)
      // Host controls use CSS pixels; the public pane contract uses physical pixels.
      setController({
        fit: () => { currentPane.handle({ type: 'fit', messageVersion: 2 }) },
        zoom: factor => {
          const rect = host.current?.getBoundingClientRect()
          if (!rect || rect.width <= 0 || rect.height <= 0) return
          const scale = dpr()
          currentPane.handle({ type: 'zoomAt', messageVersion: 2, sx: rect.width * scale / 2, sy: rect.height * scale / 2, factor })
        },
        pan: (dx, dy) => { const scale = dpr(); currentPane.handle({ type: 'pan', messageVersion: 2, dx: dx * scale, dy: dy * scale }) },
        locateTarget: (target, zoom = true) => { currentPane.handle({ type: 'locateTarget', messageVersion: 2, target, zoom }) },
        setSelection: (targets, notify = true) => {
          if (!notify) suppressReferences++
          try { currentPane.handle({ type: 'setSelection', messageVersion: 2, targets }) }
          finally { if (!notify) suppressReferences-- }
        },
        clearSelection: (notify = true) => {
          if (!notify) suppressReferences++
          try { currentPane.handle({ type: 'clearSelection', messageVersion: 2 }) }
          finally { if (!notify) suppressReferences-- }
        },
        zoomToRect: rect => {
          const scale = dpr()
          currentPane.handle({ type: 'zoomToRect', messageVersion: 2, rect: { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale } })
        },
        setViewportInsets: insets => {
          const scale = dpr()
          currentPane.handle({ type: 'setViewportInsets', messageVersion: 2, top: insets.top * scale, right: insets.right * scale, bottom: insets.bottom * scale, left: insets.left * scale })
        },
        setColorMode: mode => { currentPane.handle({ type: 'setColorMode', messageVersion: 2, mode }) },
      })
      pane.handle({ type: 'load', messageVersion: 2, packText: descriptor.packText, name: descriptor.name, provenance })
    } catch (e) {
      if (!disposed) setError(e instanceof Error ? e.message : String(e))
    }
    return () => {
      disposed = true
      void (async () => { try { await callback.current?.(null) } catch { /* Disposal ignores stale invalidation failures. */ } })()
      pane?.dispose()
      container.textContent = ''
    }
  }, [descriptor])

  const visibleDegraded = degraded ?? loaded?.degraded
  return h('section', { className: 'cdv', 'data-testid': 'drawing-preview' },
    h('div', { className: 'cdv-meta' },
      h('strong', null, loaded?.name ?? descriptor.name),
      loaded ? h('span', null, `${loaded.entities} 实体 · ${loaded.dims} 尺寸`) : null,
      loaded?.pack ? h('span', { title: loaded.pack.identity }, `pack ${loaded.pack.sha256.slice(0, 12)}…`) : h('span', null, '内容模式 · 只读'),
      visibleDegraded?.geometryDecimated ? h('span', { className: 'cdv-badge' }, '几何已抽稀') : null,
      visibleDegraded?.textTruncated ? h('span', { className: 'cdv-badge' }, '文字有截断') : null,
      visibleDegraded?.skippedTypes.length ? h('span', { className: 'cdv-badge' }, `跳过未知类型：${visibleDegraded.skippedTypes.join('、')}`) : null),
    descriptor.missing?.length ? h('div', { className: 'cdv-missing' }, `缺失信息：${descriptor.missing.join('、')}`) : null,
    error ? h('div', { className: 'cdv-error', role: 'alert' }, error) : null,
    h('div', { className: adapter ? 'cdv-body cdv-body-adapted' : 'cdv-body' },
      h('div', {
        ref: host, className: 'cdv-canvas', tabIndex: 0, role: 'region',
        'aria-label': '二维图纸画布，拖动平移，滚轮缩放，F 适配全图',
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          event.currentTarget.focus({ preventScroll: true })
          if (event.button !== 1) return
          event.preventDefault()
          middleDrag.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        },
        onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
          const previous = middleDrag.current
          if (!previous) return
          event.preventDefault()
          middleDrag.current = { x: event.clientX, y: event.clientY }
          controller?.pan(event.clientX - previous.x, event.clientY - previous.y)
        },
        onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
          if (!middleDrag.current) return
          event.preventDefault(); middleDrag.current = null
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        },
        onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
          if (!middleDrag.current) return
          event.preventDefault(); middleDrag.current = null
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (!controller) return
          if (event.key.startsWith('Arrow')) {
            const step = event.shiftKey ? 120 : 40
            controller.pan(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
          }
          else if (event.key.toLowerCase() === 'f') controller.fit()
          else if (event.key === '+' || event.key === '=') controller.zoom(1.3)
          else if (event.key === '-' || event.key === '_') controller.zoom(1 / 1.3)
          else if (event.key === 'Escape') controller.clearSelection()
          else return
          event.preventDefault()
        },
      }),
      adapter ? h(adapter, { descriptor, controller, selection, viewportRef: host, degraded: visibleDegraded ?? null, onReference }) : null))
}

export const name = 'camind-ui-drawing-viewer'
export const inject = ['slots']
export function apply(ctx: any): void {
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = drawingCss; document.head.append(style); return () => style.remove() })
  ctx.slots.inject('cam.drawing.preview', () => ctx.slots.register({ name: 'cam.drawing.preview', key: 'drawing-viewer' }, DrawingPreview))
}
