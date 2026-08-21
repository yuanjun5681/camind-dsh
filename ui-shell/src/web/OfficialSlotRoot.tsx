/**
 * ui-shell 的路由感知 AppFrame：全局 Shell 只拥有 sidebar / page / overlay；
 * Conversation / Workbench / Details 三列属于会话详情子布局。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getLayoutSnapshot, layoutActions, subscribeLayout } from './officialLayout'
import { Workbench, type WorkbenchSession } from './Workbench'
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore'

const SIDEBAR_DEFAULT = 280
const SIDEBAR_COLLAPSED = 56
const SIDEBAR_AUTO_COLLAPSE = 1024
const WORKBENCH_DEFAULT = 360
const WORKBENCH_MIN = 300
const WORKBENCH_MAX = 560

type SessionListState = {
  current?: string
  byId: Record<string, WorkbenchSession | undefined>
}

type RootProps = {
  renderSlot(name: string, owner: object): ReactNode
  renderSlotChain(name: string, owner: object, options?: { fallback?: ReactNode; overlay?: boolean }): ReactNode
  useSessions<T>(selector: (state: SessionListState) => T): T
}

type SessionDetailLayoutProps = {
  current?: WorkbenchSession
  panels: ReturnType<typeof getLayoutSnapshot>
  renderSlot(name: string, owner: object): ReactNode
  viewport: number
}

function sessionIdFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith('/s/')) return undefined
  try {
    return decodeURIComponent(pathname.slice(3))
  } catch {
    return undefined
  }
}

function isPluginPagePath(pathname: string): boolean {
  return pathname === '/pages' || pathname.startsWith('/pages/')
}

function SessionDetailLayout({ current, panels, renderSlot, viewport }: SessionDetailLayoutProps) {
  const workbench = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot)
  const [workbenchWidth, setWorkbenchWidth] = useState(WORKBENCH_DEFAULT)
  const resize = useRef<{ x: number; width: number }>()
  const detailsWidth = current ? panels.details : 0
  const workbenchVisible = Boolean(current) && workbench.open && detailsWidth === 0
  const workbenchOverlay = viewport < 1100
  const resolvedWorkbenchWidth = workbenchVisible && !workbenchOverlay
    ? Math.min(workbenchWidth, Math.max(WORKBENCH_MIN, viewport * 0.4))
    : 0

  function beginWorkbenchResize(event: PointerEvent<HTMLDivElement>) {
    if (!workbenchVisible) return
    resize.current = { x: event.clientX, width: workbenchWidth }
    const move = (next: globalThis.PointerEvent) => {
      const start = resize.current
      if (!start) return
      setWorkbenchWidth(Math.min(WORKBENCH_MAX, Math.max(WORKBENCH_MIN, start.width + start.x - next.clientX)))
    }
    const stop = () => {
      resize.current = undefined
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    event.preventDefault()
  }

  return (
    <section
      className="official-session-page"
      style={{ gridTemplateColumns: `minmax(0, 1fr) ${resolvedWorkbenchWidth}px ${detailsWidth}px` }}
      data-workbench-collapsed={!workbenchVisible || undefined}
      data-workbench-overlay={workbenchOverlay || undefined}
      data-details-collapsed={detailsWidth === 0 || undefined}
    >
      <main className="official-conversation">
        {renderSlot('conversation', {})}
      </main>
      <div className="official-workbench-column">
        {workbenchVisible && (
          <>
            <div className="workbench-resizer" role="separator" aria-orientation="vertical" onPointerDown={beginWorkbenchResize} />
            <Workbench session={current} />
          </>
        )}
      </div>
      <div className="official-details-column">
        {renderSlot('details', {})}
      </div>
      {current && !workbenchVisible && detailsWidth === 0 && (
        <button type="button" className="workbench-open" onClick={() => workbenchActions.open()}>
          工作台
        </button>
      )}
    </section>
  )
}

export function OfficialSlotRoot({ renderSlot, renderSlotChain, useSessions }: RootProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const panels = useSyncExternalStore(subscribeLayout, getLayoutSnapshot)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const current = useSessions((state) => state.current ? state.byId[state.current] : undefined)

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => {
    layoutActions.setNarrow(narrow)
  }, [narrow])

  const collapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : (panels.sidebar || SIDEBAR_DEFAULT)
  const routeOwner = {
    pathname: location.pathname,
    navigate: (path: string) => { navigate(path) },
  }
  const pluginPage = renderSlotChain('shell.content', routeOwner, { fallback: null })
  // 新会话首页扩展（camind-ui-home）：只在 / 分支渲染；无 entry 时为 null，
  // display:contents 锚点不影响布局，官方 conversation 行为完全不变。
  const homePage = renderSlotChain('shell.home', routeOwner, { fallback: null })
  const pluginPageRoute = isPluginPagePath(location.pathname)
  const routeSessionId = sessionIdFromPath(location.pathname)
  const routeSession = routeSessionId && current?.id === routeSessionId ? current : undefined

  return (
    <div
      className="official-frame"
      style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
      data-sidebar-collapsed={collapsed || undefined}
    >
      <div className="official-sidebar" style={{ width: sidebarWidth }}>
        {renderSlot('sidebar', {
          collapsed,
          width: sidebarWidth,
          ...routeOwner,
        })}
      </div>
      <div className="official-page">
        {pluginPageRoute ? (
          <main className="official-page-content">{pluginPage}</main>
        ) : routeSessionId ? (
          <SessionDetailLayout
            current={routeSession}
            panels={panels}
            renderSlot={renderSlot}
            viewport={viewport}
          />
        ) : (
          <main className="official-conversation official-home">
            {homePage}
            <div className="official-home-conversation">{renderSlot('conversation', {})}</div>
          </main>
        )}
      </div>
      <div className="official-overlay" data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
    </div>
  )
}
