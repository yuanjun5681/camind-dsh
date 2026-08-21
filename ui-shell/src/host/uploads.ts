/**
 * Session-scoped upload storage shared by every Agent mode.
 * Archives are extracted eagerly with path, count, and expanded-size limits;
 * the workspace is never used as an upload staging area.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Unzip, UnzipInflate } from 'fflate'

export const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
export const UPLOADS_ROOT = path.join(DSH_HOME, 'uploads')
export const UPLOAD_BATCH_RE = /^upload-[A-Za-z0-9_-]+$/
export const UPLOAD_REF_RE = /^upload:\/\/(upload-[A-Za-z0-9_-]+)\/(.+)$/

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_UPLOAD_FILES = 32
const MAX_UPLOAD_BATCH_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_FILES = 1000
const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_ARCHIVE_EXPANDED_BYTES = 128 * 1024 * 1024
const PENDING_MARKER = '.pending'
const PENDING_SCHEMA_VERSION = 1

interface UploadInput {
  name: string
  data: string
}

export interface StoredUpload {
  id: string
  original_name: string
  stored_name: string
  media_type: string
  size: number
  sha256: string
  archive: boolean
}

export interface ExtractedUpload {
  archive_id: string
  path: string
  stored_path: string
  media_type: string
  size: number
  sha256: string
}

export interface UploadManifest {
  schema_version: 2
  batch_id: string
  session_id: string
  created_at: string
  files: StoredUpload[]
  extracted_files: ExtractedUpload[]
}

export interface AvailableUpload {
  name: string
  path: string
  size: number
  mediaType: string
  source: 'upload' | 'archive'
}

interface PendingSelection {
  schema_version: 1
  created_at: string
  paths: string[]
}

function decodeBase64(data: string): Buffer {
  const comma = data.indexOf(',')
  const payload = comma >= 0 ? data.slice(comma + 1) : data
  return Buffer.from(payload, 'base64')
}

function safeBasename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).trim()
  if (!base || base === '.' || base === '..') throw new Error(`非法文件名：${name}`)
  return base
}

export function safeSessionId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = path.basename(name, ext)
  let candidate = path.join(dir, name)
  let index = 0
  while (existsSync(candidate)) {
    index += 1
    candidate = path.join(dir, `${stem}-${index}${ext}`)
  }
  return candidate
}

function hasZipSignature(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  )
}

function isZip(name: string, bytes: Buffer): boolean {
  return name.toLowerCase().endsWith('.zip') || hasZipSignature(bytes)
}

function safeArchivePath(name: string): string {
  if (name.includes('\0')) throw new Error('ZIP 包含非法空字符路径')
  const slashName = name.replace(/\\/g, '/')
  if (slashName.startsWith('/') || /^[A-Za-z]:\//.test(slashName)) {
    throw new Error(`ZIP 包含绝对路径：${name}`)
  }
  const normalized = path.posix.normalize(slashName)
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`ZIP 包含越界路径：${name}`)
  }
  return normalized
}

function extractZip(
  bytes: Buffer,
  archive: StoredUpload,
  batchDir: string,
  mediaTypeOf: (name: string) => string,
): ExtractedUpload[] {
  if (!hasZipSignature(bytes)) throw new Error(`ZIP 文件头无效：${archive.original_name}`)
  const archiveStem = path.basename(archive.stored_name, path.extname(archive.stored_name)) || archive.id
  const extractionRoot = path.join(batchDir, 'extracted', archiveStem)
  mkdirSync(extractionRoot, { recursive: true })
  const extracted: ExtractedUpload[] = []
  const seen = new Set<string>()
  const openFiles = new Set<number>()
  let totalBytes = 0
  let entryCount = 0
  let failure: Error | undefined

  const unzip = new Unzip((entry) => {
    if (failure) return
    let relative: string
    try {
      relative = safeArchivePath(entry.name)
      if (seen.has(relative)) throw new Error(`ZIP 包含重复路径：${entry.name}`)
      seen.add(relative)
      entryCount += 1
      if (entryCount > MAX_ARCHIVE_FILES) throw new Error(`ZIP 文件数超过限制 ${MAX_ARCHIVE_FILES}`)
      if ((entry.originalSize ?? 0) > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new Error(`ZIP 单文件解压后超过 ${MAX_ARCHIVE_ENTRY_BYTES / 1024 / 1024} MiB：${entry.name}`)
      }
      if (totalBytes + (entry.originalSize ?? 0) > MAX_ARCHIVE_EXPANDED_BYTES) {
        throw new Error(`ZIP 解压总量超过 ${MAX_ARCHIVE_EXPANDED_BYTES / 1024 / 1024} MiB`)
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      entry.terminate()
      return
    }

    const destination = path.join(extractionRoot, ...relative.split('/'))
    const isDirectory = entry.name.endsWith('/')
    if (isDirectory) {
      mkdirSync(destination, { recursive: true })
      entry.ondata = (error) => {
        if (error && !failure) failure = error
      }
      entry.start()
      return
    }

    mkdirSync(path.dirname(destination), { recursive: true })
    let fd: number | undefined
    let size = 0
    const hash = createHash('sha256')
    try {
      fd = openSync(destination, 'wx', 0o600)
      openFiles.add(fd)
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      entry.terminate()
      return
    }
    entry.ondata = (error, chunk, final) => {
      if (error && !failure) failure = error
      if (failure) {
        if (fd !== undefined && openFiles.delete(fd)) closeSync(fd)
        return
      }
      size += chunk.length
      totalBytes += chunk.length
      if (size > MAX_ARCHIVE_ENTRY_BYTES || totalBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
        failure = new Error(`ZIP 实际解压大小超过安全限制：${entry.name}`)
        if (fd !== undefined && openFiles.delete(fd)) closeSync(fd)
        throw failure
      }
      if (fd !== undefined && chunk.length > 0) {
        writeSync(fd, chunk)
        hash.update(chunk)
      }
      if (final && fd !== undefined) {
        if (openFiles.delete(fd)) closeSync(fd)
        extracted.push({
          archive_id: archive.id,
          path: relative,
          stored_path: path.posix.join('extracted', archiveStem, relative),
          media_type: mediaTypeOf(relative),
          size,
          sha256: hash.digest('hex'),
        })
      }
    }
    entry.start()
  })
  unzip.register(UnzipInflate)
  try {
    unzip.push(bytes, true)
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  } finally {
    for (const fd of openFiles) closeSync(fd)
  }
  if (failure) throw failure
  return extracted
}

export async function saveUploadBatch(
  sessionId: string,
  inputs: UploadInput[] | undefined,
  mediaTypeOf: (name: string) => string,
): Promise<UploadManifest | null> {
  if (!inputs?.length) return null
  if (inputs.length > MAX_UPLOAD_FILES) throw new Error(`单次最多上传 ${MAX_UPLOAD_FILES} 个文件`)
  const normalizedSessionId = safeSessionId(sessionId)
  const batchId = `upload-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const batchDir = path.join(UPLOADS_ROOT, normalizedSessionId, batchId)
  const filesDir = path.join(batchDir, 'files')
  mkdirSync(filesDir, { recursive: true })
  try {
    const files: StoredUpload[] = []
    const extractedFiles: ExtractedUpload[] = []
    let uploadedBytes = 0
    for (const [index, input] of inputs.entries()) {
      if (!input?.name || typeof input.data !== 'string') continue
      const bytes = decodeBase64(input.data)
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`文件过大：${input.name}`)
      uploadedBytes += bytes.length
      if (uploadedBytes > MAX_UPLOAD_BATCH_BYTES) {
        throw new Error(`本批文件总量超过 ${MAX_UPLOAD_BATCH_BYTES / 1024 / 1024} MiB`)
      }
      const originalName = safeBasename(input.name)
      const destination = uniquePath(filesDir, originalName)
      writeFileSync(destination, bytes, { mode: 0o600 })
      const archive = isZip(originalName, bytes)
      const stored: StoredUpload = {
        id: `file-${index + 1}`,
        original_name: originalName,
        stored_name: path.basename(destination),
        media_type: mediaTypeOf(originalName),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        archive,
      }
      files.push(stored)
      if (archive) extractedFiles.push(...extractZip(bytes, stored, batchDir, mediaTypeOf))
    }
    const manifest: UploadManifest = {
      schema_version: 2,
      batch_id: batchId,
      session_id: normalizedSessionId,
      created_at: new Date().toISOString(),
      files,
      extracted_files: extractedFiles,
    }
    writeFileSync(path.join(batchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    return manifest
  } catch (error) {
    rmSync(batchDir, { recursive: true, force: true })
    throw error
  }
}

export function availableUploads(manifest: UploadManifest): AvailableUpload[] {
  const direct = manifest.files.map((file) => ({
    name: file.original_name,
    path: `upload://${manifest.batch_id}/files/${file.stored_name}`,
    size: file.size,
    mediaType: file.media_type,
    source: 'upload' as const,
  }))
  const extracted = manifest.extracted_files.map((file) => ({
    name: file.path,
    path: `upload://${manifest.batch_id}/${file.stored_path}`,
    size: file.size,
    mediaType: file.media_type,
    source: 'archive' as const,
  }))
  return [...direct, ...extracted]
}

function uploadManifestAt(batchDir: string, sessionId: string, batchId: string): UploadManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(batchDir, 'manifest.json'), 'utf8')) as UploadManifest
    if (
      parsed.schema_version !== 2 ||
      parsed.session_id !== sessionId ||
      parsed.batch_id !== batchId ||
      !Array.isArray(parsed.files) ||
      !Array.isArray(parsed.extracted_files)
    ) return null
    return parsed
  } catch {
    return null
  }
}

function readPendingPaths(batchDir: string, manifest: UploadManifest): Set<string> | null {
  const marker = path.join(batchDir, PENDING_MARKER)
  if (!existsSync(marker)) return null
  const allPaths = availableUploads(manifest).map((file) => file.path)
  try {
    const parsed = JSON.parse(readFileSync(marker, 'utf8')) as Partial<PendingSelection>
    if (parsed.schema_version !== PENDING_SCHEMA_VERSION || !Array.isArray(parsed.paths)) {
      return new Set(allPaths)
    }
    const known = new Set(allPaths)
    return new Set(parsed.paths.filter((candidate): candidate is string => (
      typeof candidate === 'string' && known.has(candidate)
    )))
  } catch {
    // rc.7 早期版本只写 created_at 文本；读取时把旧标记视为整批选中。
    return new Set(allPaths)
  }
}

function writePendingSelection(batchDir: string, createdAt: string, paths: Iterable<string>): void {
  const selection: PendingSelection = {
    schema_version: PENDING_SCHEMA_VERSION,
    created_at: createdAt,
    paths: [...paths],
  }
  writeFileSync(path.join(batchDir, PENDING_MARKER), `${JSON.stringify(selection, null, 2)}\n`, { mode: 0o600 })
}

function selectPendingFiles(manifest: UploadManifest, paths: ReadonlySet<string>): UploadManifest {
  return {
    ...manifest,
    files: manifest.files.filter((file) => paths.has(
      `upload://${manifest.batch_id}/files/${file.stored_name}`,
    )),
    extracted_files: manifest.extracted_files.filter((file) => paths.has(
      `upload://${manifest.batch_id}/${file.stored_path}`,
    )),
  }
}

/** 把一个已完整提交的批次标记为等待下一条用户消息消费。 */
export function markUploadBatchPending(manifest: UploadManifest): void {
  const batchDir = path.join(UPLOADS_ROOT, safeSessionId(manifest.session_id), manifest.batch_id)
  writePendingSelection(batchDir, manifest.created_at, availableUploads(manifest).map((file) => file.path))
}

