// Authorized drawing-source snapshots. previewFiles decides the trust boundary; this module only
// reads that file once and uses those stable bytes for hashing and conversion.
import { createHash } from 'node:crypto'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const MAX_DRAWING_SOURCE_BYTES = 128 * 1024 * 1024

export async function snapshotDrawingSource({ sessionId, requested, resolve }) {
  if (!sessionId || !requested) throw new Error('需要会话与图纸引用')
  const resolved = await resolve(sessionId, requested)
  const handle = await open(resolved.file, 'r')
  let bytes
  try {
    const info = await handle.stat()
    if (info.size > MAX_DRAWING_SOURCE_BYTES) throw new Error('图纸源文件超过 128 MiB，暂不支持')
    const buffer = Buffer.alloc(Math.min(info.size, MAX_DRAWING_SOURCE_BYTES + 1))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_DRAWING_SOURCE_BYTES) throw new Error('图纸源文件超过 128 MiB，暂不支持')
    bytes = buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
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

function validDxfText(text) {
  if (!/^\s*0\s*\r?\nSECTION/i.test(text)) throw new Error('无法识别 DXF 内容结构')
  return text
}

export function decodeDxfSnapshot(snapshot) {
  const extension = path.extname(snapshot.name).toLowerCase()
  if (extension === '.dwg') return { kind: 'dwg', text: null, bytes: snapshot.bytes }
  if (extension !== '.dxf') throw new Error(`不支持的图纸载体：${extension || '无扩展名'}；仅支持 .dwg/.dxf`)
  const bytes = snapshot.bytes
  const hasBom = (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
    || (bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF)
  if (!hasBom && bytes.includes(0)) throw new Error('不支持无 BOM 的 UTF-16 或二进制 DXF 内容')
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { kind: 'dxf', text: validDxfText(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3))), bytes }
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return { kind: 'dxf', text: validDxfText(new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))), bytes }
  }
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return { kind: 'dxf', text: validDxfText(new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2))), bytes }
  }
  return { kind: 'dxf', text: validDxfText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes }
}
