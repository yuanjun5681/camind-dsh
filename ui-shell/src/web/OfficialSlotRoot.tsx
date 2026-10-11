/**
 * ui-shell 的路由感知 frame（顶替官方 AppFrame 的 root occupant）。
 * 0.2.0 布局：sidebar 列 + 中央 keyed `main`（conversation 或全局面板）
 * + Workbench 列 + rightbar 列（官方右侧栏，0.1.1 的 details 已并入）。
 * 全局 Shell 只拥有 sidebar / page / overlay；会话详情三列属于子布局。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getLayoutSnapshot, layoutActions, subscribeLayout } from './officialLayout'
import { getOfficialClient } from './officialClient'
import { Workbench, type WorkbenchSession } from './Workbench'
import { DeliverablesSync } from './DeliverablesSync'
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore'

const SIDEBAR_DEFAULT = 280
const SIDEBAR_COLLAPSED = 56
const SIDEBAR_AUTO_COLLAPSE = 1024
const WORKBENCH_DEFAULT = 360
const WORKBENCH_MIN = 300
const WORKBENCH_MAX = 560
const RIGHTBAR_WIDTH = 380

type SessionListState = {
  byId: Record<string, (WorkbenchSession & { retainedBy?: Record<string, number | undefined> }) | undefined>
}

/** 0.2.0 的「当前会话」：mainView 保留计数 > 0 的列表行（ui-workspace 导航写入）。 */
export function selectMainSession(state: SessionListState): (WorkbenchSession & { id: string }) | undefined {
  for (const row of Object.values(state.byId)) {
    if (row && (row.retainedBy?.mainView ?? 0) > 0) return row as WorkbenchSession & { id: string }
  }
  return undefined
}

type RootProps = {
  renderSlot(name: string, owner: object, options?: { entryKey?: string }): ReactNode
  renderSlotChain(name: string, owner: object, options?: { fallback?: ReactNode; overlay?: boolean }): ReactNode
  useSessions<T>(selector: (state: SessionListState) => T): T
}

type SessionDetailLayoutProps = {
  current?: WorkbenchSession
  rightbarOpen: boolean
  renderSlot(name: string, owner: object, options?: { entryKey?: string }): ReactNode
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

function SessionDetailLayout({ current, rightbarOpen, renderSlot, viewport }: SessionDetailLayoutProps) {
  const workbench = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot)
  const [workbenchWidth, setWorkbenchWidth] = useState(WORKBENCH_DEFAULT)
  const resize = useRef<{ x: number; width: number }>()
  const rightbarWidth = current && rightbarOpen ? RIGHTBAR_WIDTH : 0
  const workbenchVisible = Boolean(current) && workbench.open && !rightbarOpen
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
      style={{ gridTemplateColumns: `minmax(0, 1fr) ${resolvedWorkbenchWidth}px ${rightbarWidth}px` }}
      data-workbench-collapsed={!workbenchVisible || undefined}
      data-workbench-overlay={workbenchOverlay || undefined}
      data-details-collapsed={!rightbarOpen || undefined}
    >
      <main className="official-conversation">
        {renderSlot('main', {}, { entryKey: 'conversation' })}
      </main>
      {current && <DeliverablesSync sessionId={current.id} />}
      <div className="official-workbench-column">
        {workbenchVisible && (
          <>
            <div className="workbench-resizer" role="separator" aria-orientation="vertical" onPointerDown={beginWorkbenchResize} />
            <Workbench session={current} />
          </>
        )}
      </div>
      <div className="official-details-column">
        {renderSlot('rightbar', {
          width: rightbarWidth,
          viewportWidth: viewport,
          // 是否放得下由视口宽度决定，不拿当前开合状态当闸门——seat 要能用
          // syncPresentation 把 layout 打开（openTab 等主动入口）。
          canShow: viewport >= 900,
        })}
      </div>
      {current && !workbenchVisible && !rightbarOpen && (
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
  const current = useSessions(selectMainSession)

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
  const activePanel = panels.activePanel
  const rightbar = panels.rightbar

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
        {activePanel !== null ? (
          <main className="official-main-panel">{renderSlot('main', {}, { entryKey: activePanel })}</main>
        ) : pluginPageRoute ? (
          <main className="official-page-content">{pluginPage}</main>
        ) : routeSessionId ? (
          <SessionDetailLayout
            current={routeSession}
            rightbarOpen={rightbar.open}
            renderSlot={renderSlot}
            viewport={viewport}
          />
        ) : (
          <main className="official-conversation official-home">
            {homePage}
            <div className="official-home-conversation">
              {renderSlot('main', {}, { entryKey: 'conversation' })}
            </div>
          </main>
        )}
      </div>
      <div className="official-overlay" data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
    </div>
  )
}
