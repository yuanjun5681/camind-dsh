// camPipeline — CAM-Agent proxy（NX 工作台）HTTP 客户端服务。
// 协议纪律全部移植自旧 Camind backend/app/services/nx/client.py（NxClient），
// 契约以 docs/nx_endpoint_contract_v1.md 为准。本服务只做传输与状态归集，
// 不含任何领域判断。token 经 dsh 凭据库解析，任何返回值都不携带 token 明文。
//
// 当前能力（设计稿 docs/cam-machining-design.md §4.1/§4.5）：
// - 连接配置解析（settings > 环境变量兜底）+ ping；
// - call(endpoint, params, timeoutSeconds)：秒级只读同步转发（默认 60s、上限 300s）；
// - run(endpoint, params, options)：/submit + /poll 长任务纪律——2s 轮询、
//   默认 1800s deadline、到点查 /health 的 queue_processing 忙碌延展（×4 硬上限）、
//   /poll 结果单次消费（done 立即返回）、超时先 /cancel、worker 错误信封从
//   data.result 提取 error_class；
// - 文件传输：uploadFile（/fs_upload，客户端算 sha256 放 X-CAM-SHA256）、
//   listDir（/fs_list）、stat（/fs_stat，缺失文件回 ok + exists=false）；
// - 回收侧传输：zipDir（/fs_zip 目录打包回收）与 downloadFile（/fs_download
//   单文件回收）——成功时返回文件流而非 JSON 信封；响应头 X-CAM-SHA256 端到端
//   校验（不符整体拒收），X-CAM-Files 头不可信（真机事故在案：头=9 实为 22
//   字节空包），开包实数是调用方职责，本层只给字节；
// - ensureReady（/health 开工前健康门禁，ready=false 附 diagnosis）与
//   windowsPath（src/dst 等非自动解析路径参数的显式绝对化，base_dir 取 /ping）。
//
// 统一返回 { status:'ok', data? } / { status:'error', errorType, errorClass?,
// errorDetail?, msg, retryable? }：连接失败/WorkerTimeout/PollTimeout →
// retryable:true；error_class=refused → false（按设计拒绝）；internal_error →
// false（该报警）；无 error_class 按「判不出」处理，retryable 缺省、判据不钉
// error_type 类名。本地失败（未配置/连不上/响应无法解析）也归一成同形信封，
// 不向模型抛异常栈。
//
// 后续迭代的扩展点（§4.1，本文件内继续生长，不另起服务）：
// （run 目录 op 状态表/断点续跑与机器自检编排已落在 lib/tools/run.js；
//   回收侧开包实数对账与交付拼装已落在 lib/tools/deliver.js。）

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

export const BASE_URL_ENV = 'CAMIND_NX_AGENT_URL'
export const DEFAULT_TOKEN_ENV = 'CAMIND_NX_AGENT_TOKEN'

const REQUEST_TIMEOUT_MS = 10_000

// 同步转发：默认 60s、上限 300s（秒级只读探查；分钟级端点一律走 run）。
const DEFAULT_SYNC_SECONDS = 60
const MAX_SYNC_SECONDS = 300
// 长任务纪律（client.py run()）：1800s deadline、2s 轮询、忙碌延展 ×4 硬上限。
const DEFAULT_DEADLINE_SECONDS = 1800
const BUSY_EXTEND_FACTOR = 4
const DEFAULT_POLL_INTERVAL_SECONDS = 2
// 队列控制端点的参数放请求体顶层，其余端点包 {"params","timeout_seconds"}。
const QUEUE_CONTROL_ENDPOINTS = new Set(['/submit', '/poll', '/cancel'])
// 文件传输放宽 HTTP 超时（worker 侧另有自身的写入时限）。
const TRANSFER_TIMEOUT_MS = 300_000
// 代理层「换个时间再试可能就好」的 error_type 子集（API.md §1.4）。
const RETRYABLE_ERROR_TYPES = new Set(['WorkerTimeout'])

function ok(data) {
  return { status: 'ok', data: data ?? {} }
}

