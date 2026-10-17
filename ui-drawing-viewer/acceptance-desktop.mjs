// Live dsh-app:// acceptance using only Node's WebSocket and the CDP endpoint.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const packText = fs.readFileSync(path.join(DESKTOP, 'tests/fixtures/draft/draft_good.json'), 'utf8')
const { outputFiles } = await build({
  stdin: {
    resolveDir: root,
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { DrawingPreview, apply } from './src/client.ts';
      apply({ effect: fn => fn(), slots: { inject() {} } });
      const descriptor = ${JSON.stringify({ name: 'synthetic.dwg', packText })};
      const viewer = document.createElement('div');
      viewer.id = 'viewer';
      viewer.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;z-index:99999;background:#1e2023';
      document.body.appendChild(viewer);
      createRoot(viewer).render(React.createElement(DrawingPreview, { descriptor }));
    `,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  alias: {
    react: path.join(root, '../ui-shell/node_modules/react'),
    'react-dom': path.join(root, '../ui-shell/node_modules/react-dom'),
  },
})

const pages = await fetch('http://127.0.0.1:9236/json/list').then(r => r.json())
const target = pages.find(page => page.url.startsWith('dsh-app:'))
assert.ok(target, '必须连接真实 dsh-app:// 渲染进程')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let seq = 0
const pending = new Map(), pageErrors = []
ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id) {
    const request = pending.get(msg.id)
    if (!request) return
    pending.delete(msg.id)
    if (msg.error) request.reject(new Error(msg.error.message))
    else request.resolve(msg.result)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(msg.params.exceptionDetails.text ?? 'page exception')
  }
}
function send(method, params = {}) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return result.result?.value
}

try {
  await send('Page.bringToFront')
  await send('Runtime.enable')
  await evaluate(outputFiles[0].text)
  await new Promise(resolve => setTimeout(resolve, 600))
  const bootHasPlugin = await evaluate(`Boolean(window.__DSH_BOOT__?.entries?.some(e => e.id === 'camind-ui-drawing-viewer'))`)
  assert.equal(bootHasPlugin, true, 'desktop boot graph must include camind-ui-drawing-viewer')
  const summary = await evaluate(`(() => {
    const host = document.querySelector('.cdv-canvas')
    const meta = document.querySelector('.cdv-meta')?.innerText ?? ''
    const canvas = host?.querySelector('canvas')
    if (!canvas) return { canvases: 0, meta }
    const gl = canvas.getContext('webgl2')
    const pixels = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const colors = new Set()
    for (let i = 0; i < pixels.length; i += 4) {
      colors.add(String(pixels[i]) + ',' + String(pixels[i + 1]) + ',' + String(pixels[i + 2]))
      if (colors.size > 16) break
    }
    return { canvases: host.querySelectorAll('canvas').length, meta, width: canvas.width, height: canvas.height, colors: colors.size }
  })()`)
  assert.equal(summary.canvases, 2, 'DraftPane should create WebGL2 + Canvas2D layers')
  assert.match(summary.meta, /16 实体 · 2 尺寸/)
  assert.ok(summary.width > 0 && summary.height > 0)
  assert.ok(summary.colors > 1, `WebGL 像素为空或单色：${JSON.stringify(summary)}`)
  assert.deepEqual(pageErrors, [])
  console.log(`dsh-app:// 合成图验收通过：${JSON.stringify(summary)}`)
} finally {
  ws.close()
}
