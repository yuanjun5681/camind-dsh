/**
 * Host 协议桥与自定义前端共用的 JSON 契约。
 * 有意不依赖 dsh 内部包：界面可以整页替换，只要继续说这一套。
 */

export interface SessionSummary {
  id: string
  title: string
  cwd?: string
  createdAt: number
  /** 列表排序用：max(createdAt, 最近一次人类提问时间)。 */
  updatedAt: number
  live: boolean
  status: 'idle' | 'running' | 'cold'
  /** 尚未跑过一轮；官方侧栏隐藏此类会话，新建时复用而不是再开一条。 */
  blank: boolean
}

export interface WorkspaceSummary {
  id: string
  title: string
  path: string
  createdAt: string
  sessions: SessionSummary[]
}

export interface AppState {
  workspaces: WorkspaceSummary[]
  ungrouped: SessionSummary[]
}

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
}

export interface FsListing {
  path: string
  parent: string | null
  entries: FsEntry[]
}

export interface WireEvent {
  type: string
  seq: number
  time: number
  data: unknown
  /** 表面事件才有：`'append'` 追加，`{ op: 'replace' }` 为范围替换（压缩检查点）。 */
  surfaceOp?: 'append' | { op: string }
}

export interface AgentPresetInfo {
  id: string
  name?: string
  description?: string
  trust: 'system' | 'user'
  broken?: string
}

export interface AgentPresetCatalog {
  presets: AgentPresetInfo[]
  defaultId: string
}

export interface AgentPresetRef {
  id: string
  name: string
}

export interface SessionSnapshot {
  id: string
  title: string
  cwd?: string
  status: 'idle' | 'running' | 'cold'
  events: WireEvent[]
  permission?: PermissionSelect
  agentPreset?: AgentPresetRef
  blank?: boolean
}

export type StreamMessage =
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  | { type: 'event'; event: WireEvent }
  | { type: 'status'; status: 'idle' | 'running' }
  | { type: 'title'; title: string }
  | { type: 'error'; error: string }

export interface CreateWorkspaceRequest {
  path: string
  title?: string
}

export interface RenameWorkspaceRequest {
  title: string
}

export interface RenameSessionRequest {
  title: string
}

/** native：系统文件夹选择器；browse：远端/无桌面时才用自绘目录框。 */
export type PickDirectoryResult =
  | { kind: 'native'; path: string | null }
  | { kind: 'browse' }

export interface ModelChoice {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ReasoningEffortInfo {
  id: string
  name: string
  description?: string
}

export interface ModelReasoningInfo {
  efforts: ReasoningEffortInfo[]
  defaultEffort?: string
}

export interface ModelInfo {
  id: string
  name: string
  description?: string
  contextWindow?: number
  reasoning?: ModelReasoningInfo
}

export interface ProviderModels {
  id: string
  name: string
  models: ModelInfo[]
}

export interface ModelCatalog {
  providers: ProviderModels[]
  default?: ModelChoice
}

export interface PermissionOption {
  value: string
  name: string
  description?: string
}

export interface PermissionSelect {
  options: PermissionOption[]
  currentValue: string
}

export interface UploadedImage {
  name: string
  mediaType: string
  /** 无 data-URL 前缀的 base64 */
  data: string
}

export interface UploadedFile {
  name: string
  /** 无 data-URL 前缀的 base64 */
  data: string
}

/** 已保存的上传文件。path 始终是当前会话专属的 upload:// 批次引用。 */
export interface WorkspaceFile {
  name: string
  path: string
  size: number
  mediaType: string
  source?: 'upload' | 'archive'
}

/** 已上传、等待随下一条用户消息进入模型上下文的一个批次。 */
export interface WorkspaceUploadBatch {
  batchId: string
  files: WorkspaceFile[]
}

export interface UploadWorkspaceFilesRequest {
  files: UploadedFile[]
}

export interface UploadWorkspaceFilesResult {
  files: WorkspaceFile[]
  /** 所有模式都使用会话隔离上传批次。 */
  batchId?: string
}

export interface PendingWorkspaceUploadsResult {
  batches: WorkspaceUploadBatch[]
}

export interface RemovePendingWorkspaceUploadRequest {
  batchId: string
  path: string
}

export interface FilePreview {
  path: string
  name: string
  size: number
  mediaType: string
  kind: 'text' | 'image' | 'pdf' | 'binary'
  /** 仅 text 预览返回；其余类型走受 session cwd 约束的 raw URL。 */
  text?: string
  truncated?: boolean
}

export interface GitFileStatus {
  path: string
  status: string
}

export interface GitWorkspaceStatus {
  available: boolean
  branch?: string
  files: GitFileStatus[]
  error?: string
}

export interface CreateSessionRequest extends Partial<ModelChoice> {
  workspaceId?: string
  cwd?: string
  permission?: string
  agentPreset?: string
}

export interface ResumeSessionRequest extends Partial<ModelChoice> {}

export interface PromptRequest extends Partial<ModelChoice> {
  text?: string
  images?: UploadedImage[]
  files?: UploadedFile[]
  permission?: string
}

export interface SetPermissionRequest {
  preset: string
}

export interface SelectAgentPresetRequest {
  agentPreset: string
}

/** 斜杠命令：名称不含前导 `/`。 */
export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint: string }
}

/** 斜杠菜单里的 skill：点选后插入 `/name `，发送时走 prompt，由 Host 注入正文。 */
export interface SkillDescriptor {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

export interface SlashCatalog {
  commands: CommandDescriptor[]
  skills: SkillDescriptor[]
}

/** 官方 `window.__DSH_BOOT__` 图：ui-shell 用来启动同一套 client 插件。 */
export interface ClientPluginEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  /** 0.1.1 起图行声明的动态外部依赖（模块系统按它预取依赖行）。 */
  external?: string[]
  immediately?: boolean
}

export interface ClientPluginGraph {
  rev: string
  entries: ClientPluginEntry[]
}

export interface ExecuteCommandRequest {
  line: string
}

export interface CommandResult {
  kind: 'success' | 'error'
  text?: string
}

export interface CommandExecution {
  commandId: string
  result: CommandResult
}

/** 设置文档里一个命名空间的脱敏视图。 */
export interface SettingsSecretFlag {
  path: string[]
  set: boolean
}

export interface SettingsNamespaceView {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: 'live' | 'restart'
  secrets: SettingsSecretFlag[]
  revision: number
}

export interface SettingsDocument {
  writable: boolean
  documentPath?: string
  canOpen: boolean
  namespaces: SettingsNamespaceView[]
}

export type SettingsPathOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

export interface SettingsMutateRequest {
  ns: string
  ops: SettingsPathOp[]
  expectedRevision?: number
}

export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

export interface LlmProviderConfig {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  active: boolean
  declared?: boolean
}

export interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export interface SettingsPresetInfo {
  id: string
  name?: string
  description?: string
  trust: 'system' | 'user'
  broken?: string
  isDefault: boolean
}

export interface SettingsPresetRoster {
  presets: SettingsPresetInfo[]
  defaultId: string
  authorable: boolean
  hasDocument: boolean
}

export interface SettingsPresetDocument {
  id: string
  trust: 'system' | 'user'
  name?: string
  description?: string
  content: string
}

export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
}

export interface PluginInventorySnapshot {
  entries: PluginInventoryEntry[]
}
