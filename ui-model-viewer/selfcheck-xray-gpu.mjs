// Real Chromium pixel/ID-pick acceptance for complementary masks, including phase-removal and altered-Bayer mutations.
// Exact 4x4 complement is pinned by Node mask math plus production-source mutation needles; GPU color counts are overlap acceptance, not per-pixel mask proof.
// This test drives SceneRenderer phases directly to validate shader and ID pass; GeomView's production phase assignment is covered by selfcheck-xray.mjs.
// Click checks use synthetic PointerEvent through the production handlers and real GPU ID pass, not OS-level pointer input.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import { createPinnedFixturePlugin, loadPinnedFixtures } from './selfcheck-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.CAMIND_PLAYWRIGHT_PATH || 'playwright-core')
const root = fileURLToPath(new URL('./', import.meta.url))
const DESKTOP = path.resolve(process.env.DESKTOP_REPO ?? fileURLToPath(new URL('../../Camind-desktop', import.meta.url)))
const pinned = loadPinnedFixtures(root, DESKTOP, ['packages/viewer/src/synthetic_pack.ts'])
const sourceCommit = pinned.sourceCommit
const shaderPath = path.join(root, 'src/viewer/shaders.ts')
const phaseNeedle = 'p += ivec2(1, 2);'
const productionBayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const alteredBayer = [1, 13, 2, 9, 0, 11, 6, 15, 10, 5, 14, 7, 12, 3, 8, 4]
const keepSet = (bayer, phase) => {
  const result = new Set()
  for (let y = 0; y < 4; ++y) for (let x = 0; x < 4; ++x) {
    const px = phase ? ((y + 2) % 4) * 4 + ((x + 1) % 4) : y * 4 + x
    if (128 / 255 > (bayer[px] + 0.5) / 16) result.add(y * 4 + x)
  }
  return [...result].sort((a, b) => a - b)
}
assert.notDeepEqual(keepSet(alteredBayer, false), keepSet(productionBayer, false), 'altered Bayer must differ from the no-shift control')
assert.deepEqual(keepSet(alteredBayer, false), keepSet(alteredBayer, true), 'altered Bayer must be non-complementary')

