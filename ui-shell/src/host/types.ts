/**
 * 自定义 UI 的 Host 侧类型：只描述本插件真正调用的 ctx 面，
 * 不把 @deepseek-ai/* 拉进依赖树（那些包是 peer，装进插件会重复且易碎）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export type AgentStatus = 'idle' | 'running'

export interface SessionEvent {
  type: string
  seq: number
  time: number
  data: unknown
  surfaceOp?: 'append' | { op: string }
}

export interface SessionHeader {
  id: string
  createdAt: number
  cwd?: string
  agentPreset?: string
}

export interface Session {
  readonly id: string
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  append(type: string, data: unknown): void
}

export interface Agent {
  readonly id: string
  readonly status: AgentStatus
  readonly session: Session
  readonly ctx: AgentScopedContext
  followup(message: unknown): void
  cancel(cause: { kind: 'user' }): void
}

export interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

export interface AgentScopedContext {
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
}

export interface Workspace {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly createdAt: string
  readonly sessionIds: readonly string[]
  attachSession(sessionId: string): Promise<void>
  setTitle(title: string): Promise<void>
}

export type DirectoryPickerCapability =
  | { kind: 'native'; pick: (signal: AbortSignal) => Promise<string | null> }
  | {
    kind: 'browse'
    list: (path?: string, signal?: AbortSignal) => Promise<unknown>
    createDirectory: (path: string, name: string) => Promise<string>
  }

export interface HostContext {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  agents: {
    create(options: {
      sessionId: string
      meta?: {
        cwd?: string
        agentPreset?: string
        parentSession?: string
        seedLength?: number
      }
      seed?: readonly SessionEvent[]
      agentOptions?: ModelSelection
      setup?: (agentCtx: AgentScopedContext) => void | Promise<void>
    }): Promise<AgentHandle>
    resume(options: {
      resumeSessionId: string
      agentOptions?: ModelSelection
      setup?: (agentCtx: AgentScopedContext) => void | Promise<void>
    }): Promise<AgentHandle>
    get(id: string): Agent | undefined
  }
  llm?: {
    listProviders(): readonly { id: string; name: string }[]
    listConfigurableProviders(): readonly {
      provider: string
      displayName: string
      settingsNs: string
      settingsPath: readonly string[]
      declared?: boolean
    }[]
    listModels(provider: string): Promise<readonly { id: string; name: string; description?: string }[]>
    resolveModelInfo(provider: string, model: string): Promise<{
      id: string
      name: string
      description?: string
      context?: { contextWindow: number }
      reasoning?: {
        efforts: readonly { id: string; name: string; description?: string }[]
        defaultEffort?: string
      }
    }>
    discoverModels(settingsNs: string, request: {
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }): Promise<readonly {
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
    }[]>
  }
  agentDefaultModel?: {
    currentSelection(): ModelSelection
  }
  permissionPresets?: {
    names: readonly string[]
    defaultPreset: string
    current(events: readonly SessionEvent[]): string
    optionOf(name: string): { value: string; name: string; description?: string }
    set(session: Session, name: string): void
  }
  agentPresets?: {
    defaultId: string
    authorable: boolean
    list(): Promise<readonly {
      id: string
      name?: string
      description?: string
      trust: 'system' | 'user'
      broken?: string
      path: string
    }[]>
    resolve(id?: string): Promise<{
      id: string
      name?: string
      description?: string
      trust: 'system' | 'user'
      broken?: string
      path: string
    }>
    read(id: string): Promise<string>
    copy(from: string, id: string, name?: string): Promise<void>
    remove(id: string): Promise<void>
    mount(agentCtx: AgentScopedContext, id?: string): Promise<{ id: string }>
    recompose(agentCtx: AgentScopedContext, id: string): Promise<{ id: string }>
    /** 预设 isolate 里的服务对 Host 不可见；按 agent 取该会话实际挂上的实例。 */
    serviceFor(agent: Agent, name: string): unknown
  }
  /** 可选服务：官方设置/凭据/插件清单不在 inject 里，运行时 ctx.get。 */
  get?(name: string): unknown
  attachments?: {
    saveImages(inputs: readonly { data: Uint8Array; mediaType: string; name?: string }[]): Promise<readonly ImageAttachmentRef[]>
  }
  sessions: {
    get(id: string): Session | undefined
    list(): Session[]
  }
  workspaceRegistry: {
    list(): Workspace[]
    get(id: string): Workspace | undefined
    create(path: string, title?: string): Promise<Workspace>
    delete(id: string): Promise<boolean>
    archivedSessionIds: readonly string[]
    archiveSession(sessionId: string): Promise<void>
  }
  sessionPersistence?: {
    list(): Promise<SessionHeader[]>
    inspect(id: string): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>
  }
  sessionTitle?: {
    get(session: Session): { title: string } | undefined
    rename(session: Session, title: string): { title: string; eventSeq: number }
  }
  directoryPicker: {
    capability(): DirectoryPickerCapability
  }
  commands: {
    list(agent: Agent): readonly {
      name: string
      description: string
      input?: { hint: string }
    }[]
    execute(agent: Agent, line: string, signal: AbortSignal): Promise<{
      commandId: string
      result: { kind: 'success' | 'error'; text?: string }
    } | undefined>
  }
  skills: {
    list(options?: { cwd?: string; scope?: unknown; signal?: AbortSignal }): Promise<readonly {
      name: string
      description: string
      whenToUse?: string
      invocation: { modelInvocable: boolean; userInvocable: boolean }
    }[]>
  }
  clientModules: {
    graph(): {
      rev: string
      entries: readonly {
        id: string
        url: string
        rev: string
        inject?: readonly string[]
        immediately?: boolean
      }[]
    }
  }
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  effect(factory: () => (() => void) | void): void
}
