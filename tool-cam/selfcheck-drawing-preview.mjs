// Preview status regression: known dimension helper points are not missing drawing content.
// Visible/unknown omissions and compatibility fallback must remain explicit; diagnostics stay separate.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readDrawingPreview } from './lib/drawing.js'

const preview = by_reason => readDrawingPreview('unused.dwg', { converter: {
  convertDwg: async () => ({ self_check: { dropped: { by_type: { POINT: Object.values(by_reason).reduce((a, b) => a + b, 0) }, by_reason } } }),
  toSvg: () => '<svg/>',
} })
const helpers = await preview({ ignored_dimension_defpoint: 167 })
assert.equal(helpers.preview_partial, false, 'Dimension helper points must not trigger a missing-content warning')
assert.equal(helpers.preview_info.status, 'ready')
assert(helpers.preview_info.omissions.some(text => text.includes('167') && text.includes('标注辅助点')))
const visiblePoint = await preview({ unsupported_block_entity: 1 })
assert.equal(visiblePoint.preview_partial, true, 'A visible point must not be silently ignored')
const image = await preview({ ignored_dimension_defpoint: 167, unsupported_image: 2 })
assert.equal(image.preview_info.status, 'partial')
assert(image.preview_info.messages.some(text => text.includes('2') && text.includes('图片')))
assert(!image.preview_info.messages.join('').includes('unsupported'))
const unknown = await preview({ future_reason: 1 })
assert.equal(unknown.preview_partial, true)
assert(!unknown.preview_info.messages.join('').includes('future_reason'))
assert(unknown.preview_info.diagnostics.includes('future_reason'))
assert.equal((await preview({})).preview_info.status, 'ready')

if (process.platform !== 'win32') {
  const dir = await mkdtemp(path.join(tmpdir(), 'camind-preview-check-')), oldPath = process.env.PATH
  try {
    await writeFile(path.join(dir, 'dwg2SVG'), `#!${process.execPath}\nconsole.log('<svg/>')`, { mode: 0o700 })
    process.env.PATH = `${dir}${path.delimiter}${oldPath}`
    const fallback = await readDrawingPreview('unused.dwg', { converter: { convertDwg: async () => { throw new Error('synthetic conversion failure') } } })
    assert.equal(fallback.preview_partial, true)
    assert.equal(fallback.preview_info.status, 'fallback')
    assert(!fallback.preview_info.messages.join('').includes('synthetic conversion failure'))
    assert(fallback.preview_info.diagnostics.includes('synthetic conversion failure'))
  } finally { process.env.PATH = oldPath; await rm(dir, { recursive: true, force: true }) }
}
console.log('drawing preview status selfcheck: PASS')