/**
 * 读取当前会话尚未进入模型上下文的批次。
 * marker 与 manifest 分离，避免改变 tool-upload 校验的上传事实清单。
 */
export function pendingUploadBatches(sessionId: string): UploadManifest[] {
  const normalizedSessionId = safeSessionId(sessionId)
  const sessionDir = path.join(UPLOADS_ROOT, normalizedSessionId)
  if (!existsSync(sessionDir)) return []
  const manifests: UploadManifest[] = []
  for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UPLOAD_BATCH_RE.test(entry.name)) continue
    const batchDir = path.join(sessionDir, entry.name)
    const manifest = uploadManifestAt(batchDir, normalizedSessionId, entry.name)
    if (!manifest) continue
    const selectedPaths = readPendingPaths(batchDir, manifest)
    if (!selectedPaths || selectedPaths.size === 0) continue
    manifests.push(selectPendingFiles(manifest, selectedPaths))
  }
  return manifests.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** 当前会话全部上传事实（含已发送批次），供工作台「本次上传」在刷新后恢复。 */
export function listSessionUploads(sessionId: string): AvailableUpload[] {
  const normalizedSessionId = safeSessionId(sessionId)
  const sessionDir = path.join(UPLOADS_ROOT, normalizedSessionId)
  if (!existsSync(sessionDir)) return []
  const manifests: UploadManifest[] = []
  for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UPLOAD_BATCH_RE.test(entry.name)) continue
    const manifest = uploadManifestAt(path.join(sessionDir, entry.name), normalizedSessionId, entry.name)
    if (manifest) manifests.push(manifest)
  }
  manifests.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return manifests.flatMap((manifest) => availableUploads(manifest))
}

