/**
 * 工作台「加工」页签：按 session 展示 CAM run 列表与状态。
 * 数据源 = run 目录磁盘落盘（tool-cam 只读路由 GET /camind/api/cam/runs），
 * 不读会话事件投影——免疫 cam/* 事件会话重启拒绝重载的上游限制（设计稿 §4.4），
 * 也能展示中断后可 resume 续跑的 run。组件只在页签激活时挂载，挂载期间 5s 轮询。
 *
 * 刀路查看器接线：camind-ui-toolpath-viewer 把渲染器注册进 keyed slot
 * `cam.nc.preview`（key `toolpath-viewer`，owner props { content, fileName }）。
 * 本组件直接读 slot 注册表（entriesOfSlot + subscribe）拿到组件并渲染——ui-shell
 * 是 slot runtime 的宿主且与官方 bundle 共享同一 React 实例（dsh-client-web 静态表
 * 经 Vite dedupe 与壳内 react 同源），ToolpathViewer 只消费 owner props（无
 * inject/store/locale 席位），绕过官方 renderer 的 standard-kit 注入无损失；
 * 席位声明仍在 tool-cam 交付卡（本组件不重复声明——slot 系统对重复声明抛错）。
 */
import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import type { CamRunDetail, CamRunOverall, CamRunSummary } from '@shared/protocol'
import { api } from './api'
import { bytesLabel } from './FilePreviewBody'
import { getOfficialClient } from './officialClient'
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore'

type ToolpathViewerComponent = ComponentType<{ content: string; fileName?: string }>

const OVERALL_VIEW: Record<CamRunOverall, { label: string; modifier: string }> = {
  ok: { label: '通过', modifier: 'ok' },
  incomplete: { label: '含未决项', modifier: 'warn' },
  error: { label: '失败', modifier: 'err' },
  planned: { label: '未执行', modifier: 'muted' },
}

const OP_STATUS_LABELS: Record<string, string> = {
  ok: '完成',
  generated: '缺 NC',
  empty: '空刀路',
  error: '失败',
}

function opStatusLabel(status: string | null): string {
  return status === null ? '未执行' : OP_STATUS_LABELS[status] ?? status
}

