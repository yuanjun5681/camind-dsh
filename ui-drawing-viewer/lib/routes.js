// Authenticated HTTP adaptation for drawingPreview jobs and packs. No source paths or URIs are logged.
export const DRAWING_ROUTE_PREFIX = '/camind/api/drawings/sessions'
const MAX_BODY_BYTES = 64 * 1024

function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(text)
}

async function bodyJson(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw Object.assign(new Error('需要 application/json 请求体'), { status: 400 })
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体超过 64 KiB 上限'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw Object.assign(new Error('JSON 请求体无法解析'), { status: 400 }) }
}

function statusCode(error) {
  if (Number.isInteger(error.status)) return error.status
  if (error.name === 'FilePreviewForbiddenError' || error.code === 'FORBIDDEN') return 403
  if (error.name === 'FilePreviewNotFoundError' || error.code === 'ENOENT') return 404
  if (error.code === 'PACK_NOT_READY' || error.code === 'SOURCE_CHANGED') return 409
  return 400
}

export function createDrawingRouteHandler({ service, connection, referenceVerifier }) {
  return async function drawingRoute(req, res) {
    const rejection = connection.requestRejection({ headers: req.headers })
    if (rejection !== undefined) return send(res, rejection, { ok: false, message: rejection === 401 ? '未登录' : '拒绝访问' })
    try {
      const url = new URL(req.url ?? '', 'http://localhost')
      const pathname = decodeURIComponent(url.pathname)
      const rest = pathname.slice(DRAWING_ROUTE_PREFIX.length).replace(/^\//, '')
      const segments = rest.split('/')
      const sessionId = segments.shift()
      if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return send(res, 404, { ok: false, message: '图纸接口不存在' })
      if (segments[0] === 'refs') {
        if (segments.length !== 2 || segments[1] !== 'verify') return send(res, 404, { ok: false, message: '图纸接口不存在' })
        if (req.method !== 'POST') return send(res, 405, { ok: false, message: '引用核验仅支持 POST' })
        if (!referenceVerifier) return send(res, 503, { ok: false, message: '引用核验服务不可用' })
        const body = await bodyJson(req)
        return send(res, 200, await referenceVerifier.verify(sessionId, body.reference ?? body))
      }
      if (segments[0] !== 'packs') return send(res, 404, { ok: false, message: '图纸接口不存在' })
      const parts = segments.slice(1)
      if (parts.length === 0) {
        if (req.method !== 'POST') return send(res, 405, { ok: false, message: '启动转换仅支持 POST' })
        const body = await bodyJson(req)
        if (typeof body.path !== 'string' || !body.path.trim() || body.path.length > 4096) return send(res, 400, { ok: false, message: '需要有效 path' })
        return send(res, 202, service.prepare(sessionId, body.path.trim()))
      }
      const [key, action] = parts
      if (!/^[A-Za-z0-9_-]+$/.test(key) || parts.length > 2) return send(res, 404, { ok: false, message: '图纸接口不存在' })
      if (!action) {
        if (req.method !== 'GET') return send(res, 405, { ok: false, message: '读取图纸包仅支持 GET' })
        if (!/^[0-9a-f]{64}$/i.test(key)) return send(res, 400, { ok: false, message: '非法图纸包身份' })
        const requested = url.searchParams.get('path')?.trim()
        if (!requested || requested.length > 4096) return send(res, 400, { ok: false, message: '读取图纸包需要有效 path' })
        const descriptor = await service.read(sessionId, key, requested)
        return send(res, 200, descriptor, { 'x-pack-sha256': descriptor.pack.sha256 })
      }
      if (!['status', 'cancel', 'retry'].includes(action)) return send(res, 404, { ok: false, message: '图纸接口不存在' })
      if (action === 'status') {
        if (req.method !== 'GET') return send(res, 405, { ok: false, message: '作业状态仅支持 GET' })
        const job = service.status(sessionId, key)
        return job ? send(res, 200, job) : send(res, 404, { ok: false, message: '转换作业不存在' })
      }
      if (req.method !== 'POST') return send(res, 405, { ok: false, message: '作业取消/重试仅支持 POST' })
      if (action === 'cancel') {
        const job = service.cancel(sessionId, key)
        return job ? send(res, 200, job) : send(res, 404, { ok: false, message: '转换作业不存在或已结束' })
      }
      return send(res, 202, service.retry(sessionId, key))
    } catch (error) {
      return send(res, statusCode(error), { ok: false, message: error.message })
    }
  }
}
