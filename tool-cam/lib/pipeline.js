// camPipeline — CAM-Agent proxy（NX 工作台）HTTP 客户端服务。
// 当前为最小集合（设计稿 docs/cam-machining-design.md §4.1/§4.5 的初版）：
// 连接配置解析（settings > 环境变量兜底）+ ping。token 经 dsh 凭据库解析，
// 任何返回值都不携带 token 明文。
//
// 后续迭代的扩展点（§4.1，本文件内继续生长，不另起服务）：
// - submit+poll 长任务纪律（/submit、/poll 单次取结果、忙碌延展、超时先 cancel）；
// - 文件传输（/fs_upload sha256、/fs_zip 开包实数、/fs_download 头校验）；
// - run 目录 op 状态表与断点续跑决策（ok 跳过 / generated 补 post / 其余重跑）；
// - 机器自检编排（NC 对账 / 空刀路 fail-closed / 翻面验证 / 特征核对）。

import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

export const BASE_URL_ENV = 'CAMIND_NX_AGENT_URL'
export const DEFAULT_TOKEN_ENV = 'CAMIND_NX_AGENT_TOKEN'

const REQUEST_TIMEOUT_MS = 10_000

// getConfig 返回当前生效的 settings 节（installSettingsSection 的 source thunk，
// 热更新由 dsh-settings 驱动，本服务每次调用重新读取，不缓存配置）。
export function createCamPipeline(ctx, getConfig) {
  // baseURL 优先级：settings 值 > 环境变量 CAMIND_NX_AGENT_URL > 空
  function effectiveBaseURL() {
    const configured = getConfig().baseURL
    if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
    return launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value ?? ''
  }

  // token 优先级：Config 直存（role('secret')，组合层用）> 凭据库 tokenEnv 引用。
  // 返回值只用于请求头，绝不外露。
  async function resolveToken() {
    const config = getConfig()
    if (typeof config.token === 'string' && config.token.length > 0) return config.token
    const refName = config.tokenEnv || DEFAULT_TOKEN_ENV
    if (!isCredentialRefName(refName)) return undefined
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(credentialRef(refName)))?.value
    const ambient = launchEnvironmentOf(ctx).get(refName)?.value
    return ambient !== undefined && ambient.length > 0 ? ambient : undefined
  }

  async function connectionInfo() {
    const token = await resolveToken()
    return {
      baseURL: effectiveBaseURL(),
      tokenConfigured: typeof token === 'string' && token.length > 0,
    }
  }

  // proxy 契约：全部端点 POST，响应信封 {status:'ok',data} / {status:'error',...}，
  // 判成败只看 status 字段，不看 HTTP 码。本地失败（未配置/连不上/响应无法解析）
  // 也归一成同形信封，调用方只认 status。
  async function ping() {
    const baseURL = effectiveBaseURL()
    if (!baseURL) {
      return {
        status: 'error',
        error_type: 'not_configured',
        msg: `未配置 NX 工作台地址：请在「设置 → 插件 → NX 工作台」填写连接地址，或设置环境变量 ${BASE_URL_ENV}。`,
      }
    }
    const token = await resolveToken()
    if (!token) {
      return {
        status: 'error',
        error_type: 'not_configured',
        msg: `未配置 NX 工作台访问令牌：请在「设置 → 插件 → NX 工作台」填写令牌，或设置环境变量 ${getConfig().tokenEnv || DEFAULT_TOKEN_ENV}。`,
      }
    }
    let response
    try {
      response = await fetch(`${baseURL.replace(/\/+$/, '')}/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-CAM-Agent-Token': token },
        body: '{}',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      return {
        status: 'error',
        error_type: 'unreachable',
        msg: `无法连接 NX 工作台（${baseURL}）：${error?.cause?.message ?? error.message}。请确认 Windows 侧 CAM-Agent proxy 已启动、网络可达。`,
      }
    }
    const envelope = await response.json().catch(() => null)
    if (!envelope || typeof envelope.status !== 'string') {
      return {
        status: 'error',
        error_type: 'bad_response',
        msg: `NX 工作台（${baseURL}）返回了无法解析的响应（HTTP ${response.status}），请确认地址指向 CAM-Agent proxy。`,
      }
    }
    return envelope
  }

  return { connectionInfo, ping }
}
