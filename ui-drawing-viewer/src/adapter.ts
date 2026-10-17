// Descriptor and DrawingReference candidates. No HTTP or draft-sending here: M2 adds the
// drawingPreview service and the mandatory /refs/verify server-side verification path.
import type { DraftProvenance, DraftTarget } from './draft/draft_pane.ts'

export interface DrawingDescriptor {
  name: string
  packText: string
  session?: string
  source?: { uri: string; sha256: string; name: string }
  pack?: { sha256: string; identity: string }
  conversion?: { tool: string; commit: string; libredwg: string; ezdxf: string }
  degraded?: { geometryDecimated?: boolean; textTruncated?: boolean; skippedTypes?: string[] }
  missing?: string[]
}
export interface DrawingReferenceCandidate {
  kind: 'camind-drawing-ref'
  version: 1
  session: string
  source: { uri: string; sha256: string; name: string }
  pack: { sha256: string; identity: string }
  target: DraftTarget
}

const sha = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)

export function descriptorProvenance(descriptor: DrawingDescriptor): DraftProvenance | null {
  const anyIdentity = descriptor.session !== undefined || descriptor.source !== undefined || descriptor.pack !== undefined
  if (!anyIdentity) return null
  if (!descriptor.session || !descriptor.source || !descriptor.pack
    || !descriptor.source.uri || !descriptor.source.name || !sha(descriptor.source.sha256)
    || !sha(descriptor.pack.sha256) || !sha(descriptor.pack.identity))
    throw new Error('descriptor 的 session/source/pack 来源身份不完整或哈希非法')
  return {
    session: descriptor.session,
    source: { ...descriptor.source },
    pack: { ...descriptor.pack },
  }
}

export function validateDescriptor(descriptor: DrawingDescriptor): void {
  if (!descriptor || typeof descriptor !== 'object') throw new Error('descriptor 须为对象')
  if (typeof descriptor.name !== 'string' || !descriptor.name.trim()) throw new Error('descriptor.name 不得为空')
  if (typeof descriptor.packText !== 'string' || !descriptor.packText.trim()) throw new Error('descriptor.packText 不得为空')
  descriptorProvenance(descriptor)
}

export function drawingReferences(descriptor: DrawingDescriptor, targets: readonly DraftTarget[]): DrawingReferenceCandidate[] {
  const provenance = descriptorProvenance(descriptor)
  if (!provenance) return []
  return targets.map(target => ({
    kind: 'camind-drawing-ref', version: 1,
    session: provenance.session,
    source: { ...provenance.source },
    pack: { ...provenance.pack },
    target: { ...target },
  }))
}
