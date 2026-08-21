/**
 * 挂载 custom root（官方 sidebar / conversation / details + Workbench），
 * 并让官方当前会话与 /camind 的 React Router 对齐。
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  getOfficialBootError,
  getOfficialClient,
  subscribeOfficialClient,
  type OfficialClient,
} from './officialClient'

function useOfficialClient() {
  return useSyncExternalStore(subscribeOfficialClient, getOfficialClient)
}

function useSlotVersion(name: string): number {
  const ctx = useOfficialClient()
  return useSyncExternalStore(
    (listener) => {
      if (!ctx) return subscribeOfficialClient(listener)
      const offSlot = ctx.slots.subscribe(name, listener)
      const offClient = subscribeOfficialClient(listener)
      return () => {
        offSlot()
        offClient()
      }
    },
    () => ctx?.slots.getVersion(name) ?? 0,
  )
}

function currentSessionId(pathname: string): string | undefined {
  if (!pathname.startsWith('/s/')) return undefined
  return decodeURIComponent(pathname.slice(3))
}

function sessionPath(id: string, blank?: boolean): string {
  return blank ? '/' : `/s/${encodeURIComponent(id)}`
}

function isPluginPage(pathname: string): boolean {
  return pathname === '/pages' || pathname.startsWith('/pages/')
}

function readSessionList(ctx: OfficialClient) {
  return ctx.sessions.list.getSnapshot()
}

/**
 * 给官方动作补上 ui-shell 的 URL 语义。单靠 store.current 订阅无法感知
 * “再次打开当前会话”或“复用当前空白会话”，这两种动作必须在调用边界处理。
 */
function useOfficialActionRoutes(ctx: OfficialClient | null, routeSettled: RefObject<boolean>) {
  const navigate = useNavigate()
  const location = useLocation()
  const route = useRef({ pathname: location.pathname, navigate })
  route.current = { pathname: location.pathname, navigate }

  useEffect(() => {
    if (!ctx) return

    const originalOpen = ctx.sessions.open
    const originalStartSession = ctx.workspaces.startSession
    const open: OfficialClient['sessions']['open'] = (id) => {
      originalOpen.call(ctx.sessions, id)
      const summary = readSessionList(ctx).byId[id]
      const next = sessionPath(id, Boolean(summary?.blank))
      // 启动阶段 client runtime 自动 open 恢复会话（connectWorkspace）；此时路由
      // 仲裁尚未首轮就绪，不得把显式的插件页深链接导航走。用户在侧栏点选会话
      // 必然发生在仲裁就绪之后，不受影响。
      const bootRestore = !routeSettled.current && isPluginPage(route.current.pathname)
      if (route.current.pathname !== next && !bootRestore) route.current.navigate(next)
    }
    const startSession: OfficialClient['workspaces']['startSession'] = (workspaceId) => {
      originalStartSession.call(ctx.workspaces, workspaceId)
      if (route.current.pathname !== '/') route.current.navigate('/')
    }

    ctx.sessions.open = open
    ctx.workspaces.startSession = startSession
    return () => {
      if (ctx.sessions.open === open) ctx.sessions.open = originalOpen
      if (ctx.workspaces.startSession === startSession) {
        ctx.workspaces.startSession = originalStartSession
      }
    }
  }, [ctx])
}

