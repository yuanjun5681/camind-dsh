// camind-service-draft-converter — DWG/DXF → camind-draft-pack v1 图纸包转换服务。
// CAM-Agent Drawing_parser/dwg_to_draft_v1.py 的纯 JS 移植(运行时唯一外部依赖 =
// 用户自装的 dwg2dxf CLI,GPL 铁律:LibreDWG 不进任何安装包,只以子进程调用)。
// 提供 Cordis draftConverter 服务:
//   await convertDwg(absPath) → 契约 v1 包(失败抛错,err.checkErrors 带拒绝码)
//   convertDxf(text, meta) → 契约 v1 包(DXF 直读,meta.sourceName/sourceBytes)
//   preview(pack)       → SVG + 同源文字/尺寸目标索引(实际绘制 entity_ids)
//   check(pack, profile) → packcheck 校验(writer/reader 两档,码表与 CAM-Agent 同源)
//   info()               → { dwg2dxf, libredwg, converter, conversionFingerprint } 版本与转换身份
// 配置:条目 config 的 dwg2dxfPath(volatile 热更)> 环境变量 CAMIND_DWG2DXF > PATH。

import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'

import { convertDxfText, PIPELINE_VERSION, RULES_VERSION, VIEW_RULE_VERSION } from './lib/convert.js'
import { checkDraftPack } from './lib/packcheck.js'
import { svgFromPack, drawingTargetsFromPack } from './lib/svg.js'
import { libredwgVersionAsync, resolveDwg2dxf } from './lib/dwg.js'
import { convertDwgAsync, convertDxfAsync } from './lib/worker.js'
import { converterRelease, converterBuildFingerprint, conversionFingerprint, packIdentity } from './lib/identity.js'

export const name = 'service-draft-converter'
export const Config = z.object({
  dwg2dxfPath: z.string().default('').volatile(),
})

const cellValue = (v) => (v && typeof v.get === 'function' ? v.get() : v)

export function apply(ctx, config) {
  const dwg2dxfPath = () => cellValue(config?.dwg2dxfPath) || undefined
  const release = converterRelease()
  const buildFingerprint = converterBuildFingerprint()
  const conversionIdentity = async (options = {}) => {
    const { signal, ...identityOptions } = options
    return conversionFingerprint({
      buildFingerprint,
      libredwgVersion: options.libredwgVersion ?? await libredwgVersionAsync({ dwg2dxfPath: dwg2dxfPath(), signal }),
      ...identityOptions,
    })
  }

  const draftConverter = {
    convertDwg(absPath, opts = {}) {
      return convertDwgAsync(absPath, {
        dwg2dxfPath: dwg2dxfPath(), timeoutMs: opts.timeoutMs, converterVersion: release,
        signal: opts.signal,
        maxOldGenerationSizeMb: opts.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: opts.maxYoungGenerationSizeMb,
      })
    },
    convertDxf(text, meta = {}) {
      return convertDxfAsync(text, { ...meta, converterVersion: release })
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
    conversionIdentity,
    async identity(pack, options = {}) {
      return packIdentity(pack, { conversionFingerprint: await conversionIdentity(options) })
    },
    async identities(sourceSha256, options = {}) {
      if (!/^[0-9a-f]{64}$/i.test(sourceSha256)) throw new Error('源 SHA256 非法')
      const fingerprint = await conversionIdentity(options)
      return ['autocad', 'nx', 'unknown'].map(channel => ({
        channel,
        ...packIdentity({
          source_sha256: sourceSha256,
          pipeline_version: PIPELINE_VERSION,
          origin: { channel },
          rules_version: RULES_VERSION,
          view_rule_version: VIEW_RULE_VERSION,
        }, { conversionFingerprint: fingerprint }),
      }))
    },
    async info() {
      const bin = resolveDwg2dxf(dwg2dxfPath())
      return {
        dwg2dxf: bin,
        libredwg: await libredwgVersionAsync({ dwg2dxfPath: dwg2dxfPath() }),
        converter: release,
        conversionFingerprint: await conversionIdentity(),
      }
    },
  }
  ctx.provide('draftConverter', draftConverter)

  console.log(
    '[service-draft-converter] loaded；registered: draftConverter 服务'
    + '（convertDwg/convertDxf/check/info）、条目 config（dwg2dxfPath）',
  )
}
