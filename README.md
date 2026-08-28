# Camind

本工作区是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件机制搭建的 CAM 加工业 Agent Harness 工作区。Harness 的核心理念是 **everything is a plugin**：agent 的所有能力（工具、命令、LLM、shell 等）都是挂在 [Cordis](https://github.com/cordiverse/cordis) 插件框架上的插件，用户也可以用同样的方式扩展它。

dsh 本体通过 `npx` 从 npm 运行（`@deepseek-ai/dsh`），不需要克隆源码仓库。仓库根目录的
`dsh-version.json` 是唯一版本源；`scripts/dsh.mjs`、自定义 UI 客户端包和桌面打包都使用该版本。

## 目录结构

```
.dsh/             dsh 数据目录（DSH_HOME，已 gitignore，`npm run init` 重建）：profiles、会话、设置、上传批次
  profiles/       两个 profile：headless / web，各自声明要组合的 bundle
  .agent-presets/ 运行时 AgentPreset（用户自建）
  skills/         symlink -> ../skills（DSH_HOME 级发现，任何工作区的会话都能加载）
  uploads/        所有模式共用的会话隔离上传批次（<session>/<batch>/）
  memory/         OKF 记忆库 bundle（knowledge/ + experience/），DSH_HOME 级共享
skills/           版本化的技能库；.dsh/skills 是指向它的 symlink
tool-upload/      所有模式共用的会话上传文件列表与读取工具
tool-memory/      OKF 记忆库：memoryBank 服务 + search/read/save/extract 四个记忆工具
service-git-repository/ 通用 gitRepository 服务：本地仓库、worktree、锁
page-memory/      记忆库管理页：底部菜单 + 两级页面（知识/经验）+ `/camind/api/memory`
ui-shell/         混合 Web UI：官方会话/侧栏 + 文件上传、预览与交付物 Workbench，入口 /camind/
ui-foundation/    Web UI 基础层：Camind 语义 token + 跨页面公共组件；仅 /camind 激活
ui-sidebar/       /camind 专用的官方 Sidebar 兼容实现，增加品牌与一级菜单 slot
ui-brand/         品牌插件：CAM 虎钳工匠 mascot + 字标，注册到 sidebar.brand.mark/name 席位
ui-home/          新会话首页定制（/）：Camind 品牌区 + 紧随其下的示例卡片，与官方输入卡合成一个整体居中组；示例经不可见的 inputActions 桥（conversation.input.dock）写官方草稿
desktop/          Electron 桌面壳：spawn `dsh web` 并加载自定义 UI（/camind/）；`npm start` 开发运行，`npm run dist` 打包 .app/.dmg
docs/             项目专题文档（UI 架构、记忆库设计、dsh 升级）+ 指向上游官方文档的 README
docs/dsh-topology.svg  dsh 架构拓扑图
```

## 前置要求

- Node.js `^22.19` 或 `>=24`
- pnpm（profile 的依赖安装由它完成，可用 `corepack enable pnpm` 提供）
- `DEEPSEEK_API_KEY`（模型调用需要；可在环境变量、根目录 `.env` 中设置，或在 Web UI 的 **Settings → Models** 里配置）

## 运行

新检出或新机器先做一次初始化（幂等，只补齐缺失部分：`.dsh/` 的 profile 与依赖、skills symlink、ui-shell 构建；API key 缺失会警告）：

```sh
npm run init
```

之后日常运行一条命令。`scripts/dsh.mjs` 固定运行 `dsh-version.json` 钉住的 dsh 版本（不随 npm `latest` 漂移），且 `DSH_HOME` 未设置时默认指向 Camind 项目根的 `.dsh/`，与 session 选择的 workspace cwd 无关（显式 export 可覆盖）：

```sh
# 启动 Web UI（默认 http://127.0.0.1:3080）；web 子命令固定使用 web profile，没有 --profile 选项
node scripts/dsh.mjs web

# 无头模式一次性执行一个任务，使用 headless profile
node scripts/dsh.mjs --profile headless "总结一下这个目录里有什么"

# 查看某个 profile 实际组合出的配置（不需要 API key，排查插件是否生效时最有用）
node scripts/dsh.mjs --profile headless --dump-config
```

profile 即 `.dsh/profiles/<name>/` 目录，其 `package.json` 里的 `dsh.profile.bundles` 声明了按顺序组合的 bundle 列表。配置按层叠加，后面的层覆盖前面同 `id` 的行：

1. profile 的 `bundles` 列表中每个 bundle 的 `cordis.patch.yml`（`@deepseek-ai/dsh-base` 在最前）
2. profile 自己的 `cordis.patch.yml`
3. `$DSH_HOME/cordis.patch.yml`（机器级偏好）
4. 命令行 `--patch <文件>` 覆盖层（可多次，按顺序）

## 工作区插件

插件已通过 `link:` 依赖装入 profile。tool-upload、tool-memory 与 gitRepository 服务在 headless/web 全局加载；ui-shell、ui-foundation、ui-brand、ui-home 与 page-memory 只装入 web profile（见 `.dsh/profiles/*/package.json`）：

- **tool-upload** — 通用上传工具集。它提供会话隔离的 Cordis `uploads` 服务；`list_uploaded_files` 列出当前 session 的上传批次、原始文件和 ZIP 解压文件，`read_uploaded_file` 对清单内文件做有界分段读取。服务和工具都从调用上下文取得 session ID，不接受跨会话路径，也不把用户设备上传设计成模型工具。
- **tool-memory** — OKF 记忆库（知识库 + 经验库，设计见 [docs/memory-design.md](docs/memory-design.md)）。提供 Cordis `memoryBank` 服务：`$DSH_HOME/memory/` 下 OKF v0.2 bundle 的解析/校验/CRUD 与检索（LLM 查询改写 + 元数据粗排 + LLM 语义重排），写操作经 `gitRepository` best-effort 自动 commit。注册 `search_memory` / `read_memory` / `save_memory` / `extract_memory` 四个模型工具。
- **service-git-repository** — 通用 Cordis `gitRepository` 服务。初始化独立 Git 仓库、worktree、diff/commit/merge、sidecar 与仓库锁；不理解任何领域数据。
- **page-memory** — 记忆库管理页（两级）。侧栏底部菜单「记忆库」（「设置」上方）打开 `/camind/pages/memory`：知识/经验双 tab 列表 → 详情；零表单上传 .md/.txt 后由 Host 经 dsh `llm` 服务后台自动补全元数据；经验审核流转（采纳/弃用/退回/删除）。Host 半提供 `/camind/api/memory`，领域逻辑复用 tool-memory 的 `memoryBank` 服务。
- **ui-shell** — 基于官方 UI 插件组合出的混合界面（TypeScript）。全局 Shell 只负责 Sidebar、页面出口和 Overlay；`/s/:id` 会话详情子布局组合官方 Conversation/Details 与可折叠 Workbench，`/` 新会话和 `/pages/*` 插件页使用不挂载 Workbench 的普通页面布局。`shell.content` 提供插件页面扩展位，官方 Composer slot 挂文件上传：所有模式统一保存到 `$DSH_HOME/uploads/<session>/<batch>/`，ZIP 自动安全解压，不向 session cwd 写入上传文件；`conversation.input.dock` 作为插件生命周期锚点，待发送文件通过 portal 显示在 Composer 卡片内、textarea 上方，并统一分流拖拽（官方支持的图片进入图片 rail，其他文件进入通用文件 rail），用户 draft 只保留实际输入。Host 在下一条用户消息的 `agent/pre-step` 将不透明批次 ID 和文件摘要作为独立插件上下文注入，成功进入请求后消费 pending 标记。Workbench 提供输入上下文与交付物列表，原始与解压文件均可在 `shell.overlay` 预览。Host 桥只为这些业务能力补充 `/camind/api`。定制界面是默认入口（`/` 302 到 `/camind/`）；官方原始界面由 `/web`（302 到 `/index.html`）访问。
- **ui-foundation** — `/camind` 的统一视觉与组件基础层。官方 `ui-theme` 继续负责 light/dark/system，foundation 将 `--dsw-*` 映射为稳定的 `--camind-*` 产品语义，并提供 Page、Tabs、Card、Badge、Field、State、Dialog 等无业务组件；Button、Input、Modal、Pill、Tooltip 直接复用官方 primitives。动态页面通过 `dsh.client.external` 消费，不复制主题色板与通用控件。
- **ui-sidebar** — `/camind` 专用、基于官方 `@deepseek-ai/dsh-client-ui-sidebar` 0.1.1-rc.2 源码的兼容客户端插件。保留官方 Workspace、Settings、折叠行为与 0.1.1 起上游原生的 `sidebar.brand.mark` / `sidebar.brand.name` 品牌席位，并把官方 `sidebar.footer.action` 的 owner props 扩展为 `{ wide, pathname, navigate }`；通过官方模块 ID 静态替换，只影响 `/camind`。
- **ui-brand** — 品牌插件。Host 提供选定的 CAM 虎钳工匠 PNG，手写 client bundle 将它与字标注册到上游原生 `sidebar.brand.mark` / `sidebar.brand.name` single 席位（priority -10 压过图内官方注册；仅 `/camind` 路径注册）；展开态显示 mascot + “Camind” 字标与主题反白 “Harness” 徽章，折叠 rail 只显示 mascot。
- **ui-home** — 新会话首页（`/`）定制。`shell.home` 链把 Camind 品牌区（与 ui-brand 一致的 mascot + 字标徽章）和紧随其下的示例卡片叠在官方 conversation 上方，官方工作区行/preset chip/输入卡（含上传）原样保留；插件 CSS 中和官方 hero 的自居中，由外层容器把「品牌 + 示例 + 工作区行 + 输入卡」收成一个整体居中组（`safe center`，矮视口可滚动）。示例点击经 `inputActions.setDraft` 写官方草稿——root 级组件拿不到输入机，故在 `conversation.input.dock` 挂一个不可见桥条目暴露 blank 会话的 inputActions；无会话态点示例自动接最近工作区的 blank 会话并预填。官方 HeroShell（鱼标 + 「探索未至之境」+ 预览徽章）无 slot 可换，由结构选择器 CSS 隐藏（dsh 升级需复核，见 docs/dsh-upgrade.md）。设计约束的完整推导见 docs/custom-ui.md。

自定义前端（`npm run init` 已完成构建与装载；手动重做时）：

```sh
cd ui-shell && npm install && npm run build
node ../scripts/dsh.mjs web
# 打开 http://127.0.0.1:3080/camind/，记忆库管理页为 /camind/pages/memory
```

## 升级 dsh

开发、客户端依赖和桌面包必须使用同一版本。查看 npm 最新版本后，修改根目录
`dsh-version.json`，再运行同步命令：

```sh
# 查看 npm 上的最新版本
npm view @deepseek-ai/dsh version

# 修改 dsh-version.json 后同步 ui-shell/package.json 与 package-lock.json
npm run sync:dsh-version

# 校验所有 dsh 客户端包与唯一版本源一致
npm run check:dsh-version
```

vendor 源码快照（`ui-shell/vendor/`）与 ui-sidebar 上游基线需要人工同步，完整 SOP 见 [docs/dsh-upgrade.md](docs/dsh-upgrade.md)；升级不需要重跑 `npm run init`。

日常命令统一通过 `node scripts/dsh.mjs ...` 启动；启动器会显式运行
`@deepseek-ai/dsh@<dsh-version.json.version>`，不会随 npm `latest` 漂移。

升级对 profile 的影响：

- profile 里的内置 bundle（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-headless` 等）始终从正在运行的 dsh 安装自身解析，随 dsh 一起升级，profile 无需改动。
- 通过 `link:` 挂载的本地插件（如本工作区的 tool-memory、ui-shell）与 dsh 版本解耦，不受影响。
- dsh 处于 developer preview，**不保证磁盘格式兼容**：升级后旧版写入的会话日志等数据可能被新版直接拒绝打开（见上游文档 `docs/subsystems/persistence.md`）。升级后可用 `--dump-config` 快速验证组合是否正常。

## 打包桌面客户端

`desktop/` 是一个 Electron 壳：启动时自动选一个空闲端口 spawn `dsh web`，在窗口里加载其 Web UI；关掉窗口即退出并回收 dsh 子进程。

```sh
cd desktop
npm install
npm start        # 开发模式：npx 跑 dsh，DSH_HOME 复用 Camind 项目根的 .dsh（本项目插件直接生效）
npm run dist     # 打包：先 prepare-vendor 再 electron-builder，产物在 desktop/dist/（.app/.dmg/.zip）
```

打包版完全自包含，用户机器无需安装 Node：dsh 由 Electron 内嵌的 Node 24 直接运行，`desktop/scripts/prepare-vendor.mjs` 负责安装 `@deepseek-ai/dsh` 本体，把本工作区插件从 `link:` 引用实体化，并把 skills 复制进种子 DSH_HOME（`desktop/vendor/dsh-home/`）。首次启动时种子释放到 `~/Library/Application Support/Camind/dsh-home`（删除该目录即重置；设 `DSH_HOME` 环境变量可覆盖默认位置）。

两个实现要点（改动 `desktop/` 前先读）：

- **子进程必须传 `--expose-internals`**。dsh 的插件加载器要拿到 Node 内部 ESM loader 才能按 profile 目录解析插件包名；常规 Node 下由 `node-addon-require-builtin` 旁路提供，Electron 的 Node 下该旁路不可用，只能靠这个 flag（见 `desktop/main.js`）。
- **extraResources 必须从 `vendor/` 整体拷贝**（`from: vendor, to: .`）。electron-builder 会静默剥掉拷贝源目录根级的 `node_modules`，嵌套层级的不受影响；直接以 `vendor/dsh` 为源会丢光依赖。

其他：升级 dsh 时修改根目录 `dsh-version.json`、运行 `npm run sync:dsh-version` 后重新 `npm run dist`；构建配置未签名（`identity: null`），本机直接用没问题，分发到其他 Mac 首次打开需右键 → 打开，正式分发要配开发者证书；目前只配置了 mac 目标，Windows/Linux 在 `desktop/package.json` 的 `build` 里加 target 即可。

## 编写自己的插件

### 1. 最小插件

插件就是一个导出 `apply(ctx)` 的 ESM 模块，框架加载时调用它，通过 `ctx` 注册的能力在插件卸载时自动回收：

```js
// index.js
export const name = 'my-plugin'

// 声明依赖的服务，全部就绪后 apply 才会执行
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'my_tool',
    description: '我的第一个工具',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return 'hello from my-plugin'
    },
  })
}
```

要点：

- `inject` 声明消费的服务（`tools`、`commands`、`llm` 等），Cordis 等待其就绪后再运行 `apply`。
- 通过 `ctx` 注册的一切（监听器、工具、定时器）都是可逆 effect，卸载时自动清理；需要手动管理的资源用 `ctx.effect(() => disposer)`。
- 插件还有对象形态（`export default { name, inject, apply }`）和类形态（继承 `Service`，用于向其他插件提供服务），详见上游文档 `docs/user/develop/basic/index.md`。

### 2. 打成 bundle

一个 bundle 就是带 `dsh.bundle` 声明的 npm 包，三个文件：

```
my-plugin/
├── package.json       # 声明 dsh.bundle
├── cordis.patch.yml   # 该 bundle 被启用时插入的配置层
└── index.js           # 插件代码
```

```json
// package.json
{
  "name": "dsh-my-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
# cordis.patch.yml — 插件行按包名引用，Node 解析到安装后的代码
- insert:
    - id: my-plugin
      name: dsh-my-plugin
```

`tool-upload/` 和 `tool-memory/` 都是完整示例（另见上游 `docs/user/develop/basic/` 教程）。

### 3. 装进 profile

`dsh plugin` 会把命令转发给 profile 目录里的 pnpm，并在包声明了 `dsh.bundle` 时自动把 bundle 追加到 `dsh.profile.bundles`：

```sh
# 从本目录安装本地插件（link 方式，改代码即生效）
node scripts/dsh.mjs plugin --profile headless add ./my-plugin

# 验证配置层，然后运行
node scripts/dsh.mjs --profile headless --dump-config
node scripts/dsh.mjs --profile headless "试试我的工具"

# 移除（依赖和配置层一起删掉）
node scripts/dsh.mjs plugin --profile headless remove dsh-my-plugin
```

也可以直接从 GitHub 或 npm 安装；git 安装需要注意 `prepare` 构建脚本与 pnpm 的 `allowBuilds` 白名单，细节见上游文档 `docs/user/develop/basic/publish.md`。

## 文档

项目专题：

- [自定义 UI 架构](docs/custom-ui.md)：`/camind` 定制前端（ui-shell / ui-sidebar / 页面插件）如何工作
- [UI 基础层设计](docs/ui-foundation-design.md)：主题、token、公共组件、品牌和插件边界
- [UI 设计规范](docs/ui-design-standards.md)：组件选择、样式命名、排版、状态、无障碍与验收矩阵
- [Slot 插槽清单](docs/slots.md)：`/camind` 下所有可注入的 UI slot（自定义 + 官方），含注册规则与现状
- [会话上传文件](docs/uploads.md)：所有模式统一上传、会话隔离访问与 ZIP 安全解压
- [记忆库设计](docs/memory-design.md)：知识库 + 经验库（OKF v0.2 bundle），camind-tool-memory 工具与 camind-page-memory 页面
- [dsh 版本升级流程](docs/dsh-upgrade.md)：`dsh-version.json` 唯一版本源 + 同步/校验 SOP

上游官方文档（master）：<https://github.com/deepseek-ai/deepseek-harness/tree/master/docs>

- [架构总览](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) / [中文](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md)
- [你的第一个插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)
- [构建工具](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md) / [插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) / [打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [Cordis 入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md) / [Cookbook](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cookbook)

项目处于 developer preview，迭代很快，行为以最新版上游为准。
