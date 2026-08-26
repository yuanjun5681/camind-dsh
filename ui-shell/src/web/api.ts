/**
 * 自定义前端调用 Host 协议桥。/camind/api 由 dsh 提供，Vite 开发时走 proxy。
 */
import type {
  AgentPresetCatalog,
  AgentPresetRef,
  AppState,
  CamRunDetailResult,
  CamRunListResult,
  CommandExecution,
  CreateSessionRequest,
  CredentialView,
  DiscoveredModel,
  FsListing,
  GitWorkspaceStatus,
  LlmProviderConfig,
  ModelCatalog,
  PendingWorkspaceUploadsResult,
  PermissionSelect,
  PickDirectoryResult,
  PluginInventorySnapshot,
  PromptRequest,
  ResumeSessionRequest,
  RemovePendingWorkspaceUploadRequest,
  SessionSnapshot,
  SessionSummary,
  SettingsDocument,
  SettingsMutateRequest,
  SettingsNamespaceView,
  SettingsPresetDocument,
  SettingsPresetRoster,
  SlashCatalog,
  StreamMessage,
  UploadWorkspaceFilesResult,
  UploadedFile,
  WorkspaceFile,
  ClientPluginGraph,
} from '@shared/protocol'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/camind/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) as T & { error?: string; message?: string } : ({} as T)
  if (!res.ok) {
    throw new Error(data.error || data.message || res.statusText)
  }
  return data
}

