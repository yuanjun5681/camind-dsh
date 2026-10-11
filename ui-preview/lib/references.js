// Desktop @path references are ordinary user-message text, not uploaded attachments.
// Issue opaque session-verified preview handles; never accept an arbitrary host path from HTTP.
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export function hasSensitiveSegment(file) {
  return file.split(/[\\/]/).some(segment => segment === '.git' || segment === '.dsh' || segment.startsWith('.env'))
}

export function referencedPaths(session) {
  const seen = new Set(), files = []
  const events = session.snapshotEvents?.() ?? []
  for (const event of [...events].reverse()) {
    if (event.type !== 'user/message' || (event.data?.source?.kind && event.data.source.kind !== 'user')) continue
    const content = event.data?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      // Same whitespace and quoted-path grammar used by the desktop formatFileMention.
      for (const match of block.text.matchAll(/(?:^|\s)@(?:"([^"\r\n]+)"(?=\s|$)|([^\s"]+))/gu)) {
        const value = match[1] ?? match[2]
        if (!value || /[\u0000-\u001f\u007f]/u.test(value) || /[\\/]$/.test(value)) continue
        if (!path.isAbsolute(value) && !session.header?.cwd) continue
        const absolute = path.resolve(session.header?.cwd ?? '.', value)
        if (seen.has(absolute)) continue
        seen.add(absolute)
        files.push({ absolute, displayPath: value })
      }
    }
  }
  return files
}

export async function listReferences(session) {
  const files = []
  for (const ref of referencedPaths(session)) {
    const file = await realpath(ref.absolute).catch(() => null)
    const info = file ? await stat(file).catch(() => null) : null
    if (info?.isDirectory()) continue
    const sensitive = hasSensitiveSegment(ref.absolute) || (file !== null && hasSensitiveSegment(file))
    const available = Boolean(info?.isFile()) && !sensitive
    // Include the resolved path so replacing a symlink invalidates an already-issued handle.
    const id = createHash('sha256').update(`${ref.absolute}\0${file ?? ''}`).digest('hex')
    files.push({ name: path.basename(ref.absolute), path: `reference://${id}`, displayPath: ref.displayPath,
      source: 'reference', size: info?.size ?? 0, available, forbidden: sensitive,
      ...available ? { absolute: file } : { message: sensitive ? '敏感路径不能预览' : '引用文件不存在或不可读' },
    })
  }
  return files
}
