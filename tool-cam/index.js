// camind-tool-cam — CAM 加工场景插件（初版：NX 工作台连接配置 + ping）。
// Host 半：camPipeline Cordis 服务（lib/pipeline.js）+ settings namespace
// `cam-nx`（照官方 dsh-web-search-deepseek 双件套，热更新）+ web 下的
// POST /camind/api/cam/ping（设置卡片「测试连接」用；webServer 仅 web
// profile 提供，故路由是带自己 inject 的子插件，headless 下自然不激活）。
// 浏览器半是 lib/client.js（官方 Settings → 插件 → 插件配置 里的 keyed 卡片）。
// 4 个 CAM 模型工具、tools/pre-execute 闸门、断点续跑属后续迭代（设计稿 §4）。

import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

import { createCamPipeline, DEFAULT_TOKEN_ENV } from './lib/pipeline.js'

export const name = 'tool-cam'
export const inject = ['credentials']

// 双字段形态对齐官方模板：tokenEnv 是凭据引用（界面写 .credentials.yaml），
// token 是组合层直存（role('secret')，describe 时被结构性剥离）。
export const Config = z.object({
  baseURL: z.string().default(''),
  tokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_ENV),
  token: z.string().role('secret'),
})

const SETTINGS_NS = settingsNamespace('cam-nx')

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function apply(ctx, config) {
  let current = () => config
  installSettingsSection(ctx, SETTINGS_NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })

  const camPipeline = createCamPipeline(ctx, () => current())
  ctx.provide('camPipeline', camPipeline)

  // 仅 web profile：子插件 inject webServer，headless 下保持不激活、不影响服务本体。
  ctx.plugin({
    name: 'tool-cam-ping-route',
    inject: ['webServer'],
    apply(routeCtx) {
      routeCtx.webServer.register({
        kind: 'exact',
        path: '/camind/api/cam/ping',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '仅支持 POST。' })
          const result = await camPipeline.ping()
          const { baseURL } = await camPipeline.connectionInfo()
          if (result.status === 'ok') {
            const data = result.data ?? {}
            sendJson(res, 200, {
              ok: true,
              message: `连接成功：base_dir ${data.base_dir ?? '未知'}，proxy_version ${data.proxy_version ?? '未知'}。`,
              baseURL,
              baseDir: data.base_dir,
              proxyVersion: data.proxy_version,
            })
          } else {
            sendJson(res, 200, { ok: false, message: result.msg ?? '连接失败。', baseURL })
          }
        },
      })
    },
  })

  console.log('[tool-cam] loaded；registered: camPipeline 服务（connectionInfo/ping）、settings namespace cam-nx')
}
