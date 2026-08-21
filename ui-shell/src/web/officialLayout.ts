/**
 * 替代官方 ui-layout 的 apply：提供 ctx.layout 与 theme 投影。
 * 不 import 官方 ./client（Vite 解开 factory 后 require("react/jsx-runtime") 会炸）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

const SIDEBAR_DEFAULT = 280
const DARK_ATTRIBUTE = 'data-ds-dark-theme'

export type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
}

let layoutState: LayoutState = {
  sidebar: SIDEBAR_DEFAULT,
  details: 0,
  narrow: false,
  narrowExpanded: false,
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
  setDetails(px: number) {
    writeLayout({ details: Math.min(520, Math.max(300, Math.round(px))) })
  },
  toggleSidebar() {
    if (layoutState.narrow) writeLayout({ narrowExpanded: !layoutState.narrowExpanded })
    else writeLayout({ sidebar: layoutState.sidebar === 0 ? SIDEBAR_DEFAULT : 0 })
  },
  setNarrow(narrow: boolean) {
    if (layoutState.narrow === narrow) return
    writeLayout({ narrow, narrowExpanded: false })
  },
  openDetails() {
    if (layoutState.details === 0) writeLayout({ details: 360 })
  },
  closeDetails() {
    writeLayout({ details: 0 })
  },
}

class LayoutController {
  #panels: typeof layoutActions | undefined

  attachPanels(actions: typeof layoutActions) {
    this.#panels = actions
  }

  toggleSidebar() {
    this.#require().toggleSidebar()
  }

  openDetails() {
    this.#require().openDetails()
  }

  closeDetails() {
    this.#require().closeDetails()
  }

  #require() {
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}

type ThemeSnapshot = {
  active: {
    colorScheme: string
    tokens: Record<string, string>
  }
}

class ThemePresenter {
  appliedTokens: string[] = []
  themeColorMeta = document.createElement('meta')

  constructor() {
    this.themeColorMeta.name = 'theme-color'
  }

  apply(snapshot: ThemeSnapshot) {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
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
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}

type LayoutHost = ClientContext & {
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
    layout.attachPanels(layoutActions)
    ctx.effect(() => host.reflect.provide('layout', layout), 'ui-shell-layout: service')
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
