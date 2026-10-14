// cam_survey 模型工具 —— CAM 读件（v1 仅 3D；2D 图纸解析属下一迭代，
// 见 docs/cam-machining-design.md §4.2）。
// 流程：uploads 服务解析当前 session 已上传文件 → camPipeline.uploadFile
// 推到 proxy input/<session>_<sha8>_<文件名>（命名约定移植自旧 Camind
// flows/nx_machining/flow.py，task 标识用 dsh session id）→
// camPipeline.run('/cam_survey') → 透传零件事实 + 疑似高风险候选清单
// （候选供人确认，非判定）。全部失败路径返回中文、可行动的错误 JSON。

import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync } from 'node:fs'

import { deriveRiskCandidates } from '../survey-candidates.js'

function json(payload) {
  return JSON.stringify(payload, null, 2)
}

function failure(stage, result, advice) {
  const payload = {
    status: 'error',
    stage,
    error_type: result.errorType,
    msg: result.msg,
  }
  if (result.errorClass !== undefined) payload.error_class = result.errorClass
  if (result.retryable !== undefined) payload.retryable = result.retryable
  if (advice) payload.advice = advice
  return json(payload)
}

// 代理错误分类 → 给模型的处置建议（设计稿 §4.1 错误分类映射）。
function adviceOf(result) {
  if (result.retryable === true) return '可到 Windows 侧确认 CAM-Agent proxy 与 worker 状态后重试。'
  if (result.errorClass === 'refused') return 'proxy 按设计拒绝（护栏正常工作的证据）：请核对入参与前置条件，不要原样重试。'
  if (result.errorClass === 'internal_error') return 'proxy 内部错误：请记录现象并告知人工排查。'
  return '无法判定错误类别：请把错误信息如实转述给用户。'
}

export function safeSessionId(value) {
  return String(value ?? 'global').replace(/[^A-Za-z0-9_-]/g, '_')
}

// 远端文件名只保留 ASCII 可打印字符（路径分隔符与非 ASCII 一律压成下划线）：
// X-CAM-Path 是 HTTP 头，非 ASCII 在 fetch 侧直接抛 ByteString 错（实证
// 2026-08-25「ZM26030-704程式.prt」上传失败）；sha8 前缀保唯一性，可读性其次。
export function safeRemoteName(name) {
  return String(name).replace(/[\\/<>:"|?*]/g, '_').replace(/[^\x20-\x7E]/g, '_')
}

// 会话消息里 @/绝对路径 提及的零件文件（用户在 composer 用 @ 引主机文件而非
// 上传时）。命中即得绝对路径——路径是用户自己写在会话里的，fs 工具本来就可读，
// cam_survey 把它当上传件推给 proxy。
function mentionedParts(exec) {
  const events = exec?.agent?.session?.snapshotEvents?.()
  if (!events) return []
  const found = new Map()
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const content = event.data?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part?.type !== 'text' || typeof part.text !== 'string') continue
      for (const m of part.text.matchAll(/@(\/[^\s@]+)/g)) {
        const absolute = m[1]
        const name = absolute.split('/').pop()
        if (!found.has(name)) found.set(name, absolute)
      }
    }
  }
  return [...found.entries()].map(([name, absolute]) => ({ name, absolute }))
}

// 在当前 session 的全部上传批次里按文件名/清单路径找文件；跨 session 与越界
// 由 uploads 服务的 manifest 校验挡住（这里只读到 batch.files 的声明清单）。
export async function resolvePart(uploads, exec, requested, ctx) {
  if (requested.startsWith('task-input://')) {
    const input = await ctx?.get('camTasks')?.resolveInput(exec.agent.id, requested)
    if (!input) throw new Error('正式任务输入服务不可用')
    return { batch: null, file: { name: input.name, absolute: input.file, size: statSync(input.file).size } }
  }
  const preview = ctx?.get('previewFiles')
  if (preview) {
    const matches = (await preview.list(exec.agent.id)).filter(file => file.name === requested || file.path === requested || file.displayPath === requested)
    if (matches.length > 1) throw new Error('文件名不唯一，请使用当前会话文件引用')
    const input = await preview.resolve(exec.agent.id, matches[0]?.path ?? requested)
    return { batch: null, file: { name: input.name ?? input.file.split('/').pop(), absolute: input.file, size: statSync(input.file).size } }
  }
  const batches = uploads.listBatches(exec)
  const matches = []
  for (const batch of batches) {
    for (const file of batch.files) {
      if (file.name === requested || file.path === requested) matches.push({ batch, file })
    }
  }
  if (matches.length === 0) {
    // @/绝对路径 提及兜底（0.2.0 起 desktop/官方 composer 常见形态）。
    const mentioned = mentionedParts(exec).filter((m) => m.name === requested || m.absolute === requested)
    if (mentioned.length === 1) {
      const file = mentioned[0]
      if (!existsSync(file.absolute) || !statSync(file.absolute).isFile()) {
        return { error: json({ status: 'error', stage: 'resolve_upload', msg: `会话里 @ 提及的文件在盘上不存在或不是文件：${file.absolute}` }) }
      }
      return { batch: null, file: { name: file.name, absolute: file.absolute, size: statSync(file.absolute).size } }
    }
    if (mentioned.length > 1) {
      return { error: json({ status: 'error', stage: 'resolve_upload', msg: `文件名「${requested}」在会话提及里不唯一：${mentioned.map((m) => m.absolute).join('、')}，请按全路径调用。` }) }
    }
    return {
      error: json({
        status: 'error',
        stage: 'resolve_upload',
        msg: batches.length === 0
          ? '当前会话没有上传文件。请先在会话里上传 3D 零件模型（.prt），或在消息里用 @ 引用其主机绝对路径，再调用本工具。'
          : `当前会话的上传文件里没有「${requested}」。请先用 list_uploaded_files 查看已上传列表，按其中的文件名调用；也可用 @ 直接引用主机上的零件文件。`,
      }),
    }
  }
  if (matches.length > 1) {
    return {
      error: json({
        status: 'error',
        stage: 'resolve_upload',
        msg: `文件名「${requested}」在多个上传批次中都存在，请改用 list_uploaded_files 返回的 path 精确定位：`
          + matches.map((m) => `${m.batch?.batch_id ?? 'mention'}/${m.file.path}`).join('、'),
      }),
    }
  }
  return matches[0]
}

