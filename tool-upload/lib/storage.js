// Read-only access to the current session's upload manifests and files.
// Paths are accepted only when declared by a valid manifest owned by that session.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const UPLOADS_ROOT = path.join(DSH_HOME, 'uploads')
const BATCH_RE = /^upload-[A-Za-z0-9_-]+$/

export function safeSessionId(value) {
  return String(value ?? 'global').replace(/[^A-Za-z0-9_-]/g, '_')
}

export function sessionIdOf(exec) {
  return safeSessionId(exec?.agent?.id)
}

function safeStoredPath(value) {
  if (typeof value !== 'string' || !value) return null
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'))
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

function declaredFiles(batchDir, manifest) {
  const files = []
  for (const entry of manifest.files) {
    const storedName = safeStoredPath(entry?.stored_name)
    if (!storedName || storedName.includes('/')) throw new Error('上传清单包含非法原始文件路径。')
    files.push({
      id: entry.id,
      path: `files/${storedName}`,
      name: entry.original_name,
      media_type: entry.media_type,
      size: entry.size,
      sha256: entry.sha256,
      source: 'upload',
      archive: Boolean(entry.archive),
      absolute: path.join(batchDir, 'files', storedName),
    })
  }
  for (const entry of Array.isArray(manifest.extracted_files) ? manifest.extracted_files : []) {
    const storedPath = safeStoredPath(entry?.stored_path)
    if (!storedPath || !storedPath.startsWith('extracted/')) throw new Error('上传清单包含非法解压文件路径。')
    files.push({
      archive_id: entry.archive_id,
      path: storedPath,
      name: entry.path,
      media_type: entry.media_type,
      size: entry.size,
      sha256: entry.sha256,
      source: 'archive',
      archive: false,
      absolute: path.join(batchDir, ...storedPath.split('/')),
    })
  }
  for (const file of files) {
    const info = existsSync(file.absolute) ? statSync(file.absolute) : null
    if (!info?.isFile()) {
      throw new Error(`上传文件缺失：${file.name}。`)
    }
    if (Number.isInteger(file.size) && info.size !== file.size) throw new Error(`上传文件大小校验失败：${file.name}。`)
  }
  return files
}

export function loadBatch(sessionId, batchId) {
  if (typeof batchId !== 'string' || !BATCH_RE.test(batchId)) throw new Error('上传批次 ID 非法。')
  const batchDir = path.join(UPLOADS_ROOT, safeSessionId(sessionId), batchId)
  const manifestPath = path.join(batchDir, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`当前会话不存在上传批次 ${batchId}。`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`上传清单无法解析：${error.message}`)
  }
  if (
    ![1, 2].includes(manifest?.schema_version) ||
    manifest?.batch_id !== batchId ||
    manifest?.session_id !== safeSessionId(sessionId) ||
    !Array.isArray(manifest?.files)
  ) {
    throw new Error(`上传批次 ${batchId} 的清单无效或不属于当前会话。`)
  }
  return {
    batch_id: batchId,
    created_at: manifest.created_at,
    files: declaredFiles(batchDir, manifest),
  }
}

export function listBatches(sessionId) {
  const sessionDir = path.join(UPLOADS_ROOT, safeSessionId(sessionId))
  if (!existsSync(sessionDir)) return []
  const batches = []
  for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !BATCH_RE.test(entry.name)) continue
    try {
      batches.push(loadBatch(sessionId, entry.name))
    } catch {
      // Incomplete batches have no committed manifest and are deliberately invisible.
    }
  }
  return batches.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
}

export function latestBatch(sessionId) {
  return listBatches(sessionId)[0] ?? null
}

export function resolveDeclaredFile(sessionId, batchId, requested) {
  const reference = typeof requested === 'string' ? /^upload:\/\/(upload-[A-Za-z0-9_-]+)\/(.+)$/.exec(requested) : null
  if (reference && batchId && batchId !== reference[1]) throw new Error('文件引用与 batch_id 不一致。')
  const resolvedBatchId = batchId || reference?.[1]
  const batch = resolvedBatchId ? loadBatch(sessionId, resolvedBatchId) : latestBatch(sessionId)
  if (!batch) throw new Error('当前会话没有上传文件。')
  if (typeof requested !== 'string' || !requested) throw new Error('必须提供上传文件路径。')
  const normalized = safeStoredPath(reference?.[2] ?? requested)
  if (!normalized) throw new Error('上传文件路径非法。')
  const matches = batch.files.filter((file) => file.path === normalized || file.name === requested)
  if (matches.length === 0) throw new Error(`批次 ${batch.batch_id} 中不存在文件 ${requested}。`)
  if (matches.length > 1) throw new Error(`文件名 ${requested} 不唯一，请使用文件列表返回的 path。`)
  return { batch, file: matches[0] }
}
