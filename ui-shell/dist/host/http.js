import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
};
export function parseUrl(req) {
    return new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
}
export class HttpBodyTooLargeError extends Error {
    limit;
    constructor(limit) {
        super(`请求体超过 ${Math.ceil(limit / 1024 / 1024)} MiB`);
        this.limit = limit;
        this.name = 'HttpBodyTooLargeError';
    }
}
export async function readJson(req, maxBytes = Number.POSITIVE_INFINITY) {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes)
        throw new HttpBodyTooLargeError(maxBytes);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes)
            throw new HttpBodyTooLargeError(maxBytes);
        chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw)
        return {};
    return JSON.parse(raw);
}
export function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(payload);
}
export function sendError(res, status, error) {
    sendJson(res, status, { error });
}
export function webRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
}
export function serveSpa(res, urlPath, bootGraph) {
    const root = webRoot();
    if (!existsSync(root)) {
        sendError(res, 503, '自定义前端尚未构建：在 ui-shell/ 运行 npm run build');
        return;
    }
    const rel = decodeURIComponent(urlPath.replace(/^\/camind\/?/, '')) || 'index.html';
    const candidate = path.resolve(root, rel);
    if (!candidate.startsWith(root)) {
        sendError(res, 403, '路径越界');
        return;
    }
    const file = existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : path.join(root, 'index.html');
    const ext = path.extname(file);
    res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    });
    if (ext === '.html' && bootGraph) {
        const script = `<script>window.__DSH_BOOT__ = ${JSON.stringify(bootGraph).replaceAll('<', '\\u003c')}</script>`;
        const html = readFileSync(file, 'utf8').replace('<head>', `<head>${script}`);
        res.end(html);
        return;
    }
    createReadStream(file).pipe(res);
}
export function openSse(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
    });
}
export function sseWrite(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
//# sourceMappingURL=http.js.map