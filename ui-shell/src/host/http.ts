/**
 * 最小 HTTP 帮手：JSON 读写、静态文件、SSE。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
}

export class HttpBodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`请求体超过 ${Math.ceil(limit / 1024 / 1024)} MiB`)
    this.name = 'HttpBodyTooLargeError'
  }
}

export async function readJson(req: IncomingMessage, maxBytes = Number.POSITIVE_INFINITY): Promise<unknown> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpBodyTooLargeError(maxBytes)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new HttpBodyTooLargeError(maxBytes)
    chunks.push(bytes)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw) as unknown
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

export function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error })
}

export function webRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web')
}

export function serveSpa(res: ServerResponse, urlPath: string, bootGraph?: unknown): void {
  const root = webRoot()
  if (!existsSync(root)) {
    sendError(res, 503, '自定义前端尚未构建：在 ui-shell/ 运行 npm run build')
    return
  }
  const rel = decodeURIComponent(urlPath.replace(/^\/camind\/?/, '')) || 'index.html'
  const candidate = path.resolve(root, rel)
  if (!candidate.startsWith(root)) {
    sendError(res, 403, '路径越界')
    return
  }
  const file = existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : path.join(root, 'index.html')
  const ext = path.extname(file)
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
  })
  if (ext === '.html' && bootGraph) {
    const script = `<script>window.__DSH_BOOT__ = ${JSON.stringify(bootGraph).replaceAll('<', '\\u003c')}</script>`
    const html = readFileSync(file, 'utf8').replace('<head>', `<head>${script}`)
    res.end(html)
    return
  }
  createReadStream(file).pipe(res)
}

export function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
}

export function sseWrite(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}