async function compile(mutation) {
  const fixturePlugin = createPinnedFixturePlugin(pinned)
  const plugins = [fixturePlugin.plugin]
  if (mutation) plugins.push({
    name: 'shader-mutation',
    setup(b) {
      b.onLoad({ filter: /shaders\.ts$/ }, async args => {
        if (args.path !== shaderPath) return
        const source = await fs.readFile(args.path, 'utf8')
        const spec = mutation === 'remove'
          ? { needle: phaseNeedle, replacement: 'p += ivec2(0, 0);' }
          : mutation === 'bayer'
            ? {
              needle: '0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,\n                                          3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0',
              replacement: alteredBayer.map(value => value.toFixed(1)).join(', '),
            }
            : null
        assert.ok(spec, `unknown shader mutation: ${mutation}`)
        assert.equal(source.split(spec.needle).length - 1, 1, `${mutation} mutation must find exactly one production needle`)
        return { contents: source.replace(spec.needle, spec.replacement), loader: 'ts' }
      })
    },
  })
  const { outputFiles } = await build({
    stdin: {
      resolveDir: root,
      contents: `
        import { SceneRenderer, viewParamsFromCamera, defaultRenderOptions } from './src/viewer/scene_renderer.ts';
        import { GeomView } from './src/viewer/geom_view.ts';
        import { OrbitCamera, Projection, StandardView, meshBounds } from './src/core/index.ts';
        import { makeSyntheticPackMulti, parseSyntheticMesh } from ${JSON.stringify(path.join(DESKTOP, 'packages/viewer/src/synthetic_pack.ts'))};
        window.__runXrayOverlap = () => {
          const canvas = document.getElementById('view');
          const gl = canvas.getContext('webgl2', { antialias: false, depth: true, preserveDrawingBuffer: true });
          if (!gl) throw new Error('WebGL2 unavailable');
          const pack = makeSyntheticPackMulti(200, 2, 4);
          const vertsPerFace = 25;
          const posOff = 32 + pack.faceCount * 16;
          const f32 = new Float32Array(pack.meshBytes.buffer, pack.meshBytes.byteOffset + posOff,
            (pack.meshBytes.byteLength - posOff) / 4);
          let minX = Infinity, maxX = -Infinity;
          for (let v = 0; v < pack.faceCount * vertsPerFace; ++v) {
            const x = f32[v * 3];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
          const cellSize = (maxX - minX) / 3;
          for (let f = 1; f < pack.faceCount; f += 2) {
            const fx = f % 3;
            const shift = fx === 0 ? cellSize : -cellSize;
            for (let v = 0; v < vertsPerFace; ++v) {
              const o = (f * vertsPerFace + v) * 3;
              f32[o] += shift;
              f32[o + 2] += 60;
            }
          }
          const mesh = parseSyntheticMesh(pack);
          const camera = new OrbitCamera();
          camera.setProjection(Projection.Orthographic);
          camera.setSceneBounds(meshBounds(mesh));
          camera.setStandardView(StandardView.Top);
          camera.fit(1);
          const view = viewParamsFromCamera(camera, 1);
          const opts = { ...defaultRenderOptions(), showEdges: false, showToolpath: false };
          const facesOf = body => pack.faces.map((face, index) => ({ face, index }))
            .filter(({ face }) => face.body === body).map(({ index }) => index);
          const redCount = bluePhase => {
            const renderer = new SceneRenderer(gl, { checkErrors: true });
            renderer.setMesh(mesh, pack.faces);
            renderer.setXrayMode(true);
            renderer.setHiddenBodies([1]);
            for (const face of facesOf(0)) {
              renderer.setFaceColor(face, [200, 80, 80, 128]);
              renderer.setFacePhase(face, 0);
            }
            for (const face of facesOf(1)) {
              renderer.setFaceColor(face, [80, 80, 200, 128]);
              renderer.setFacePhase(face, bluePhase);
            }
            renderer.render(view, 400, 400, opts);
            const rgba = new Uint8Array(400 * 400 * 4);
            gl.readPixels(0, 0, 400, 400, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            renderer.dispose();
            let red = 0, blue = 0;
            for (let i = 0; i < rgba.length; i += 4) {
              if (rgba[i] > rgba[i + 2] + 20 && rgba[i] > 60) ++red;
              else if (rgba[i + 2] > rgba[i] + 20 && rgba[i + 2] > 60) ++blue;
            }
            return { red, blue };
          };
          const complementary = redCount(1);
          const sameMask = redCount(0);
          const idDrawCounts = [], idReadSizes = [];
          const originalDrawElements = gl.drawElements.bind(gl);
          gl.drawElements = (...args) => { idDrawCounts.push(args[1]); return originalDrawElements(...args); };
          const originalReadPixels = gl.readPixels.bind(gl);
          gl.readPixels = (...args) => { idReadSizes.push([args[2], args[3]]); return originalReadPixels(...args); };
          const pickRenderer = new SceneRenderer(gl, { checkErrors: true });
          pickRenderer.setMesh(mesh, pack.faces);
          pickRenderer.setXrayMode(true);
          pickRenderer.setHiddenBodies([1]);
          const describe = hit => ({ kind: hit.kind, index: hit.index, body: hit.kind === 1 ? pack.faces[hit.index].body : null });
          const xrayHit = describe(pickRenderer.pick(view, 400, 400, 200, 200, opts));
          pickRenderer.setXrayMode(false);
          const hiddenHit = describe(pickRenderer.pick(view, 400, 400, 200, 200, opts));
          pickRenderer.dispose();
          const meshIdDrawCounts = [...idDrawCounts];
          const meshIdReadSizes = idReadSizes.map(size => [...size]);
          canvas.setPointerCapture = () => {};
          canvas.releasePointerCapture = () => {};
          const productionView = new GeomView(canvas, gl, { dpr: () => 1, requestFrame: fn => fn(), now: () => 0 });
          productionView.setPart('overlap', pack.faces, pack.bodies, { sourceSha256: 'source', geometrySha256: 'geometry' });
          productionView.setMesh(mesh);
          productionView.setHiddenBodies([1]);
          productionView.setXrayMode(true);
          productionView.setSelectableBodies({ sourceSha256: 'source', geometrySha256: 'geometry', bodies: [1] });
          const declaredPick = describe(productionView.pickAt({ x: 200, y: 200 }));
          if (productionView.facePhaseAt(declaredPick.index) !== 0) throw new Error('role declaration alone must not assign phase 1');
          // Phase 1 requires BOTH conditions: the role declaration above (selection filtering)
          // plus this default-translucent assignment (dithered phase). Neither implies the other.
          productionView.setDefaultTranslucentBodies([1]);
          const productionPhase = productionView.facePhaseAt(declaredPick.index);
          let controlPoint = null;
          for (let y = 20; y < 400 && !controlPoint; y += 20) {
            for (let x = 20; x < 400 && !controlPoint; x += 20) {
              const hit = productionView.pickAt({ x, y });
              if (hit.kind === 1 && pack.faces[hit.index].body === 0)
                controlPoint = { x, y, hit: describe(hit) };
            }
          }
          if (!controlPoint) throw new Error('no visible non-declared control face found');
          idDrawCounts.length = 0;
          idReadSizes.length = 0;
          const originalPickAt = productionView.pickAt.bind(productionView);
          const clickRawHits = [];
          productionView.pickAt = pos => {
            const hit = originalPickAt(pos);
            clickRawHits.push(describe(hit));
            return hit;
          };
          const clickAt = (x, y, pointerId) => {
            canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId, clientX: x, clientY: y, bubbles: true }));
            canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId, clientX: x, clientY: y, bubbles: true }));
          };
          clickAt(controlPoint.x, controlPoint.y, 9);
          const selectedAfterControl = productionView.selectedFaces();
          const controlSelectionCount = selectedAfterControl.length;
          clickAt(200, 200, 10);
          const selectedAfterDeclared = productionView.selectedFaces();
          const declaredSelectionCount = selectedAfterDeclared.length;
          const selectedBodiesAfterDeclared = selectedAfterDeclared.map(face => pack.faces[face].body);
          const fullIndexDrawCounts = [...idDrawCounts];
          const declaredIdReadSizes = idReadSizes.map(size => [...size]);
          const clickRawBodies = clickRawHits.map(hit => hit.body);
          productionView.dispose();
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            complementary, sameMask, xrayHit, hiddenHit,
            idDrawCounts: meshIdDrawCounts, idReadSizes: meshIdReadSizes,
            declaredPick, productionPhase, controlPoint, selectedAfterControl, selectedAfterDeclared, selectedBodiesAfterDeclared,
            controlSelectionCount, declaredSelectionCount, clickRawBodies, fullIndexDrawCounts, declaredIdReadSizes,
            fullIndexCount: mesh.indexCount(),
            gain: complementary.red - sameMask.red,
            debugAvailable: debug !== null,
            rendererSource: debug ? 'unmasked' : 'masked',
            vendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : '',
            renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
          };
        };
      `,
    },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { '@camind/core': path.join(root, 'src/core/index.ts') },
    plugins,
  })
  fixturePlugin.assertAllLoadedOnce()
  return outputFiles[0].text
}