export function registerCamSurvey(ctx, camPipeline, uploads) {
  ctx.tools.register({
    name: 'cam_survey',
    description:
      '读取当前会话已上传的 3D 零件模型（.prt）：经 NX 工作台解析几何事实'
      + '（特征/孔位/尺寸/bbox 等），并给出疑似高风险候选清单（攻丝/沉窝，'
      + '仅供人工确认、非判定）。事实绑定当前零件字节版本并保存在正式任务中。失败时返回中文错误与处置建议。',
    parameters: {
      type: 'object',
      properties: {
        part: {
          type: 'string',
          description: '当前会话的 3D 零件文件名（如 part.prt）：会话上传清单里的文件名/path，或会话消息里 @ 引用的主机绝对路径对应文件名',
        },
      },
      required: ['part'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const requested = typeof args?.part === 'string' ? args.part.trim() : ''
      if (!requested) {
        return json({ status: 'error', stage: 'args', msg: '缺少参数 part：请给出当前会话已上传的 3D 文件名。' })
      }
      let resolved
      try {
        resolved = await resolvePart(uploads, exec, requested, ctx)
      } catch (error) {
        return json({ status: 'error', stage: 'resolve_upload', msg: `读取上传清单失败：${error.message}` })
      }
      if (resolved.error) return resolved.error
      const { file } = resolved
      const batchId = resolved.batch?.batch_id ?? null

      const sessionId = safeSessionId(exec?.agent?.id)
      if (!/\.prt$/i.test(file.name)) return json({ status: 'error', stage: 'resolve_upload', msg: '读件只接受 .prt 文件。' })
      const sourceSha = createHash('sha256').update(readFileSync(file.absolute)).digest('hex')
      const remoteRel = `input/${sessionId.slice(0, 64)}_${sourceSha}_${safeRemoteName(file.name).slice(-64)}`

      const ready = await camPipeline.ensureReady()
      if (ready.status !== 'ok') return failure('ensure_ready', ready, adviceOf(ready))
      if (ready.data?.queue_pending !== 0 || ready.data?.queue_processing !== 0) return json({ status: 'error', stage: 'ensure_ready', msg: 'NX 队列忙碌，暂不切换模型读件。' })
      const session = await camPipeline.run('/ele_session_state', {})
      if (session.status !== 'ok') return failure('ensure_ready', session, adviceOf(session))
      if (!Array.isArray(session.data?.modified_parts) || session.data.modified_parts.length || session.data.modified_unreadable !== 0) return json({ status: 'error', stage: 'ensure_ready', msg: 'NX 有未保存模型或修改状态不明，请先处理；不会关闭或保存其他模型。' })
      const uploaded = await camPipeline.uploadFile(file.absolute, remoteRel)
      if (uploaded.status !== 'ok') return failure('upload', uploaded, adviceOf(uploaded))

      const ran = await camPipeline.run('/cam_survey', { prt: remoteRel })
      if (ran.status !== 'ok') return failure('survey', ran, adviceOf(ran))

      const survey = ran.data ?? {}
      if (createHash('sha256').update(readFileSync(file.absolute)).digest('hex') !== sourceSha) return json({ status: 'error', stage: 'survey', msg: '读件期间源文件变更，请重新读取当前版本。' })
      const tasks = ctx.get('camTasks')
      if (tasks && (await tasks.read(exec.agent.id)).inputs.prt?.sha256 === sourceSha) await tasks.recordSurvey(exec.agent.id, sourceSha, survey)
      return json({
        status: 'ok',
        part: {
          source: file.name,
          source_sha256: sourceSha,
          batch_id: batchId,
          uploaded_as: remoteRel,
        },
        survey,
        risk_candidates: deriveRiskCandidates(survey),
        notes: [
          'risk_candidates 由几何规则推导，供人工确认，不构成判定；高风险工序未经书面声明不得进入执行。',
          'DWG 标注通过 read_drawing 读取正式快照；图纸要求、NX 实测与工艺建议须区分来源。',
        ],
      })
    },
  })
}
