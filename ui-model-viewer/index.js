// PRT preview Host: authenticated, session-scoped geometry export and file routes.
import os from 'node:os'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createModelService, FILES } from './lib/models.js'
import { createJointService } from './lib/joint.js'
const PREFIX = '/camind/api/models/sessions'
export const inject = ['webServer', 'previewFiles', 'camPipeline']
export function apply(ctx) {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const models = createModelService({ home, resolve: (...args) => ctx.previewFiles.resolve(...args), pipeline: ctx.camPipeline })
  const joint = createJointService({ home, models })
  ctx.provide('modelPreview', models)
  ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: async (req, res) => {
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    const rejection = ctx.get('connection')?.requestRejection({ headers: req.headers })
    if (rejection !== undefined) return json(rejection, { message: '拒绝访问' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const segments = decodeURIComponent(url.pathname).slice(PREFIX.length + 1).split('/')
      const [session, action, name] = segments
      if (!/^[A-Za-z0-9_-]+$/.test(session) || !['model', 'runs'].includes(action) || segments.length > 3) return json(404, { message: '未知接口' })
      if (req.method !== 'GET' && req.method !== 'POST') return json(405, { message: '仅支持 GET / POST' })
      if (action === 'runs') {
        if (req.method !== 'GET') return json(405, { message: '仅支持 GET' })
        if (name) return json(200, await joint.detail(session, name))
        const requested = url.searchParams.get('path')
        if (!requested || requested.length > 4096) return json(400, { message: '需要有效 path' })
        return json(200, { runs: await joint.list(session, requested) })
      }
      const requested = url.searchParams.get('path')
      if (!requested || requested.length > 4096) return json(400, { message: '需要有效 path' })
      const t = await models.target(session, requested)
      if (name) {
        if (req.method !== 'GET' || !FILES.includes(name) || name === 'manifest.json') return json(404, { message: '未知文件' })
        if ((await models.status(t)).state !== 'ready') return json(409, { message: '模型尚未就绪' })
        const bytes = await readFile(path.join(t.dir, name))
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return res.end(bytes)
      }
      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json') || url.searchParams.get('confirm') !== '1') return json(400, { message: '需确认 NX 导出副作用' })
        return json(202, await models.prepare(t))
      }
      json(200, await models.status(t))
    } catch (error) {
      const code = error.name === 'FilePreviewForbiddenError' ? 403 : error.code === 'ENOENT' || error.name === 'FilePreviewNotFoundError' ? 404 : 400
      json(code, { message: error.message })
    }
  } })
}
