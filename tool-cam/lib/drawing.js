// Local, bounded LibreDWG decoding. Original DWG stays immutable; SVG is a partial display, not a measurement engine.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
    preview_partial: true, note: '本地 LibreDWG 转换预览；部分二维实体显示。标注原文/句柄来自 DWG，几何对应及格式化尺寸须核对原图。' }
}
export async function readDrawing(file) {
  if ((await stat(file)).size > MAX) throw new Error('DWG 超过 32 MiB，暂不解析')
  const bytes = await readFile(file)
  if (!/^AC\d{4}$/.test(bytes.subarray(0, 6).toString('ascii'))) throw new Error('文件不是可识别的 DWG（ACxxxx 签名缺失）')
  try {
    const { stdout } = await exec('dwgread', ['-O', 'JSON', file], { timeout: 30000, maxBuffer: MAX, env: { ...process.env, LC_ALL: 'C.UTF-8' } })
    const drawing = decodeDrawing(JSON.parse(stdout))
    const svg = await exec('dwg2SVG', [file], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
    if (!svg.stdout.includes('<svg')) throw new Error('转换未返回 SVG')
    return { ...drawing, svg: svg.stdout }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('缺少本地 LibreDWG dwgread/dwg2SVG；需要在宿主安装，图纸未发送到第三方')
    throw new Error(`DWG 本地解析失败：${String(error.message).slice(0, 500)}`)
  }
}
