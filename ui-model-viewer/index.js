// PRT preview Host: authenticated, session-scoped geometry export and file routes.
import os from 'node:os'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createModelService, FILES } from './lib/models.js'
import { createJointService } from './lib/joint.js'
import { validateSelectionMessages } from './lib/selection.js'
const PREFIX = '/camind/api/models/sessions'
export const inject = ['webServer', 'previewFiles', 'camPipeline', 'tools']
export function apply(ctx) {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const models = createModelService({ home, resolve: (...args) => ctx.previewFiles.resolve(...args), pipeline: ctx.camPipeline })
  const joint = createJointService({ home, models })
  ctx.provide('modelPreview', models)
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    await validateSelectionMessages(messages, agent.id, models)
    if (signal.aborted) return { kind: 'reject' }
    return next()
  })
  ctx.tools.register({
    name: 'read_model_selection',
    description: '核对当前会话的选面引用：验证 PRT 与显示几何包版本、面编号，返回曲面类型和显示包面积。引用过期时明确报错；精确尺寸仍需 NX 量测。',
    parameters: { type: 'object', additionalProperties: false,
      properties: {
        path: { type: 'string', description: '选面引用中的模型路径句柄' },
        source_sha256: { type: 'string', description: '选面引用中的 PRT SHA256' },
        geometry_sha256: { type: 'string', description: '选面引用中的几何清单 SHA256' },
        fids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: '选面引用中的面编号' },
      }, required: ['path', 'source_sha256', 'geometry_sha256', 'fids'],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      try {
        if (!exec?.agent?.id) throw new Error('需要当前会话')
        return JSON.stringify({ status: 'ok', selection: await models.selection(exec.agent.id, args.path, args.source_sha256, args.geometry_sha256, args.fids) })
      } catch (error) { return JSON.stringify({ status: 'error', msg: error.message }) }
    },
  })
  ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: async (req, res) => {
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    const rejection = ctx.get('connection')?.requestRejection({ headers: req.headers })
    if (rejection !== undefined) return json(rejection, { message: '拒绝访问' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const segments = decodeURIComponent(url.pathname).slice(PREFIX.length + 1).split('/')
      const [session, action, name] = segments
      if (!/^[A-Za-z0-9_-]+$/.test(session) || !['model', 'runs', 'selection'].includes(action) || segments.length > 3) return json(404, { message: '未知接口' })
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
      if (action === 'selection') {
        if (req.method !== 'GET' || name) return json(405, { message: '选面引用仅支持 GET' })
        const fids = url.searchParams.get('fids') ?? ''
        if (fids.length > 1000) return json(400, { message: '面编号超限' })
        return json(200, await models.selection(session, requested, url.searchParams.get('sha'), url.searchParams.get('geometry'), fids.split(',')))
      }
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