/** 从下一条消息的附件选择中移除一个文件；上传事实与磁盘原件保持不变。 */
export function removePendingUpload(sessionId: string, batchId: string, requestedPath: string): void {
  const normalizedSessionId = safeSessionId(sessionId)
  if (!UPLOAD_BATCH_RE.test(batchId)) throw new Error('上传批次无效')
  const batchDir = path.join(UPLOADS_ROOT, normalizedSessionId, batchId)
  const manifest = uploadManifestAt(batchDir, normalizedSessionId, batchId)
  if (!manifest) throw new Error('上传批次不存在或已损坏')
  const selectedPaths = readPendingPaths(batchDir, manifest)
  if (!selectedPaths || !selectedPaths.has(requestedPath)) throw new Error('待发送文件不存在')

  selectedPaths.delete(requestedPath)
  const direct = manifest.files.find((file) => (
    requestedPath === `upload://${manifest.batch_id}/files/${file.stored_name}`
  ))
  if (direct?.archive) {
    for (const file of manifest.extracted_files) {
      if (file.archive_id === direct.id) {
        selectedPaths.delete(`upload://${manifest.batch_id}/${file.stored_path}`)
      }
    }
  }

  if (selectedPaths.size === 0) {
    rmSync(path.join(batchDir, PENDING_MARKER), { force: true })
    return
  }
  writePendingSelection(batchDir, manifest.created_at, selectedPaths)
}