const browser = await chromium.launch({
  ...(process.env.CAMIND_CHROMIUM_PATH ? { executablePath: process.env.CAMIND_CHROMIUM_PATH } : {}),
  args: ['--disable-software-rasterizer'],
})
try {
  async function run(mutation) {
    const source = await compile(mutation)
    const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.setContent('<style>body{margin:0}</style><canvas id="view" width="400" height="400"></canvas>')
      await page.addScriptTag({ content: source })
      const result = await page.evaluate(() => window.__runXrayOverlap())
      assert.deepEqual(errors, [])
      return result
    } finally { await page.close() }
  }

  const phaseAcceptance = result => result.sameMask.red > 0 && result.sameMask.blue > 0
    && result.complementary.red > result.sameMask.red * 1.3
    && result.gain > result.sameMask.blue * 0.25
  const assertRealGpuEvidence = result => {
    assert.equal(result.debugAvailable, true, 'WEBGL_debug_renderer_info must be available for GPU evidence')
    assert.equal(result.rendererSource, 'unmasked')
    assert.doesNotMatch(result.renderer, /swiftshader|llvmpipe|softpipe|software rasterizer|software renderer|basic render driver|\bwarp\b/i, `software rendering is not accepted as real GPU evidence: ${result.renderer}`)
    assert.match(result.renderer, /ANGLE|Metal|Direct3D|Vulkan|OpenGL|Mesa|GeForce|Radeon|Adreno|Mali|Apple M\d+|Intel.*Graphics/i,
      `renderer must identify a concrete hardware/backend stack, not a vendor name or masked generic string: ${result.renderer}`)
  }
  for (const fake of [
    { renderer: 'SwiftShader', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'llvmpipe (LLVM)', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'Mesa softpipe', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'ANGLE (Software Rasterizer)', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'Apple Software Renderer', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'Software Renderer', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'Apple Inc.', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'Intel Inc.', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'NVIDIA', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'Basic Render Driver', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'Direct3D11 WARP', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'WebKit WebGL', debugAvailable: true, rendererSource: 'unmasked' },
    { renderer: 'WebKit WebGL', debugAvailable: false, rendererSource: 'masked' },
  ]) assert.throws(() => assertRealGpuEvidence(fake), /GPU evidence|software rendering|hardware\/backend/)
  const assertGpuVendor = vendor => {
    assert.ok(vendor.length > 0, 'UNMASKED_VENDOR_WEBGL must identify the backend vendor')
    assert.doesNotMatch(vendor, /swiftshader|llvmpipe|softpipe|software rasterizer|software renderer|basic render driver|\bwarp\b|webkit/i,
      `software or masked GPU vendor is not accepted: ${vendor}`)
  }
  for (const vendor of [
    '',
    'SwiftShader',
    'llvmpipe (LLVM)',
    'Mesa softpipe',
    'Software Rasterizer',
    'Apple Software Renderer',
    'Software Renderer',
    'Basic Render Driver',
    'Direct3D11 WARP',
    'WebKit',
  ]) assert.throws(() => assertGpuVendor(vendor), /vendor|software|masked/)
  const production = await run(null)
  assertRealGpuEvidence(production)
  assertGpuVendor(production.vendor)
  assert.equal(production.productionPhase, 1, 'GeomView production phase assignment must mark the translucent declared body as phase 1')
  assert.equal(phaseAcceptance(production), true, `production phase acceptance failed: ${JSON.stringify(production)}`)
  // Phase-1 translucency only has to remain visible; equality with the same-density control is acceptable.
  assert.ok(production.complementary.blue > 0, 'phase-1 translucent body must remain visible in the real color pass')
  assert.ok(production.complementary.blue > production.sameMask.blue * 0.9,
    `phase-1 visibility must be comparable to the same-mask control: ${JSON.stringify({ complementary: production.complementary, sameMask: production.sameMask })}`)
  assert.equal(production.xrayHit.kind, 1, `X-ray hidden body must be hit through the real ID pass: ${JSON.stringify(production.xrayHit)}`)
  assert.equal(production.xrayHit.body, 1)
  assert.equal(production.hiddenHit.kind, 1, `visible body must remain pickable with X-ray off: ${JSON.stringify(production.hiddenHit)}`)
  assert.equal(production.hiddenHit.body, 0, `X-ray off must remove the hidden body from the real ID pass: ${JSON.stringify(production.hiddenHit)}`)
  // Current SceneRenderer.pick contract: one mesh ID draw and one 9x9 readback per call.
  assert.equal(production.idDrawCounts.length, 2)
  assert.equal(production.idDrawCounts[0], production.fullIndexCount)
  assert.ok(production.idDrawCounts[1] < production.fullIndexCount)
  assert.deepEqual(production.idReadSizes, [[9, 9], [9, 9]])
  assert.equal(production.declaredPick.kind, 1, `declared body must still be visible to the raw ID pass: ${JSON.stringify(production.declaredPick)}`)
  assert.equal(production.declaredPick.body, 1)
  assert.equal(production.controlPoint.hit.body, 0, `positive click control must hit a non-declared visible body: ${JSON.stringify(production.controlPoint)}`)
  assert.equal(production.controlSelectionCount, 1, 'positive control click must execute the selection path')
  assert.deepEqual(production.clickRawBodies, [0, 1], `click raw hits must be control then declared: ${JSON.stringify(production.clickRawBodies)}`)
  assert.equal(production.declaredSelectionCount, 1, 'CPU selection filtering must reject only the declared body after the real GPU ID hit')
  assert.deepEqual(production.selectedAfterDeclared, production.selectedAfterControl, 'declared click must not replace the positive control selection')
  assert.deepEqual(production.selectedBodiesAfterDeclared, [0], 'the retained selection must remain the non-declared body')
  // Two clicks use one full-index ID draw each; the positive selection also schedules one full-index render.
  assert.deepEqual(production.fullIndexDrawCounts, [production.fullIndexCount, production.fullIndexCount, production.fullIndexCount])
  assert.deepEqual(production.declaredIdReadSizes, [[9, 9], [9, 9]])
  for (const mutation of ['remove', 'bayer']) {
    const mutant = await run(mutation)
    assert.ok(mutant.sameMask.red > 0, `${mutation} mutation must still render a non-empty control frame`)
    assert.equal(mutant.complementary.red, mutant.sameMask.red, `${mutation} mutation must specifically destroy complementarity`)
    assert.equal(phaseAcceptance(mutant), false, `${mutation} shader mutation must fail the same acceptance: ${JSON.stringify(mutant)}`)
    console.log(`${mutation} shader mutation: complementary red=${mutant.complementary.red}, same-mask red=${mutant.sameMask.red}, gain=${mutant.gain} (rejected as required)`)
  }
  console.log(`production: vendor=${production.vendor}; complementary red=${production.complementary.red}, blue=${production.complementary.blue}, same-mask red=${production.sameMask.red}, blue=${production.sameMask.blue}, gain=${production.gain}; real ID hits ${JSON.stringify(production.xrayHit)} -> ${JSON.stringify(production.hiddenHit)}; idDrawCounts=${JSON.stringify(production.idDrawCounts)}; idReadSizes=${JSON.stringify(production.idReadSizes)}; declaredPick=${JSON.stringify(production.declaredPick)} phase=${production.productionPhase}; control=${JSON.stringify(production.controlPoint)} rawBodies=${JSON.stringify(production.clickRawBodies)}; selectedAfterControl=${JSON.stringify(production.selectedAfterControl)}; selectedAfterDeclared=${JSON.stringify(production.selectedAfterDeclared)}; fullIndexDrawCounts=${JSON.stringify(production.fullIndexDrawCounts)}`)
  console.log(`X-ray real-Chromium Z-overlap and ID-pick selfcheck passed on ${production.renderer} at 400x400; fixtures=${sourceCommit}; redRatio=${(production.complementary.red / production.sameMask.red).toFixed(3)}; gainRatio=${(production.gain / production.sameMask.blue).toFixed(3)}; dithering is not smooth blending and same-phase layers still occlude.`)
} finally { await browser.close() }
