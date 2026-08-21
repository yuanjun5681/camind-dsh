# Slot 插槽清单（/camind）

本文盘点 `/camind` 定制前端组合下所有可由插件注入的 UI slot：本工作区自定义的（ui-shell / ui-sidebar fork）与官方 rc.7 插件图提供的。插件注册方式统一为 `ctx.slots.inject(name, () => ctx.slots.register(...))`——`inject` 等待 slot 声明就绪后再注册，未声明的 slot 直接 register 会 throw。

## 通用规则

- **kind**：
  - `single`：一个坑位。允许不同 `priority` 的影子注册，**priority 最低者渲染**；同 priority 重复注册会 throw。
  - `list`：追加型。多个插件按 `id` 各占一格、按 `order` 并列渲染；同 id 时按 priority 影子覆盖（同样最低者渲染）。
  - `keyed`：按 `key` 分发（如按工具名、按消息节点类型），每格规则同 single。
  - `chain`：选举型。按 priority 升序跑各 entry 的 `select(owner)`，第一个返回非 null 的 entry 中标（其返回值成为组件的 `matched` prop），全 null 走 owner 的 fallback。
- **scope**：`root` 全局；`session` 严格会话内（组件可拿到 `sessionId` 与会话快照 hooks）；`session-maybe` 允许无会话（hooks 在无会话时返回 `undefined`）。
- 注册即 effect：通过 `ctx` 注册的一切随插件卸载自动回收，fallback 自动回退。
- 官方 SlotMap 类型声明在 `desktop/vendor/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/types/**`；本工作区自定义的在 `ui-sidebar/src/client/contract/slots.ts` 与 `ui-shell/src/web/officialClient.ts`。

## 侧栏（ui-sidebar fork 声明；★ 为本工作区新增）

| Slot | Kind | Scope | 用途 | 现状 |
|---|---|---|---|---|
| ★ `sidebar.brand` | single | root | 侧栏 logo（owner 传 `{ wide }`，区分展开/折叠） | 空位；fallback 为官方 BrandWordmark / FishLogo |
| `sidebar.workspaces` | single | root | 工作区列表区 | 官方 workspace 插件占位 |
| `sidebar.settings` | single | root | 设置入口区 | 官方 settings-general 占位 |
| `sidebar.footer.action` | list | root | 侧栏底部按钮（「设置」上方；本地扩展 owner 传 `{ wide, pathname, navigate }`，官方契约的超集） | page-memory 已注册“记忆库”管理页入口 |

## 壳层（ui-shell 在 root entry 的 children 里集中声明）

| Slot | Kind | Scope | 用途 | 现状 |
|---|---|---|---|---|
| ★ `shell.content` | chain | root | 插件页面路由（select 匹配 pathname 即接管页面区） | page-memory 已注册 `/pages/memory` |
| ★ `shell.home` | chain | root | 新会话首页（`/`）扩展：内容叠在官方 conversation 上方（品牌区/示例卡片），select 按 `pathname === '/'` 中标 | ui-home 已注册品牌区 + 示例 |
| `shell.overlay` | list | root | 全局浮层（追加型，默认不挡点击） | ui-shell：文件预览 + 代码对比 |
| `sidebar` | single | root | 侧栏整体替换 | ui-sidebar 以官方模块 ID 静态占位 |
| `conversation` | single | session-maybe | 会话区整体替换 | 官方 Conversation 占位 |
| `details` | single | session | Details 面板整体替换 | 官方 Details 占位 |
| `root` | single | root | 渲染树根 | **勿注册**：会顶掉整个 AppFrame（官方类型注释明确警告） |

## 会话区 conversation.\*

官方 conversation entry 声明；/camind 只在 `/s/:id` 会话详情子布局挂官方 Conversation，这些 slot 只在那里生效（`/` 新会话与 `/pages/*` 不挂）。

