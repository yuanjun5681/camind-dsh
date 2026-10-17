// DWG/DXF preview: descriptor -> DraftPane v2 messages and selection -> reference candidates.
import React, { useEffect, useRef, useState } from 'react'
import { DraftPane, type PaneViewerMessage } from './draft/draft_pane.ts'
import { descriptorProvenance, drawingReferences, validateDescriptor, type DrawingDescriptor, type DrawingReferenceCandidate } from './adapter.ts'
import { drawingCss } from './styles.ts'

const h = React.createElement
type ReferenceHandler = (reference: DrawingReferenceCandidate) => void | Promise<void>
type Loaded = Extract<PaneViewerMessage, { type: 'loaded' }>

export function DrawingPreview({ descriptor, onReference }: { descriptor: DrawingDescriptor; onReference?: ReferenceHandler }): React.ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const callback = useRef<ReferenceHandler | undefined>(onReference)
  callback.current = onReference
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [degraded, setDegraded] = useState<Loaded['degraded'] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoaded(null); setDegraded(null); setError('')
    const container = host.current
    if (!container) return
    let disposed = false
    container.textContent = '' // B 失败不得把保留的 A 错标为 B
    let pane: DraftPane | null = null
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
          for (const reference of drawingReferences(descriptor, msg.targets)) {
            void (async () => {
              try { await callback.current?.(reference) }
              catch (e) { fail(e) }
            })()
          }
        }
      })
      pane.handle({ type: 'load', messageVersion: 2, packText: descriptor.packText, name: descriptor.name, provenance })
    } catch (e) {
      if (!disposed) setError(e instanceof Error ? e.message : String(e))
    }
    return () => { disposed = true; pane?.dispose(); container.textContent = '' }
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
    h('div', { ref: host, className: 'cdv-canvas' }))
}

export const name = 'camind-ui-drawing-viewer'
export const inject = ['slots']
export function apply(ctx: any): void {
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = drawingCss; document.head.append(style); return () => style.remove() })
  ctx.slots.inject('cam.drawing.preview', () => ctx.slots.register({ name: 'cam.drawing.preview', key: 'drawing-viewer' }, DrawingPreview))
}
