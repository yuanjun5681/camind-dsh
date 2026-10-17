// Authorized drawing-source snapshots. previewFiles decides the trust boundary; this module only
// reads that file once and uses those stable bytes for hashing and conversion.
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const MAX_DRAWING_SOURCE_BYTES = 128 * 1024 * 1024

export async function snapshotDrawingSource({ sessionId, requested, resolve }) {
  if (!sessionId || !requested) throw new Error('需要会话与图纸引用')
  const resolved = await resolve(sessionId, requested)
  const bytes = await readFile(resolved.file)
  if (bytes.length > MAX_DRAWING_SOURCE_BYTES) throw new Error('图纸源文件超过 128 MiB，暂不支持')
  const name = resolved.displayPath ?? resolved.name ?? path.basename(resolved.file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'camind-drawing-source-'))
  const snapshotPath = path.join(dir, path.basename(resolved.file))
  await writeFile(snapshotPath, bytes, { flag: 'wx' })
  return {
    sessionId,
    uri: requested,
    name,
    file: resolved.file,
    snapshotPath,
    bytes,
    sha256,
    source: { uri: requested, sha256, name },
    async cleanup() { await rm(dir, { recursive: true, force: true }) },
  }
}

export function decodeDxfSnapshot(snapshot) {
  const extension = path.extname(snapshot.name).toLowerCase()
  if (extension === '.dwg') return { kind: 'dwg', text: null, bytes: snapshot.bytes }
  if (extension !== '.dxf') throw new Error(`不支持的图纸载体：${extension || '无扩展名'}；仅支持 .dwg/.dxf`)
  const bytes = snapshot.bytes
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { kind: 'dxf', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3)), bytes }
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return { kind: 'dxf', text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)), bytes }
  }
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return { kind: 'dxf', text: new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2)), bytes }
  }
  return { kind: 'dxf', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes }
}
