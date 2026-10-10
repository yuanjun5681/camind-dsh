// camind-page-memory Host half — memory-bank JSON API under /camind/api/memory
// (longest-prefix wins over ui-shell's /camind/api, so the two never interfere).
// Domain logic lives in camind-tool-memory's memoryBank Cordis service (injected);
// this half only does HTTP routing and LLM metadata backfill scheduling.
// Browser half is lib/client.js.

import { handleMemoryApi } from './lib/server.js'

export const name = 'page-memory'

export const inject = ['webServer', 'memoryBank']

export function apply(ctx) {
  ctx.webServer.register({
    kind: 'prefix',
    path: '/camind/api/memory',
    handler: (req, res) => {
      // 0.1.7 起官方 Web 有浏览器门禁；记忆库含私有领域知识，同一口径。
      const rejection = ctx.get('connection')?.requestRejection({ headers: req.headers })
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: rejection === 401 ? '未登录' : '拒绝访问' }))
        return
      }
      handleMemoryApi(ctx, req, res)
    },
  })
}
