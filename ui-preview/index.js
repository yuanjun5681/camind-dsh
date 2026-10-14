// camind-ui-preview（Host 半）—— 会话内容预览路由。
// 自 ui-shell 拆出（2026-08-26，ui-shell 减重）：会话文件预览是自带完整边界
// 的功能（路由 + 视图 + 状态），独立成插件；ui-shell 只保留调用入口。
//
// 路由（prefix /camind/api/preview/sessions，与 ui-shell 的 /camind/api 共存——
// webServer 是「精确未中后最长 prefix 优先」匹配，tool-cam 的 /camind/api/cam/*
// 同款；注意 prefix 不能带尾斜杠，匹配器用 pathname.startsWith(prefix + '/')）：
//   GET /camind/api/preview/sessions/<id>/files                       输入文件列表
//   GET /camind/api/preview/sessions/<id>/file?path=<相对路径>          预览描述 JSON
//   GET /camind/api/preview/sessions/<id>/file?path=<相对路径>&raw=1    原始字节流
//
// 路径纪律（与 ui-shell 原实现同口径）：
// - path 相对会话工作区（session cwd，live 取 agents/sessions，非 live 回退
//   sessionPersistence.inspect），realpath 后必须仍在工作区内；
// - upload://<batch>/<path> 引用本会话上传批次（$DSH_HOME/uploads/<session>/），
//   归一化后不得越出批次目录；
// - reference://<id> 仅解析当前会话用户消息明确 @ 引用的文件（允许工作区外）；
//   list/resolve 共用校验，已变更的 symlink 目标使句柄失效，冷会话只读开闭；
// - 拒绝 .git/.dsh/.env* 段；raw 限 20 MiB、文本预览截断 1 MiB；
// - .nc（Fanuc G-code）算文本：交付物页签走路径预览，kind=text 才进刀路查看器；
// - 错误名映射状态码：NotFound→404 / Forbidden→403 / Invalid→400。
// webServer 仅 web profile 提供，headless 不加载本插件（profile 未挂载）。