function useOfficialSessionRoute(ctx: OfficialClient | null, routeSettled: RefObject<boolean>) {
  const navigate = useNavigate()
  const location = useLocation()
  const previous = useRef<{
    pathname: string
    current: string | undefined
  }>()
  const sessionList = useSyncExternalStore(
    (listener) => {
      if (!ctx) return subscribeOfficialClient(listener)
      const offList = ctx.sessions.list.subscribe(listener)
      const offClient = subscribeOfficialClient(listener)
      return () => {
        offList()
        offClient()
      }
    },
    () => (ctx ? readSessionList(ctx) : null),
  )

  // URL 与官方 Session store 只能在一个 effect 内仲裁。拆成两个双向 effect
  // 会在 open(B) 后分别按旧 URL 恢复 A、再导航 B，最终形成无限导航抖动。
  useEffect(() => {
    if (!ctx || !sessionList) {
      previous.current = undefined
      return
    }
    if (sessionList.phase !== 'ready') return

    const pathname = location.pathname
    const current = sessionList.current
    const last = previous.current
    const pathnameChanged = !last || last.pathname !== pathname
    const currentChanged = Boolean(last && last.current !== current)

    // 先记下本轮观测值，再触发 store/router，确保同步通知产生的下一轮
    // 能正确识别究竟是哪一侧发生了变化。
    previous.current = { pathname, current }
    // 首轮 ready 仲裁完成后，sessions.open 的导航包装才把调用视为用户操作
    //（此前的 open 是 client runtime 的启动会话恢复，见 useOfficialActionRoutes）。
    routeSettled.current = true

    if (pathnameChanged) {
      // 显式 URL 导航优先。插件页只覆盖内容区，但属于非会话路由：清空
      // 已有会话的选中（会话行选中态由 sessions.list.current 驱动、不随
      // URL 变化，否则与插件页菜单同时高亮）。clear 只动选中指针，staged
      // 会话按 masked-gap 契约保留。空白新会话与其他非会话路径一样保留。
      if (isPluginPage(pathname)) {
        if (current && !sessionList.byId[current]?.blank) ctx.sessions.clear()
        return
      }

      const pathId = currentSessionId(pathname)
      if (pathId) {
        if (sessionList.byId[pathId] && current !== pathId) ctx.sessions.open(pathId)
        return
      }
      if (current && !sessionList.byId[current]?.blank) ctx.sessions.clear()
      return
    }

    if (!currentChanged) {
      // 首条消息把当前空白会话变成已有会话（id 不变，只翻 blank）：按
      // “已有会话落在 /s/:id” 的语义从 '/' 归位，否则 '/' 下永远不进
      // 会话详情子布局，Workbench 无从显示。
      if (pathname === '/' && current && !sessionList.byId[current]?.blank) {
        navigate(sessionPath(current))
      }
      return
    }

    // 插件页内选中被清空（进入插件页的清选、会话被移除等）不触发导航，
    // 停留插件页；反向（插件页里选了某个会话）仍走下方导航退出插件页。
    if (!current && isPluginPage(pathname)) return

    // 启动恢复（store 把 current 从 undefined 恢复成有值）不得劫持显式的
    // 插件页深链接——深链接刷新插件页会被错误导航回 '/'。用户在插件页点选
    // 会话经由 sessions.open 包装函数导航，不依赖这里的仲裁。
    if (!last?.current && current && isPluginPage(pathname)) return

    // Session store 自身变化表示侧栏操作。空白新会话落在首页，已有
    // 会话落在 /s/:id；从插件页选会话时也由这里退出插件页。
    const blank = Boolean(current && sessionList.byId[current]?.blank)
    const next = current ? sessionPath(current, blank) : '/'
    if (pathname !== next) navigate(next)
  }, [ctx, location.pathname, navigate, sessionList, routeSettled])
}

export function OfficialSidebar() {
  const ctx = useOfficialClient()
  const error = getOfficialBootError()
  const routeSettled = useRef(false)
  useSlotVersion('root')
  useSlotVersion('sidebar')
  useOfficialActionRoutes(ctx, routeSettled)
  useOfficialSessionRoute(ctx, routeSettled)

  const ready = Boolean(
    ctx
    && ctx.slots.entriesOfSlot('root').length > 0
    && ctx.slots.entriesOfSlot('sidebar').length > 0,
  )

  if (ready && ctx) {
    return ctx.slots.renderSlot('root', {}) as ReactNode
  }

  return (
    <aside className="official-shell-fallback">
      <a className="settings-row" href="/" title={error ?? '打开官方界面'}>
        {error ? '官方 UI 未加载' : '正在加载官方 UI…'}
      </a>
    </aside>
  )
}
