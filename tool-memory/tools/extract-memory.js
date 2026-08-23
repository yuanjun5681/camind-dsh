// Model-facing tool: distill a lesson from the current session into a draft experience entry.
// 另支持范本来源模式（source_prt，设计稿 §5.2）：归档 .prt 原件到记忆库 reference/，
// 经 NX 工作台（camPipeline）反推几何事实，LLM 生成三段式草稿，条目落
// status: draft + metadata_status: pending——标题/描述/标签由记忆库页面的
// 元数据补全流程后补（pending → ready/failed），审核流转复用现有页面。
// camPipeline / uploads / llm 均防御式读取（ctx.get，执行时点），任一不可用则范本模式中文报错。

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { toolDefinition } from '../lib/tool.js'
import { llmReady, streamText } from '../lib/llm.js'

const SURVEY_CLIP = 8000

const REVERSE_PROMPT = `你是 CAM 加工工艺员。给定一份历史编程范本零件的 NX 几何解析事实（JSON），反推一条可复用的加工经验草稿，供人工审核。
只输出一个 JSON 对象（不要输出任何其他文字、不要用代码围栏）：
{"trigger":"什么时候适用这条经验（从零件特征角度写）","situation":"范本零件的事实描述（尺寸/孔位/疑似高风险特征）","lesson":"从范本反推的一句话判断","action":"可复用的做法（工序安排/刀具/参数取向）","signature":{"holes":"孔数档，如 1-5 / 6-20 / 21+","ops":"工序类型，如 drilling+tapping","dims":"关键尺寸档 mm，如 <=100 / 100-500 / 500+"}}
要求：只依据给定事实，不要编造材料、热处理等几何解析无法获得的信息；不确定的 signature 键直接省略；signature 键名必须是小写字母/数字/下划线。
零件文件名：%s
几何解析事实（JSON）：
`

function parseJsonObject(text) {
  const match = /\{[\s\S]*\}/.exec(String(text ?? ''))
  if (!match) throw new Error('模型输出中没有 JSON 对象。')
  return JSON.parse(match[0])
}

// 范本来源解析：reference/ 已归档文件名（可带 reference/ 前缀）优先，
// 否则在当前 session 上传清单里按文件名/清单路径找（跨 session 与越界由 uploads 服务挡住）。
function resolveSource(ctx, memoryBank, exec, requested) {
  const bare = requested.startsWith('reference/') ? requested.slice('reference/'.length) : requested
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,140}\.prt$/i.test(bare) && memoryBank.root()) {
    const archived = path.join(memoryBank.root(), 'reference', bare)
    if (existsSync(archived)) return { sourceAbs: archived, originalName: bare, alreadyArchived: true }
  }
  const uploads = typeof ctx.get === 'function' ? ctx.get('uploads') : undefined
  if (!uploads) {
    throw new Error('uploads 服务不可用：范本模式只能引用记忆库 reference/ 中已归档的 .prt 文件名。')
  }
  const batches = uploads.listBatches(exec)
  const matches = []
  for (const batch of batches) {
    for (const file of batch.files) {
      if (file.name === requested || file.path === requested) matches.push({ batch, file })
    }
  }
  if (matches.length === 0) {
    throw new Error(batches.length === 0
      ? '当前会话没有上传文件。请先在会话里上传范本 .prt，或改用 reference/ 中已归档的文件名。'
      : `当前会话的上传文件里没有「${requested}」。请先用 list_uploaded_files 查看已上传列表，按其中的文件名调用。`)
  }
  if (matches.length > 1) {
    throw new Error(`文件名「${requested}」在多个上传批次中都存在，请改用 list_uploaded_files 返回的 path 精确定位：`
      + matches.map((m) => `${m.batch.batch_id}/${m.file.path}`).join('、'))
  }
  const { file } = matches[0]
  if (!/\.prt$/i.test(file.name)) throw new Error(`范本模式只支持 .prt 文件：${file.name}`)
  return { sourceAbs: file.absolute, originalName: file.name, alreadyArchived: false }
}

