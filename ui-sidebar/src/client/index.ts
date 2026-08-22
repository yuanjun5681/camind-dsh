/**
 * Custom Sidebar client plugin. It occupies the official `sidebar` seat under
 * the official package id in ui-shell, preserving downstream slot names.
 * Locale namespace stays `customSidebar`: the official `sidebar` namespace
 * belongs to the stock sidebar and re-registering it would throw.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps,
  SidebarBrandNameOwnerProps,
  SidebarFooterActionOwnerProps,
  SidebarRootComponentProps,
  SidebarRootInjected,
  SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    customSidebar: SidebarKey
  }
}

const NS = 'customSidebar'

export const name = 'ui-shell-sidebar'
export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries')

  const injectProps = (): SidebarRootInjected => ({
    startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
  })

  ctx.slots.inject('sidebar', () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      // The shell owns geometry and the brand seats; ui-workspace registers
      // the browsing region, ui-settings the foot trigger + settings panel,
      // camind-ui-brand the brand mark/name occupants.
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: injectProps,
    }, SidebarRoot))
}
