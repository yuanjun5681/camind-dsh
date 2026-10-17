// Authenticated formal-task API. User confirmations are separate from Agent draft-tool actions.
const PREFIX = '/camind/api/cam/tasks'
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
export function createTaskRoute(ctx, tasks) {
  return async (req, res) => {
    const rejected = ctx.get('connection')?.requestRejection({ headers: req.headers })
    if (rejected !== undefined) return send(res, rejected, { ok: false, message: '未登录或拒绝访问' })
    try {
      const url = new URL(req.url, 'http://localhost'), match = /^\/camind\/api\/cam\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,160})(?:\/(drawing|collect|answer|finish-review|authorize|stop|revise|reference|operations|release))?$/.exec(url.pathname)
      if (!match) return send(res, 404, { ok: false, message: '任务接口不存在' })
      const [, sid, action] = match
      if (req.method === 'GET' && (!action || action === 'drawing')) return send(res, 200, { ok: true, data: action ? await tasks.drawing(sid, { preview: true }) : await tasks.read(sid) })
      if (req.method !== 'POST' || !action || action === 'drawing') return send(res, 405, { ok: false, message: '方法不支持' })
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { ok: false, message: '仅接受 application/json' })
      const chunks = []; let length = 0
      for await (const chunk of req) { length += Buffer.byteLength(chunk); if (length > 256 * 1024) return send(res, 413, { ok: false, message: '请求超过 256 KiB' }); chunks.push(Buffer.from(chunk)) }
      const args = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (action === 'reference') return send(res, 200, { ok: true, data: await tasks.validateReference(sid, args.reference) })
      if (!Number.isInteger(args.version)) throw new Error('必须提交当前任务 version')
      let data
      if (action === 'collect') data = await tasks.collect(sid, args.version, args.inputs)
      if (action === 'operations') data = await tasks.update(sid, args.version, { operations: args.operations }, 'user')
      if (action === 'answer') data = await tasks.answer(sid, args.version, args.id, args.value, args.resolved)
      if (action === 'finish-review') data = await tasks.finishReview(sid, args.version, args.fingerprint, args.requirement_ids)
      if (action === 'authorize') data = await tasks.authorize(sid, args.version, args.fingerprint, args.bounds)
      if (action === 'release') data = await tasks.release(sid, args.version, args.run_id)
      if (action === 'stop') data = await tasks.stop(sid, args.version)
      if (action === 'revise') data = await tasks.revise(sid, args.version, args.feedback)
      return send(res, 200, { ok: true, data })
    } catch (error) { return send(res, error.code === 'TaskConflict' ? 409 : error.code === 'TaskLocked' ? 423 : 400, { ok: false, message: error.message }) }
  }
}
export function registerTaskRoute(ctx, tasks) {
  ctx.plugin({ name: 'cam-task-route', inject: ['webServer'], apply(routeCtx) { routeCtx.webServer.register({ kind: 'prefix', path: PREFIX, handler: createTaskRoute(routeCtx, tasks) }) } })
}
