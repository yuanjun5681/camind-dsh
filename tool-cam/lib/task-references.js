// Current-request validation only: older messages retain historical meaning. DrawingReference v1
// is expanded for the existing validator, which must re-verify it before the request can proceed.
export function adaptDrawingReference(reference) {
  if (reference?.kind !== 'camind-drawing-ref' || reference.version !== 1) throw new Error('图纸引用 kind/version 不合法')
  const target = reference.target
  const id = target?.type === 'dim' && typeof target.id === 'string' ? `dim:${target.id}`
    : target?.type === 'entity' && Number.isInteger(target.id) && target.id >= 0 ? `entity:${target.id}` : null
  if (id === null) throw new Error('图纸引用目标不合法')
  return {
    kind: 'drawing-target',
    session_id: reference.session,
    source_sha256: reference.source?.sha256,
    pack_sha256: reference.pack?.sha256,
    conversion_identity: reference.pack?.identity,
    ids: [id],
    drawing_reference: reference,
  }
}

export async function validateTaskReferences(messages, sid, tasks) {
  const request = messages.findLast(message => message.source?.kind === 'user')
  let count = 0
  for (const block of request?.content ?? []) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    for (const [open, close, drawingOnly] of [['[CAM_OBJECT]', '[/CAM_OBJECT]', false], ['[CAM_DRAWING_REFERENCE]', '[/CAM_DRAWING_REFERENCE]', true]]) {
      for (const piece of block.text.split(open).slice(1)) {
        if (++count > 20) throw new Error('每次提问最多引用 20 组加工对象')
        const end = piece.indexOf(close)
        if (end < 0 || end > 16384) throw new Error('加工对象引用格式不完整或超限')
        let reference
        try { reference = JSON.parse(piece.slice(0, end)) } catch { throw new Error('加工对象引用格式错误，请重新选择') }
        if (drawingOnly && reference?.kind !== 'camind-drawing-ref') throw new Error('图纸引用格式错误，请重新选择')
        await tasks.validateReference(sid, reference?.kind === 'camind-drawing-ref' ? adaptDrawingReference(reference) : reference)
      }
    }
  }
}
