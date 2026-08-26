# 自定义 UI 架构

本文介绍 Camind 的定制前端如何工作。定制 UI 挂在 `/camind` 并是默认入口（`/` 302 跳转到 `/camind/`）；官方 UI 仍在 fallback 席位，由任意未占用路径（如 `/web`）访问，两者互不干扰。涉及这些插件：

- `camind-ui-shell`（ui-shell/）— Host 协议桥 + 自托管 React SPA：半注册 `/camind` 与 `/camind/api`，浏览器侧加载官方插件图并复用官方 slot runtime。
- `camind-ui-sidebar`（ui-sidebar/）— 以官方模块 ID 静态替换的 Sidebar，沿用 0.1.1 起上游原生的 `sidebar.brand.mark` / `sidebar.brand.name` 品牌席位，并把官方 `sidebar.footer.action` 的 owner props 扩展为 `{ wide, pathname, navigate }`。
- `camind-ui-brand`（ui-brand/）— 品牌插件：动态 blobatar mascot + “Camind” 字标徽章，注册到 `sidebar.brand.mark` / `sidebar.brand.name` 席位（priority -10 压过图内 ui-brand-official；仅 `/camind` 路径注册）。
- `camind-ui-home`（ui-home/）— 新会话首页（`/`）品牌区与紧随其下的示例卡片：`shell.home` 链叠加在官方 conversation 上方，并中和官方 hero 的自居中、由外层把「品牌 + 示例 + 工作区行 + 输入卡」收成一个整体居中组；`conversation.input.dock` 上挂一个不可见的 inputActions 桥供示例写草稿；官方 HeroShell 用结构选择器 CSS 隐藏。
- `camind-page-memory`（page-memory/）— 记忆库管理页（两级）：底部菜单 + `/pages/memory` 知识/经验双 tab 列表 + `/pages/memory/<type>/<name>` 详情，Host 半自带 `/camind/api/memory`。

仅 web profile 组合这些插件。改 ui-shell 任何代码都要 `npm run build`：dist 不会随 link 依赖自动更新，未构建时 `/camind` 直接返回 503 提示（`ui-shell/src/host/http.ts:52`）。

## Host 侧：/camind 与 /camind/api

入口 `ui-shell/src/host/index.ts`（tsc 编译到 `dist/host/`，包 `main` 指向产物，包根没有手写 index.js）。插件 `inject` 声明 15 个 dsh 服务（webServer、sessions、llm、commands、skills、attachments、clientModules 等），`apply()` 尾部用 `webServer` 服务做两条 prefix 注册加一条 exact 注册：

- **exact `/`**：302 跳转到 `/camind/`，让定制 UI 成为默认入口。webServer 的匹配顺序是 exact → 最长 prefix → fallback，官方 UI 占的是 fallback 席位（`dsh-host-frontend-static`），精确路由优先于它，无需也抢不了该席位（单主，且由 `dsh-web-app` 内部挂载，patch 够不着）。官方前端没有 URL 路由逻辑，因此 fallback 在任意未占用路径（如 `/web`）照常完整提供官方界面。
- **`/camind`**：SPA 静态托管，只接 GET/HEAD（其余 405，不回退给官方壳）。`serveSpa` 先找 `dist/web` 下对应文件，找不到回退 `index.html`，路径越界 403；返回 HTML 时把 `ctx.clientModules.graph()` 序列化为 `<script>window.__DSH_BOOT__ = ...</script>` 内联进 `<head>`（`ui-shell/src/host/http.ts:69`）。
- **`/camind/api`**：REST + SSE 协议桥，把 dsh 服务翻译成 HTTP 端点：state/models/permissions/presets/fs/workspaces 等一组 REST，`GET /camind/api/sessions/:id/stream` 是 SSE 事件流（来自 `session/event`、`agent/status`），`/camind/api/client-plugins` 把 boot 图转发给浏览器。未匹配路径 404。

「半注册」的含义：`/camind` 只接管页面与静态资源请求，不代理官方 API；官方界面在 fallback 席位完全不受影响。定制 UI 的路径前缀集中硬编码在以下位置，改名需同步：host 注册与端点字符串（`host/index.ts`、`host/settings.ts`）、`serveSpa` 剥前缀正则（`host/http.ts`）、`BrowserRouter basename`（`web/main.tsx`）、web 侧 API 前缀（`web/api.ts`）、Vite `base` 与 dev proxy（`vite.config.ts`）、桌面壳加载地址（`desktop/main.js`）。

