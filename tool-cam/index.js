// camind-tool-cam — CAM 加工场景插件（当前：NX 工作台连接配置 + ping +
// camPipeline 长任务/文件传输[含 fs 回收] + cam_survey 读件工具[仅 3D] +
// cam_plan v1 工序单校验/绑定/落盘 + cam_run 远程执行[后台 job + 断点续跑 +
// 最小自检] + cam_deliver 交付打包[NC 回收对账 + 交付报告 + 加工设定单 +
// 交付三件套镜像进会话工作区] + tools/pre-execute 高风险声明/交付签字硬闸门）。
// Host 半：camPipeline Cordis 服务（lib/pipeline.js）+ 条目 config（0.2.0 起
// 即设置面：baseURL/tokenEnv/token，Plugins 页可编辑）+ web 下的
// POST /camind/api/cam/ping（设置卡片「测试连接」用）与只读路由
// GET /camind/api/cam/runs（lib/runs-route.js：?session= 列表 + <session>/<runId>
// 详情，数据源 = run 目录落盘，供 ui-shell 工作台「加工」页签；<session>/<runId>/
// delivery/<file> 交付下载与 NC 条目抽取委托 lib/delivery-route.js，严格防越界）
// ——webServer 仅 web profile 提供，故路由是带自己 inject 的子插件，headless 下
// 自然不激活。
// 浏览器半是 lib/client.js（官方 Settings 的 keyed 设置卡片）。
// 会话事件与聊天卡片已退役（2026-08-26）：cam/stage、cam/check-report、
// cam/delivered 三个会话事件不在上游 KNOWN_SESSION_EVENT_TYPES 且 append()
// 无 ignorable 形参，含它们的会话重启后整体拒绝重载（实证事故）——已全面
// 停发；加工过程视图由 ui-shell 工作台「加工」页签承担（数据源 run 目录
// runstate.history），cam.nc.preview 刀路挂点席位改由 ui-shell 声明；历史
// 会话日志用 scripts/repair-cam-session-events.mjs 标 ignorable 修复。
// cam_plan v1 不调 proxy（纯本地校验 + 冻结落盘），机床参数经 inject
// machineRegistry 直读、不经模型转手（设计稿 §3 关键决策 3）。
// 闸门（lib/gate.js）拦 cam_run 与 cam_deliver：只认 run 目录落盘文件。
// cam_run 高风险声明缺失 → deny 中文清单，齐全 → ask 签字卡；cam_deliver 缺
// runstate → deny（先 cam_run），否则一律 ask 签字卡（检查未全过醒目标注）。
// ask 路由 approval 缝（fail-closed 是平台行为）。
// 翻面验证/特征核对、2D 图纸解析、刀路查看器本体属后续迭代（设计稿 §4）。

import z from '@deepseek-ai/schemastery'
import os from 'node:os'
import path from 'node:path'
import { createCamTasks } from './lib/tasks.js'
import { readDrawing, readDrawingPreview } from './lib/drawing.js'
import { registerTaskRoute } from './lib/task-route.js'
import { registerCamTask } from './lib/tools/task.js'
import { validateTaskReferences } from './lib/task-references.js'

import { createCamPipeline, DEFAULT_TOKEN_ENV } from './lib/pipeline.js'
import { registerCamGate } from './lib/gate.js'
import { createRunsRouteHandler } from './lib/runs-route.js'
import { registerCamSurvey } from './lib/tools/survey.js'
import { registerCamPlan } from './lib/tools/plan.js'
import { registerCamRun } from './lib/tools/run.js'
import { registerCamDeliver } from './lib/tools/deliver.js'

export const name = 'tool-cam'
export const inject = ['credentials', 'tools', 'uploads', 'machineRegistry']

// 双字段形态对齐官方模板：tokenEnv 是凭据引用（界面写 .credentials.yaml），
// token 是组合层直存（role('secret')，describe 时被结构性剥离）。
// 0.2.0 起 settings 即插件条目 config：本 Config 由 SettingsForms 按条目 id
// （tool-cam）服务，值落在 profile patch 的条目 config 里；volatile 字段在
// 界面保存后原地热更（cordis updateVolatile），不重建 fiber。
export const Config = z.object({
  baseURL: z.string().default('').volatile(),
  tokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_ENV).volatile(),
  token: z.string().role('secret').volatile(),
})

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