/** 只消费本次 pre-step 已注入的精确批次，不触碰之后上传的新批次。 */
export function consumePendingUploadBatches(sessionId: string, batchIds: readonly string[]): void {
  const sessionDir = path.join(UPLOADS_ROOT, safeSessionId(sessionId))
  for (const batchId of batchIds) {
    if (!UPLOAD_BATCH_RE.test(batchId)) continue
    rmSync(path.join(sessionDir, batchId, PENDING_MARKER), { force: true })
  }
}

export async function resolveUploadReference(sessionId: string, requested: string) {
  const match = UPLOAD_REF_RE.exec(requested)
  if (!match) return null
  const [, batchId, rawRelative] = match
  const relative = rawRelative.includes('/') ? rawRelative : `files/${rawRelative}`
  const normalized = path.posix.normalize(relative.replace(/\\/g, '/'))
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('上传文件引用超出当前批次')
  }
  const batchDir = path.join(UPLOADS_ROOT, safeSessionId(sessionId), batchId)
  const candidate = path.join(batchDir, ...normalized.split('/'))
  const rootInfo = await stat(batchDir)
  if (!rootInfo.isDirectory()) throw new Error(`上传批次不存在：${batchId}`)
  const info = await stat(candidate)
  if (!info.isFile()) throw new Error('上传引用不是文件')
  return { root: batchDir, file: candidate, relative: requested }
}
