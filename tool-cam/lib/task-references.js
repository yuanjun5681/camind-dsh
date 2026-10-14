// Current-request validation only: older task/drawing references retain historical meaning without blocking a new plain request.
export async function validateTaskReferences(messages, sid, tasks) {
  const request = messages.findLast(message => message.source?.kind === 'user')
  let count = 0
  for (const block of request?.content ?? []) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    for (const piece of block.text.split('[CAM_OBJECT]').slice(1)) {
      if (++count > 20) throw new Error('每次提问最多引用 20 组加工对象')
      const end = piece.indexOf('[/CAM_OBJECT]')
      if (end < 0 || end > 16384) throw new Error('加工对象引用格式不完整或超限')
      let reference
      try { reference = JSON.parse(piece.slice(0, end)) } catch { throw new Error('加工对象引用格式错误，请重新选择') }
      await tasks.validateReference(sid, reference)
    }
  }
}