// volatile 字段在解析后的 config 里是 cosmokit cell（.get() 读活值）；
// 非 volatile 兼容普通值。pipeline 每次调用经这里取当前快照。
function cellValue(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

export function apply(ctx, config) {
  const current = () => ({
    baseURL: cellValue(config.baseURL),
    tokenEnv: cellValue(config.tokenEnv),
    token: cellValue(config.token),
  })

  const camPipeline = createCamPipeline(ctx, () => current())
  ctx.provide('camPipeline', camPipeline)
  const camTasks = createCamTasks({
    home: process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
    machineRegistry: ctx.machineRegistry,
    // 当前预览与冻结标注证据分离;转换失败时明确回退兼容预览。
    drawingReader: (file) => readDrawing(file, { converter: ctx.get('draftConverter') }),
    drawingPreview: (file) => readDrawingPreview(file, { converter: ctx.get('draftConverter') }),
    getDrawingPreview: () => ctx.get('drawingPreview'),
    async resolve(sid, reference, exec) {
      if (reference.startsWith('task-input://')) throw new Error('接件请选择原始会话文件；归档快照用于读件/引用')
      const preview = ctx.get('previewFiles')
      if (preview) {
        let requested = reference
        if (!reference.includes('://')) {
          const matches = (await preview.list(sid)).filter(file => file.name === reference || file.path === reference || file.displayPath === reference)
          if (matches.length > 1) throw new Error('文件名不唯一，请使用会话文件引用')
          if (matches.length === 1) requested = matches[0].path
        }
        const resolved = await preview.resolve(sid, requested)
        return { ...resolved, reference: requested, name: path.basename(resolved.file) }
      }
      const scope = exec ?? { agent: { id: sid, session: ctx.get('agents')?.get(sid)?.session } }
      const uri = /^upload:\/\/([^/]+)\/(.+)$/.exec(reference)
      if (uri) { const { file } = ctx.uploads.resolveFile(scope, uri[1], uri[2]); return { file: file.absolute, reference, name: file.name } }
      const matches = ctx.uploads.listBatches(scope).flatMap(batch => batch.files.filter(file => file.name === reference || file.path === reference).map(file => ({ file, batch })))
      if (matches.length !== 1) throw new Error('请使用当前会话唯一的上传文件引用')
      const file = matches[0].file
      return { file: file.absolute, reference: `upload://${matches[0].batch.batch_id}/${file.path}`, name: file.name }
    },
    async geometry(sid, reference) {
      const models = ctx.get('modelPreview')
      return models ? models.status(await models.target(sid, reference)) : null
    },
  })
  ctx.provide('camTasks', camTasks)
  registerCamTask(ctx, camTasks)
  registerTaskRoute(ctx, camTasks)
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    await validateTaskReferences(messages, agent.id, camTasks, () => ctx.get('drawingPreview'))
    if (signal.aborted) return { kind: 'reject' }
    return next()
  })
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
          // 0.1.7 起官方 Web 有浏览器门禁；本路由回显连接信息，同一口径。
          const rejection = routeCtx.get('connection')?.requestRejection({ headers: req.headers })
          if (rejection !== undefined) return sendJson(res, rejection, { ok: false, message: rejection === 401 ? '未登录' : '拒绝访问' })
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
      // run 只读查询 + 交付下载（列表/详情数据源是 run 目录落盘；delivery 子路径
      // 委托 delivery-route.js），严格防越界见 runs-route.js / delivery-route.js。
      const runsHandler = createRunsRouteHandler()
      routeCtx.webServer.register({
        kind: 'prefix',
        path: '/camind/api/cam/runs',
        handler: (req, res) => {
          const rejection = routeCtx.get('connection')?.requestRejection({ headers: req.headers })
          if (rejection !== undefined) return sendJson(res, rejection, { ok: false, message: rejection === 401 ? '未登录' : '拒绝访问' })
          return runsHandler(req, res)
        },
      })
    },
  })

  console.log('[tool-cam] loaded；registered: camPipeline 服务（connectionInfo/ping/call/run/uploadFile/zipDir/downloadFile/listDir/stat/ensureReady/windowsPath）、条目 config（baseURL/tokenEnv/token）、工具 cam_survey, cam_plan, cam_run, cam_deliver、cam_run/cam_deliver 硬闸门、web 路由 /camind/api/cam/ping 与 /camind/api/cam/runs（run 列表/详情 + 交付下载）')
}
