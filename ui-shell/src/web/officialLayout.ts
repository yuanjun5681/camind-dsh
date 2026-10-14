/**
 * 替代官方 ui-layout 的 apply：提供 0.2.0 契约的 ctx.layout 与 theme 投影。
 * 不 import 官方 ./client（Vite 解开 factory 后 require("react/jsx-runtime") 会炸）。
 *
 * 0.2.0 的 ILayout：panelInfo / selectPanel / beginNavigation / toggleSidebar /
 * openRightbar / closeRightbar（details 时代已结束，右栏归 ui-sidebar-right，
 * 经 openRightbar 上报开合）。usePanelInfo 全局标准 prop 由这里
 * slots.provideRoot 供出（官方由 ui-layout 提供；我们顶替了它）。
 * selectPanel 的合法性校验照上游：必须是已注册的 main key。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'

const SIDEBAR_DEFAULT = 280
const DARK_ATTRIBUTE = 'data-ds-dark-theme'
const THEME_SOURCE_ATTRIBUTE = 'data-ds-theme-source'
const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size'

export type RightbarState = {
  open: boolean
  track: boolean
  fullscreen: boolean
}

export type LayoutState = {
  sidebar: number
  narrow: boolean
  narrowExpanded: boolean
  activePanel: string | null
  rightbar: RightbarState
}

let layoutState: LayoutState = {
  sidebar: SIDEBAR_DEFAULT,
  narrow: false,
  narrowExpanded: false,
  activePanel: null,
  rightbar: { open: false, track: false, fullscreen: false },
}

const layoutListeners = new Set<() => void>()

function emitLayout() {
  for (const listener of layoutListeners) listener()
}

function writeLayout(patch: Partial<LayoutState>) {
  layoutState = { ...layoutState, ...patch }
  emitLayout()
}

export function getLayoutSnapshot(): LayoutState {
  return layoutState
}

export function subscribeLayout(listener: () => void): () => void {
  layoutListeners.add(listener)
  return () => { layoutListeners.delete(listener) }
}

export const layoutActions = {
  setSidebar(px: number) {
    writeLayout({ sidebar: Math.min(420, Math.max(264, Math.round(px))) })
  },
  toggleSidebar() {
    if (layoutState.narrow) writeLayout({ narrowExpanded: !layoutState.narrowExpanded })
    else writeLayout({ sidebar: layoutState.sidebar === 0 ? SIDEBAR_DEFAULT : 0 })
  },
  setNarrow(narrow: boolean) {
    if (layoutState.narrow === narrow) return
    writeLayout({ narrow, narrowExpanded: false })
  },
}

type MainPanelId = string

// panelInfo 快照必须是引用稳定的对象：useSyncExternalStore 按 Object.is 比
// 较快照，每次新对象会让官方订阅方（WorkspaceBrowser 等）陷入 #185 更新风暴。
let panelInfoSnapshot: { activePanelId: MainPanelId | null } = { activePanelId: null }

type SlotsLike = {
  entries(name: string): readonly { options: { key?: string } }[]
  provideRoot(contribution: { hooks?: Record<string, unknown> }): () => void
}

class LayoutController {
  /** Root-scoped navigation state exposed to panel-aware components. */
  readonly panelInfo = {
    getSnapshot: () => panelInfoSnapshot,
    subscribe: (listener: () => void) => subscribeLayout(listener),
  }

  #slots: SlotsLike | undefined
  #navigation = new AbortController()

  attachSlots(slots: SlotsLike) {
    this.#slots = slots
  }

  selectPanel(panelId: MainPanelId | null) {
    if (panelId !== null && !this.#slots?.entries('main').some((entry) => entry.options.key === panelId)) {
      throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
    }
    if (layoutState.activePanel === panelId) return
    this.#navigation.abort()
    this.#navigation = new AbortController()
    panelInfoSnapshot = { activePanelId: panelId }
    writeLayout({ activePanel: panelId })
  }

  beginNavigation(): AbortSignal {
    this.#navigation.abort()
    this.#navigation = new AbortController()
    return this.#navigation.signal
  }

  dispose() {
    this.#navigation.abort()
  }

  toggleSidebar() {
    layoutActions.toggleSidebar()
  }

  openRightbar(track: boolean, fullscreen: boolean) {
    writeLayout({ rightbar: { open: true, track, fullscreen } })
  }

  closeRightbar() {
    writeLayout({ rightbar: { open: false, track: false, fullscreen: false } })
  }
}

type ThemeSnapshot = {
  preference?: string
  fontSize?: number
  active: {
    colorScheme: string
    tokens: Record<string, string>
  }
}

/** 与上游 ui-layout theme-presenter 同口径：color-scheme + palette 属性 +
 * 主题来源属性 + 内容字号轴 + token 内联 + theme-color。 */
class ThemePresenter {
  appliedTokens: string[] = []
  themeColorMeta = document.createElement('meta')

  constructor() {
    this.themeColorMeta.name = 'theme-color'
  }

  apply(snapshot: ThemeSnapshot) {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    document.documentElement.setAttribute(
      THEME_SOURCE_ATTRIBUTE,
      snapshot.preference === 'system' ? 'system' : scheme,
    )
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    if (typeof snapshot.fontSize === 'number') {
      body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`)
    }
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
  }

  dispose() {
    document.documentElement.style.removeProperty('color-scheme')
    document.documentElement.removeAttribute(THEME_SOURCE_ATTRIBUTE)
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}

type LayoutHost = ClientContext & {
  slots: SlotsLike
  theme: {
    getTheme(): ThemeSnapshot
  }
  reflect: {
    provide(name: string, value: unknown): () => void
  }
}

export const layoutShim = {
  name: 'ui-shell-layout-shim',
  inject: ['slots', 'theme'],
  apply(ctx: ClientContext) {
    const host = ctx as LayoutHost
    const layout = new LayoutController()
    layout.attachSlots(host.slots)
    ctx.effect(() => host.reflect.provide('layout', layout), 'ui-shell-layout: service')
    ctx.effect(() => host.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } }), 'ui-shell-layout: panelInfo')
    ctx.effect(() => () => layout.dispose(), 'ui-shell-layout: navigation')
    ctx.effect(() => {
      const presenter = new ThemePresenter()
      presenter.apply(host.theme.getTheme())
      const off = ctx.on('theme/change', (snapshot: ThemeSnapshot) => {
        presenter.apply(snapshot)
      })
      return () => {
        off()
        presenter.dispose()
      }
    }, 'ui-shell-layout: theme presenter')
  },
}
