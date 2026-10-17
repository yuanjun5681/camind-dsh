// camind-service-draft-converter — DWG/DXF → camind-draft-pack v1 图纸包转换服务。
// CAM-Agent Drawing_parser/dwg_to_draft_v1.py 的纯 JS 移植(运行时唯一外部依赖 =
// 用户自装的 dwg2dxf CLI,GPL 铁律:LibreDWG 不进任何安装包,只以子进程调用)。
// 提供 Cordis draftConverter 服务:
//   await convertDwg(absPath) → 契约 v1 包(失败抛错,err.checkErrors 带拒绝码)
//   convertDxf(text, meta) → 契约 v1 包(DXF 直读,meta.sourceName/sourceBytes)
//   preview(pack)       → SVG + 同源文字/尺寸目标索引(实际绘制 entity_ids)
//   check(pack, profile) → packcheck 校验(writer/reader 两档,码表与 CAM-Agent 同源)
//   info()               → { dwg2dxf, libredwg } 当前解析到的转换链版本
// 配置:条目 config 的 dwg2dxfPath(volatile 热更)> 环境变量 CAMIND_DWG2DXF > PATH。

import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'

import { convertDxfText } from './lib/convert.js'
import { checkDraftPack } from './lib/packcheck.js'
import { svgFromPack, drawingTargetsFromPack } from './lib/svg.js'
import { libredwgVersion, resolveDwg2dxf } from './lib/dwg.js'
import { convertDwgAsync } from './lib/worker.js'

export const name = 'service-draft-converter'
export const Config = z.object({
  dwg2dxfPath: z.string().default('').volatile(),
})

const cellValue = (v) => (v && typeof v.get === 'function' ? v.get() : v)

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export function apply(ctx, config) {
  const dwg2dxfPath = () => cellValue(config?.dwg2dxfPath) || undefined

  const draftConverter = {
    convertDwg(absPath, opts = {}) {
      return convertDwgAsync(absPath, { dwg2dxfPath: dwg2dxfPath(), timeoutMs: opts.timeoutMs, converterVersion: pkg.version })
    },
    convertDxf(text, meta = {}) {
      return convertDxfText(text, { ...meta, converterVersion: pkg.version })
    },
    toSvg(pack) {
      return svgFromPack(pack)
    },
    preview(pack) {
      return { svg: svgFromPack(pack), targets: drawingTargetsFromPack(pack) }
    },
    check(pack, profile = 'writer') {
      return checkDraftPack(pack, profile)
    },
    info() {
      const bin = resolveDwg2dxf(dwg2dxfPath())
      return { dwg2dxf: bin, libredwg: libredwgVersion({ dwg2dxfPath: dwg2dxfPath() }), converter: pkg.version }
    },
  }
  ctx.provide('draftConverter', draftConverter)

  console.log(
    '[service-draft-converter] loaded；registered: draftConverter 服务'
    + '（convertDwg/convertDxf/check/info）、条目 config（dwg2dxfPath）',
  )
}
