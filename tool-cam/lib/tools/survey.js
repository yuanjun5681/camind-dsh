// cam_survey 模型工具 —— CAM 读件（v1 仅 3D；2D 图纸解析属下一迭代，
// 见 docs/cam-machining-design.md §4.2）。
// 流程：uploads 服务解析当前 session 已上传文件 → camPipeline.uploadFile
// 推到 proxy input/<session>_<sha8>_<文件名>（命名约定移植自旧 Camind
// flows/nx_machining/flow.py，task 标识用 dsh session id）→
// camPipeline.run('/cam_survey') → 透传零件事实 + 疑似高风险候选清单
// （候选供人确认，非判定）。全部失败路径返回中文、可行动的错误 JSON。

import { createHash } from 'node:crypto'

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
  return String(name).replace(/[\\/]/g, '_').replace(/[^\x20-\x7E]/g, '_')
}

// 在当前 session 的全部上传批次里按文件名/清单路径找文件；跨 session 与越界
// 由 uploads 服务的 manifest 校验挡住（这里只读到 batch.files 的声明清单）。
export function resolvePart(uploads, exec, requested) {
  const batches = uploads.listBatches(exec)
  const matches = []
  for (const batch of batches) {
    for (const file of batch.files) {
      if (file.name === requested || file.path === requested) matches.push({ batch, file })
    }
  }
  if (matches.length === 0) {
    return {
      error: json({
        status: 'error',
        stage: 'resolve_upload',
        msg: batches.length === 0
          ? '当前会话没有上传文件。请先在会话里上传 3D 零件模型（.prt），再调用本工具。'
          : `当前会话的上传文件里没有「${requested}」。请先用 list_uploaded_files 查看已上传列表，按其中的文件名调用。`,
      }),
    }
  }
  if (matches.length > 1) {
    return {
      error: json({
        status: 'error',
        stage: 'resolve_upload',
        msg: `文件名「${requested}」在多个上传批次中都存在，请改用 list_uploaded_files 返回的 path 精确定位：`
          + matches.map((m) => `${m.batch.batch_id}/${m.file.path}`).join('、'),
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
      + '仅供人工确认、非判定）。2D 图纸解析（材料/热处理/螺纹/公差）尚未实现，'
      + '需用户在对话中声明。失败时返回中文错误与处置建议。',
    parameters: {
      type: 'object',
      properties: {
        part: {
          type: 'string',
          description: '当前会话已上传的 3D 零件文件名（如 part.prt），或 list_uploaded_files 返回的 path',
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
        resolved = resolvePart(uploads, exec, requested)
      } catch (error) {
        return json({ status: 'error', stage: 'resolve_upload', msg: `读取上传清单失败：${error.message}` })
      }
      if (resolved.error) return resolved.error
      const { batch, file } = resolved

      const sessionId = safeSessionId(exec?.agent?.id)
      const sha8 = createHash('sha256').update(file.absolute).digest('hex').slice(0, 8)
      const remoteRel = `input/${sessionId}_${sha8}_${safeRemoteName(file.name)}`

      const uploaded = await camPipeline.uploadFile(file.absolute, remoteRel)
      if (uploaded.status !== 'ok') return failure('upload', uploaded, adviceOf(uploaded))

      const ran = await camPipeline.run('/cam_survey', { prt: remoteRel })
      if (ran.status !== 'ok') return failure('survey', ran, adviceOf(ran))

      const survey = ran.data ?? {}
      return json({
        status: 'ok',
        part: {
          source: file.name,
          batch_id: batch.batch_id,
          uploaded_as: remoteRel,
        },
        survey,
        risk_candidates: deriveRiskCandidates(survey),
        notes: [
          'risk_candidates 由几何规则推导，供人工确认，不构成判定；高风险工序未经书面声明不得进入执行。',
          '2D 图纸解析（材料/热处理/螺纹/公差/颜色规则）本迭代未实现，相关事实需用户在对话中声明。',
        ],
      })
    },
  })
}
