// Validate native CAM reference chips and their persisted plain-text form before a model step.
const OPEN = '[CAM_SELECTION]'
const CLOSE = '[/CAM_SELECTION]'
export async function validateSelectionMessages(messages, sessionId, models) {
  let count = 0
  // Historical references describe older versions; only this request can block the next step.
  const request = messages.findLast(message => message.source?.kind === 'user')
  if (!request) return
  for (const block of request.content ?? []) {
    if (block.type !== 'text' || typeof block.text !== 'string' || !block.text.includes(OPEN)) continue
    const pieces = block.text.split(OPEN).slice(1)
    for (const piece of pieces) {
      if (++count > 20) throw new Error('单次提问最多引用 20 组选面')
      const end = piece.indexOf(CLOSE)
      if (end < 0 || end > 16384) throw new Error('选面引用格式不完整或超限，请移除后重新选面')
      let reference
      try { reference = JSON.parse(piece.slice(0, end)) }
      catch { throw new Error('选面引用格式错误，请移除后重新选面') }
      if (reference?.session_id !== sessionId || reference?.kind !== 'faces') throw new Error('选面引用不属于当前会话，请重新选面')
      await models.selection(sessionId, reference.path, reference.source_sha256, reference.geometry_sha256, reference.fids)
    }
  }
}
