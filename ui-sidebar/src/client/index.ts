/**
 * Custom Sidebar client plugin. It occupies the official `sidebar` seat under
 * the official package id in ui-shell, preserving downstream slot names.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandOwnerProps,
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
      children: {
        'sidebar.brand': { kind: 'single', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: injectProps,
    }, SidebarRoot))
}
