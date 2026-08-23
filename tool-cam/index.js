// camind-tool-cam — CAM 加工场景插件（当前：NX 工作台连接配置 + ping +
// camPipeline 长任务/文件传输[含 fs 回收] + cam_survey 读件工具[仅 3D] +
// cam_plan v1 工序单校验/绑定/落盘 + cam_run 远程执行[后台 job + 断点续跑 +
// 最小自检] + cam_deliver 交付打包[NC 回收对账 + 交付报告 + 加工设定单] +
// tools/pre-execute 高风险声明/交付签字硬闸门）。
// Host 半：camPipeline Cordis 服务（lib/pipeline.js）+ settings namespace
// `cam-nx`（照官方 dsh-web-search-deepseek 双件套，热更新）+ web 下的
// POST /camind/api/cam/ping（设置卡片「测试连接」用；webServer 仅 web
// profile 提供，故路由是带自己 inject 的子插件，headless 下自然不激活）。
// 浏览器半是 lib/client.js（官方 Settings → 插件 → 插件配置 里的 keyed 卡片）。
// cam_plan v1 不调 proxy（纯本地校验 + 冻结落盘），机床参数经 inject
// machineRegistry 直读、不经模型转手（设计稿 §3 关键决策 3）。
// 闸门（lib/gate.js）拦 cam_run 与 cam_deliver：只认 run 目录落盘文件。
// cam_run 高风险声明缺失 → deny 中文清单，齐全 → ask 签字卡；cam_deliver 缺
// runstate → deny（先 cam_run），否则一律 ask 签字卡（检查未全过醒目标注）。
// ask 路由 approval 缝（fail-closed 是平台行为）。
// 翻面验证/特征核对、2D 图纸解析、刀路查看器、会话卡片属后续迭代（设计稿 §4）。

import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

import { createCamPipeline, DEFAULT_TOKEN_ENV } from './lib/pipeline.js'
import { registerCamGate } from './lib/gate.js'
import { registerCamSurvey } from './lib/tools/survey.js'
import { registerCamPlan } from './lib/tools/plan.js'
import { registerCamRun } from './lib/tools/run.js'
import { registerCamDeliver } from './lib/tools/deliver.js'

export const name = 'tool-cam'
export const inject = ['credentials', 'tools', 'uploads', 'machineRegistry']

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
  registerCamSurvey(ctx, camPipeline, ctx.uploads)
  registerCamPlan(ctx, { machineRegistry: ctx.machineRegistry, uploads: ctx.uploads })
  registerCamRun(ctx, camPipeline)
  registerCamDeliver(ctx, camPipeline)
  registerCamGate(ctx)

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

  console.log('[tool-cam] loaded；registered: camPipeline 服务（connectionInfo/ping/call/run/uploadFile/zipDir/downloadFile/listDir/stat/ensureReady/windowsPath）、settings namespace cam-nx、工具 cam_survey, cam_plan, cam_run, cam_deliver、cam_run/cam_deliver 硬闸门')
}
