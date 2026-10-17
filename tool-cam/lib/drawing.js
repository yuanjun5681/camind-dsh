// Local, bounded DWG evidence decoding and independent display preview. Neither rewrites the source or provides precision measurement.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
const exec = promisify(execFile)
const MAX = 32 * 1024 * 1024
export function decodeDrawing(data) {
  if (!data || !Array.isArray(data.OBJECTS) || data.OBJECTS.length > 200000) throw new Error('DWG 对象清单缺失或超限')
  const objects = data.OBJECTS
  const handle = value => Array.isArray(value) && Number.isSafeInteger(value.at(-1)) ? value.at(-1).toString(16) : null
  const clean = value => String(value ?? '').replace(/\\P/g, '\n').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
  const layers = Object.fromEntries(objects.filter(o => o.object === 'LAYER').map(o => [handle(o.handle), String(o.name)]))
  const annotations = objects.filter(o => o.entity && (['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(o.entity) || o.entity.startsWith('DIMENSION'))).map(o => {
    const id = handle(o.handle)
    if (!id) throw new Error('DWG 标注缺少稳定句柄')
    return { id, type: o.entity, layer: layers[handle(o.layer)] ?? '', text: clean(o.text_value ?? o.text ?? o.user_text),
      ...(Number.isFinite(o.act_measurement) ? { nominal: o.act_measurement } : {}),
      anchor: o.ins_pt ?? o.text_midpt ?? null, raw: o }
  })
  const unknown = objects.filter(o => /UNKNOWN|PROXY/.test(o.entity ?? '')).map(o => o.entity)
  return { readable: annotations.length > 0 && unknown.length === 0, units: data.HEADER?.INSUNITS === 4 ? 'mm' : data.HEADER?.INSUNITS === 1 ? 'inch' : 'unknown',
    version: data.FILEHEADER?.version ?? null, annotations, layers: Object.values(layers),
    layouts: objects.filter(o => o.object === 'LAYOUT').map(o => ({ name: o.layout_name, id: handle(o.handle) })),
    entity_count: objects.filter(o => o.entity).length, unknown_types: [...new Set(unknown)],
    preview_partial: true, note: '部分内容未显示' }
}
export async function readDrawing(file, { converter } = {}) {
  if ((await stat(file)).size > MAX) throw new Error('DWG 超过 32 MiB，暂不解析')
  const bytes = await readFile(file)
  if (!/^AC\d{4}$/.test(bytes.subarray(0, 6).toString('ascii'))) throw new Error('文件不是可识别的 DWG（ACxxxx 签名缺失）')
  try {
    const { stdout } = await exec('dwgread', ['-O', 'JSON', file], { timeout: 30000, maxBuffer: MAX, env: { ...process.env, LC_ALL: 'C.UTF-8' } })
    const drawing = decodeDrawing(JSON.parse(stdout))
    return { ...drawing, ...await readDrawingPreview(file, { converter }) }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('缺少本地 LibreDWG dwgread；需要在宿主安装，图纸未发送到第三方')
    throw new Error(`DWG 本地解析失败：${String(error.message).slice(0, 500)}`)
  }
}
function previewInfo(pack) {
  const dropped = pack.self_check?.dropped ?? {}, reasons = dropped.by_reason ?? {}
  const labels = { unsupported_block_entity: '标注块对象', unsupported_image: '图片对象', unsupported_ole: '嵌入对象',
    unsupported_proxy: '代理对象', unsupported_3d: '三维对象', no_geometry_block: '尺寸标注', empty_mtext: '文字对象' }
  const helpers = reasons.ignored_dimension_defpoint ?? 0
  const messages = Object.entries(reasons).filter(([reason, count]) => reason !== 'ignored_dimension_defpoint' && count > 0)
    .map(([reason, count]) => `${count} 个${labels[reason] || '图纸对象'}未能显示，请打开原图核对。`)
  return { status: messages.length ? 'partial' : 'ready', messages,
    omissions: helpers ? [`已省略 ${helpers} 个标注辅助点，不作为图纸内容显示。`] : [],
    diagnostics: Object.keys(reasons).length ? JSON.stringify({ dropped }, null, 2) : '' }
}
// Display-only refresh: never rewrites the frozen annotation evidence.
export async function readDrawingPreview(file, { converter } = {}) {
  let diagnostics = '未启用图纸转换服务'
  if (converter) {
    try {
      const pack = await converter.convertDwg(file), info = previewInfo(pack)
      const { svg, targets } = converter.preview ? converter.preview(pack) : { svg: converter.toSvg(pack), targets: [] }
      const preview_sha256 = createHash('sha256').update(JSON.stringify({ svg, targets })).digest('hex')
      return { svg, targets, preview_sha256, preview_partial: info.status !== 'ready', note: info.status === 'partial' ? '预览有缺失' : '', preview_info: info }
    } catch (error) { diagnostics = String(error.message).slice(0, 500) }
  }
  const svg = await exec('dwg2SVG', [file], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
  if (!svg.stdout.includes('<svg')) throw new Error('转换未返回 SVG')
  return { svg: svg.stdout, targets: [], preview_sha256: null, preview_partial: true, note: '已使用兼容预览',
    preview_info: { status: 'fallback', messages: ['部分图纸内容可能未显示，请打开原图核对。'], omissions: [], diagnostics } }
}