## 浏览器侧启动

`ui-shell/src/web/main.tsx` 做三件事：初始化主题、`bootOfficialClient()`、挂载 `<BrowserRouter basename="/camind">`。

`bootOfficialClient()`（`ui-shell/src/web/officialClient.ts`）：

1. `ensureBootGraph()`：优先读 Host 内联的 `window.__DSH_BOOT__`，缺失时 `GET /camind/api/client-plugins`。图结构为 `{ rev, entries: [{ id, url, inject?, external?, immediately? }] }`。
2. 安装 `window.__ModuleLoader__` facade（queue 模式），把三个本地模块的 factory 压入待处理队列（见下节），再经 `createClientModuleSystem()` 建系统并切入活动注册。`staticModules` 是官方平台词表（react、react-dom、cordis、ui-slots、ui-primitives），模块实例来自 ui-shell 自己的 Vite bundle，`resolve.dedupe` 保证 react 单实例。
3. 预取 `immediately` 插件，然后按图逐行 `ctx.loader.create({ name })` 激活（modules 行命中 bootstrap 缓存）；单个插件失败仅 `console.warn`，不阻塞整体。

### 静态替换机制

0.1.1 起官方模块系统删除 `registerStatic`：本地模块改为在建系统前以图行 ID 预注册 factory（`__ModuleLoader__.load({ id, factory })` 进待处理队列）。解析顺序是 seed（平台词表）→ 已物化记录 → 已注册 factory → 网络图行；factory 命中即不再抓取对应 bundle。三处本地注册（`officialClient.ts` 的 `bootOfficialClient`）：

- `@deepseek-ai/dsh-client-ui-layout` → layoutShim（提供 `ctx.layout` 与 theme 投影）；
- `@deepseek-ai/dsh-client-ui-sidebar` → ui-sidebar 的 TS 源码（相对路径 import，由 ui-shell 的 Vite 直接编译，不走 `__ModuleLoader__`）；
- `camind-ui-shell/app-shell` → customShell（图外自定义行：root slot 声明 + 业务扩展，见下节）。

`@deepseek-ai/dsh-client-modules` 则由 Vite 解开其 loader 格式产物（`vite.config.ts` 的 `unwrapDshClientLoader`）后作为 bootstrap module 传给 `createClientModuleSystem()`。boot 图里即便也有官方 sidebar，预注册 factory 先行拦截，依赖它的模块（如 ui-workspace）拿到的都是自定义实现。官方 `/web`（302 到 `/index.html`）用另一套 boot，不受影响。

## 布局与 slot

组件树：`Root`（routes.tsx）→ `App` → `OfficialSidebar`（等官方 client 就绪且 `root`/`sidebar` slot 均有注册后 `renderSlot('root', {})`，未就绪时渲染加载回退）→ `OfficialSlotRoot`。

**root slot 的子洞集中声明在一处**（customShell，`officialClient.ts:98-109`），第三方插件只通过 `slots.inject` 注册条目，不自行声明洞：

- `sidebar`（single）— 侧栏，被 ui-sidebar 占据；
- `conversation`（single）— 会话区，官方 Conversation；
- `shell.content`（chain，自定义）— 插件页面，按路由 select；
- `shell.home`（chain，自定义）— 新会话首页（`/`）叠加层，在官方 conversation 上方渲染（品牌区/示例卡片）；
- `details`（single）— 官方详情栏；
- `shell.overlay`（list，自定义）— 全局浮层。

全局 Shell 是两列 grid（sidebar + page）。page 列按路由三分支（`OfficialSlotRoot.tsx:152`）：

- `/pages/*` → `renderSlotChain('shell.content', routeOwner)` 命中的插件页面；
- `/s/:id` → `SessionDetailLayout`：三列 `conversation | Workbench | details`。Workbench 与官方 details 互斥（`workbench.open && detailsWidth === 0`），宽度 300–560 可拖拽调宽，视口过窄时退化为 overlay；折叠且 details 未开时显示「工作台」悬浮按钮；
- 其余（`/`）→ 新会话首页：`shell.home` 链的中标内容叠在官方 `conversation` slot 上方（无 entry 时锚点为 display:contents + null，布局与纯官方完全一致）。官方 hero 的工作区行、preset chip、输入卡（含上传）原样保留；官方 HeroShell（鱼标 + 标题 + 预览徽章）无 slot 可换、locale 重复注册会 throw，由 ui-home 用结构选择器 CSS 隐藏（锚点 `[data-phase="hero"]`/`[data-composer-seat]`/`[data-chain-overlay-fallback]`，不含 hash 类名；dsh 升级时复核，见 dsh-upgrade.md）。