export const api = {
  state: () => request<AppState>('/state'),
  listFs: (dir: string) => request<FsListing>(`/fs?path=${encodeURIComponent(dir)}`),
  createWorkspace: (path: string, title?: string) =>
    request<{ id: string; title: string; path: string }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ path, title }),
    }),
  pickDirectory: () => request<PickDirectoryResult>('/pick-directory', { method: 'POST' }),
  renameWorkspace: (id: string, title: string) =>
    request<{ id: string; title: string; path: string }>(`/workspaces/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  deleteWorkspace: (id: string) =>
    request<{ ok: boolean }>(`/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  renameSession: (id: string, title: string) =>
    request<{ title: string }>(`/sessions/${encodeURIComponent(id)}/rename`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  forkSession: (id: string) =>
    request<SessionSummary>(`/sessions/${encodeURIComponent(id)}/fork`, { method: 'POST' }),
  archiveSession: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  models: () => request<ModelCatalog>('/models'),
  permissions: () => request<PermissionSelect>('/permissions'),
  presets: () => request<AgentPresetCatalog>('/presets'),
  setPermission: (id: string, preset: string) =>
    request<PermissionSelect>(`/sessions/${encodeURIComponent(id)}/permission`, {
      method: 'POST',
      body: JSON.stringify({ preset }),
    }),
  selectPreset: (id: string, agentPreset: string) =>
    request<AgentPresetRef>(`/sessions/${encodeURIComponent(id)}/preset`, {
      method: 'POST',
      body: JSON.stringify({ agentPreset }),
    }),
  createSession: (body: CreateSessionRequest) =>
    request<SessionSummary>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  resume: (id: string, body?: ResumeSessionRequest) =>
    request<SessionSummary>(`/sessions/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  prompt: (id: string, body: PromptRequest) =>
    request<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}/prompt`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancel: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  snapshot: (id: string) => request<SessionSnapshot>(`/sessions/${encodeURIComponent(id)}/events`),
  listCommands: (id: string) =>
    request<SlashCatalog>(`/sessions/${encodeURIComponent(id)}/commands`),
  executeCommand: (id: string, line: string) =>
    request<CommandExecution>(`/sessions/${encodeURIComponent(id)}/command`, {
      method: 'POST',
      body: JSON.stringify({ line }),
    }),
  uploadWorkspaceFiles: (id: string, files: UploadedFile[]) =>
    request<UploadWorkspaceFilesResult>(`/sessions/${encodeURIComponent(id)}/files`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),
  pendingWorkspaceUploads: (id: string) =>
    request<PendingWorkspaceUploadsResult>(`/sessions/${encodeURIComponent(id)}/files`),
  sessionUploads: (id: string) =>
    request<{ files: WorkspaceFile[] }>(`/sessions/${encodeURIComponent(id)}/uploads`),
  // CAM run 只读查询（tool-cam Host 路由；数据源 = run 目录落盘）。
  camRuns: (sessionId: string) =>
    request<CamRunListResult>(`/cam/runs?session=${encodeURIComponent(sessionId)}`),
  camRunDetail: (sessionId: string, runId: string) =>
    request<CamRunDetailResult>(`/cam/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}`),
  /** 交付文件/NC 条目的原始下载 URL（不经 request 封装，直接给 <a href> 或 fetch 文本）。 */
  camDeliveryFileUrl: (sessionId: string, runId: string, file: string) =>
    `/camind/api/cam/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}/delivery/${file.split('/').map(encodeURIComponent).join('/')}`,
  removePendingWorkspaceUpload: (id: string, body: RemovePendingWorkspaceUploadRequest) =>
    request<PendingWorkspaceUploadsResult>(`/sessions/${encodeURIComponent(id)}/files`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),
  gitStatus: (id: string) =>
    request<GitWorkspaceStatus>(`/sessions/${encodeURIComponent(id)}/git`),
  clientPlugins: () => request<ClientPluginGraph>('/client-plugins'),
  settings: () => request<SettingsDocument>('/settings'),
  mutateSettings: (body: SettingsMutateRequest) =>
    request<SettingsNamespaceView>('/settings/mutate', { method: 'POST', body: JSON.stringify(body) }),
  openSettingsDocument: () =>
    request<{ ok: boolean; path: string }>('/settings/open', { method: 'POST' }),
  llmProviders: () => request<{ providers: LlmProviderConfig[] }>('/settings/providers'),
  discoverModels: (body: {
    settingsNs: string
    provider?: string
    baseURL?: string
    api?: string
    apiKey?: string
  }) => request<{ models: DiscoveredModel[] }>('/settings/providers/discover', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  describeCredentials: (refs: string[]) =>
    request<{ credentials: Record<string, CredentialView> }>('/credentials/describe', {
      method: 'POST',
      body: JSON.stringify({ refs }),
    }),
  setCredential: (ref: string, value: string) =>
    request<{ ok: boolean }>('/credentials/set', {
      method: 'POST',
      body: JSON.stringify({ ref, value }),
    }),
  unsetCredential: (ref: string) =>
    request<{ ok: boolean }>('/credentials/unset', {
      method: 'POST',
      body: JSON.stringify({ ref }),
    }),
  pluginInventory: () => request<PluginInventorySnapshot>('/settings/plugins'),
  settingsPresets: () => request<SettingsPresetRoster>('/settings/presets'),
  presetDocument: (id: string) =>
    request<SettingsPresetDocument>(`/settings/presets/${encodeURIComponent(id)}/document`),
  copyPreset: (from: string, id: string, name?: string) =>
    request<SettingsPresetRoster>('/settings/presets/copy', {
      method: 'POST',
      body: JSON.stringify({ from, id, name }),
    }),
  removePreset: (id: string) =>
    request<SettingsPresetRoster>('/settings/presets/remove', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  openPresetLocation: (id: string) =>
    request<{ opened: boolean; path: string }>('/settings/presets/open', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
}

/** 对齐官方 session-log-export：HEAD 预检后再把 GET URL 交给浏览器下载管理器。 */
export async function downloadSessionExport(sessionId: string): Promise<void> {
  const filename = `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
  const url = `/api/session.export?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=true`
  const probe = await fetch(url, { method: 'HEAD' })
  if (!probe.ok && probe.status !== 405) {
    const detail = await probe.text().catch(() => '')
    throw new Error(`导出失败：HTTP ${probe.status}${detail ? ` ${detail}` : ''}`)
  }
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function openSessionStream(id: string, onMessage: (msg: StreamMessage) => void): () => void {
  const source = new EventSource(`/camind/api/sessions/${encodeURIComponent(id)}/stream`)
  source.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data) as StreamMessage)
    } catch {
      onMessage({ type: 'error', error: '无法解析事件流' })
    }
  }
  source.onerror = () => {
    onMessage({ type: 'error', error: '事件流中断，正在重连…' })
  }
  return () => source.close()
}