async function extractFromReference(ctx, memoryBank, args, exec, requested) {
  const camPipeline = typeof ctx.get === 'function' ? ctx.get('camPipeline') : undefined
  if (!camPipeline || typeof camPipeline.run !== 'function') {
    throw new Error('CAM 加工插件（camPipeline）不在线：范本反推需要 tool-cam 已加载且 NX 工作台连接已配置。')
  }
  const ready = llmReady(ctx)
  if (!ready) {
    throw new Error('llm 服务或默认模型不可用（请在 Settings → Models 配置）：范本反推需要模型生成三段式草稿。')
  }
  const source = resolveSource(ctx, memoryBank, exec, requested)
  const archived = source.alreadyArchived
    ? { ref: `reference/${source.originalName}`, archived: false }
    : await memoryBank.archiveReference(exec, { sourceAbs: source.sourceAbs, originalName: source.originalName })

  // NX 反推几何事实（与 cam_survey 同一协议：fs 上传到 input/ 再 submit+poll /cam_survey）
  const bytes = readFileSync(source.sourceAbs)
  const sha8 = archived.sha8 ?? createHash('sha256').update(bytes).digest('hex').slice(0, 8)
  const sessionId = String(exec?.agent?.id ?? 'global').replace(/[^A-Za-z0-9_-]/g, '_')
  const remoteRel = `input/memory_${sessionId}_${sha8}_${String(source.originalName).replace(/[\\/]/g, '_')}`
  const uploaded = await camPipeline.uploadFile(source.sourceAbs, remoteRel)
  if (uploaded.status !== 'ok') throw new Error(`推送范本到 NX 工作台失败：${uploaded.msg ?? uploaded.errorType ?? '未知错误'}`)
  const ran = await camPipeline.run('/cam_survey', { prt: remoteRel })
  if (ran.status !== 'ok') throw new Error(`NX 反推失败：${ran.msg ?? ran.errorType ?? '未知错误'}`)

  // LLM 生成三段式草稿（标题/描述/标签留给记忆库页面的元数据补全流程）
  const surveyText = JSON.stringify(ran.data ?? {}, null, 2).slice(0, SURVEY_CLIP)
  const text = await streamText(ready.llm, ready.selection, {
    id: `memory-extract-${Date.now()}`,
    prompt: REVERSE_PROMPT.replace('%s', source.originalName) + surveyText,
    maxTokens: 1024,
  })
  const draft = parseJsonObject(text)
  for (const key of ['situation', 'lesson', 'action']) {
    if (!String(draft[key] ?? '').trim()) {
      throw new Error(`模型输出的草稿缺少 ${key}：请重试，或改用人工填写（不传 source_prt）。`)
    }
  }
  const signature = args?.signature && typeof args.signature === 'object'
    ? { ...(typeof draft.signature === 'object' && draft.signature !== null ? draft.signature : {}), ...args.signature }
    : draft.signature
  const result = await memoryBank.extractExperience(exec, {
    title: '',
    trigger: String(draft.trigger ?? '').trim() || '加工与该范本特征相似的零件时',
    situation: draft.situation,
    lesson: draft.lesson,
    action: draft.action,
    description: '',
    tags: args?.tags,
    circuit_types: args?.circuit_types,
    signature,
    refs: [archived.ref],
    metadata_status: 'pending',
    actor: `dsh-agent/${ready.selection.model}`,
  })
  return `已归档范本原件 ${archived.ref}${archived.archived ? '' : '（已存在，复用）'}，并经 NX 工作台反推生成候选经验 ${result.name}`
    + '（status: draft；标题/描述/标签由记忆库页面自动生成中）。请提醒用户在记忆库页面审核采纳后生效。'
}

export function registerExtractMemory(ctx, memoryBank) {
  ctx.tools.register(toolDefinition(
    'extract_memory',
    '从当前会话的工作中提炼一条经验（什么情境、什么教训、正确做法），保存为候选（draft），需人工在记忆库页面审核采纳后才生效。完成一项非平凡任务、修复隐蔽问题或验证某种做法有效后调用。如果是稳定的领域事实/规范，改用 save_memory。'
    + '范本来源模式：提供 source_prt（当前会话已上传的 .prt 文件名，或记忆库 reference/ 中已归档的 .prt 文件名）时，自动归档原件、经 NX 工作台反推几何事实并生成三段式草稿——此时 title/trigger/situation/lesson/action 均可留空；需要 NX 工作台连接与模型配置在线。',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '经验标题（一句话概括教训）；范本模式可留空，由元数据补全生成' },
        trigger: { type: 'string', description: '触发条件：什么情况下适用这条经验' },
        situation: { type: 'string', description: '情境：当时的问题/现象是什么' },
        lesson: { type: 'string', description: '教训：一句话结论' },
        action: { type: 'string', description: '做法：正确的做法是什么' },
        circuit_types: { type: 'array', items: { type: 'string' }, description: '适用电路类型（可空）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签（可空）' },
        signature: { type: 'object', additionalProperties: { type: 'string' }, description: '特征签名（可空）：材料/孔数档/工序类型/关键尺寸档等键值对，检索时精确过滤用，如 {"material":"AL6061","holes":"6-20"}；范本模式下与反推结果合并（此处优先）' },
        source_prt: { type: 'string', description: '范本来源模式：当前会话已上传的 .prt 文件名（或 list_uploaded_files 返回的 path），或记忆库 reference/ 中已归档的 .prt 文件名' },
      },
      required: [],
    },
    async (args, exec) => {
      const sourcePrt = typeof args?.source_prt === 'string' ? args.source_prt.trim() : ''
      if (sourcePrt) {
        try {
          return await extractFromReference(ctx, memoryBank, args, exec, sourcePrt)
        } catch (error) {
          return `范本反推失败：${error.message}`
        }
      }
      try {
        const result = await memoryBank.extractExperience(exec, {
          title: args?.title,
          trigger: args?.trigger,
          situation: args?.situation,
          lesson: args?.lesson,
          action: args?.action,
          circuit_types: args?.circuit_types,
          tags: args?.tags,
          signature: args?.signature,
        })
        return `已保存为候选经验 ${result.name}（${memoryBank.root()}/experience/${result.name}.md，status: draft），需在记忆库页面人工审核采纳后生效。`
      } catch (error) {
        return `提取经验失败：${error.message}`
      }
    },
  ))
}
