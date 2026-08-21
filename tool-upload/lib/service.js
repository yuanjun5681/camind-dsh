// Cordis upload service shared by generic tools and domain plugins.
// Every public operation derives session ownership from the tool execution context.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

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

export function createUploadService() {
  return Object.freeze({
    loadBatch(exec, batchId, options = {}) {
      const batch = loadBatch(sessionIdOf(exec), batchId)
      return options.verifyIntegrity ? verifyBatch(batch) : batch
    },

    listBatches(exec) {
      return listBatches(sessionIdOf(exec))
    },

    latestBatch(exec, options = {}) {
      const batch = latestBatch(sessionIdOf(exec))
      return batch && options.verifyIntegrity ? verifyBatch(batch) : batch
    },

    resolveFile(exec, batchId, requested) {
      return resolveDeclaredFile(sessionIdOf(exec), batchId, requested)
    },

    readFile(exec, batchId, requested) {
      const resolved = resolveDeclaredFile(sessionIdOf(exec), batchId, requested)
      return { ...resolved, bytes: verifiedBytes(resolved.file) }
    },
  })
}
