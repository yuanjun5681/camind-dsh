// Cordis upload service shared by generic tools and domain plugins.
// Every public operation derives session ownership from the tool execution context.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import {
  latestBatch,
  listBatches,
  loadBatch,
  resolveDeclaredFile,
  sessionIdOf,
} from './storage.js'

function verifiedBytes(file) {
  const bytes = readFileSync(file.absolute)
  if (file.sha256 && createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`上传文件完整性校验失败：${file.name}。`)
  }
  return bytes
}

function verifyBatch(batch) {
  for (const file of batch.files) verifiedBytes(file)
  return batch
}

// 桌面端/官方 composer 的文件上传走官方附件体系（落盘 $DSH_HOME/attachments/v1，
// 会话事件留 file ref），不写 uploads/<session>/<batch>/——本服务把当前会话的官方
// 文件附件合成一个 `attachments` 伪批次并入列举/解析，让 cam_survey 等工具在桌面端
// 也能找到刚上传的零件。只读桥，不写盘。
function attachmentBatchOf(exec, host) {
  // 服务都经执行时点 ctx.get 活查（apply 时可能还没注册）。
  const attachments = host?.ctx?.get('attachments')
  const events = exec?.agent?.session?.snapshotEvents?.()
  if (!attachments || typeof attachments.fileHostPath !== 'function' || !events) return null
  const seen = new Set()
  const files = []
  let latest = 0
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const content = event.data?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part?.type !== 'file') continue
      const ref = part.attachment
      if (typeof ref?.attachmentId !== 'string' || typeof ref?.name !== 'string') continue
      const key = `${ref.name}:${ref.bytes}`
      if (seen.has(key)) continue
      seen.add(key)
      let absolute
      try { absolute = attachments.fileHostPath(ref) } catch { continue }
      if (typeof absolute !== 'string' || !existsSync(absolute)) continue
      if (typeof event.time === 'number') latest = Math.max(latest, event.time)
      files.push({
        id: ref.attachmentId,
        path: `attachments/${ref.name}`,
        name: ref.name,
        media_type: undefined,
        size: ref.bytes,
        sha256: undefined,
        source: 'attachment',
        archive: false,
        absolute,
      })
    }
  }
  if (files.length === 0) return null
  return { batch_id: 'attachments', created_at: new Date(latest || Date.now()).toISOString(), files }
}

export function createUploadService(host) {
  return Object.freeze({
    loadBatch(exec, batchId, options = {}) {
      const batch = loadBatch(sessionIdOf(exec), batchId)
      return options.verifyIntegrity ? verifyBatch(batch) : batch
    },

    listBatches(exec) {
      const batches = listBatches(sessionIdOf(exec))
      const bridged = attachmentBatchOf(exec, host)
      return bridged ? [bridged, ...batches] : batches
    },

    latestBatch(exec, options = {}) {
      const batch = latestBatch(sessionIdOf(exec))
      return batch && options.verifyIntegrity ? verifyBatch(batch) : batch
    },

    resolveFile(exec, batchId, requested) {
      if (batchId === 'attachments') {
        const batch = attachmentBatchOf(exec, host)
        if (!batch) throw new Error('当前会话没有官方附件体系的上传文件。')
        const matches = batch.files.filter((file) => file.path === requested || file.name === requested)
        if (matches.length === 0) throw new Error(`当前会话的官方附件里没有「${requested}」。`)
        if (matches.length > 1) throw new Error(`文件名 ${requested} 不唯一，请使用文件列表返回的 path。`)
        return { batch, file: matches[0] }
      }
      return resolveDeclaredFile(sessionIdOf(exec), batchId, requested)
    },

    readFile(exec, batchId, requested) {
      const resolved = this.resolveFile(exec, batchId, requested)
      return { ...resolved, bytes: verifiedBytes(resolved.file) }
    },
  })
}
