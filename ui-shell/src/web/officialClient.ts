/**
 * 官方 client 插件运行时：加载 __DSH_BOOT__ 图、挂上 SlotRenderer。
 *
 * 官方 ui-layout 的 AppFrame 不知道项目 Workbench。这里用自管 layout shim
 * 提供 ctx.layout / theme，并以混合 root 渲染官方四个顶层 slot 与业务工作台。
 * 不 Vite-import 官方 ./client（factory require 在解开后会炸）。
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as ModulesClient from '@deepseek-ai/dsh-client-modules/client'
import { ClientModuleSystem, parseBootManifest } from '@deepseek-ai/dsh-client-modules/client'
import { APP_SHELL_ID, getStaticModules } from '@deepseek-ai/dsh-client-web'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { api } from './api'
import { layoutShim } from './officialLayout'
import { OfficialSlotRoot } from './OfficialSlotRoot'
import { DeliverableFiles, selectPreviewableDeliverables } from './DeliverableFiles'
import { FilePreviewOverlay } from './FilePreviewOverlay'
import { DiffOverlay } from './DiffOverlay'
import {
  WorkspaceFileUploadButton,
  WorkspaceUploadDock,
  type DroppedImageIntake,
} from './WorkspaceFileUpload'
import * as CustomSidebarClient from '../../../ui-sidebar/src/client/index'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const LAYOUT_ID = '@deepseek-ai/dsh-client-ui-layout'
const SIDEBAR_ID = '@deepseek-ai/dsh-client-ui-sidebar'

type SlotChildSpec = { kind: 'single' | 'list' | 'keyed' | 'chain'; scope: 'root' | 'session' | 'session-maybe' }

type OfficialSlots = {
  install(renderer: unknown): void
  renderSlot(name: string, owner: object): unknown
  renderSlotChain(name: string, owner: object, options?: { fallback?: unknown; overlay?: boolean }): unknown
  subscribe(name: string, fn: () => void): () => void
  getVersion(name: string): number
  entries(name: string): readonly { component?: unknown; options: { key?: string; id?: string } }[]
  entriesOfSlot(name: string): readonly { component?: unknown; options: { key?: string; id?: string } }[]
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

type SessionListSnapshot = {
  current: string | undefined
  phase?: 'pending' | 'ready'
  byId: Record<string, { blank?: boolean; cwd?: string; displayTitle?: string; title?: string; running?: boolean } | undefined>
}

type DraftImage = { id: string; file: File; previewUrl: string }
type ConversationImageService = {
  createDraftImages(files: readonly File[]): DraftImage[]
  draftImages(ids: readonly string[]): readonly DraftImage[]
  releaseDraftImages(images: readonly DraftImage[]): void
}

type SessionScope = {
  get(name: string): unknown
}

export type OfficialClient = ClientContext & {
  slots: OfficialSlots
  sessions: {
    scope(id: string): SessionScope | undefined
    list: {
      getSnapshot(): SessionListSnapshot
      subscribe(fn: () => void): () => void
    }
    open(id: string): void
    clear(): void
  }
  workspaces: {
    startSession(workspaceId?: string): void
  }
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

/** 装 SlotRenderer、混合 root，以及不替换官方 Conversation 的业务扩展。 */
const customShell = {
  name: 'ui-shell-app-shell',
  inject: ['slots', 'layout', 'sessions'],
  apply(ctx: ClientContext) {
    const slots = (ctx as OfficialClient).slots
    slots.install(createSlotRenderer())
    slots.register({
      name: 'root',
      priority: -1,
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        // 五个洞都由 OfficialSlotRoot 渲染；声明权仍集中在 root entry。
        conversation: { kind: 'single', scope: 'session-maybe' },
        'shell.content': { kind: 'chain', scope: 'root' },
        // 新会话首页（/）的品牌/示例扩展：内容叠在官方 conversation 上方，
        // 由插件（camind-ui-home）按 pathname === '/' 中标接管。
        'shell.home': { kind: 'chain', scope: 'root' },
        details: { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    }, OfficialSlotRoot)

    slots.inject('conversation.input.left', () => slots.register({
      name: 'conversation.input.left',
      id: 'custom-workspace-file-upload',
      order: 30,
    }, WorkspaceFileUploadButton))

    slots.inject('conversation.input.dock', () => slots.register({
      name: 'conversation.input.dock',
      id: 'custom-workspace-upload-dock',
      order: 30,
      inject: (sessionId: string) => {
        const sessionScope = (ctx as OfficialClient).sessions.scope(sessionId)
        const conversation = sessionScope?.get('conversation') as ConversationImageService | undefined
        const addDroppedImages: DroppedImageIntake = (files, currentImageIds, limits, addImageIds) => {
          if (!conversation) return '官方图片附件服务不可用'
          if (limits) {
            if (files.some((file) => !limits.mediaTypes.includes(file.type))) return '包含不支持的图片格式'
            if (currentImageIds.length + files.length > limits.maxImagesPerMessage) {
              return `每条消息最多添加 ${limits.maxImagesPerMessage} 张图片`
            }
            if (files.some((file) => file.size > limits.maxImageBytes)) {
              return `单张图片不能超过 ${Math.ceil(limits.maxImageBytes / 1024 / 1024)} MiB`
            }
            const existingBytes = conversation.draftImages(currentImageIds)
              .reduce((sum, image) => sum + image.file.size, 0)
            const incomingBytes = files.reduce((sum, file) => sum + file.size, 0)
            if (existingBytes + incomingBytes > limits.maxMessageImageBytes) {
              return `本条消息的图片总量不能超过 ${Math.ceil(limits.maxMessageImageBytes / 1024 / 1024)} MiB`
            }
          }
          try {
            const images = conversation.createDraftImages(files)
            if (addImageIds(images.map((image) => image.id))) return null
            conversation.releaseDraftImages(images)
            return '当前输入状态不能添加图片'
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        }
        return { addDroppedImages }
      },
    }, WorkspaceUploadDock))

    slots.inject('conversation.chat.turnTail', () => slots.register({
      name: 'conversation.chat.turnTail',
      priority: -100,
      select: selectPreviewableDeliverables as (owner: never) => unknown,
    }, DeliverableFiles))

    slots.inject('shell.overlay', () => slots.register({
      name: 'shell.overlay',
      id: 'file-preview',
      order: 10,
    }, FilePreviewOverlay))

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

export async function bootOfficialClient(): Promise<void> {
  try {
    await ensureBootGraph()
    const win = window as Window & { __DSH_BOOT__?: unknown; __DSH_MODULES__?: ClientModuleSystem; __ModuleLoader__?: unknown }
    if (win.__ModuleLoader__) {
      throw new Error('window.__ModuleLoader__ 已被占用，无法启动官方插件表')
    }
    const manifest = parseBootManifest(win.__DSH_BOOT__)
    const modules = new ClientModuleSystem({
      modules: manifest.modules,
      staticModules: getStaticModules(),
    })
    modules.registerStatic(APP_SHELL_ID, customShell)
    modules.registerStatic(MODULES_ID, ModulesClient)
    modules.registerStatic(LAYOUT_ID, layoutShim)
    // /camind 专用：以相同模块 ID 替换官方 Sidebar，满足 ui-workspace 的依赖边；
    // 官方 / 使用另一套 boot，不受影响。
    modules.registerStatic(SIDEBAR_ID, CustomSidebarClient)
    win.__DSH_MODULES__ = modules

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
