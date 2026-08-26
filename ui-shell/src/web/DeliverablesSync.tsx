/**
 * 交付物数据的无头同步（替代「聊天区 turnTail useEffect 写 store」的旧耦合）。
 * 旧机制：workbench 交付物 tab 的数据由聊天区 turnTail 组件渲染时写入——刷新后
 * 若官方激活视图停在「预览」（chatStore 持久化 view），聊天区根本不挂载，
 * turnTail 不渲染，交付物 tab 永远空白。
 * 新机制：会话布局常驻的本组件直接读会话投影快照（ConversationSnapshot.nodes
 * 的 tool-result 节点，callView 是 Host 经 presentCall 算好随帧下发的），按与
 * 官方 deliverables 折叠同一口径（generic/edit 或 diff 的 locations）汇总产出
 * 路径写进 workbenchStore——不依赖任何标签页是否挂载。
 */
import { useEffect } from 'react'
import { getOfficialClient } from './officialClient'
import { workbenchActions } from './workbenchStore'

type CallView = {
  card?: string
  kind?: string
  locations?: readonly { path?: unknown }[]
} | null

/** 与官方 dsh-client-ui-deliverables producedPaths 同口径。 */
function producedPaths(view: CallView): string[] {
  if (view === null || view === undefined) return []
  if (view.card !== 'diff' && !(view.card === 'generic' && view.kind === 'edit')) return []
  return (view.locations ?? [])
    .map((location) => location?.path)
    .filter((path): path is string => typeof path === 'string')
}

function deliverablesOfNodes(nodes: readonly unknown[]): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const item = node as { kind?: string; isError?: boolean; callView?: CallView }
    if (item.kind !== 'tool-result' || item.isError === true) continue
    for (const path of producedPaths(item.callView ?? null)) {
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }
  }
  return paths
}

type BindingSession = {
  getSnapshot(): { nodes?: readonly unknown[] }
  subscribe(listener: () => void): () => void
}

export function DeliverablesSync({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    const client = getOfficialClient()
    const sessions = client?.sessions as unknown as {
      binding?: (id: string) => { session?: BindingSession } | undefined
    } | undefined
    const session = sessions?.binding?.(sessionId)?.session
    if (session === undefined) return
    const sync = () => workbenchActions.setDeliverables(sessionId, deliverablesOfNodes(session.getSnapshot().nodes ?? []))
    sync()
    return session.subscribe(sync)
  }, [sessionId])
  return null
}
