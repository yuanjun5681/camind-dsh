/**
 * 官方 client 插件运行时：加载 __DSH_BOOT__ 图、挂上 SlotRenderer。
 *
 * 官方 ui-layout 的 AppFrame 不知道项目 Workbench。这里用自管 layout shim
 * 提供 0.2.0 契约的 ctx.layout / theme，并以混合 root 渲染官方顶层 slot
 * （sidebar / main keyed / rightbar / shell.overlay / shell.leading）与业务
 * 工作台。0.1.1 起官方模块系统删除 registerStatic：本地替换模块（layout
 * shim、定制 Sidebar、app-shell）改为在建系统前压入 __ModuleLoader__
 * 待处理队列。
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as ModulesClient from '@deepseek-ai/dsh-client-modules/client'
import { createClientModuleSystem } from '@deepseek-ai/dsh-client-modules/client'
import { getStaticModules } from '@deepseek-ai/dsh-client-web'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { api } from './api'
import { layoutShim } from './officialLayout'
import { OfficialSlotRoot } from './OfficialSlotRoot'
import { bindPreviewClient } from './previewClient'
import { DiffOverlay } from './DiffOverlay'
import {
  WorkspaceUploadDock,
} from './WorkspaceFileUpload'
import * as CustomSidebarClient from '../../../ui-sidebar/src/client/index'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const LAYOUT_ID = '@deepseek-ai/dsh-client-ui-layout'
const SIDEBAR_ID = '@deepseek-ai/dsh-client-ui-sidebar'
// 本地 app-shell 行：不在 Host 下发的图里，用预注册 factory + 显式 create 激活。
const APP_SHELL_ID = 'camind-ui-shell/app-shell'

type SlotChildSpec = { kind: 'single' | 'list' | 'keyed' | 'chain'; scope: 'root' | 'session' | 'session-maybe' }

type OfficialSlots = {
  install(renderer: unknown): void
  renderSlot(name: string, owner: object): unknown
  renderSlotChain(name: string, owner: object, options?: { fallback?: unknown; overlay?: boolean }): unknown
  subscribe(name: string, fn: () => void): () => void
  getVersion(name: string): number
  entries(name: string): readonly { component?: unknown; options: { key?: string; id?: string } }[]
  entriesOfSlot(name: string): readonly { component?: unknown; options: { key?: string; id?: string } }[]
  provideRoot(contribution: { hooks?: Record<string, unknown> }): () => void
  register(options: {
    name: string
    priority?: number
    order?: number
    id?: string
    select?: (owner: never) => unknown
    children?: Record<string, SlotChildSpec>
    store?: unknown
    inject?: unknown
  }, component: unknown): () => void
  inject(name: string, effect: () => (() => void)): () => void
}

/** 0.2.0 SessionListState：无 current；当前会话 = retainedBy.mainView > 0 的行。 */
type SessionListSnapshot = {
  ids: string[]
  phase?: 'pending' | 'ready'
  byId: Record<string, {
    id: string
    blank?: boolean
    cwd?: string
    displayTitle?: string
    title?: string
    running?: boolean
    retainedBy?: Record<string, number | undefined>
  } | undefined>
}

type DraftAttachment = { id: string; kind: string; file: File }
type ConversationRootService = {
  createDrafts(sessionId: string, files: readonly File[]): readonly DraftAttachment[]
  releaseDraftAttachments(attachments: readonly DraftAttachment[]): void
  resolveDraftAttachments(ids: readonly string[]): readonly DraftAttachment[]
}
type SessionConversationService = {
  input: { for(scope: unknown): { state: unknown; setDraft(text: string): void; addAttachments(ids: readonly string[]): boolean } }
}

type SessionScope = {
  get(name: string): unknown
}

export type OfficialClient = ClientContext & {
  slots: OfficialSlots
  sessions: {
    scope(id: string): SessionScope | undefined
    binding(id: string): { sessionId: string; session: unknown; ctx: ClientContext } | undefined
    list: {
      getSnapshot(): SessionListSnapshot
      subscribe(fn: () => void): () => void
    }
  }
  uiWorkspace: {
    startSession(workspaceId?: string): void
    openSession(target: string): void
  }
  conversation: ConversationRootService
}

let client: OfficialClient | null = null
let bootError: string | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getOfficialClient(): OfficialClient | null {
  return client
}