| Slot | Kind | Scope | 用途 | 现状 |
|---|---|---|---|---|
| `conversation.input.left` | list | session | 输入框左侧按钮区 | ui-shell 已挂上传按钮 |
| `conversation.input.right` | list | session | 输入框右侧按钮区 | — |
| `conversation.input.dock` | list | session | 输入框 dock 区（hero 态渲染在输入卡正上方） | ui-shell 以此为附件 rail 生命周期锚点，并 portal 到 Composer 卡片内；ui-home 挂不可见的 inputActions 桥（首页示例写草稿用） |
| `conversation.input.overlay` | list | session | 输入框浮层（@ 触发等） | 官方 input-trigger 在用 |
| `conversation.input.plan` | single | session | plan 模式开关 | 官方占位 |
| `conversation.input.model` | single | session | 模型选择 | 官方占位 |
| `conversation.composer` | chain | session | 输入框整体接管 | 官方占位 |
| `conversation.composer.bar` | single | session-maybe | composer 工具条 | — |
| `conversation.composer.dock` | list | session | composer dock 区 | — |
| `conversation.session` | single | session | 会话整体替换 | 官方占位 |
| `conversation.session.header` | single | session | 会话头部替换 | 官方占位 |
| `conversation.session.header.actions` | list | session | 会话头部操作按钮 | — |
| `conversation.session.header.utilities` | list | session | 会话头部工具位 | — |
| `conversation.view` | list | session | 会话视图追加 | — |
| `conversation.chat.node` | keyed | session | 按 key 替换消息节点渲染 | 官方占位 |
| `conversation.chat.commandview` | keyed | session | 命令视图渲染 | 官方占位 |
| `conversation.chat.turnTail` | chain | session | Turn 尾部扩展链 | ui-shell 已挂 DeliverableFiles |
| `conversation.chat.assistant-actions` | list | session | 助手消息操作条 | — |
| `conversation.hero.workspace` | single | root | 新会话 hero 区工作区选择 | 官方占位 |
| `conversation.hero.agentPreset` | single | root | 新会话 agent preset chip | 官方 agent-preset 占位 |
| `conversation.details.tool` | single | session | Details 中工具详情 | 官方占位 |

## Details / 工具展示

| Slot | Kind | Scope | 用途 | 现状 |
|---|---|---|---|---|
| `tool.call.toolview` | keyed | session | 按工具名自定义工具调用展示 | 官方按工具注册 |
| `tool.view.cordis` | keyed | session | Cordis 相关工具视图 | 官方占位 |

## 设置面板 settings.\*

| Slot | Kind | Scope | 用途 | 现状 |
|---|---|---|---|---|
| `settings.general.item` | list | root | 在 General 页加一行偏好（最轻量的设置扩展） | 官方 locale/theme 等在用 |
| `settings.section` | list | root | 增加一整页设置（id/order/label 即导航身份） | 官方各 section 在用 |
| `settings.plugins.tab` | list | root | Plugins 设置页加 tab | 官方在用 |
| `settings.plugin.item` | list | root | 单个插件的设置项 | 官方在用 |
| `settings.action` | list | root | 设置面板头部动作（Close 之前） | — |
| `settings.onboarding` | list | root | onboarding 步骤 | 官方在用 |
| `settings.trigger` | single | root | 侧栏设置触发行内容 | 官方占位 |
| `settings.header` | single | root | 设置面板标题 | 官方占位 |
| `settings.close` | single | root | 关闭按钮的无障碍标签 | 官方占位 |

## 典型玩法速查

| 想做的事 | 用的 Slot |
|---|---|
| 换 logo | `sidebar.brand`（single，空位，注册即接管） |
| 定制新会话首页品牌/示例 | `shell.home`（chain，`/` 叠加在官方 conversation 上方）+ `conversation.input.dock`（不可见 inputActions 桥，供示例写草稿） |
| 加底部菜单 | `sidebar.footer.action`（list，按 order 并列，owner 传 `{ wide, pathname, navigate }`） |
| 加插件页面 | `shell.content`（chain，select 匹配路由） |
| 加全局浮层 | `shell.overlay`（list，追加不冲突） |
| 加一行设置 | `settings.general.item`（list） |
| 加整页设置 | `settings.section`（list） |
| 输入框加按钮 | `conversation.input.left` / `conversation.input.right`（list） |
| 自定义某工具调用展示 | `tool.call.toolview`（keyed，key = 工具名） |
| 接管某类消息渲染 | `conversation.chat.node`（keyed） |
