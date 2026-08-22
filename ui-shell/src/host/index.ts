/**
 * camind-ui-shell — Host 协议桥。
 *
 * 把 dsh 的 agents / sessions / workspaceRegistry 暴露成 /camind 下的 REST + SSE，
 * 并托管独立 React SPA。不改官方 Web 壳；官方界面仍在 /。
 */
import { randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'

import type {
  AgentPresetCatalog,
  AgentPresetRef,
  AppState,
  ClientPluginGraph,
  CommandDescriptor,
  CreateSessionRequest,
  CreateWorkspaceRequest,
  ExecuteCommandRequest,
  FsListing,
  FilePreview,
  GitWorkspaceStatus,
  ModelCatalog,
  ModelChoice,
  PermissionSelect,
  PickDirectoryResult,
  PromptRequest,
  RenameSessionRequest,
  RenameWorkspaceRequest,
  ResumeSessionRequest,
  SessionSnapshot,
  SessionSummary,
  SkillDescriptor,
  StreamMessage,
  UploadedFile,
  UploadedImage,
  WireEvent,
  WorkspaceSummary,
} from '../shared/protocol.js'
import { HttpBodyTooLargeError, openSse, parseUrl, readJson, sendError, sendJson, serveSpa, sseWrite } from './http.js'
import { handleSettingsApi } from './settings.js'
import {
  availableUploads,
  consumePendingUploadBatches,
  listSessionUploads,
  markUploadBatchPending,
  pendingUploadBatches,
  removePendingUpload,
  resolveUploadReference,
  saveUploadBatch,
} from './uploads.js'
import type { UploadManifest } from './uploads.js'
import type {
  Agent,
  AgentHandle,
  AgentScopedContext,
  HostContext,
  ImageAttachmentRef,
  ModelSelection,
  Session,
  SessionEvent,
  Workspace,
} from './types.js'

export const name = 'ui-shell'

export const inject = [
  'webServer',
  'agents',
  'sessions',
  'workspaceRegistry',
  'sessionPersistence',
  'sessionTitle',
  'llm',
  'agentDefaultModel',
  'permissionPresets',
  'attachments',
  'agentPresets',
  'directoryPicker',
  'commands',
  'skills',
  'clientModules',
]

const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_UPLOAD_REQUEST_BYTES = 96 * 1024 * 1024
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
const MAX_RAW_PREVIEW_BYTES = 20 * 1024 * 1024
const execFile = promisify(execFileCallback)

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cfg', '.cir', '.ckt', '.conf', '.cpp', '.css', '.csv', '.go', '.h', '.hpp', '.html', '.ini',
  '.java', '.js', '.json', '.jsx', '.log', '.markdown', '.md', '.mjs', '.py', '.rs', '.sh', '.sql',
  '.net', '.ptnset', '.sp', '.spi', '.spice', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])

const MEDIA_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.markdown': 'text/markdown',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

interface ModelSelectionRef {
  current: ModelSelection | undefined
  assembled: ModelSelection | undefined
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('\n')
  if (value && typeof value === 'object' && 'text' in value && typeof (value as { text: unknown }).text === 'string') {
    return (value as { text: string }).text
  }
  return ''
}

function messageText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const content = (data as { content?: unknown }).content
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && typeof block === 'object' && (block as { type?: string }).type === 'text')
      .map((block) => asText((block as { text?: string }).text))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function titleFromEvents(events: readonly SessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type === 'session/title') {
      const title = (event.data as { title?: unknown } | undefined)?.title
      if (typeof title === 'string' && title.trim()) return title
    }
  }
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = (event.data as { source?: { kind?: string } } | undefined)?.source
    if (source?.kind && source.kind !== 'user') continue
    const text = messageText(event.data).trim()
    if (text) return text.split(/\s+/).slice(0, 8).join(' ')
  }
  return undefined
}

function toWire(event: SessionEvent): WireEvent {
  const surfaceOp = event.surfaceOp
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: event.data,
    ...surfaceOp !== undefined ? { surfaceOp } : {},
  }
}

function createPrompt(text: string, images: readonly ImageAttachmentRef[] = []) {
  const content: object[] = []
  if (text) content.push({ type: 'text' as const, text })
  for (const attachment of images) {
    content.push({ type: 'image' as const, attachment: Object.freeze({ ...attachment }) })
  }
  if (content.length === 0) throw new Error('消息不能为空')
  return Object.freeze({
    id: randomUUID(),
    role: 'user' as const,
    content: Object.freeze(content),
    source: Object.freeze({ kind: 'user' as const }),
  })
}

function uploadContextText(batches: readonly UploadManifest[]): string {
  return [
    '用户已通过 Composer 上传以下会话隔离文件。先调用 list_uploaded_files 获取清单；需要内容时调用 read_uploaded_file。',
    ...batches.flatMap((batch) => [
      `本轮上传批次：${batch.batch_id}`,
      ...batch.files.map((file) => `上传文件：${file.original_name}`),
      ...batch.extracted_files.map((file) => `ZIP 已解压：${file.path}`),
    ]),
  ].join('\n')
}

/** 上传引用作为独立插件上下文进入模型，绝不混入用户可编辑的 Composer draft。 */
function createUploadContext(batches: readonly UploadManifest[]) {
  const text = uploadContextText(batches)
  return Object.freeze({
    id: randomUUID(),
    role: 'user' as const,
    content: Object.freeze([{ type: 'text' as const, text }]),
    source: Object.freeze({
      kind: 'plugin' as const,
      plugin: 'camind-ui-shell',
      form: 'snapshot' as const,
      sections: Object.freeze([{ name: 'composer-uploads', text }]),
    }),
  })
}

function isDirectUserMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const source = (message as { source?: { kind?: unknown } }).source
  return source?.kind === 'user'
}

