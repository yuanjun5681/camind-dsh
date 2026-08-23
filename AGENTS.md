# AGENTS.md

本文件面向 AI 编码代理，介绍本工作区的结构、约定与常用命令。假设读者对本项目一无所知。

## 项目概览

Camind 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件机制搭建的 CAM 加工业 Agent Harness 工作区，**不是 dsh 本体的源码仓库**。dsh 本体通过 `npx` 从 npm 运行（`@deepseek-ai/dsh`，仓库由根目录 `dsh-version.json` 固定版本，当前为 `0.1.1-rc.2`；developer preview 阶段，迭代快、不保证磁盘格式兼容）。`scripts/dsh.mjs`、ui-shell 客户端包和桌面 vendor 必须保持该版本一致。

dsh 的核心理念是 **everything is a plugin**：agent 的所有能力（工具、命令、LLM、shell 等）都是挂在 [Cordis](https://github.com/cordiverse/cordis) 插件框架上的插件。本工作区包含一组通用插件（上传、记忆库、Git 仓库服务）、一个独立定制前端、一个 Electron 桌面壳和一份 dsh 数据目录（`.dsh/`）。

## 技术栈

- **运行时**：Node.js `^22.19` 或 `>=24`（当前环境 v22.22.1）。
- **插件**：纯 JavaScript、ESM（`"type": "module"`），无构建步骤、无 TypeScript、无测试框架。例外：`ui-shell/` 用 TypeScript（Host 侧 `tsc`，前端 Vite + React），`npm run build` 产出 `dist/`。
- **客户端（浏览器）bundle**：树外 dsh UI 扩展仍用手写 `window.__ModuleLoader__.load()` 格式。独立定制界面在 `ui-shell/`，复用官方 slot runtime，由 Host 桥挂在 `/camind`。
- **桌面壳**：Electron 43 + electron-builder 26，仅配置了 mac 目标（未签名，`identity: null`）。
- **包管理**：profile 内的插件安装由 `dsh plugin` 命令转发给 pnpm 完成；`desktop/` 用 npm。

## 目录结构与模块划分

```
.dsh/               dsh 数据目录（DSH_HOME），已 gitignore
  profiles/         两个 profile：headless / web；各自 package.json 的
                    dsh.profile.bundles 声明按顺序组合的 bundle 列表，dependencies
                    用 link: 引用本工作区的插件（绝对路径，机器相关）
  sessions/         会话存储
  settings.yaml     设置（可能含 API key 等凭据，勿提交、勿外传）
  .agent-presets/   dsh 运行时 AgentPreset（用户自建，本仓库不同步任何 preset）
  skills/           symlink -> ../skills（DSH_HOME 级被发现，不随 session cwd 变化，
                    任何工作区的会话都能加载；唯一事实源是仓库 skills/）
  uploads/          所有模式共用的会话隔离上传批次（<session>/<batch>/）；ZIP 自动解压
  memory/           OKF 记忆库 bundle（knowledge/ + experience/），DSH_HOME 级共享、
                    所有工作区的会话共用；独立 git 仓库，写操作自动 commit
  machines/         机床档案运行时存储（init 从仓库 machines/ 种子拷入，目标已存在不覆盖；
                    独立 git 仓库，写操作自动 commit）
skills/             版本化的技能库，init 时经 .dsh/skills symlink 挂入 DSH_HOME
machines/           机床档案种子基线（版本化、走评审；现有 VMC-HJ-01.yaml = 华集 CV-850 立加，
                    旧 Camind seed_cv850.py 的 YAML 转换；init 时拷入 .dsh/machines/）
ui-shell/           独立定制前端（TypeScript）：Host 协议桥 + React SPA；官方 UI slot + Workbench，入口 /camind（/ 302 至此）
ui-sidebar/         /camind 专用的官方 Sidebar 兼容实现；扩展底部菜单 owner props
ui-brand/           Camind 品牌插件（`camind-ui-brand`）：always-on 动态
                    blobatar mascot + 字标，注册到上游原生 sidebar.brand.mark/name 席位
ui-home/            新会话首页插件（`camind-ui-home`）：`/` 叠加品牌区 + 示例卡片
                    （`shell.home` 链），blank hero 示例 chips 挂官方
                    `conversation.input.dock`；官方 HeroShell 由结构选择器 CSS 隐藏
page-memory/        记忆库管理页（`camind-page-memory`）：底部菜单「记忆库」+ 两级页面
                    `/pages/memory`（知识/经验双 tab 列表 → `/pages/memory/<type>/<name>` 详情）；
                    Host 半注册 `/camind/api/memory`；上传/新建/编辑缺元数据时经
                    dsh `llm` 服务后台自动补全（pending → ready/failed，页面轮询）
service-git-repository/ 通用 Cordis `gitRepository` 服务（`camind-service-git-repository`）：
                    本地仓库、worktree、锁与 sidecar；headless/web 全局加载
tool-upload/        通用上传工具集：当前 session 的上传文件列表与分段读取；所有模式全局加载
tool-cam/           CAM 加工插件（`camind-tool-cam`，设计稿 docs/cam-machining-design.md）：
                    camPipeline 服务（CAM-Agent proxy 客户端，初版仅连接配置 + ping）+
                    settings namespace cam-nx + 官方 Settings 插件配置卡片；所有模式全局加载
tool-memory/        OKF 记忆库（`camind-tool-memory`）：`memoryBank` Cordis 服务 +
                    4 个记忆工具（search/read/save/extract）；所有模式全局加载
desktop/            Electron 壳：spawn `dsh web` 并加载自定义 UI（/camind/）
  main.js           主进程：选空闲端口、spawn dsh、窗口生命周期
  scripts/prepare-vendor.mjs  打包前准备 vendor/（安装 dsh 本体 + 实体化种子 DSH_HOME）
  vendor/           打包材料（gitignore，由 prepare-vendor 生成）
  dist/             electron-builder 产物（gitignore）
docs/               项目专题文档（custom-ui / slots / memory-design / uploads / dsh-upgrade /
                    cam-machining-design[设计稿]）+ 每次 dsh 升级的过程记录 upgrades/
                    + 指向官方文档的 README；上游文档见 README 的「文档」一节
docs/dsh-topology.svg  dsh 架构拓扑图
README.md           主要文档（运行、插件开发教程、桌面打包细节），改动前先读
```

插件的分工：

- **ui-shell**（`camind-ui-shell`）— 独立定制前端（TypeScript）。Host 半注册 `/camind`（SPA）与 `/camind/api`，并注册 exact `/` 302 到 `/camind/` 作为默认入口（0.1.1 起官方前端只在 dist 根与 `/index.html` 提供入口，另注册 exact `/web` 302 到 `/index.html` 访问官方 UI）；浏览器侧加载官方插件图。全局 Shell 只渲染 Sidebar、页面出口和 Overlay；`/s/:id` 会话详情子布局才组合官方 Conversation/Details 与自定义 Workbench（「输入」「交付物」两个页签），`/` 新会话和 `/pages/*` 插件页不挂载 Workbench。插件页面通过 `shell.content` route chain 扩展。仅 web profile。需 `cd ui-shell && npm install && npm run build`。
- **ui-sidebar**（`camind-ui-sidebar`）— 基于官方 `@deepseek-ai/dsh-client-ui-sidebar@0.1.1-rc.2` 源码的 `/camind` 专用 Cordis 客户端插件；以官方模块 ID 静态替换（0.1.1 起官方模块系统删除 registerStatic，改为建系统前压入 `__ModuleLoader__` 待处理队列），继续声明 `sidebar.workspaces` / `sidebar.settings` / `sidebar.footer.action` 与上游原生的 `sidebar.brand.mark` / `sidebar.brand.name` 品牌席位，并把 `sidebar.footer.action` 的 owner props 扩展为 `{ wide, pathname, navigate }`（官方契约的超集）；另修复官方沿用的 `.footerActions` 横向 flex 布局（官方只有单个底部菜单项从未暴露，多菜单项时横向挤压裁剪）为纵向排列，官方 `/` 不受影响。最底部是账号行：左侧用户块（本地无账号体系，固定显示名 `user`，首字母圆形头像 + 名字），右侧 `sidebar.settings` 固定以 `wide: false` 渲染官方 36px 圆形纯图标 trigger；折叠 rail 只剩图标，与官方一致。
- **ui-brand**（`camind-ui-brand`）— Camind 品牌插件：手写 client bundle 注册到上游原生 `sidebar.brand.mark` / `sidebar.brand.name` single 席位（priority -10 压过图内 ui-brand-official 的 priority 0 注册；仅 `/camind` 路径注册，官方壳保持原生品牌）。品牌标记是一个 always-on 动态 blobatar mascot（round 剪影；blobatar@2.1.0 SSR 冻结为静态 SVG 内联进 bundle，动画由随包的 motion.css 驱动、激活时注入 `<head>`，遵循 prefers-reduced-motion）；展开态渲染 mascot + “Camind” 字标与主题反白 “Harness” 徽章（deepseek-HARNESS 风格），折叠 rail 只渲染 mascot。仅 web profile。
- **ui-home**（`camind-ui-home`）— 新会话首页定制（`/`）。`shell.home` 链（ui-shell 在 root entry 声明）把品牌区（与 ui-brand 逐字节一致的 mascot + “Camind”字标 + “Harness”徽章）与紧随其下的示例卡片叠在官方 conversation 上方；官方工作区行、preset chip、输入卡（含上传）原样保留。插件 CSS 中和官方 hero 的自居中（`[data-phase="hero"] [data-conversation-scroll]`），由外层容器 `safe center` 把「品牌区 + 示例 + 工作区行 + 输入卡」收成一个整体居中组。示例点击经 `inputActions.setDraft` 写官方草稿：root 级组件拿不到 input 机，故在 `conversation.input.dock` 挂一个不可见的桥条目暴露 blank 会话的 inputActions；无会话态点示例则暂存草稿并 `workspaces.startSession()`（接最近工作区的 blank 会话），桥挂载时补写（不覆盖已有草稿）。官方 HeroShell（鱼标 + 「探索未至之境」+ 预览徽章）无 slot 且 locale 重复注册会 throw，用锚在 `[data-phase="hero"]`/`[data-composer-seat]` 的结构选择器 CSS 隐藏（不含 hash 类名），dsh 升级需复核。仅 web profile。
- **tool-memory**（`camind-tool-memory`）— OKF 记忆库（知识库 + 经验库，设计见 `docs/memory-design.md`）。提供 Cordis `memoryBank` 服务：`$DSH_HOME/memory/` 下 OKF v0.2 bundle 的解析/校验/CRUD 与检索（LLM 查询改写 + 元数据粗排 + LLM 语义重排，无向量、无索引库），写操作经 `gitRepository` best-effort 自动 commit，只读不 `git init`。知识条目 `knowledge/<name>.md`（`type: Knowledge`，人工/上传/工具保存，立即生效）；经验条目 `experience/exp-*.md`（`type: Experience`，三段式「情境/教训/做法」，`draft` 候选 → 人工采纳 `stable` → `deprecated`）。注册 4 个模型工具：`search_memory` / `read_memory` / `save_memory`（保存知识）/ `extract_memory`（提炼经验候选，evidence 自动附当前 session）。headless/web 全局加载，所有模式可用。
- **page-memory**（`camind-page-memory`）— 记忆库管理页（两级）。底部菜单「记忆库」注册到 `sidebar.footer.action`（`order: 20`，「设置」之上），页面注册到 `shell.content`，路由 `/camind/pages/memory`（`/experience` 切 tab；`/knowledge|experience/<name>` 为详情，深链接有效）。Host 半注册 `prefix /camind/api/memory`，领域逻辑经 `inject: ['webServer', 'memoryBank']` 复用 tool-memory 的服务。知识 tab 支持零表单上传（.md/.txt 多选，选完即传）：缺 title/description 的条目落 `metadata_status: pending`，Host 经 dsh `llm` 服务（`agentDefaultModel` 选模型，防御式 `ctx.get`）后台自动补全 → `ready`/`failed`，卡片与详情 3 秒轮询。经验只能由 `extract_memory` 产生，页面负责审核流转（采纳/弃用/编辑退回候选/删除）。仅 web profile。
- **service-git-repository**（`camind-service-git-repository`）— 通用 Cordis `gitRepository` 服务。管理本地 Git 仓库、worktree、commit/merge、sidecar 与仓库锁，以及文件级 log/diffRefs/restoreFileTo，不理解任何领域数据。headless/web 全局加载。
- **tool-upload**（`camind-tool-upload`）— 所有 Agent 模式全局加载的通用上传工具集。UI Host 把每次上传写到 `$DSH_HOME/uploads/<session>/<batch>/`，原始文件在 `files/`，ZIP 自动安全解压到 `extracted/<archive>/`；session 工作区不作上传暂存。插件提供 Cordis `uploads` 服务，集中处理 session 归属、manifest、路径与完整性校验；模型侧 `list_uploaded_files` / `read_uploaded_file` 只允许列出、分段读取调用 session 的 manifest 声明文件，不能跨 session 或读取 `$DSH_HOME` 其他数据。浏览器文件选择和字节传输不设计成模型 tool。
- **tool-cam**（`camind-tool-cam`）— CAM 加工场景插件（设计稿 `docs/cam-machining-design.md`；初版只实现 §4.5 + §4.1 的 ping，4 个 CAM 工具/闸门/断点续跑属后续迭代）。Host 侧提供 Cordis `camPipeline` 服务（CAM-Agent proxy HTTP 客户端：连接配置解析 settings > 环境变量 `CAMIND_NX_AGENT_URL` 兜底、token 经凭据库 `tokenEnv` 引用解析且明文不外露、`connectionInfo()` / `ping()`），并以 `installSettingsSection` 注册 settings namespace `cam-nx`（热更新，照官方 dsh-web-search-deepseek 双件套）；web 下半注册 exact `POST /camind/api/cam/ping`（webServer 是带自己 inject 的子插件，headless 不激活）。client bundle 往官方 Settings → 插件 → 插件配置 tab 注册 keyed 卡片「NX 工作台」（`settings.plugin.item` key `cam-nx`）：baseURL 文本框走 `settingsScope`，token 输入框 write-only 走 `credentials.set/describe` wire API，「测试连接」调上述 ping 路由回显 base_dir / proxy_version。headless/web 全局加载。

## 运行与构建命令

新检出/新机器先跑一次初始化（幂等：重建 profile 与依赖、建立 skills symlink、同步机床档案种子到 .dsh/machines/、构建 ui-shell）：

```sh
npm run init
```

日常命令统一走 `node scripts/dsh.mjs ...`：启动器固定 dsh 版本（不随 npm latest 漂移），且 `DSH_HOME` 未设置时默认指向 Camind 项目根的 `.dsh/`，与 session 选择的 workspace cwd 无关（显式 export 可覆盖，指向别处时要自行承担 profile 差异）：

```sh
# Web UI（默认 http://127.0.0.1:3080）；web 子命令固定用 web profile，无 --profile 选项
node scripts/dsh.mjs web

# 无头模式一次性执行（headless profile）
node scripts/dsh.mjs --profile headless "总结一下这个目录里有什么"

# 查看 profile 实际组合出的配置（不需要 API key，排查插件是否生效首选）
node scripts/dsh.mjs --profile headless --dump-config

# 安装/移除插件（转发 pnpm；声明了 dsh.bundle 时自动维护 bundles 列表）
node scripts/dsh.mjs plugin --profile headless add ./my-plugin
node scripts/dsh.mjs plugin --profile headless remove dsh-my-plugin

# 修改 dsh-version.json 后同步并校验客户端包
npm run sync:dsh-version
npm run check:dsh-version
```

桌面壳：

```sh
cd desktop
npm install
npm start        # 开发：npx 跑 dsh，DSH_HOME 复用 Camind 项目根的 .dsh（本项目插件直接生效）
npm run dist     # 打包：先 prepare-vendor 再 electron-builder，产物在 desktop/dist/
```

升级 dsh：按 `docs/dsh-upgrade.md` 的 SOP 执行（改 `dsh-version.json` → `npm run sync:dsh-version` → 人工同步 vendor 快照与 ui-sidebar → rebuild ui-shell → 需要时重新 `npm run dist`）；升级不要重跑 `npm run init`。

## 插件开发约定

一个 bundle = 带 `dsh.bundle` 声明的 npm 包，三个文件：`package.json`、`cordis.patch.yml`、`index.js`。照抄现有示例的结构即可，要点：

- 本工作区自定义插件的命名约定：包名 `camind-<角色>-<职责>`（对齐上游文档 `docs/cookbook/adding-a-package.zh.md` 的角色命名规范——名称描述当前稳定职责，不用 `custom`、`plugin` 这类无信息量或基类词）；目录名 = 包名去掉 `camind-` 前缀。现有九个：`camind-ui-shell`（ui-shell/）、`camind-ui-sidebar`（ui-sidebar/）、`camind-ui-brand`（ui-brand/）、`camind-ui-home`（ui-home/）、`camind-tool-upload`（tool-upload/）、`camind-tool-cam`（tool-cam/）、`camind-tool-memory`（tool-memory/）、`camind-page-memory`（page-memory/）、`camind-service-git-repository`（service-git-repository/）。
- 插件是导出 `apply(ctx)` 的 ESM 模块；`export const inject = ['tools', 'commands', ...]` 声明消费的服务，Cordis 等其就绪后才运行 `apply`。通过 `ctx` 注册的一切都是可逆 effect，卸载自动回收；手动资源用 `ctx.effect(() => disposer)`。
- `package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；有浏览器代码时再加 `"dsh": { "client": { "platform": "web" } }` 并导出 `./client`。
- `cordis.patch.yml` 的插件行按**包名**引用（`- insert: [{ id: ..., name: <包名> }]`），Node 解析到安装后的代码。
- client bundle 手写格式：`window.__ModuleLoader__.load({ id: <包名>, factory: (require) => {...} })`，`id` 必须等于包名；除 shell 提供的共享包外一切依赖必须内联。参考 `page-memory/lib/client.js`。
- UI 扩展用 slot 机制（`ctx.slots.inject(name, () => ctx.slots.register(...))`），不要改 shell 自有组件。
- 配置按层叠加，后面的层覆盖前面同 `id` 的行：profile 的 bundles 列表（`@deepseek-ai/dsh-base` 最前）→ profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch`（可多次）。

详细教程见 `README.md` 的「编写自己的插件」一节和上游 `docs/user/develop/basic/`。

## 测试策略

本项目**没有自动化测试**（无任何 test 脚本或测试框架）。验证手段是手动冒烟：

1. `--dump-config`（无需 API key）：确认插件行出现在组合后的配置里。
2. `http://127.0.0.1:3080/`（302 到 `/camind/`）：验证自定义前端（需先在 `ui-shell/` 执行 `npm install && npm run build`）。新会话页 `/` 显示 Camind 品牌区（mascot + 字标 + Harness 徽章）、紧随其下的示例卡片，与官方工作区行/输入卡组成一个整体居中组，官方鱼标/「探索未至之境」/预览徽章不再出现（ui-home 叠加 + CSS 隐藏）；点示例直接写入输入框草稿（无会话时先自动接最近工作区的 blank 会话再预填）。侧栏顶部显示 Camind 动态 blobatar mascot + 字标（ui-brand 占 `sidebar.brand.mark`/`sidebar.brand.name` 席位；折叠 rail 只剩 mascot），底部「设置」上方显示「记忆库」（page-memory），点击进入 `/camind/pages/memory`：知识/经验双 tab 列表、搜索与 chip 过滤、上传 .md/.txt 后元数据自动生成（「生成中」→ 自动填好或「生成失败」可编辑手填）、编辑/删除、经验采纳/弃用，详情深链接刷新保持。Composer 加号打开斜杠命令列表（含命令与技能），输入 `/` 同样弹出。官方壳由 `http://127.0.0.1:3080/web`（302 到 `/index.html`）访问，保持原生品牌与布局。
3. Web 新建会话，上传普通文件和 ZIP：必须写入 `$DSH_HOME/uploads/<session>/<batch>/`，session 工作区根不出现上传文件，且只能通过通用工具列出/读取自己的批次；ZIP 原件保留、内容自动解压，越界路径和解压限额必须阻止整个批次。

改动插件代码后通过 `link:` 依赖即生效，无需重新安装（web/headless 重启进程生效）。

## 安全注意事项

- `DEEPSEEK_API_KEY` 是模型调用前提：环境变量、根目录 `.env`，或 Web UI 的 Settings → Models。`.env` 已 gitignore，**不要读取或外泄其内容**。
- `.dsh/` 整个目录已 gitignore：含会话日志、上传原件/解压内容和 `settings.yaml`（可能含凭据）。不要提交，也不要把内容贴到外部。上传 ZIP 限制为 1000 条目、单条解压 32 MiB、总解压 128 MiB，并拒绝绝对/越界/重复路径；修改这些限制时必须保留 zip-slip 与 zip-bomb 防护。记忆库（`.dsh/memory/`）同此目录：含私有领域知识与经验，不提交、不外传；页面上传后的元数据补全会把文档内容（截断 8000 字符）发往用户在 dsh 配置的模型商，与 Agent 会话同通道、不新增出域面。
- profile 的 `package.json` 里 `link:` 依赖是**绝对路径**（机器相关）；新机器跑 `npm run init` 即可从模板重建（`scripts/init.mjs` 运行时计算路径），无需手动 `dsh plugin add`。
- 桌面打包配置未签名（`identity: null`）：本机可用，分发到其他 Mac 首次需右键 → 打开；正式分发要配开发者证书。

## 改动 desktop/ 前必读的两个坑

- **子进程必须传 `--expose-internals`**：dsh 的插件加载器需要 Node 内部 ESM loader 才能按 profile 目录解析裸包名；常规 Node 下由 `node-addon-require-builtin` 旁路提供，Electron 的 Node 下只能靠这个 flag（见 `desktop/main.js`）。
- **extraResources 必须从 `vendor/` 整体拷贝**（`from: vendor, to: .`）：electron-builder 会静默剥掉拷贝源目录根级的 `node_modules`，直接以 `vendor/dsh` 为源会丢光依赖。

## 代码风格

- 纯 JS ESM，无 lint/format 配置；模仿现有文件风格即可。
- 注释语言：桌面壳与 README 用中文，客户端 bundle（ui-brand / ui-home / page-memory）的注释用英文。面向模型的 tool `description` 用中文是本工作区的既有做法，新增工具保持一致。
- 每个文件顶部有一段说明性头注释（模块职责 + 关键约定），新文件保持这一习惯。