import { readFile, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { hasSensitiveSegment, listReferences } from './lib/references.js'

const ROUTE_PREFIX = '/camind/api/preview/sessions'
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
const MAX_RAW_PREVIEW_BYTES = 20 * 1024 * 1024

const UPLOAD_REF_RE = /^upload:\/\/(upload-[A-Za-z0-9_-]+)\/(.+)$/

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cfg', '.cir', '.ckt', '.conf', '.cpp', '.css', '.csv', '.go', '.h', '.hpp', '.html', '.ini',
  '.java', '.js', '.json', '.jsx', '.log', '.markdown', '.md', '.mjs', '.nc', '.net', '.py', '.rs', '.sh', '.sql',
  '.ptnset', '.sp', '.spi', '.spice', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
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

export const inject = ['webServer', 'agents', 'sessions', 'uploads']

export function apply(ctx) {
  const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const uploadsRoot = path.join(dshHome, 'uploads')
  const persist = ctx.get('sessionPersistence')

  function safeSessionId(value) {
    return String(value ?? 'global').replace(/[^A-Za-z0-9_-]/g, '_')
  }

  async function withSession(sessionId, use) {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw previewError('FilePreviewInvalidError', '非法会话 ID')
    const live = ctx.agents.get(sessionId)?.session ?? ctx.sessions.get(sessionId)
    if (live) return use(live)
    if (!persist) throw previewError('FilePreviewNotFoundError', '会话不存在或尚未打开')
    const handle = await persist.open(sessionId, 'read')
    try {
      const { events } = await handle.read()
      return await use({ header: handle.header, snapshotEvents: () => events })
    } finally {
      await handle.close()
    }
  }

  async function sessionCwd(sessionId) {
    return withSession(sessionId, session => {
      if (session.header?.cwd) return session.header.cwd
      throw previewError('FilePreviewInvalidError', '当前会话没有工作目录')
    })
  }

  async function listPreviewFiles(sessionId) {
    return withSession(sessionId, async session => {
      const uploads = ctx.get('uploads')
      const batches = uploads?.listBatches({ agent: { id: sessionId, session } }) ?? []
      const files = batches.flatMap(batch => batch.files.map(file => ({
        name: file.name, size: file.size, source: file.source, available: true,
        path: `upload://${batch.batch_id}/${file.path}`,
      })))
      const references = await listReferences(session)
      return [...files, ...references.map(({ absolute, ...file }) => file)]
    })
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
    const root = await realpath(batchDir)
    const file = await realpath(candidate)
    const inside = path.relative(root, file)
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside) || hasSensitiveSegment(inside)) {
      throw previewError('FilePreviewForbiddenError', '上传文件路径超出批次或包含敏感段')
    }
    return { root, file, relative: requested }
  }

  /** 将用户请求约束在 session cwd 或本会话上传批次内，并拒绝跨边界访问。 */
  async function resolveSessionFile(sessionId, requested) {
    if (requested.startsWith('task-input://')) {
      const tasks = ctx.get('camTasks')
      if (!tasks) throw previewError('FilePreviewNotFoundError', '正式任务服务不可用')
      const input = await tasks.resolveInput(sessionId, requested)
      return { root: path.dirname(input.file), file: input.file, name: input.name, relative: requested, displayPath: input.name }
    }
    if (requested.startsWith('reference://')) {
      if (!/^reference:\/\/[a-f0-9]{64}$/.test(requested)) throw previewError('FilePreviewForbiddenError', '非法文件引用')
      return withSession(sessionId, async session => {
        const ref = (await listReferences(session)).find(file => file.path === requested)
        if (!ref) throw previewError('FilePreviewForbiddenError', '该文件未被当前会话的用户引用，或引用目标已变更')
        if (!ref.available) throw previewError(ref.forbidden ? 'FilePreviewForbiddenError' : 'FilePreviewNotFoundError', ref.message)
        return { root: path.dirname(ref.absolute), file: ref.absolute, relative: requested, displayPath: ref.displayPath }
      })
    }
    if (requested.startsWith('upload://attachments/')) {
      return withSession(sessionId, session => {
        const uploads = ctx.get('uploads')
        if (!uploads) throw previewError('FilePreviewNotFoundError', '附件服务不可用')
        const requestedFile = requested.slice('upload://attachments/'.length)
        const { file } = uploads.resolveFile({ agent: { id: sessionId, session } }, 'attachments', requestedFile)
        return { root: path.dirname(file.absolute), file: file.absolute, relative: requested }
      })
    }
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
        displayPath: resolved.displayPath ?? resolved.relative,
        path: resolved.relative,
        name: resolved.name ?? path.basename(resolved.file),
        size: info.size,
        mediaType,
        kind,
      }
    }
    const bytes = await readFile(resolved.file)
    const truncated = bytes.length > MAX_TEXT_PREVIEW_BYTES
    return {
      displayPath: resolved.displayPath ?? resolved.relative,
      path: resolved.relative,
      name: resolved.name ?? path.basename(resolved.file),
      size: info.size,
      mediaType,
      kind,
      text: bytes.subarray(0, MAX_TEXT_PREVIEW_BYTES).toString('utf8'),
      ...truncated ? { truncated: true } : {},
    }
  }

  // Shared trust boundary for format-specific preview plugins; no arbitrary host paths.
  ctx.provide('previewFiles', { resolve: resolveSessionFile, list: listPreviewFiles })

  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      // 0.1.7 起官方 Web 有浏览器门禁；本路由读会话工作区文件，同一口径。
      const rejection = ctx.get('connection')?.requestRejection({ headers: req.headers })
      if (rejection !== undefined) {
        sendError(res, rejection, rejection === 401 ? '未登录' : '拒绝访问')
        return
      }
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
      if (!/^[A-Za-z0-9_-]+$/.test(sessionId) || !['file', 'files'].includes(action)) {
        sendError(res, 404, `未知接口：GET ${pathname}`)
        return
      }
      if (action === 'files') {
        try { sendJson(res, 200, { files: await listPreviewFiles(sessionId) }) }
        catch (error) { sendError(res, error.name === 'FilePreviewNotFoundError' ? 404 : 400, error.message) }
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
