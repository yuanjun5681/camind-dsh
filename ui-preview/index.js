// camind-ui-preview（Host 半）—— 会话内容预览路由。
// 自 ui-shell 拆出（2026-08-26，ui-shell 减重）：会话文件预览是自带完整边界
// 的功能（路由 + 视图 + 状态），独立成插件；ui-shell 只保留调用入口。
//
// 路由（prefix /camind/api/preview/sessions，与 ui-shell 的 /camind/api 共存——
// webServer 是「精确未中后最长 prefix 优先」匹配，tool-cam 的 /camind/api/cam/*
// 同款；注意 prefix 不能带尾斜杠，匹配器用 pathname.startsWith(prefix + '/')）：
//   GET /camind/api/preview/sessions/<id>/file?path=<相对路径>          预览描述 JSON
//   GET /camind/api/preview/sessions/<id>/file?path=<相对路径>&raw=1    原始字节流
//
// 路径纪律（与 ui-shell 原实现同口径）：
// - path 相对会话工作区（session cwd，live 取 agents/sessions，非 live 回退
//   sessionPersistence.inspect），realpath 后必须仍在工作区内；
// - upload://<batch>/<path> 引用本会话上传批次（$DSH_HOME/uploads/<session>/），
//   归一化后不得越出批次目录；
// - 拒绝 .git/.dsh/.env* 段；raw 限 20 MiB、文本预览截断 1 MiB；
// - 错误名映射状态码：NotFound→404 / Forbidden→403 / Invalid→400。
// webServer 仅 web profile 提供，headless 不加载本插件（profile 未挂载）。

import { readFile, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ROUTE_PREFIX = '/camind/api/preview/sessions'
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
const MAX_RAW_PREVIEW_BYTES = 20 * 1024 * 1024

const UPLOAD_REF_RE = /^upload:\/\/(upload-[A-Za-z0-9_-]+)\/(.+)$/

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cfg', '.cir', '.ckt', '.conf', '.cpp', '.css', '.csv', '.go', '.h', '.hpp', '.html', '.ini',
  '.java', '.js', '.json', '.jsx', '.log', '.markdown', '.md', '.mjs', '.py', '.rs', '.sh', '.sql',
  '.net', '.ptnset', '.sp', '.spi', '.spice', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])

const MEDIA_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.markdown': 'text/markdown',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function mediaTypeOf(file) {
  const ext = path.extname(file).toLowerCase()
  if (MEDIA_TYPES[ext]) return MEDIA_TYPES[ext]
  if (TEXT_EXTENSIONS.has(ext)) return ext === '.json' ? 'application/json' : 'text/plain'
  return 'application/octet-stream'
}

function previewKind(mediaType) {
  if (mediaType.startsWith('text/') || mediaType === 'application/json' || mediaType === 'image/svg+xml') return 'text'
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf') return 'pdf'
  return 'binary'
}

function hasSensitiveSegment(relative) {
  return relative.split(path.sep).some((segment) => segment === '.git' || segment === '.dsh' || segment.startsWith('.env'))
}

function previewError(name, message) {
  const error = new Error(message)
  error.name = name
  return error
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, message })
}

export const inject = ['webServer', 'agents', 'sessions']