export function getOfficialBootError(): string | null {
  return bootError
}

export function subscribeOfficialClient(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 装混合 root 与不替换官方 Conversation 的业务扩展；SlotRenderer 由官方
 *  ui-renderer 插件（图内 fetch bundle）安装。 */
const customShell = {
  name: 'ui-shell-app-shell',
  inject: ['slots', 'layout', 'sessions'],
  apply(ctx: ClientContext) {
    const root = ctx as OfficialClient
    const slots = root.slots
    // 内容预览入口桥：预览本体在 camind-ui-preview 插件（路由 + 「预览」标签页），
    // 本壳各「预览」按钮经 previewClient 转发其 filePreview 服务。
    bindPreviewClient(ctx)
    slots.register({
      name: 'root',
      priority: -1,
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        // 0.2.0 的中央面板是 keyed main（官方会话占 key conversation，
        // 插件管理/自动化任务占各自 key），六个洞都由 OfficialSlotRoot 渲染；
        // 声明权仍集中在 root entry。
        main: { kind: 'keyed', scope: 'root' },
        rightbar: { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        // macOS 桌面壳的窗口镀铬席；Web 侧栏永不完全隐藏，声明供注入激活但不渲染。
        'shell.leading': { kind: 'single', scope: 'root' },
        'shell.content': { kind: 'chain', scope: 'root' },
        // 新会话首页（/）的品牌/示例扩展：内容叠在官方 conversation 上方，
        // 由插件（camind-ui-home）按 pathname === '/' 中标接管。
        'shell.home': { kind: 'chain', scope: 'root' },
      },
    }, OfficialSlotRoot)

    // 0.2.0 官方 composer 的 + 菜单已含文件上传，0.1.1 的自定义「+ 文件」按钮退役；
    // Camind 会话上传（Host pending 批次 + pre-step 上下文）由下方 dock 的拖放承担。
    slots.inject('conversation.input.dock', () => slots.register({
      name: 'conversation.input.dock',
      id: 'custom-workspace-upload-dock',
      order: 30,
      inject: (sessionId: string) => {
        const sessionScope = root.sessions.scope(sessionId)
        const conversation = sessionScope?.get('conversation') as SessionConversationService | undefined
        const input = sessionScope && conversation?.input.for(sessionScope)
        const addDroppedImages = (files: readonly File[], currentAttachmentIds: readonly string[], limits?: {
          mediaTypes: readonly string[]
          maxImagesPerMessage: number
          maxImageBytes: number
          maxMessageImageBytes: number
        }): string | null => {
          if (!input) return '官方图片附件服务不可用'
          if (limits) {
            if (files.some((file) => !limits.mediaTypes.includes(file.type))) return '包含不支持的图片格式'
            if (currentAttachmentIds.length + files.length > limits.maxImagesPerMessage) {
              return `每条消息最多添加 ${limits.maxImagesPerMessage} 张图片`
            }
            if (files.some((file) => file.size > limits.maxImageBytes)) {
              return `单张图片不能超过 ${Math.ceil(limits.maxImageBytes / 1024 / 1024)} MiB`
            }
            const existingBytes = root.conversation.resolveDraftAttachments(currentAttachmentIds)
              .reduce((sum, attachment) => sum + attachment.file.size, 0)
            const incomingBytes = files.reduce((sum, file) => sum + file.size, 0)
            if (existingBytes + incomingBytes > limits.maxMessageImageBytes) {
              return `本条消息的图片总量不能超过 ${Math.ceil(limits.maxMessageImageBytes / 1024 / 1024)} MiB`
            }
          }
          try {
            const drafts = root.conversation.createDrafts(sessionId, files)
            if (input.addAttachments(drafts.map((draft) => draft.id))) return null
            root.conversation.releaseDraftAttachments(drafts)
            return '当前输入状态不能添加图片'
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        }
        return { addDroppedImages }
      },
    }, WorkspaceUploadDock))

    slots.inject('shell.overlay', () => slots.register({
      name: 'shell.overlay',
      id: 'code-diff',
      order: 20,
    }, DiffOverlay))
  },
}

async function ensureBootGraph(): Promise<void> {
  const win = window as Window & { __DSH_BOOT__?: unknown }
  if (win.__DSH_BOOT__) return
  const graph = await api.clientPlugins()
  win.__DSH_BOOT__ = graph
}

type BundleRegistration = {
  id: string
  factory: (require: (spec: string) => unknown) => Record<string, unknown>
}

/** 官方引导 HTML 内联脚本安装的页面级 facade（见 dsh-client-modules 的
 *  ClientModuleLoaderTarget）；/camind 是自己的 SPA，由这里补齐。 */
type ModuleLoaderFacade = {
  mode: 'queue' | 'live'
  pendingQueue: BundleRegistration[]
  load(registration: BundleRegistration): void
  create(options: { boot: unknown; staticModules: Record<string, unknown> }): ClientModuleSystemLike
}

type ClientModuleSystemLike = {
  manifest: { plugins: { id: string; immediately: boolean }[] }
  prefetch(id: string): Promise<void>
}

export async function bootOfficialClient(): Promise<void> {
  try {
    await ensureBootGraph()
    const win = window as Window & {
      __DSH_BOOT__?: unknown
      __DSH_MODULES__?: ClientModuleSystemLike
      __ModuleLoader__?: ModuleLoaderFacade
    }
    if (win.__ModuleLoader__) {
      throw new Error('window.__ModuleLoader__ 已被占用，无法启动官方插件表')
    }
    const facade: ModuleLoaderFacade = {
      mode: 'queue',
      pendingQueue: [],
      load(registration) { this.pendingQueue.push(registration) },
      create(options) {
        return createClientModuleSystem(
          this as never,
          { id: MODULES_ID, exports: ModulesClient as Record<string, unknown> },
          options as never,
        ) as unknown as ClientModuleSystemLike
      },
    }
    win.__ModuleLoader__ = facade
    // /camind 专用：以图行 ID 预注册本地模块——layout 换 shim、Sidebar 换
    // 定制实现（满足 ui-workspace 的依赖边）；app-shell 是图外自定义行。
    // 官方 /web 使用另一套 boot，不受影响。factory 闭包持有 Vite 打包后的模块。
    facade.load({ id: LAYOUT_ID, factory: () => layoutShim as never })
    facade.load({ id: SIDEBAR_ID, factory: () => CustomSidebarClient as Record<string, unknown> })
    facade.load({ id: APP_SHELL_ID, factory: () => customShell as never })
    const modules = facade.create({ boot: win.__DSH_BOOT__, staticModules: getStaticModules() })
    win.__DSH_MODULES__ = modules
    // 0.2.0 起官方 bundle 走 combo 批次：批次脚本一次性注册批次内全部
    // factory，模块系统在 create() 时把 facade.load 改写为 live 注册。本地
    // 预注册顶替的两个图行（layout/sidebar）也会在批次里再注册一次——
    // 官方模块系统对重复注册直接 throw 并中断批次余量，这里在 live 口子上
    // 把被顶替 id 的官方注册吞掉（本地 factory 已在 create 前入队生效）。
    const stripClientSuffix = (ModulesClient as Record<string, unknown>).stripClientSuffix as
      ((id: string) => string) | undefined
    const strip = stripClientSuffix ?? ((id: string) => id.replace(/\/client$/, ''))
    const replacedIds = new Set([LAYOUT_ID, SIDEBAR_ID])
    const liveLoad = facade.load.bind(facade)
    facade.load = (registration) => {
      if (replacedIds.has(strip(registration.id))) return
      liveLoad(registration)
    }
    const manifest = modules.manifest

    const ctx = new Context()
    await ctx.plugin(Loader)
    ctx.loader.internal = modules

    await Promise.all(
      manifest.plugins
        .filter((row) => row.immediately)
        .map((row) => modules.prefetch(row.id).catch(() => undefined)),
    )

    const rows = [
      MODULES_ID,
      ...manifest.plugins.map((row) => row.id).filter((id) => id !== MODULES_ID),
      APP_SHELL_ID,
    ]
    await Promise.all(rows.map(async (name) => {
      try {
        await ctx.loader.create({ name })
      } catch (err) {
        console.warn(`[ui-shell] 官方插件 ${name} 未激活`, err)
      }
    }))
    await ctx.loader.await()
    client = ctx as OfficialClient
    emit()
  } catch (err) {
    bootError = err instanceof Error ? err.message : String(err)
    console.warn('[ui-shell] 官方 client 未能启动', err)
    emit()
  }
}
