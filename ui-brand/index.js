import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const name = 'ui-brand'
export const inject = ['webServer']

const MASCOT_ROUTE = '/camind/assets/camind-mascot.png'
const MASCOT_FILE = fileURLToPath(new URL('./assets/camind-mascot.png', import.meta.url))
let mascotBytesPromise

function readMascot() {
  mascotBytesPromise ??= readFile(MASCOT_FILE)
  return mascotBytesPromise
}

export function apply(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: MASCOT_ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end()
        return
      }
      try {
        const bytes = await readMascot()
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(bytes.length),
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        })
        res.end(req.method === 'HEAD' ? undefined : bytes)
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Camind mascot is unavailable.')
      }
    },
  })
}