export function apply(ctx) {
  const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const uploadsRoot = path.join(dshHome, 'uploads')
  const persist = ctx.get('sessionPersistence')

  function safeSessionId(value) {
    return String(value ?? 'global').replace(/[^A-Za-z0-9_-]/g, '_')
  }

  async function sessionCwd(sessionId) {
    const live = ctx.agents.get(sessionId)?.session ?? ctx.sessions.get(sessionId)
    if (live?.header.cwd) return live.header.cwd
    if (persist) {
      const inspection = await persist.inspect(sessionId)
      if (inspection.meta.cwd) return inspection.meta.cwd
    }
    throw previewError('FilePreviewInvalidError', '当前会话没有工作目录')
  }

  /** upload:// 引用 → 本会话上传批次内文件（归一化后不得越界）。 */
  async function resolveUploadReference(sessionId, requested) {
    const match = UPLOAD_REF_RE.exec(requested)
    if (!match) return null
    const [, batchId, rawRelative] = match
    const relative = rawRelative.includes('/') ? rawRelative : `files/${rawRelative}`
    const normalized = path.posix.normalize(relative.replace(/\\/g, '/'))
    if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
      throw previewError('FilePreviewForbiddenError', '上传文件引用超出当前批次')
    }
    const batchDir = path.join(uploadsRoot, safeSessionId(sessionId), batchId)
    const candidate = path.join(batchDir, ...normalized.split('/'))
    const rootInfo = await stat(batchDir).catch(() => null)
    if (!rootInfo?.isDirectory()) throw previewError('FilePreviewNotFoundError', `上传批次不存在：${batchId}`)
    const info = await stat(candidate).catch(() => null)
    if (!info?.isFile()) throw previewError('FilePreviewNotFoundError', '上传引用不是文件')
    return { root: batchDir, file: candidate, relative: requested }
  }

  /** 将用户请求约束在 session cwd 或本会话上传批次内，并拒绝跨边界访问。 */
  async function resolveSessionFile(sessionId, requested) {
    if (requested.startsWith('upload://')) {
      const resolved = await resolveUploadReference(sessionId, requested)
      if (resolved) return resolved
      throw previewError('FilePreviewForbiddenError', '上传文件引用非法')
    }
    const cwd = await sessionCwd(sessionId)
    const root = await realpath(cwd)
    const candidate = path.resolve(root, requested)
    const file = await realpath(candidate).catch(() => null)
    if (file === null) throw previewError('FilePreviewNotFoundError', `文件不存在：${requested}`)
    const relative = path.relative(root, file)
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw previewError('FilePreviewForbiddenError', '文件路径超出会话工作区')
    }
    if (hasSensitiveSegment(relative)) {
      throw previewError('FilePreviewForbiddenError', '该路径包含敏感配置或内部数据，不能在界面中预览')
    }
    const info = await stat(file)
    if (!info.isFile()) throw previewError('FilePreviewInvalidError', '目标不是文件')
    return { root, file, relative }
  }

  async function describePreview(sessionId, requested) {
    const resolved = await resolveSessionFile(sessionId, requested)
    const info = await stat(resolved.file)
    const mediaType = mediaTypeOf(resolved.file)
    const kind = previewKind(mediaType)
    if (kind !== 'text') {
      return {
        path: resolved.relative,
        name: path.basename(resolved.file),
        size: info.size,
        mediaType,
        kind,
      }
    }
    const bytes = await readFile(resolved.file)
    const truncated = bytes.length > MAX_TEXT_PREVIEW_BYTES
    return {
      path: resolved.relative,
      name: path.basename(resolved.file),
      size: info.size,
      mediaType,
      kind,
      text: bytes.subarray(0, MAX_TEXT_PREVIEW_BYTES).toString('utf8'),
      ...truncated ? { truncated: true } : {},
    }
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendError(res, 405, '仅支持 GET。')
        return
      }
      let url
      let pathname
      try {
        url = new URL(req.url ?? '', 'http://localhost')
        pathname = decodeURIComponent(url.pathname)
      } catch {
        sendError(res, 400, 'URL 无法解析。')
        return
      }
      const rest = pathname.slice(ROUTE_PREFIX.length).replace(/^\//, '')
      const slash = rest.indexOf('/')
      const sessionId = slash >= 0 ? rest.slice(0, slash) : rest
      const action = slash >= 0 ? rest.slice(slash + 1) : ''
      if (!/^[A-Za-z0-9_-]+$/.test(sessionId) || action !== 'file') {
        sendError(res, 404, `未知接口：GET ${pathname}`)
        return
      }
      const requested = url.searchParams.get('path')?.trim()
      if (!requested) {
        sendError(res, 400, '需要 path')
        return
      }
      try {
        if (url.searchParams.get('raw') === '1') {
          const resolved = await resolveSessionFile(sessionId, requested)
          const info = await stat(resolved.file)
          if (info.size > MAX_RAW_PREVIEW_BYTES) {
            sendError(res, 413, '文件过大，不能在浏览器中直接预览')
            return
          }
          const bytes = await readFile(resolved.file)
          res.writeHead(200, {
            'Content-Type': mediaTypeOf(resolved.file),
            'Content-Length': String(bytes.length),
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(resolved.file))}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
          })
          res.end(bytes)
          return
        }
        sendJson(res, 200, await describePreview(sessionId, requested))
      } catch (error) {
        const name = error instanceof Error ? error.name : ''
        const status = name === 'FilePreviewNotFoundError' ? 404
          : name === 'FilePreviewForbiddenError' ? 403
            : name === 'FilePreviewInvalidError' ? 400
              : 500
        sendError(res, status, error instanceof Error ? error.message : String(error))
      }
    },
  })

  console.log('[ui-preview] 会话文件预览路由已注册：/camind/api/preview/sessions/<id>/file')
}