function failure({ errorType, msg, errorClass, errorDetail, retryable }) {
  const result = { status: 'error', errorType, msg }
  if (errorClass !== undefined) result.errorClass = errorClass
  if (errorDetail !== undefined) result.errorDetail = errorDetail
  if (retryable !== undefined) result.retryable = retryable
  return result
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 响应信封 → 统一结果。判成败只看 status 字段，不看 HTTP 码；错误分类映射见
// 文件头注释（判据钉 error_class，不钉 error_type 类名——类名会随上游重构漂）。
function classify(endpoint, envelope) {
  if (envelope.status === 'ok') return ok(envelope.data)
  const errorType = String(envelope.error_type || 'WorkerError')
  const errorClass = typeof envelope.error_class === 'string' ? envelope.error_class : undefined
  let retryable
  if (RETRYABLE_ERROR_TYPES.has(errorType)) retryable = true
  else if (errorClass === 'refused') retryable = false
  else if (errorClass === 'internal_error') retryable = false
  return failure({
    errorType,
    msg: String(envelope.msg || `${endpoint} 调用失败（${errorType}）。`),
    errorClass,
    errorDetail: envelope.error_detail,
    retryable,
  })
}

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

  // 未配置门禁：baseURL 或 token 缺失时返回中文错误信封（不抛异常），
  // 否则返回 { baseURL, token }。
  async function configured() {
    const baseURL = effectiveBaseURL()
    if (!baseURL) {
      return failure({
        errorType: 'not_configured',
        retryable: false,
        msg: `未配置 NX 工作台地址：请在「设置 → 插件 → NX 工作台」填写连接地址，或设置环境变量 ${BASE_URL_ENV}。`,
      })
    }
    const token = await resolveToken()
    if (!token) {
      return failure({
        errorType: 'not_configured',
        retryable: false,
        msg: `未配置 NX 工作台访问令牌：请在「设置 → 插件 → NX 工作台」填写令牌，或设置环境变量 ${getConfig().tokenEnv || DEFAULT_TOKEN_ENV}。`,
      })
    }
    return { baseURL: baseURL.replace(/\/+$/, ''), token }
  }

  // 裸 POST：返回解析后的信封原文；本地失败归一成 error 信封（snake_case，
  // 与代理信封同形，由调用方分类）。
  async function postRaw(conn, endpoint, { body, headers = {}, timeoutMs }) {
    let response
    try {
      response = await fetch(`${conn.baseURL}${endpoint}`, {
        method: 'POST',
        headers: { 'X-CAM-Agent-Token': conn.token, ...headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      return {
        status: 'error',
        error_type: 'unreachable',
        msg: `无法连接 NX 工作台（${conn.baseURL}）：${error?.cause?.message ?? error.message}。请确认 Windows 侧 CAM-Agent proxy 已启动、网络可达。`,
      }
    }
    const envelope = await response.json().catch(() => null)
    if (!envelope || typeof envelope.status !== 'string') {
      return {
        status: 'error',
        error_type: 'bad_response',
        msg: `NX 工作台（${conn.baseURL}）返回了无法解析的响应（HTTP ${response.status}），请确认地址指向 CAM-Agent proxy。`,
      }
    }
    return envelope
  }

  // postRaw 的本地失败 → 统一结果；连接失败可重试，响应无法解析判不出。
  function normalizeLocal(envelope) {
    if (envelope.error_type === 'unreachable') {
      return failure({ errorType: 'unreachable', msg: envelope.msg, retryable: true })
    }
    return failure({ errorType: envelope.error_type ?? 'bad_response', msg: envelope.msg })
  }

  function isLocalFailure(envelope) {
    return envelope.status === 'error'
      && (envelope.error_type === 'unreachable' || envelope.error_type === 'bad_response')
  }

  // 秒级只读同步调用。timeoutSeconds 同时用作请求体字段（worker 等待时长）
  // 与 HTTP 超时（多 15s 余量，让代理有机会先回 WorkerTimeout）。
  async function call(endpoint, params = {}, timeoutSeconds) {
    const conn = await configured()
    if (conn.status === 'error') return conn
    const wait = Math.min(Math.max(Number(timeoutSeconds) || DEFAULT_SYNC_SECONDS, 1), MAX_SYNC_SECONDS)
    const body = QUEUE_CONTROL_ENDPOINTS.has(endpoint)
      ? JSON.stringify(params ?? {})
      : JSON.stringify({ params: params ?? {}, timeout_seconds: wait })
    const envelope = await postRaw(conn, endpoint, {
      body,
      headers: { 'content-type': 'application/json' },
      timeoutMs: wait * 1000 + 15_000,
    })
    return isLocalFailure(envelope) ? normalizeLocal(envelope) : classify(endpoint, envelope)
  }

  // /health 的 queue_processing > 0 ⇒ worker 还在算（不是掉线）。不看 ready/
  // 心跳年龄——单序算得久时心跳本来就陈旧。/health 自己拿不到 ⇒ 当不忙碌，
  // 走原超时路径。
  async function workerBusy() {
    const health = await call('/health', {}, 15)
    if (health.status !== 'ok') return { busy: false, health: null }
    const processing = Number(health.data?.queue_processing) || 0
    return { busy: processing > 0, health: health.data }
  }

  // submit + poll 到完成（client.py run() 的移植）：
  // /poll 结果只取一次，done:true 立即返回；worker 错误信封套在 data.result
  // 里、外层 status:ok，是 error_class 的第二提取点；超时先 /cancel（只保证
  // 撤掉未被领取的命令）；到点先问 /health，还在算则忙碌延展到 ×4 硬上限，
  // 硬上限到点报不可重试的 WorkerTooSlow，否则可重试的 PollTimeout。
  async function run(endpoint, params = {}, options = {}) {
    const initialDeadline = Number(options.deadlineSeconds) || DEFAULT_DEADLINE_SECONDS
    const ceiling = initialDeadline * BUSY_EXTEND_FACTOR
    const intervalSeconds = Number(options.pollIntervalSeconds) || DEFAULT_POLL_INTERVAL_SECONDS
    const submitted = await call('/submit', { endpoint, params: params ?? {} }, 30)
    if (submitted.status !== 'ok') return submitted
    const requestId = String(submitted.data?.request_id ?? '')
    if (!requestId) {
      return failure({ errorType: 'bad_response', msg: `/submit 未返回 request_id（${endpoint}）。` })
    }
    const started = Date.now()
    let deadline = initialDeadline
    for (;;) {
      const polled = await call('/poll', { request_id: requestId }, 30)
      if (polled.status !== 'ok') return polled
      const out = polled.data ?? {}
      if (out.done) {
        const result = out.result ?? {}
        return classify(endpoint, typeof result.status === 'string' ? result : { status: 'ok', data: result })
      }
      const elapsed = (Date.now() - started) / 1000
      if (elapsed > deadline) {
        const { busy, health } = await workerBusy()
        if (busy && elapsed < ceiling) {
          // 还在算——继续等（不 cancel、不判不可用），但不超过硬上限。
          deadline = Math.min(elapsed + Math.max(intervalSeconds, 30), ceiling)
        } else {
          await call('/cancel', { request_id: requestId }, 30)
          if (busy) {
            return failure({
              errorType: 'WorkerTooSlow',
              retryable: false,
              msg: `${endpoint} 已连续计算 ${Math.round(elapsed)}s（上限 ${Math.round(ceiling)}s）仍未完成，`
                + `而 CAM 工作站一直在处理该命令（queue_processing=${health?.queue_processing}）——`
                + '这条任务算不完，不是掉线。请缩小任务规模、拆分任务，或显式给一个更大的 deadline 后重试。',
            })
          }
          return failure({
            errorType: 'PollTimeout',
            retryable: true,
            msg: `${endpoint} 超过 ${Math.round(deadline)}s 未完成（request_id=${requestId}，`
              + '命令可能仍在 CAM 工作站队列中，已尝试取消）。可到 Windows 侧确认 proxy 与 worker 状态后重试。',
          })
        }
      }
      await sleep(intervalSeconds * 1000)
    }
  }

  // 上传单文件到 base_dir 内相对路径，客户端算 sha256 端到端校验。
  async function uploadFile(localAbsPath, remoteRelPath) {
    const conn = await configured()
    if (conn.status === 'error') return conn
    let bytes
    try {
      bytes = readFileSync(localAbsPath)
    } catch (error) {
      return failure({
        errorType: 'local_io',
        retryable: false,
        msg: `本地文件读取失败：${localAbsPath}（${error.message}）。`,
      })
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    const envelope = await postRaw(conn, '/fs_upload', {
      body: bytes,
      headers: { 'X-CAM-Path': remoteRelPath, 'X-CAM-SHA256': digest },
      timeoutMs: TRANSFER_TIMEOUT_MS,
    })
    return isLocalFailure(envelope) ? normalizeLocal(envelope) : classify('/fs_upload', envelope)
  }

  // 回收侧传输的公共段（client.py _download_stream 的移植）：/fs_zip 与
  // /fs_download 成功时返回文件流而不是 JSON 信封——content-type 是
  // application/json 时按信封处理（必为 error；ok JSON 是契约外形态）；
  // 文件流校验响应头 X-CAM-SHA256，不符判 ChecksumMismatch 整体拒收
  // （字节已不可信，不落盘、不归 retryable 分类）。X-CAM-Files 头不可信，
  // 本层不读它——开包实数是调用方职责。
  async function downloadStream(endpoint, params) {
    const conn = await configured()
    if (conn.status === 'error') return conn
    let response
    try {
      response = await fetch(`${conn.baseURL}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-CAM-Agent-Token': conn.token },
        body: JSON.stringify({ params: params ?? {} }),
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      })
    } catch (error) {
      return failure({
        errorType: 'unreachable',
        retryable: true,
        msg: `无法连接 NX 工作台（${conn.baseURL}）：${error?.cause?.message ?? error.message}。请确认 Windows 侧 CAM-Agent proxy 已启动、网络可达。`,
      })
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.startsWith('application/json')) {
      const envelope = await response.json().catch(() => null)
      if (!envelope || typeof envelope.status !== 'string') {
        return failure({
          errorType: 'bad_response',
          msg: `${endpoint} 返回了无法解析的 JSON 响应（HTTP ${response.status}）。`,
        })
      }
      if (envelope.status === 'ok') {
        return failure({
          errorType: 'bad_response',
          msg: `${endpoint} 契约外响应：文件端点应返回文件流，实际返回了 ok JSON 信封。`,
        })
      }
      return classify(endpoint, envelope)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    const declared = (response.headers.get('X-CAM-SHA256') ?? '').trim().toLowerCase()
    if (declared && declared !== digest) {
      return failure({
        errorType: 'ChecksumMismatch',
        msg: `${endpoint} 传输校验失败：响应头声明 sha256 ${declared.slice(0, 12)}…，`
          + `实收字节算出 ${digest.slice(0, 12)}…——字节不可信，已整体拒收（未落盘）。`
          + '可重试；重试仍不符请到 Windows 侧检查 proxy。',
      })
    }
    return ok({ bytes, sha256: digest })
  }

  // 目录打包回收（批量取交付物的唯一正道，别循环 downloadFile 单文件取）：
  // include 是 worker 侧的通配过滤（如 ['*.nc']），缺省整目录。
  async function zipDir(remoteRelPath, include) {
    const params = { path: remoteRelPath }
    if (Array.isArray(include) && include.length > 0) params.include = include
    return downloadStream('/fs_zip', params)
  }

  async function downloadFile(remoteRelPath) {
    return downloadStream('/fs_download', { path: remoteRelPath })
  }

  async function listDir(remoteRelPath = '.') {
    return call('/fs_list', { path: remoteRelPath }, 30)
  }

  // /fs_stat 对缺失文件回 ok + data.exists=false（契约 §8），调用方看 exists。
  async function stat(remoteRelPath) {
    return call('/fs_stat', { path: remoteRelPath, sha256: false }, 60)
  }

  // 开工前健康门禁（旧 Camind client.ensure_ready 的移植）：ready=false 附
  // worker 给的 diagnosis 恢复动作，可重试（去 Windows 侧看一眼）；/health
  // 自己调用失败时原样上浮（unreachable 已是可重试分类）。
  async function ensureReady() {
    const health = await call('/health', {}, 15)
    if (health.status !== 'ok') return health
    if (health.data?.ready === false) {
      return failure({
        errorType: 'NotReady',
        retryable: true,
        msg: `CAM 工作站未就绪：${health.data?.diagnosis ?? 'worker 未就绪（无 diagnosis）'}。`
          + '请到 Windows 侧按上述诊断恢复后重试。',
      })
    }
    return health
  }

  // proxy 只对 prt/out/out_dir 三个参数做相对路径解析；其余路径参数（如
  // /cam_copy_part 的 src/dst）worker 要求 base_dir 内绝对路径——这里把
  // 相对路径显式绝对化（base_dir 来自 /ping，进程内缓存；旧 Camind
  // client.windows_base_dir/to_windows_path 的移植）。
  let cachedBaseDir
  async function windowsPath(relPath) {
    const text = String(relPath ?? '')
    if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\')) return ok(text)
    if (cachedBaseDir === undefined) {
      const pinged = await ping()
      if (pinged.status !== 'ok') return pinged
      const base = String(pinged.data?.base_dir ?? '').replace(/[\\/]+$/, '')
      if (!base) {
        return failure({ errorType: 'bad_response', msg: '/ping 未返回 base_dir，无法绝对化远端路径。' })
      }
      cachedBaseDir = base
    }
    return ok(`${cachedBaseDir}\\${text.replace(/\//g, '\\')}`)
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

  return { connectionInfo, ping, call, run, uploadFile, zipDir, downloadFile, listDir, stat, ensureReady, windowsPath }
}
