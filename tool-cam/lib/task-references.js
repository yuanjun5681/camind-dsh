// Current-request validation only: older messages retain historical meaning. Frozen task drawings
// use camTasks; every other DrawingReference is re-verified by drawingPreview on each request.
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

async function verifyGenericDrawingReference(sid, claim, getDrawingPreview) {
  const expected = adaptDrawingReference(claim)
  const service = getDrawingPreview?.()
  if (!service || typeof service.verifyReference !== 'function') throw new Error('图纸引用核验服务不可用，不能发送未核验引用')
  const verified = await service.verifyReference(sid, claim)
  const adapted = adaptDrawingReference(verified?.reference)
  const checked = adapted.drawing_reference
  const sameHash = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
  if (expected.session_id !== sid || adapted.session_id !== sid || adapted.ids[0] !== expected.ids[0]
    || checked.source?.uri !== claim.source?.uri || !sameHash(adapted.source_sha256, expected.source_sha256)
    || !sameHash(adapted.pack_sha256, expected.pack_sha256) || !sameHash(adapted.conversion_identity, expected.conversion_identity)) {
    throw new Error('图纸引用核验结果与请求不符')
  }
}

export async function validateTaskReferences(messages, sid, tasks, getDrawingPreview) {
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
        if (reference?.kind !== 'camind-drawing-ref') await tasks.validateReference(sid, reference)
        else if (typeof reference.source?.uri === 'string' && reference.source.uri.startsWith('task-input://')) await tasks.validateReference(sid, adaptDrawingReference(reference))
        else await verifyGenericDrawingReference(sid, reference, getDrawingPreview)
      }
    }
  }
}