URL 归位由 `OfficialSidebar.tsx` 的单个仲裁 effect 负责：侧栏打开已有会话 → `/s/:id`；空白新会话 → `/`；首条消息把空白会话变成已有会话（id 不变、只翻 `blank`）时，自动从 `/` 归位到 `/s/:id`——少了这一跳，提交后会停在 `/`，Workbench（只在 `/s/:id` 子布局）永远不会出现。

Workbench（`Workbench.tsx`）是自定义工作台：tabs = 输入 / 交付物。输入页签展示会话工作目录、运行状态与本次上传文件；交付物页签列出会话轮次产出的文件（数据源是会话投影快照的 tool-result 节点 callView，由常驻的 `DeliverablesSync` 无头组件同步进 workbenchStore——不依赖聊天区挂载，刷新后停在「预览」标签也能恢复；聊天区 turnTail chips 仍复用官方投影渲染）。工作台各「预览」入口（交付物/加工/输入区文件列表）经 `previewClient` 桥调用 camind-ui-preview 插件的 `filePreview` 服务：目标文件写入插件预览态并切到主对话区的「预览」标签页（插件注册进官方 `conversation.view`，跟在「对话」「轨迹」之后；预览数据走插件自己的 Host 路由 `/camind/api/preview/sessions/<id>/file`）。全局 `DiffOverlay`（代码对比，分栏/统一）挂在 `shell.overlay`，任意界面可通过 `diffOverlayActions` 或 `window.__camindDiff__` 打开同一组件。

其余 slot：

- conversation 子 slot（官方定义，ui-shell 以 inject 方式注册业务扩展）：`conversation.input.left`（文件上传按钮；所有模式使用 DSH_HOME 会话隔离批次，ZIP 自动解压）、`conversation.input.dock`（待发送文件附件 rail 与拖拽分流器的生命周期锚点；组件通过 portal 落在官方 Composer 卡片内、textarea 上方，不污染 draft；图片继续桥接官方图片草稿）、`conversation.chat.turnTail`。
- `shell.overlay`：ui-shell 挂 `DiffOverlay`（全局代码对比，工作台只是调用方）。
- sidebar 子 slot（ui-sidebar 声明）：`sidebar.brand.mark` / `sidebar.brand.name` 是 0.1.1 起的上游原生席位；`sidebar.workspaces`、`sidebar.settings` 沿用官方契约，owner props 刻意保持不变；`sidebar.footer.action` 是官方 list 席位，owner props 本地扩展为 `{ wide, pathname, navigate }`（官方契约的超集，存量插件忽略多余字段），类型靠 `declare module` 增广，见 `ui-sidebar/src/client/contract/slots.ts`。
- 侧栏最底部是账号行（ui-sidebar 本地改动）：flex between 布局，左侧用户块（本地无账号体系，固定显示名 `user`，首字母圆形头像 + 名字），右侧 `sidebar.settings`——固定以 `wide: false` 传给官方 occupant，使其渲染 36px 圆形纯图标 trigger 而非整行带标签按钮；折叠 rail 下只保留该图标，与官方行为一致。

## 插件如何扩展页面（page-memory）

client bundle 是手写的 `window.__ModuleLoader__.load()` 格式（`page-memory/lib/client.js`）：

- 模块 `id` 必须等于包名 `camind-page-memory`（加载器会校验「bundle loaded without registering `<id>`」，`<id>/client` 后缀会被规范化）；
- `require` 只能请求平台种子词（react、`dsh-client-ui-primitives` 等），其余依赖必须内联；
- `exports.inject = ['slots']`，`apply` 里两处 `ctx.slots.inject`：
  - `sidebar.footer.action`：底部菜单「记忆库」（id `page-memory`、`order: 20`、label + 组件，active 按 `pathname` 判定，点击 `navigate('/pages/memory')`，样式对齐官方设置触发行）；
  - `shell.content`：`{ priority, select }`，`select({ pathname, navigate })` 匹配 `/pages/memory`（含 `/experience` tab 与 `/<type>/<name>` 详情子路径）时接管页面，页面组件按 `pathname` 分段自行渲染两级视图。

