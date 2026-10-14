// Browser regression for dependency upgrades: SPA navigation and the actual vendored TeX renderer's trust boundary.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const { chromium } = require(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const errors = [], outbound = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://camind.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  page.on('request', request => { if (new URL(request.url()).origin !== 'http://camind.test') outbound.push(request.url()) })
  await page.goto('http://camind.test/camind/')
  const bundle = await build({ stdin: { contents: `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
    import { renderTexToReact } from './vendor/dsh-client-ui-primitives/src/markdown/katex.tsx'
    function Content() {
      const location = useLocation(), navigate = useNavigate()
      Object.prototype.trust = true
      let hostile
      try { hostile = renderTexToReact('\\\\href{javascript:alert(1)}{click} + \\\\includegraphics{https://evil.test/image.png}', false) }
      finally { delete Object.prototype.trust }
      return <>
        <output>{location.pathname}</output>
        <Link to="/s/acceptance">Session</Link>
        <button onClick={() => navigate('/pages/memory')}>Memory</button>
        <button onClick={() => navigate(-1)}>Back</button>
        <div id="math">{renderTexToReact('x^2 + \\\\frac{1}{2}', false)}</div>
        <div id="hostile">{hostile}</div>
      </>
    }
    createRoot(document.getElementById('root')).render(<BrowserRouter basename="/camind"><Routes><Route path="*" element={<Content/>}/></Routes></BrowserRouter>)
  `, resolveDir: fileURLToPath(new URL('./', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.locator('output').filter({ hasText: /^\/$/ }).waitFor()
  await page.getByRole('link', { name: 'Session', exact: true }).click()
  await page.locator('output').filter({ hasText: /^\/s\/acceptance$/ }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/camind/s/acceptance')
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await page.locator('output').filter({ hasText: /^\/pages\/memory$/ }).waitFor()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.locator('output').filter({ hasText: /^\/s\/acceptance$/ }).waitFor()
  assert.equal(await page.locator('#math .katex-html').count(), 1)
  assert.equal(await page.locator('#math .katex-mathml').count(), 1)
  assert.equal(await page.locator('#math .katex-error').count(), 0)
  assert.equal(await page.locator('#hostile a, #hostile img, #hostile [href], #hostile [src]').count(), 0)
  assert.deepEqual(outbound, [])
  assert.deepEqual(errors, [])
  console.log('dependency browser selfcheck: PASS (basename, wildcard, Link, navigate/back, math and inherited-trust rejection)')
} finally { await browser.close() }
