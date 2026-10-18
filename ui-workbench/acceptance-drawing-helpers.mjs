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
  const base64 = (await page.locator(visibleCanvas).screenshot({ type: 'png' })).toString('base64')
  return page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let blue = 0, yellow = 0
    for (let i = 0; i + 3 < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      // macOS color management can shift pure ACI blue to nearby bytes such as (8,0,255).
      if (r <= 16 && g <= 16 && b >= 240) blue++
      if (r > 240 && g > 150 && g < 235 && b < 100) yellow++
    }
    return { blue, yellow }
  }, base64)
}