`package.json` 同时声明 `dsh.bundle.patch` 和 `dsh.client.platform: 'web'` 并导出 `./client`；dsh 按 `./client` 出口把 bundle 编入 boot 图。Host 侧 `index.js` 注册 `prefix /camind/api/memory`（webServer 最长前缀优先，与 ui-shell 的 `/camind/api` 互不干扰），`lib/server.js` 提供知识/经验条目的列表、详情、上传、编辑与审核流转端点；领域逻辑不复制——Host 半 `inject: ['webServer', 'memoryBank']`，直接复用 `camind-tool-memory` 的 `memoryBank` Cordis 服务，另加 LLM 元数据后台补全调度。

ui-sidebar 与 page-memory 代表了两种 client 代码形态：**TS 源码静态替换**（编译进 ui-shell bundle，用于替换官方模块）和**手写 bundle 动态加载**（独立文件，用于新增页面/内容；page-memory、ui-brand、ui-home 都是这个形态）。新页面插件用后者，照抄 page-memory 结构即可。

## 新会话首页（hero）定制的三条硬约束

官方 hero（`dsh-client-ui-conversation` 的 ConversationRoot）有三条机制约束，ui-home 的设计由它们推导：

1. **HeroShell（鱼标 + 「探索未至之境」+ 预览徽章）没有 slot**，locale 也无法覆盖——`dsh-client-locale` 的 `register(ns, locale)` 对同 namespace 同 locale 重复注册直接 throw。所以标题/徽标只能用 CSS 隐藏 + 自绘品牌区替换。
2. **entry 的 `renderSlot`/`renderSlotChain` 严格限于自己 children 声明的洞**（越界 throw），且同一 slot 不允许两个 entry 重复声明（throw "already declared"）。因此「chain 接管 `conversation.composer` 后在组件里嵌官方 composer.bar」不可行——官方输入条无法被嵌进自定义组件，自绘输入条则丢失附件/斜杠命令/提交策略等行为。
3. **session 级 chain entry 在无会话态不运行**（渲染器直接清空 entries），截图那种「未选工作区」首屏只有 root 级洞能覆盖。

结论：首页定制 = root 级 `shell.home` 叠加层（品牌区 + 紧随其下的示例卡片，并中和官方 hero 自居中、外层整组 `safe center`）+ session 级 `conversation.input.dock` 的不可见桥条目（把 blank 会话的 `inputActions` 暴露给首页组件写草稿）+ CSS 隐藏官方 HeroShell。草稿、上传、图片、斜杠命令、发送与 URL 归位全部留在官方 runtime，无连续性成本。

## 构建

- `npm run build` = `tsc -p tsconfig.host.json`（编译 src/host + src/shared → `dist/host`、`dist/shared`）+ `vite build`（web → `dist/web`）。`tsconfig.json` 只管 src/web 的类型检查（`noEmit`）。
- `prebuild` / `predev` 先跑 `scripts/sync-dsh-version.mjs --check`，dsh 版本不一致直接拒构建（见 [dsh-upgrade.md](dsh-upgrade.md)）。
- `npm run dev`：Vite dev server（5173），`/camind/api`、`/plugins`、`/api` 代理到 `127.0.0.1:3080`。

## 踩坑清单

- **不要 Vite-import 官方 `./client` 产物**：factory 形式的 `require` 在 ESM 求值时会炸。`vite.config.ts` 的 `unwrapDshClientLoader` 插件专门把 node_modules 里的官方 bundle 解开转 ESM，`node:module` 也必须 shim（浏览器里直接 throw）。
- **ui-primitives / ui-attachment 必须 alias 到 `vendor/` 上游源码**：npm lib 产物把 CSS Modules 替成空对象，直接引用会让官方组件丢样式（原因写在 `ui-shell/vendor/*/README.md`）。
- **React 单实例**：`dedupe: ['react', 'react-dom']`；手写 bundle `require` 非平台词会得到 loud error。
- **URL ↔ 官方 session store 的双向同步必须放在单个 effect 里**（`OfficialSidebar.tsx:109` 注释：拆开会导致无限导航抖动）。
- **文件预览有安全约束**：`/camind/api` 的文件端点拒绝越界与 `.git`/`.dsh`/`.env*` 路径段，raw 预览带 CSP sandbox（见 `host/index.ts` 的 `resolveSessionFile` 与 `raw=1` 分支）。新增文件类端点时沿用同一套校验。
