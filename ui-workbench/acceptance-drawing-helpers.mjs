// Shared real-desktop helpers for the DraftPane v2 drawing viewer and public diagnostics.
import assert from 'node:assert/strict'

const visibleCanvas = '.wb-preview-stage:not([hidden]) .cdv-canvas'

export async function waitForDrawing(page, timeout = 90000) {
  const host = page.locator(visibleCanvas)
  await host.waitFor({ timeout })
  await page.waitForFunction(selector => {
    const host = document.querySelector(selector)
    return Boolean(host?.dataset.camera && host.getBoundingClientRect().width > 0 && host.getBoundingClientRect().height > 0)
  }, visibleCanvas, { timeout })
  return host
}

export async function openTaskDrawing(page) {
  await page.getByRole('button', { name: 'CAD 图纸', exact: true }).click()
  return waitForDrawing(page)
}

export async function camera(page) {
  return page.locator(visibleCanvas).evaluate(el => {
    const canvas = el.querySelector('canvas'), rect = el.getBoundingClientRect(), insets = JSON.parse(el.dataset.insets)
    return {
      camera: JSON.parse(el.dataset.camera), insets,
      viewport: {
        x: insets.left, y: insets.top,
        width: canvas.width - insets.left - insets.right,
        height: canvas.height - insets.top - insets.bottom,
      },
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      dpr: canvas.width / rect.width,
    }
  })
}

export function worldAt(snapshot, clientX, clientY) {
  const sx = (clientX - snapshot.rect.left) * snapshot.dpr - snapshot.viewport.x
  const sy = (clientY - snapshot.rect.top) * snapshot.dpr - snapshot.viewport.y
  const scale = snapshot.viewport.height / (snapshot.camera.halfH * 2)
  return {
    x: (sx - snapshot.viewport.width / 2) / scale + snapshot.camera.cx,
    y: -(sy - snapshot.viewport.height / 2) / scale + snapshot.camera.cy,
  }
}

export function screenAt(snapshot, worldX, worldY) {
  const scale = snapshot.viewport.height / (snapshot.camera.halfH * 2)
  const sx = (worldX - snapshot.camera.cx) * scale + snapshot.viewport.width / 2 + snapshot.viewport.x
  const sy = -(worldY - snapshot.camera.cy) * scale + snapshot.viewport.height / 2 + snapshot.viewport.y
  return { x: snapshot.rect.left + sx / snapshot.dpr, y: snapshot.rect.top + sy / snapshot.dpr }
}

export function safeRect(snapshot) {
  return {
    left: snapshot.rect.left + snapshot.viewport.x / snapshot.dpr,
    top: snapshot.rect.top + snapshot.viewport.y / snapshot.dpr,
    right: snapshot.rect.left + (snapshot.viewport.x + snapshot.viewport.width) / snapshot.dpr,
    bottom: snapshot.rect.top + (snapshot.viewport.y + snapshot.viewport.height) / snapshot.dpr,
  }
}

export async function packDescriptor(page, sessionId, path) {
  const identity = await page.locator('.wb-preview-stage:not([hidden]) .cdv-meta span[title]').first().getAttribute('title')
  assert(identity, 'The drawing pack identity must be visible')
  return page.evaluate(async ({ sessionId, path, identity }) => {
    const response = await fetch(`/camind/api/drawings/sessions/${encodeURIComponent(sessionId)}/packs/${identity}?path=${encodeURIComponent(path)}`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.message || `pack read failed: HTTP ${response.status}`)
    return body
  }, { sessionId, path, identity })
}

export async function canvasColors(page) {
  return page.locator(visibleCanvas).evaluate(el => {
    const [glCanvas, textCanvas] = el.children
    let blue = 0, yellow = 0
    const count = data => {
      for (let i = 0; i + 3 < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        if (r === 0 && g === 0 && b === 255) blue++
        if (r > 240 && g > 150 && g < 235 && b < 100) yellow++
      }
    }
    if (glCanvas?.width && glCanvas.height) {
      const gl = glCanvas.getContext('webgl2')
      if (gl) {
        const pixels = new Uint8Array(glCanvas.width * glCanvas.height * 4)
        gl.readPixels(0, 0, glCanvas.width, glCanvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        count(pixels)
      }
    }
    if (textCanvas?.width && textCanvas.height) {
      const context = textCanvas.getContext('2d')
      if (context) count(context.getImageData(0, 0, textCanvas.width, textCanvas.height).data)
    }
    return { blue, yellow }
  })
}