function timeLabel(iso: string): string {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

/** 读 slot 注册表拿刀路查看器组件；未注册（插件缺席/未加载完）返回 null。 */
function useToolpathViewer(): ToolpathViewerComponent | null {
  const [component, setComponent] = useState<ToolpathViewerComponent | null>(null)
  useEffect(() => {
    const client = getOfficialClient()
    if (!client) return
    const update = () => {
      const entry = client.slots
        .entriesOfSlot('cam.nc.preview')
        .find((item) => item.options?.key === 'toolpath-viewer')
      setComponent(() => (entry?.component as ToolpathViewerComponent | undefined) ?? null)
    }
    update()
    return client.slots.subscribe('cam.nc.preview', update)
  }, [])
  return component
}

type DetailState =
  | { phase: 'loading' }
  | { phase: 'ready'; detail: CamRunDetail }
  | { phase: 'error'; message: string }

type NcViewerState =
  | { fileName: string; phase: 'loading' }
  | { fileName: string; phase: 'ready'; content: string }
  | { fileName: string; phase: 'error'; message: string }

function DeliveryFileRow({ sessionId, runId, file }: { sessionId: string; runId: string; file: { name: string; bytes: number } }) {
  const isMarkdown = file.name.toLowerCase().endsWith('.md')
  return (
    <div className="camrun-file">
      <span className="camrun-file-name" title={file.name}>{file.name}</span>
      <small>{bytesLabel(file.bytes)}</small>
      <span className="camrun-file-actions">
        {isMarkdown && (
          <button
            type="button"
            title="预览会话工作区镜像（镜像缺失时会报文件不存在，可改用下载）"
            onClick={() => workbenchActions.preview(sessionId, `delivery/${runId}/${file.name}`)}
          >
            预览
          </button>
        )}
        <a href={api.camDeliveryFileUrl(sessionId, runId, file.name)}>下载</a>
      </span>
    </div>
  )
}

function CamRunCard({
  sessionId,
  run,
  viewerComponent,
}: {
  sessionId: string
  run: CamRunSummary
  viewerComponent: ToolpathViewerComponent | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [detailState, setDetailState] = useState<DetailState | null>(null)
  const [ncViewer, setNcViewer] = useState<NcViewerState | null>(null)

  // 展开才拉详情；展开期间轮询发现 updated_at 前移（cam_run 续跑落盘）自动重拉。
  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setDetailState({ phase: 'loading' })
    void api.camRunDetail(sessionId, run.run_id).then((result) => {
      if (!cancelled) setDetailState({ phase: 'ready', detail: result.run })
    }).catch((error) => {
      if (!cancelled) setDetailState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [expanded, run.updated_at, run.run_id, sessionId])

  async function openNcViewer(name: string) {
    setNcViewer({ fileName: name, phase: 'loading' })
    try {
      const response = await fetch(api.camDeliveryFileUrl(sessionId, run.run_id, `nc/${name}`), { headers: { Accept: 'text/plain' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setNcViewer({ fileName: name, phase: 'ready', content: await response.text() })
    } catch (error) {
      setNcViewer({ fileName: name, phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const detail = detailState?.phase === 'ready' ? detailState.detail : null
  const machine = run.machine.display_name ?? run.machine.id
  const overallView = OVERALL_VIEW[run.overall] ?? OVERALL_VIEW.planned
  const Viewer = viewerComponent

  return (
    <section className="camrun-card">
      <button type="button" className="camrun-head" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className={`camrun-badge camrun-badge-${overallView.modifier}`}>{overallView.label}</span>
        <span className="camrun-title" title={run.run_id}>{run.run_id}</span>
        <span className="camrun-ops" title={run.ops.map((op) => `${op.name}：${opStatusLabel(op.status)}`).join('\n')}>
          {run.ops.map((op) => (
            <span key={op.index} className="camrun-op-dot" data-status={op.status ?? 'planned'} />
          ))}
          {run.ops.length === 0 && <span className="camrun-ops-empty">无工序</span>}
        </span>
        <span className="camrun-toggle">{expanded ? '收起' : '展开'}</span>
      </button>
      <dl className="camrun-facts">
        {run.part_id !== null && <div><dt>件号</dt><dd>{run.part_id}</dd></div>}
        {machine !== null && <div><dt>机床</dt><dd>{machine}</dd></div>}
        <div><dt>更新</dt><dd>{timeLabel(run.updated_at)}</dd></div>
      </dl>
      {run.read_error !== undefined && <p className="camrun-warn">{run.read_error}</p>}
      {run.overall === 'planned' && (
        <p className="camrun-note">尚未执行——在会话中让 Agent 对该 run_id 调用 cam_run 首跑。</p>
      )}
      {(run.overall === 'incomplete' || run.overall === 'error') && (
        <p className="camrun-note">本 run 未全过——可让 Agent 以 cam_run（resume=true）续跑，run_id 不变。</p>
      )}
      {run.delivery.length > 0 && (
        <div className="camrun-files">
          {run.delivery.map((file) => (
            <DeliveryFileRow key={file.name} sessionId={sessionId} runId={run.run_id} file={file} />
          ))}
        </div>
      )}

      {expanded && detailState?.phase === 'loading' && <p className="camrun-note">读取 run 详情…</p>}
      {expanded && detailState?.phase === 'error' && <p className="camrun-warn">详情读取失败：{detailState.message}</p>}
      {expanded && detail !== null && (
        <div className="camrun-detail">
          <dl className="camrun-facts">
            {detail.post_name !== null && <div><dt>后处理器</dt><dd>{detail.post_name}</dd></div>}
            {detail.out_dir !== null && <div><dt>输出目录</dt><dd title={detail.out_dir}>{detail.out_dir}</dd></div>}
            {detail.suffix !== null && <div><dt>suffix</dt><dd>{detail.suffix}</dd></div>}
          </dl>
          {detail.runstate?.ops !== undefined && detail.runstate.ops.length > 0 && (
            <ul className="camrun-op-list">
              {detail.runstate.ops.map((op) => (
                <li key={op.index}>
                  <span className="camrun-op-dot" data-status={op.status} />
                  <span className="camrun-op-name" title={op.type}>{op.name}</span>
                  <span className="camrun-op-status">{opStatusLabel(op.status)}</span>
                  {op.error !== undefined && op.error !== '' && <span className="camrun-op-error">{op.error}</span>}
                </li>
              ))}
            </ul>
          )}
          {detail.nc_error !== undefined && <p className="camrun-warn">{detail.nc_error}</p>}
          {detail.delivered && detail.nc_files.length > 0 && (
            <>
              <h4>NC 程序（{detail.nc_files.length}）</h4>
              <div className="camrun-files">
                {detail.nc_files.map((name) => (
                  <div key={name} className="camrun-file">
                    <span className="camrun-file-name" title={name}>{name}</span>
                    <span className="camrun-file-actions">
                      <a href={api.camDeliveryFileUrl(sessionId, run.run_id, `nc/${name}`)}>下载</a>
                      {Viewer !== null && (
                        <button
                          type="button"
                          disabled={ncViewer?.phase === 'loading'}
                          onClick={() => void openNcViewer(name)}
                        >
                          查看刀路
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {ncViewer !== null && (
            <div className="camrun-viewer">
              <div className="camrun-viewer-head">
                <span>刀路预览：{ncViewer.fileName}</span>
                <button type="button" onClick={() => setNcViewer(null)}>收起</button>
              </div>
              {ncViewer.phase === 'loading' && <p className="camrun-note">读取 NC 中…</p>}
              {ncViewer.phase === 'error' && <p className="camrun-warn" role="status">NC 读取失败：{ncViewer.message}</p>}
              {ncViewer.phase === 'ready' && (Viewer !== null
                ? <Viewer content={ncViewer.content} fileName={ncViewer.fileName} />
                : <pre className="camrun-nc-raw">{ncViewer.content}</pre>)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function CamRuns({ sessionId }: { sessionId: string }) {
  const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot)
  const runs = snapshot.camRuns[sessionId] ?? []
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()
  const viewerComponent = useToolpathViewer()

  // 页签激活（本组件挂载）期间：立即拉一次 + 5s 轮询；内容没变 store 不 publish。
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await api.camRuns(sessionId)
        if (cancelled) return
        workbenchActions.setCamRuns(sessionId, result.runs)
        setError(undefined)
        setLoaded(true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      }
    }
    setLoaded(false)
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId])

  if (!loaded) return <div className="workbench-empty">读取 CAM run 列表…</div>
  if (error !== undefined) return <div className="workbench-empty">CAM run 列表读取失败：{error}</div>
  if (runs.length === 0) {
    return <div className="workbench-empty">本会话还没有 CAM run——cam_plan 落盘后出现在这里（数据源是 run 目录，与会话事件无关）。</div>
  }
  return (
    <div className="workbench-section camrun-list">
      {runs.map((run) => (
        <CamRunCard key={run.run_id} sessionId={sessionId} run={run} viewerComponent={viewerComponent} />
      ))}
    </div>
  )
}
