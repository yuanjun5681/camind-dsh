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
    handler: (req, res) => handleMemoryApi(ctx, req, res),
  })
}