/** 官方 fork increaseTitle：尾部 `(n)` / `（n）` 加一，否则追加 ` (1)`。 */
function increasedForkTitle(title: string): string {
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title)
  if (ascii?.[1] !== undefined && ascii[2] !== undefined) return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title)
  if (fullWidth?.[1] !== undefined && fullWidth[2] !== undefined) return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`
  return `${title} (1)`
}

function requestedModel(body: Partial<ModelChoice> | undefined): ModelChoice | undefined {
  if (!body?.provider || !body.model) return undefined
  if (typeof body.provider !== 'string' || typeof body.model !== 'string') return undefined
  return {
    provider: body.provider,
    model: body.model,
    ...typeof body.reasoningEffort === 'string' && body.reasoningEffort
      ? { reasoningEffort: body.reasoningEffort }
      : {},
  }
}

function decodeBase64(data: string): Buffer {
  const comma = data.indexOf(',')
  const payload = comma >= 0 ? data.slice(comma + 1) : data
  return Buffer.from(payload, 'base64')
}

function safeBasename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).trim()
  if (!base || base === '.' || base === '..') throw new Error(`非法文件名：${name}`)
  return base
}

function mediaTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (MEDIA_TYPES[ext]) return MEDIA_TYPES[ext]
  if (TEXT_EXTENSIONS.has(ext)) return ext === '.json' ? 'application/json' : 'text/plain'
  return 'application/octet-stream'
}

function previewKind(mediaType: string): FilePreview['kind'] {
  if (mediaType.startsWith('text/') || mediaType === 'application/json' || mediaType === 'image/svg+xml') return 'text'
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType === 'application/pdf') return 'pdf'
  return 'binary'
}

function hasSensitiveSegment(relative: string): boolean {
  return relative.split(path.sep).some((segment) => segment === '.git' || segment === '.dsh' || segment.startsWith('.env'))
}

function bindModelSelection(agentCtx: AgentScopedContext, selection: ModelSelectionRef): void {
  agentCtx.on('system-prompt/assemble', async (...args: unknown[]) => {
    const next = args.at(-1) as () => Promise<{ variables?: Record<string, string> } & Record<string, unknown>>
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    if (!selected) return assembled
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  agentCtx.on('agent/request', async (...args: unknown[]) => {
    const next = args.at(-1) as () => Promise<Record<string, unknown>>
    const resolved = await next()
    const selected = selection.assembled
    if (!selected) return resolved
    const { reasoningEffort: _ignored, ...rest } = resolved
    return {
      ...rest,
      provider: selected.provider,
      model: selected.model,
      ...selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {},
    }
  })
}

export function apply(ctx: HostContext) {
  const handles = new Map<string, AgentHandle>()
  const streams = new Map<string, Set<ServerResponse>>()
  const selections = new Map<string, ModelSelectionRef>()
  const mountedPresets = new Map<string, string>()

  const persist = ctx.sessionPersistence
  const titles = ctx.sessionTitle

  ctx.effect(() => () => {
    for (const res of [...streams.values()].flatMap((set) => [...set])) {
      try { res.end() } catch { /* already closed */ }
    }
    streams.clear()
    for (const handle of handles.values()) void handle.dispose()
    handles.clear()
    selections.clear()
    mountedPresets.clear()
  })

  function push(sessionId: string, message: StreamMessage) {
    const listeners = streams.get(sessionId)
    if (!listeners) return
    for (const res of listeners) {
      try { sseWrite(res, message) } catch { listeners.delete(res) }
    }
  }

  ctx.on('session/event', (...args: unknown[]) => {
    const session = args[0] as Session
    const event = args[1] as SessionEvent
    push(session.id, { type: 'event', event: toWire(event) })
    if (event.type === 'session/title') {
      const title = (event.data as { title?: string } | undefined)?.title
      if (title) push(session.id, { type: 'title', title })
    }
  })

  ctx.on('agent/status', (...args: unknown[]) => {
    const payload = args[0] as { agent: Agent; status: 'idle' | 'running' }
    push(payload.agent.id, { type: 'status', status: payload.status })
  })

  ctx.on('agent/pre-step', async (...args: unknown[]) => {
    const payload = args[0] as {
      agent: Agent
      messages: unknown[]
      signal: AbortSignal
    }
    const next = args.at(-1) as () => Promise<{
      kind: 'reject' | 'enter'
      messages?: unknown[]
    }>
    if (!payload.messages.some(isDirectUserMessage)) return next()

    let batches: UploadManifest[]
    try {
      batches = pendingUploadBatches(payload.agent.id)
    } catch {
      return next()
    }
    if (batches.length === 0) return next()

    const decision = await next()
    if (decision.kind === 'reject' || payload.signal.aborted || !decision.messages) return decision
    try {
      consumePendingUploadBatches(payload.agent.id, batches.map((batch) => batch.batch_id))
    } catch (error) {
      console.warn('[ui-shell] upload context entered but pending markers could not be cleared:', error)
    }
    return {
      kind: 'enter' as const,
      messages: [...decision.messages, createUploadContext(batches)],
    }
  })

  async function listCatalog(): Promise<ModelCatalog> {
    const providers = ctx.llm?.listProviders() ?? []
    const groups = await Promise.all(providers.map(async (provider) => {
      try {
        const models = await ctx.llm!.listModels(provider.id)
        const entries = await Promise.all(models.map(async (model) => {
          try {
            const resolved = await ctx.llm!.resolveModelInfo(provider.id, model.id)
            const reasoning = resolved.reasoning === undefined || resolved.reasoning.efforts.length === 0
              ? undefined
              : {
                efforts: resolved.reasoning.efforts.map((effort) => ({
                  id: effort.id,
                  name: effort.name,
                  ...effort.description ? { description: effort.description } : {},
                })),
                ...resolved.reasoning.defaultEffort ? { defaultEffort: resolved.reasoning.defaultEffort } : {},
              }
            return {
              id: model.id,
              name: model.name || model.id,
              ...model.description ? { description: model.description } : {},
              ...resolved.context?.contextWindow ? { contextWindow: resolved.context.contextWindow } : {},
              ...reasoning ? { reasoning } : {},
            }
          } catch {
            return {
              id: model.id,
              name: model.name || model.id,
              ...model.description ? { description: model.description } : {},
            }
          }
        }))
        return {
          id: provider.id,
          name: provider.name || provider.id,
          models: entries,
        }
      } catch {
        return { id: provider.id, name: provider.name || provider.id, models: [] }
      }
    }))
    const fallback = ctx.agentDefaultModel?.currentSelection()
    return {
      providers: groups.filter((group) => group.models.length > 0),
      ...fallback?.provider && fallback.model ? { default: fallback } : {},
    }
  }

  async function resolveSelection(requested?: ModelChoice): Promise<ModelSelection> {
    if (requested) return requested
    const fallback = ctx.agentDefaultModel?.currentSelection()
    if (fallback?.provider && fallback.model) return fallback
    const catalog = await listCatalog()
    const group = catalog.providers[0]
    const model = group?.models[0]
    if (!group || !model) throw new Error('没有可用模型：请先在官方设置里配置 Provider')
    return { provider: group.id, model: model.id }
  }

  function permissionSelect(events: readonly SessionEvent[] = []): PermissionSelect | undefined {
    const presets = ctx.permissionPresets
    if (!presets) return undefined
    const currentValue = events.length > 0 ? presets.current(events) : presets.defaultPreset
    const options = presets.names.map((name) => presets.optionOf(name))
    if (currentValue === 'custom') options.push(presets.optionOf('custom'))
    return { options, currentValue }
  }

  function applyPermission(session: Session, preset: string | undefined): void {
    if (!preset || !ctx.permissionPresets) return
    if (preset === 'custom') return
    ctx.permissionPresets.set(session, preset)
  }

  function sessionBlank(events: readonly SessionEvent[]): boolean {
    return !events.some((event) => event.type === 'turn/start' || event.type === 'command/run')
  }

  function lastUserPromptAt(events: readonly SessionEvent[]): number | null {
    let latest: number | null = null
    for (const event of events) {
      if (event.type === 'command/run' || event.type === 'command/done') {
        latest = event.time
        continue
      }
      if (event.type !== 'user/message') continue
      const source = (event.data as { source?: { kind?: string } } | undefined)?.source
      if (source?.kind && source.kind !== 'user') continue
      latest = event.time
    }
    return latest
  }

  function wireCommand(item: { name: string; description: string; input?: { hint: string } }): CommandDescriptor {
    return {
      name: item.name,
      description: item.description,
      ...item.input?.hint ? { input: { hint: item.input.hint } } : {},
    }
  }

  function wireSkill(item: {
    name: string
    description: string
    whenToUse?: string
    invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  }): SkillDescriptor {
    return {
      name: item.name,
      description: item.description,
      ...item.whenToUse ? { whenToUse: item.whenToUse } : {},
      modelInvocable: item.invocation?.modelInvocable !== false,
    }
  }

  function isUserInvocable(item: { invocation?: { userInvocable?: boolean } }): boolean {
    return item.invocation?.userInvocable !== false
  }

  function skillRegistry(agent: Agent): HostContext['skills'] {
    const scoped = ctx.agentPresets?.serviceFor(agent, 'skills') as HostContext['skills'] | undefined
    return scoped ?? ctx.skills
  }

  function listUpdatedAt(createdAt: number, events: readonly SessionEvent[]): number {
    return Math.max(createdAt, lastUserPromptAt(events) ?? 0)
  }

  function recordedPresetId(session: {
    header?: { agentPreset?: string }
    meta?: { agentPreset?: string }
    events: readonly SessionEvent[]
  }): string | undefined {
    for (let i = session.events.length - 1; i >= 0; i--) {
      const event = session.events[i]
      if (event.type !== 'agent-preset/selected') continue
      const id = (event.data as { agentPreset?: unknown } | undefined)?.agentPreset
      if (typeof id === 'string' && id) return id
    }
    return session.header?.agentPreset ?? session.meta?.agentPreset
  }

  async function listPresetCatalog(): Promise<AgentPresetCatalog | undefined> {
    const presets = ctx.agentPresets
    if (!presets) return undefined
    const rows = await presets.list()
    return {
      defaultId: presets.defaultId,
      presets: rows.map((preset) => ({
        id: preset.id,
        trust: preset.trust,
        ...preset.name ? { name: preset.name } : {},
        ...preset.description ? { description: preset.description } : {},
        ...preset.broken ? { broken: preset.broken } : {},
      })),
    }
  }

  async function presetRef(id: string | undefined): Promise<AgentPresetRef | undefined> {
    if (!id || !ctx.agentPresets) return undefined
    try {
      const preset = await ctx.agentPresets.resolve(id)
      return { id: preset.id, name: preset.name || preset.id }
    } catch {
      return { id, name: id }
    }
  }

  async function resolvePresetId(sessionId?: string, requested?: string): Promise<string | undefined> {
    const presets = ctx.agentPresets
    if (!presets) return undefined
    if (requested) return (await presets.resolve(requested)).id
    if (sessionId) {
      const live = ctx.sessions.get(sessionId)
      if (live) {
        const recorded = recordedPresetId(live)
        if (recorded) return recorded
      }
      if (persist) {
        try {
          const inspection = await persist.inspect(sessionId)
          const recorded = recordedPresetId(inspection)
          if (recorded) return recorded
        } catch { /* cold inspect can fail */ }
      }
    }
    return presets.defaultId
  }

  async function spawnAgent(
    kind: 'create' | 'resume',
    sessionId: string,
    cwd: string | undefined,
    requested?: ModelChoice,
    requestedPreset?: string,
  ): Promise<Agent> {
    const selected = await resolveSelection(requested)
    const selection: ModelSelectionRef = { current: selected, assembled: undefined }
    const presetId = await resolvePresetId(kind === 'resume' ? sessionId : undefined, requestedPreset)
    const setup = async (agentCtx: AgentScopedContext) => {
      bindModelSelection(agentCtx, selection)
      if (presetId && ctx.agentPresets) await ctx.agentPresets.mount(agentCtx, presetId)
    }
    const handle = kind === 'create'
      ? await ctx.agents.create({
        sessionId,
        meta: {
          ...cwd ? { cwd } : {},
          ...presetId ? { agentPreset: presetId } : {},
        },
        agentOptions: selected,
        setup,
      })
      : await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: selected,
        setup,
      })
    handles.set(sessionId, handle)
    selections.set(sessionId, selection)
    if (presetId) mountedPresets.set(sessionId, presetId)
    return handle.agent
  }

  async function ensureLive(sessionId: string, requested?: ModelChoice): Promise<Agent> {
    const live = ctx.agents.get(sessionId)
    if (live) {
      const existing = selections.get(sessionId)
      if (existing && requested) existing.current = requested
      return live
    }
    return spawnAgent('resume', sessionId, undefined, requested)
  }

  async function readSessionState(sessionId: string): Promise<{
    id: string
    header: { cwd?: string; agentPreset?: string }
    events: SessionEvent[]
  } | undefined> {
    const live = ctx.agents.get(sessionId)?.session ?? ctx.sessions.get(sessionId)
    if (live) return { id: live.id, header: live.header, events: [...live.events] }
    if (!persist) return undefined
    try {
      const inspected = await persist.inspect(sessionId)
      return { id: sessionId, header: inspected.meta, events: [...inspected.events] }
    } catch {
      return undefined
    }
  }

  function workspaceForSession(sessionId: string): Workspace | undefined {
    return ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(sessionId))
  }

  async function forkSession(sessionId: string): Promise<SessionSummary> {
    const source = await readSessionState(sessionId)
    if (!source) throw Object.assign(new Error('会话不存在'), { status: 404 })
    const events = source.events
    let boundary: SessionEvent | undefined
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === 'turn/end') {
        boundary = events[i]
        break
      }
    }
    if (!boundary) {
      throw Object.assign(new Error('当前会话还没有已完成的轮次，无法分叉'), { status: 409 })
    }
    let cut = boundary.seq + 1
    while (cut < events.length && events[cut]?.type !== 'turn/start') cut += 1
    const selected = await resolveSelection()
    const selection: ModelSelectionRef = { current: selected, assembled: undefined }
    const presetId = recordedPresetId(source) ?? await resolvePresetId(sessionId)
    const setup = async (agentCtx: AgentScopedContext) => {
      bindModelSelection(agentCtx, selection)
      if (presetId && ctx.agentPresets) await ctx.agentPresets.mount(agentCtx, presetId)
    }
    const childId = `session-${randomUUID()}`
    const handle = await ctx.agents.create({
      sessionId: childId,
      seed: events.slice(0, cut),
      meta: {
        ...source.header.cwd ? { cwd: source.header.cwd } : {},
        parentSession: source.id,
        seedLength: cut,
        ...presetId ? { agentPreset: presetId } : {},
      },
      agentOptions: selected,
      setup,
    })
    handles.set(childId, handle)
    selections.set(childId, selection)
    if (presetId) mountedPresets.set(childId, presetId)
    const workspace = workspaceForSession(source.id)
    if (workspace) await workspace.attachSession(childId)
    const liveSource = ctx.agents.get(source.id)?.session ?? ctx.sessions.get(source.id)
    const sourceTitle = (liveSource && titles?.get(liveSource)?.title) ?? titleFromEvents(events)
    if (sourceTitle && titles) {
      try {
        titles.rename(handle.agent.session, increasedForkTitle(sourceTitle))
      } catch { /* 子会话已创建；标题递增失败时仍返回子会话 */ }
    }
    return summarizeSession(childId)
  }

  async function sessionCwd(sessionId: string): Promise<string> {
    const live = ctx.agents.get(sessionId)?.session ?? ctx.sessions.get(sessionId)
    if (live?.header.cwd) return live.header.cwd
    if (persist) {
      const inspection = await persist.inspect(sessionId)
      if (inspection.meta.cwd) return inspection.meta.cwd
    }
    throw new Error('当前会话没有工作目录')
  }

  /** 将用户请求约束在 session cwd 或本会话上传批次内，并拒绝跨边界访问。 */
  async function resolveSessionFile(sessionId: string, requested: string): Promise<{ root: string; file: string; relative: string }> {
    if (requested.startsWith('upload://')) {
      try {
        const resolved = await resolveUploadReference(sessionId, requested)
        if (resolved) return resolved
      } catch (cause) {
        const error = new Error(cause instanceof Error ? cause.message : String(cause))
        error.name = /超出|非法/u.test(error.message) ? 'FilePreviewForbiddenError' : 'FilePreviewNotFoundError'
        throw error
      }
      const error = new Error('上传文件引用非法')
      error.name = 'FilePreviewForbiddenError'
      throw error
    }
    const cwd = await sessionCwd(sessionId)
    const root = await realpath(cwd)

    async function resolveRelative(requestedPath: string): Promise<{ root: string; file: string; relative: string }> {
      const candidate = path.resolve(root, requestedPath)
      let file: string
      try {
        file = await realpath(candidate)
      } catch {
        const error = new Error(`文件不存在：${requestedPath}`)
        error.name = 'FilePreviewNotFoundError'
        throw error
      }
      const relative = path.relative(root, file)
      if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        const error = new Error('文件路径超出会话工作区')
        error.name = 'FilePreviewForbiddenError'
        throw error
      }
      if (hasSensitiveSegment(relative)) {
        const error = new Error('该路径包含敏感配置或内部数据，不能在界面中预览')
        error.name = 'FilePreviewForbiddenError'
        throw error
      }
      const info = await stat(file)
      if (!info.isFile()) {
        const error = new Error('目标不是文件')
        error.name = 'FilePreviewInvalidError'
        throw error
      }
      return { root, file, relative }
    }

    return resolveRelative(requested)
  }

  async function describePreview(sessionId: string, requested: string): Promise<FilePreview> {
    const resolved = await resolveSessionFile(sessionId, requested)
    const info = await stat(resolved.file)
    const mediaType = mediaTypeOf(resolved.file)
    const kind = previewKind(mediaType)
    if (kind !== 'text') {
      return {
        path: resolved.relative,
        name: path.basename(resolved.file),
        size: info.size,
        mediaType,
        kind,
      }
    }
    const bytes = await readFile(resolved.file)
    const truncated = bytes.length > MAX_TEXT_PREVIEW_BYTES
    return {
      path: resolved.relative,
      name: path.basename(resolved.file),
      size: info.size,
      mediaType,
      kind,
      text: bytes.subarray(0, MAX_TEXT_PREVIEW_BYTES).toString('utf8'),
      ...truncated ? { truncated: true } : {},
    }
  }

  async function gitStatus(sessionId: string): Promise<GitWorkspaceStatus> {
    const cwd = await sessionCwd(sessionId)
    try {
      const { stdout } = await execFile('git', ['status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all'], {
        cwd,
        maxBuffer: 2 * 1024 * 1024,
      })
      const rows = stdout.split('\0').filter(Boolean)
      let branch: string | undefined
      const files: GitWorkspaceStatus['files'] = []
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        if (row.startsWith('## ')) {
          branch = row.slice(3).split('...')[0]?.trim() || undefined
          continue
        }
        if (row.length < 4) continue
        const status = row.slice(0, 2)
        const filePath = row.slice(3)
        files.push({ path: filePath, status })
        if (status.includes('R') || status.includes('C')) index += 1
      }
      return { available: true, branch, files }
    } catch (err) {
      const detail = err as { stderr?: string; message?: string }
      const message = detail.stderr?.trim() || detail.message || String(err)
      if (/not a git repository/i.test(message)) return { available: false, files: [] }
      return { available: false, files: [], error: message }
    }
  }

  async function saveImages(images: UploadedImage[] | undefined): Promise<readonly ImageAttachmentRef[]> {
    if (!images?.length) return []
    if (!ctx.attachments) throw new Error('当前环境不支持图片附件')
    const inputs = images.map((image) => {
      const mediaType = image.mediaType === 'image/jpg' ? 'image/jpeg' : image.mediaType
      if (!IMAGE_MEDIA.has(mediaType)) throw new Error(`不支持的图片类型：${image.mediaType}`)
      const data = decodeBase64(image.data)
      if (data.length > MAX_UPLOAD_BYTES) throw new Error(`图片过大：${image.name}`)
      return { data: new Uint8Array(data), mediaType, name: safeBasename(image.name || 'image') }
    })
    return ctx.attachments.saveImages(inputs)
  }

  async function summarizeSession(id: string, header?: { cwd?: string; createdAt: number }): Promise<SessionSummary> {
    const agent = ctx.agents.get(id)
    const liveSession = agent?.session ?? ctx.sessions.get(id)
    if (liveSession) {
      const title = titles?.get(liveSession)?.title ?? titleFromEvents(liveSession.events) ?? '新会话'
      return {
        id,
        title,
        cwd: liveSession.header.cwd,
        createdAt: liveSession.header.createdAt,
        updatedAt: listUpdatedAt(liveSession.header.createdAt, liveSession.events),
        live: Boolean(agent),
        status: agent?.status ?? 'cold',
        blank: sessionBlank(liveSession.events),
      }
    }
    let createdAt = header?.createdAt ?? 0
    let cwd = header?.cwd
    let title = '新会话'
    let blank = true
    let updatedAt = createdAt
    if (persist) {
      try {
        const inspection = await persist.inspect(id)
        createdAt = inspection.meta.createdAt
        cwd = inspection.meta.cwd
        title = titleFromEvents(inspection.events) ?? title
        blank = sessionBlank(inspection.events)
        updatedAt = listUpdatedAt(createdAt, inspection.events)
      } catch { /* cold inspect can fail on corrupt logs */ }
    }
    return { id, title, cwd, createdAt, updatedAt, live: false, status: 'cold', blank }
  }

  async function buildState(): Promise<AppState> {
    const archived = new Set(ctx.workspaceRegistry.archivedSessionIds ?? [])
    const accounted = new Set<string>()
    const workspaces: WorkspaceSummary[] = []
    for (const ws of ctx.workspaceRegistry.list()) {
      const sessions: SessionSummary[] = []
      for (const sessionId of ws.sessionIds) {
        accounted.add(sessionId)
        if (archived.has(sessionId)) continue
        sessions.push(await summarizeSession(sessionId))
      }
      workspaces.push({
        id: ws.id,
        title: ws.title,
        path: ws.path,
        createdAt: ws.createdAt,
        sessions,
      })
    }

    const ungrouped: SessionSummary[] = []
    const persisted = persist ? await persist.list() : []
    const known = new Map<string, { cwd?: string; createdAt: number }>()
    for (const session of ctx.sessions.list()) known.set(session.id, session.header)
    for (const header of persisted) {
      if (!known.has(header.id)) known.set(header.id, header)
    }
    for (const [id, header] of known) {
      if (accounted.has(id) || archived.has(id)) continue
      ungrouped.push(await summarizeSession(id, header))
    }
    ungrouped.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
    return { workspaces, ungrouped }
  }

  async function snapshotOf(sessionId: string): Promise<SessionSnapshot> {
    const agent = ctx.agents.get(sessionId)
    const live = agent?.session ?? ctx.sessions.get(sessionId)
    if (live) {
      const permission = permissionSelect(live.events)
      const agentPreset = await presetRef(recordedPresetId(live) ?? mountedPresets.get(sessionId) ?? ctx.agentPresets?.defaultId)
      return {
        id: sessionId,
        title: titles?.get(live)?.title ?? titleFromEvents(live.events) ?? '新会话',
        cwd: live.header.cwd,
        status: agent?.status ?? 'cold',
        events: live.events.map(toWire),
        blank: sessionBlank(live.events),
        ...permission ? { permission } : {},
        ...agentPreset ? { agentPreset } : {},
      }
    }
    if (!persist) throw new Error('会话不在内存中，且没有持久化后端')
    const inspection = await persist.inspect(sessionId)
    const permission = permissionSelect(inspection.events)
    const agentPreset = await presetRef(recordedPresetId(inspection) ?? ctx.agentPresets?.defaultId)
    return {
      id: sessionId,
      title: titleFromEvents(inspection.events) ?? '新会话',
      cwd: inspection.meta.cwd,
      status: 'cold',
      events: inspection.events.map(toWire),
      blank: sessionBlank(inspection.events),
      ...permission ? { permission } : {},
      ...agentPreset ? { agentPreset } : {},
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const pathname = url.pathname.replace(/\/$/, '') || '/'
    const method = req.method ?? 'GET'

    if (await handleSettingsApi(ctx, req, res, url)) return

    if (method === 'GET' && pathname === '/camind/api/state') {
      sendJson(res, 200, await buildState())
      return
    }

    if (method === 'GET' && pathname === '/camind/api/models') {
      sendJson(res, 200, await listCatalog())
      return
    }

    if (method === 'GET' && pathname === '/camind/api/permissions') {
      const select = permissionSelect()
      if (!select) {
        sendError(res, 404, '当前环境没有权限预设')
        return
      }
      sendJson(res, 200, select)
      return
    }

    if (method === 'GET' && pathname === '/camind/api/client-plugins') {
      const graph = ctx.clientModules.graph()
      const body: ClientPluginGraph = {
        rev: graph?.rev ?? '',
        entries: (graph?.entries ?? []).map((entry) => ({
          id: entry.id,
          url: entry.url,
          rev: entry.rev,
          ...entry.inject ? { inject: [...entry.inject] } : {},
          ...entry.external?.length ? { external: [...entry.external] } : {},
          ...entry.immediately ? { immediately: true } : {},
        })),
      }
      sendJson(res, 200, body)
      return
    }

    if (method === 'GET' && pathname === '/camind/api/presets') {
      const catalog = await listPresetCatalog()
      if (!catalog) {
        sendError(res, 404, '当前环境没有 Agent 预设')
        return
      }
      sendJson(res, 200, catalog)
      return
    }

    if (method === 'POST' && pathname === '/camind/api/pick-directory') {
      const capability = ctx.directoryPicker.capability()
      if (capability.kind !== 'native') {
        sendJson(res, 200, { kind: 'browse' } satisfies PickDirectoryResult)
        return
      }
      const abort = new AbortController()
      const onClose = () => abort.abort()
      req.once('close', onClose)
      try {
        const picked = await capability.pick(abort.signal)
        sendJson(res, 200, { kind: 'native', path: picked } satisfies PickDirectoryResult)
      } catch (err) {
        if (abort.signal.aborted) {
          sendJson(res, 200, { kind: 'native', path: null } satisfies PickDirectoryResult)
          return
        }
        sendError(res, 500, err instanceof Error ? err.message : String(err))
      } finally {
        req.off('close', onClose)
      }
      return
    }

    if (method === 'GET' && pathname === '/camind/api/fs') {
      const raw = url.searchParams.get('path') || os.homedir()
      let resolved: string
      try {
        resolved = await realpath(raw)
      } catch {
        sendError(res, 404, `目录不存在：${raw}`)
        return
      }
      const info = await stat(resolved)
      if (!info.isDirectory()) {
        sendError(res, 400, '不是目录')
        return
      }
      const names = await readdir(resolved)
      const entries = []
      for (const name of names) {
        if (name.startsWith('.')) continue
        const full = path.join(resolved, name)
        try {
          const st = await stat(full)
          if (st.isDirectory()) entries.push({ name, path: full, isDir: true })
        } catch { /* ignore unreadable */ }
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      const parent = path.dirname(resolved)
      const listing: FsListing = {
        path: resolved,
        parent: parent !== resolved ? parent : null,
        entries,
      }
      sendJson(res, 200, listing)
      return
    }

    if (method === 'POST' && pathname === '/camind/api/workspaces') {
      const body = await readJson(req) as CreateWorkspaceRequest
      if (!body?.path || typeof body.path !== 'string') {
        sendError(res, 400, '需要 path')
        return
      }
      const ws = await ctx.workspaceRegistry.create(body.path, body.title)
      sendJson(res, 200, { id: ws.id, title: ws.title, path: ws.path })
      return
    }

    const workspaceMatch = pathname.match(/^\/camind\/api\/workspaces\/([^/]+)$/)
    if (workspaceMatch) {
      const workspaceId = decodeURIComponent(workspaceMatch[1])
      const workspace = ctx.workspaceRegistry.get(workspaceId)
      if (!workspace) {
        sendError(res, 404, '工作区不存在')
        return
      }
      if (method === 'POST') {
        const body = await readJson(req) as RenameWorkspaceRequest
        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        if (!title) {
          sendError(res, 400, '需要 title')
          return
        }
        if (ctx.workspaceRegistry.list().some((other) => other.id !== workspace.id && other.title === title)) {
          sendError(res, 409, `工作区名称已存在：${title}`)
          return
        }
        await workspace.setTitle(title)
        sendJson(res, 200, { id: workspace.id, title: workspace.title, path: workspace.path })
        return
      }
      if (method === 'DELETE') {
        await ctx.workspaceRegistry.delete(workspaceId)
        sendJson(res, 200, { ok: true })
        return
      }
      sendError(res, 405, `不支持 ${method}`)
      return
    }

    if (method === 'POST' && pathname === '/camind/api/sessions') {
      const body = await readJson(req) as CreateSessionRequest
      let workspace: Workspace | undefined
      let cwd = body.cwd
      if (body.workspaceId) {
        workspace = ctx.workspaceRegistry.get(body.workspaceId)
        if (!workspace) {
          sendError(res, 404, '工作区不存在')
          return
        }
        cwd = workspace.path
      }
      if (!cwd || typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
        sendError(res, 400, '需要绝对路径 cwd 或已有 workspaceId')
        return
      }
      if (!workspace) {
        workspace = await ctx.workspaceRegistry.create(cwd)
      }
      const sessionId = randomUUID()
      const agent = await spawnAgent(
        'create',
        sessionId,
        workspace.path,
        requestedModel(body),
        typeof body.agentPreset === 'string' ? body.agentPreset : undefined,
      )
      applyPermission(agent.session, typeof body.permission === 'string' ? body.permission : undefined)
      await workspace.attachSession(sessionId)
      sendJson(res, 200, await summarizeSession(sessionId))
      return
    }

    const sessionMatch = pathname.match(/^\/camind\/api\/sessions\/([^/]+)(?:\/(resume|prompt|cancel|events|stream|permission|preset|commands|command|rename|fork|archive|files|file|git|uploads))?$/)
    if (!sessionMatch) {
      sendError(res, 404, `未知接口：${method} ${pathname}`)
      return
    }
    const sessionId = decodeURIComponent(sessionMatch[1])
    const action = sessionMatch[2]

    if (method === 'GET' && action === 'uploads') {
      sendJson(res, 200, { files: listSessionUploads(sessionId) })
      return
    }

    if (method === 'GET' && action === 'files') {
      const batches = pendingUploadBatches(sessionId)
      sendJson(res, 200, {
        batches: batches.map((batch) => ({
          batchId: batch.batch_id,
          files: availableUploads(batch).filter((file) => file.source === 'upload'),
        })),
      })
      return
    }

    if (method === 'POST' && action === 'files') {
      let body: { files?: UploadedFile[] }
      try {
        body = await readJson(req, MAX_UPLOAD_REQUEST_BYTES) as { files?: UploadedFile[] }
      } catch (error) {
        if (error instanceof HttpBodyTooLargeError) {
          sendError(res, 413, error.message)
          return
        }
        throw error
      }
      const uploads = Array.isArray(body.files) ? body.files : []
      const batch = await saveUploadBatch(sessionId, uploads, mediaTypeOf)
      if (batch) markUploadBatchPending(batch)
      sendJson(res, 200, {
        files: batch ? availableUploads(batch) : [],
        batchId: batch?.batch_id,
      })
      return
    }

    if (method === 'DELETE' && action === 'files') {
      const body = await readJson(req) as { batchId?: unknown; path?: unknown }
      if (typeof body.batchId !== 'string' || typeof body.path !== 'string') {
        sendError(res, 400, '需要 batchId 和 path')
        return
      }
      try {
        removePendingUpload(sessionId, body.batchId, body.path)
      } catch (error) {
        sendError(res, 400, error instanceof Error ? error.message : String(error))
        return
      }
      const batches = pendingUploadBatches(sessionId)
      sendJson(res, 200, {
        batches: batches.map((batch) => ({
          batchId: batch.batch_id,
          files: availableUploads(batch).filter((file) => file.source === 'upload'),
        })),
      })
      return
    }

    if (method === 'GET' && action === 'file') {
      const requested = url.searchParams.get('path')?.trim()
      if (!requested) {
        sendError(res, 400, '需要 path')
        return
      }
      try {
        if (url.searchParams.get('raw') === '1') {
          const resolved = await resolveSessionFile(sessionId, requested)
          const info = await stat(resolved.file)
          if (info.size > MAX_RAW_PREVIEW_BYTES) {
            sendError(res, 413, '文件过大，不能在浏览器中直接预览')
            return
          }
          const mediaType = mediaTypeOf(resolved.file)
          const bytes = await readFile(resolved.file)
          res.writeHead(200, {
            'Content-Type': mediaType,
            'Content-Length': String(bytes.length),
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(resolved.file))}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
          })
          res.end(bytes)
          return
        }
        sendJson(res, 200, await describePreview(sessionId, requested))
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        const status = name === 'FilePreviewNotFoundError' ? 404
          : name === 'FilePreviewForbiddenError' ? 403
            : name === 'FilePreviewInvalidError' ? 400
              : 500
        sendError(res, status, err instanceof Error ? err.message : String(err))
      }
      return
    }

    if (method === 'GET' && action === 'git') {
      sendJson(res, 200, await gitStatus(sessionId))
      return
    }

    if (method === 'POST' && action === 'rename') {
      const body = await readJson(req) as RenameSessionRequest
      const title = typeof body?.title === 'string' ? body.title : ''
      if (!titles) {
        sendError(res, 500, '当前环境没有会话标题服务')
        return
      }
      const agent = await ensureLive(sessionId)
      try {
        const accepted = titles.rename(agent.session, title)
        sendJson(res, 200, { title: accepted.title })
      } catch (err) {
        if (err instanceof Error && err.name === 'SessionTitleInvalidError') {
          sendError(res, 400, err.message)
          return
        }
        throw err
      }
      return
    }

    if (method === 'POST' && action === 'fork') {
      try {
        sendJson(res, 200, await forkSession(sessionId))
      } catch (err) {
        const status = err instanceof Error && 'status' in err ? Number((err as { status?: number }).status) : 500
        sendError(res, Number.isFinite(status) && status >= 400 ? status : 500, err instanceof Error ? err.message : String(err))
      }
      return
    }

    if (method === 'POST' && action === 'archive') {
      try {
        await ctx.workspaceRegistry.archiveSession(sessionId)
      } catch (err) {
        if (err instanceof Error && err.name === 'WorkspaceUnknownSessionError') {
          sendError(res, 404, err.message)
          return
        }
        throw err
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && action === 'resume') {
      const body = await readJson(req) as ResumeSessionRequest
      const agent = await ensureLive(sessionId, requestedModel(body))
      sendJson(res, 200, await summarizeSession(agent.id))
      return
    }

    if (method === 'POST' && action === 'prompt') {
      const body = await readJson(req) as PromptRequest
      const images = Array.isArray(body?.images) ? body.images : []
      const files = Array.isArray(body?.files) ? body.files : []
      let text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text && images.length === 0 && files.length === 0) {
        sendError(res, 400, '消息不能为空')
        return
      }
      const agent = await ensureLive(sessionId, requestedModel(body))
      applyPermission(agent.session, typeof body.permission === 'string' ? body.permission : undefined)
      const batch = await saveUploadBatch(sessionId, files, mediaTypeOf)
      if (batch) {
        const note = [
          `本轮上传批次：${batch.batch_id}`,
          ...batch.files.map((file) => `上传文件：${file.original_name}`),
          ...batch.extracted_files.map((file) => `ZIP 已解压：${file.path}`),
        ].join('\n')
        text = text ? `${text}\n\n${note}` : note
      }
      const attachments = await saveImages(images)
      agent.followup(createPrompt(text, attachments))
      sendJson(res, 200, { ok: true, status: agent.status })
      return
    }

    if (method === 'POST' && action === 'permission') {
      const body = await readJson(req) as { preset?: string }
      if (!body?.preset || typeof body.preset !== 'string') {
        sendError(res, 400, '需要 preset')
        return
      }
      const agent = await ensureLive(sessionId)
      applyPermission(agent.session, body.preset)
      const select = permissionSelect(agent.session.events)
      if (!select) {
        sendError(res, 404, '当前环境没有权限预设')
        return
      }
      sendJson(res, 200, select)
      return
    }

    if (method === 'POST' && action === 'preset') {
      const body = await readJson(req) as { agentPreset?: string }
      if (!body?.agentPreset || typeof body.agentPreset !== 'string') {
        sendError(res, 400, '需要 agentPreset')
        return
      }
      if (!ctx.agentPresets) {
        sendError(res, 404, '当前环境没有 Agent 预设')
        return
      }
      const agent = await ensureLive(sessionId)
      if (!sessionBlank(agent.session.events)) {
        sendError(res, 409, '会话已经开始，无法更换 Agent 模式')
        return
      }
      const preset = await ctx.agentPresets.recompose(agent.ctx, body.agentPreset)
      agent.session.append('agent-preset/selected', { agentPreset: preset.id })
      mountedPresets.set(sessionId, preset.id)
      const ref = await presetRef(preset.id)
      sendJson(res, 200, ref ?? { id: preset.id, name: preset.id })
      return
    }

    if (method === 'POST' && action === 'cancel') {
      const agent = ctx.agents.get(sessionId)
      if (!agent) {
        sendError(res, 404, '会话未在运行')
        return
      }
      agent.cancel({ kind: 'user' })
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && action === 'commands') {
      const agent = await ensureLive(sessionId)
      const commands = ctx.commands.list(agent).map(wireCommand)
      const cwd = agent.session.header.cwd
      const skills = (await skillRegistry(agent).list({
        ...cwd ? { cwd } : {},
        scope: agent,
      })).filter(isUserInvocable).map(wireSkill)
      sendJson(res, 200, { commands, skills })
      return
    }

    if (method === 'POST' && action === 'command') {
      const body = await readJson(req) as ExecuteCommandRequest
      const line = typeof body?.line === 'string' ? body.line.trim() : ''
      if (!line.startsWith('/')) {
        sendError(res, 400, '需要以 / 开头的命令行')
        return
      }
      const agent = await ensureLive(sessionId)
      const ac = new AbortController()
      const abort = () => ac.abort()
      req.on('close', abort)
      try {
        const execution = await ctx.commands.execute(agent, line, ac.signal)
        if (!execution) {
          sendError(res, 400, `未知或格式错误的命令：${line}`)
          return
        }
        sendJson(res, 200, {
          commandId: String(execution.commandId),
          result: {
            kind: execution.result.kind,
            ...execution.result.text !== undefined ? { text: execution.result.text } : {},
          },
        })
      } finally {
        req.off('close', abort)
      }
      return
    }

    if (method === 'GET' && (action === 'events' || action === undefined)) {
      sendJson(res, 200, await snapshotOf(sessionId))
      return
    }

    if (method === 'GET' && action === 'stream') {
      openSse(res)
      const set = streams.get(sessionId) ?? new Set()
      set.add(res)
      streams.set(sessionId, set)
      const drop = () => {
        set.delete(res)
        if (set.size === 0) streams.delete(sessionId)
      }
      req.on('close', drop)
      try {
        sseWrite(res, { type: 'snapshot', snapshot: await snapshotOf(sessionId) } satisfies StreamMessage)
        const agent = ctx.agents.get(sessionId)
        if (agent) sseWrite(res, { type: 'status', status: agent.status } satisfies StreamMessage)
      } catch (err) {
        sseWrite(res, { type: 'error', error: err instanceof Error ? err.message : String(err) } satisfies StreamMessage)
      }
      return
    }

    sendError(res, 404, `未知接口：${method} ${pathname}`)
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: '/camind/api',
    handler: async (req, res) => {
      try {
        await handleApi(req, res, parseUrl(req))
      } catch (err) {
        if (!res.headersSent) sendError(res, 500, err instanceof Error ? err.message : String(err))
        else res.end()
      }
    },
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: '/camind',
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      serveSpa(res, parseUrl(req).pathname, ctx.clientModules.graph())
    },
  })

  // 定制 UI 是默认入口：精确路由优先于官方前端的 fallback 席位，
  // 访问 / 时 302 到 /camind/（302 而非 301，随时可撤销）。0.1.1 起官方
  // 前端的 fallback 只在 dist 根与 /index.html 提供入口（任意路径不再
  // 回退 SPA），官方 UI 无 URL 路由逻辑，/web 精确路由 302 到 /index.html。
  ctx.webServer.register({
    kind: 'exact',
    path: '/',
    handler: (req, res) => {
      res.writeHead(302, { Location: '/camind/' })
      res.end()
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/web',
    handler: (req, res) => {
      res.writeHead(302, { Location: '/index.html' })
      res.end()
    },
  })

  console.log('[ui-shell] serving SPA at /camind  (/ redirects here; official UI at /web -> /index.html)')
}
