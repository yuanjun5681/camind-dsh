/**
 * Official-compatible Sidebar contracts plus a custom brand seat. The official
 * workspace/settings owner props are deliberately kept unchanged so their stock
 * plugins continue to register without adapters. The official `sidebar.footer.action`
 * list additionally receives the shell's `pathname`/`navigate` so footer entries
 * can be route-aware (a superset of the official owner props — stock plugins
 * registering there simply ignore the extra fields).
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/dsh-client-ui-layout/client' {
  interface SidebarOwnerProps {
    /** Current ui-shell route; ignored by the official Sidebar implementation. */
    pathname: string
    /** Shell-owned SPA navigation callback. */
    navigate: (path: string) => void
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.brand': { kind: 'single'; scope: 'root'; owner: SidebarBrandOwnerProps }
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
  }
}

export interface SidebarBrandOwnerProps {
  wide: boolean
}

export interface SidebarSectionOwnerProps {
  wide: boolean
  expandSidebar: () => void
}

export interface SidebarSettingsOwnerProps {
  wide: boolean
}

export interface SidebarFooterActionOwnerProps {
  wide: boolean
  pathname: string
  navigate: (path: string) => void
}

export type SidebarRootInjected = {
  startSession: (workspaceId?: WorkspaceId) => void
  toggleSidebar: () => void
}

export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<
    'sidebar.brand'
    | 'sidebar.workspaces'
    | 'sidebar.settings'
    | 'sidebar.footer.action'
  >
  & SidebarRootInjected
  & PropsLocale<'customSidebar'>
