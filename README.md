# Camind

本工作区是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件机制搭建的 CAM 加工业 Agent Harness 工作区。Harness 的核心理念是 **everything is a plugin**：agent 的所有能力（工具、命令、LLM、shell 等）都是挂在 [Cordis](https://github.com/cordiverse/cordis) 插件框架上的插件，用户也可以用同样的方式扩展它。

dsh 本体通过 `npx` 从 npm 运行（`@deepseek-ai/dsh`），不需要克隆源码仓库。仓库根目录的
`dsh-version.json` 是唯一版本源；`scripts/dsh.mjs`、自定义 UI 客户端包和桌面打包都使用该版本。

## 目录结构

```
.dsh/             dsh 数据目录（DSH_HOME，已 gitignore，`npm run init` 重建）：profiles、会话、设置、上传批次
  profiles/       两个 profile：headless / web，各自声明要组合的 bundle
  skills/         symlink -> ../skills（DSH_HOME 级发现，任何工作区的会话都能加载）
  uploads/        所有模式共用的会话隔离上传批次（<session>/<batch>/）
  memory/         OKF 记忆库 bundle（knowledge/ + experience/），DSH_HOME 级共享
skills/           版本化的技能库；.dsh/skills 是指向它的 symlink
tool-upload/      所有模式共用的会话上传文件列表与读取工具
tool-memory/      OKF 记忆库：memoryBank 服务 + search/read/save/extract 四个记忆工具
service-git-repository/ 通用 gitRepository 服务：本地仓库、worktree、锁
page-memory/      记忆库管理页：底部菜单 + 两级页面（知识/经验）+ `/camind/api/memory`
ui-shell/         定制 Web 壳与 Host 桥：复用官方会话/侧栏，入口 /camind/
ui-workbench/     桌面/Web 共用模型工作台、临时向导和右侧资料
ui-compact-composer/ 工作台浮动紧凑输入，复用官方会话数据与提交
ui-model-viewer/  模型/NC 联合查看器：WebGL2 核心、工序导航、回放、源码、选面与可信工位对齐
ui-foundation/    Web UI 基础层：Camind 语义 token + 跨页面公共组件；仅 /camind 激活
ui-sidebar/       /camind 专用的官方 Sidebar 兼容实现，增加品牌与一级菜单 slot
ui-brand/         品牌插件：CAM 虎钳工匠 mascot + 字标，注册到 sidebar.brand.mark/name 席位
ui-home/          新会话首页定制（/）：Camind 品牌区 + 紧随其下的示例卡片，与官方输入卡合成一个整体居中组；示例经不可见的 inputActions 桥（conversation.input.dock）写官方草稿
docs/             项目专题文档（UI 架构、记忆库设计、dsh 升级）+ 指向上游官方文档的 README
docs/dsh-topology.svg  dsh 架构拓扑图
```

## 当前加工工作台

加工工作台已提升为“对话”“轨迹”同级的第一个会话标签，桌面与 Web 共享中央模型画布、右侧图标资料入口和当前 Agent 最新公开活动。模型选面可加入原生提问草稿，引用会核验文件和几何版本，点选不执行加工。原右栏工作台和 `/camind` 重复列已退下；下文较早的右栏布局说明不再代表当前入口。工作台无左侧零件/资料列，顶部只有一行文件标题；底部紧凑输入完全浮在模型画布上，聚焦展开、多行自适应。工作台内采用模型画布与右侧图标资料入口，接件审图确认作为分析后临时展开的过程，完成后关闭并回到正式模型；汇总勾选并整体核对后冻结加工要求，右侧仅只读展示该清单；审图完成与编程授权分别核验。DWG 为本地部分转换预览，不能代替精确核验。实现与验收见 [ui-workbench/README.md](ui-workbench/README.md)，完整目标见 [交互设计](docs/cam-workbench-interaction-design.md)。

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
- **ui-shell** — 定制 Web 壳与 Host 桥，复用官方 Sidebar、keyed `main` 和 rightbar；会话中不额外渲染一列旧 Workbench。`shell.content` 提供页面扩展，`shell.overlay` 提供全局浮层。默认 `/` 跳转到 `/camind/`，官方 Web 由 `/web` 访问；桌面使用官方壳，业务工作台通过下述插件共用。
- **ui-workbench** — 一级模型工作台：顶部合并标题、右侧图标资料栏、临时逐题向导与只读加工要求。文件嵌入主画布，公开回复和交付物读取官方会话投影，正式任务状态由 tool-cam 维护。
- **ui-compact-composer** — 仅适配官方编辑器的浮动紧凑布局，复用草稿、附件、引用和提交；响应时只显示当前轮次最新工具活动或公开回复，完整历史与控制保留在对话。
- **ui-model-viewer** — PRT/NC 统一 WebGL2 查看器。顶部「3D 模型」进入模型预览，右侧「加工记录」的「加工检查」进入工序驱动联合场景；支持工位分组、显隐、回放、源码定位、临时选面和应用内扩大视区，保留纯模型与纯NC入口。联合显示必须有源模型/几何/NC版本和真实工位矩阵；常规cam_run尚缺完整工位回读，缺证据时仍只显示独立NC。几何导出沿用独立副本五步、会话缓存与SHA256校验，未保存NX模型阻断。构建、自检与真实桌面验收见 [插件说明](ui-model-viewer/README.md)。
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

## 桌面端（官方桌面应用）

0.2.0 起上游官方提供桌面应用（本仓库不再维护自写 Electron 壳）。装好后用本项目入口启动，桌面端即加载全部 camind 插件与「CAM 加工」模式，数据（会话/记忆库/机床档案/CAM run）与 Web 端共享同一份 `.dsh/`：

```sh
# 首次：安装官方桌面应用（macOS arm64）
curl -LO https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg
# 打开 dmg 把「Deep Seek Harness」拖进 /Applications

sh ./scripts/desktop.sh   # 以本项目 .dsh 为 DSH_HOME 启动官方桌面应用
```

原理：官方桌面宿主读 `DSH_HOME` 环境变量，其受管 desktop profile 只在缺失时创建、不覆写已有内容；`npm run init` 在 `.dsh/profiles/desktop/` 预置与 web 完全一致的 bundle 组合。注意桌面窗口渲染的是烘焙进 App 的官方前端（`dsh-app://` 协议直出，不经 Host 路由），`/camind` 定制 SPA 属于浏览器路径；Camind 内容经官方席位呈现——记忆库（全局面板行）、工作台（一级模型画布、右侧资料、临时向导及紧凑输入）、NX 工作台（设置面板一节）、CAM 加工模式在桌面与 Web 官方壳均可用；`/camind` 壳的定制 SPA 页面只在浏览器 /camind 可用。

品牌化（桌面图标用 Camind mascot）：官方包是已签名/公证 bundle，macOS 对其施加 MACL 写保护，图标只能走「拷贝 + ad-hoc 重签」——`scripts/brand-desktop-app.sh` 一键完成（iconutil 全尺寸 .icns + icon.png + `CFBundleDisplayName`，重签并刷新注册），产出 `/Applications/Camind.app`，`scripts/desktop.sh` 优先启动它。官方桌面自动更新会整体替换官方 App，更新后重跑该脚本即可。图标规范：macOS `.icns` 带 16~1024 全尺寸（圆角蒙版由系统施加，源图满幅方形）；Windows 若做同等品牌化，需同名多尺寸 `.ico`（16/24/32/48/64/128/256 px，NSIS 安装包与任务栏读取）。

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

当前工作台阅读顺序与历史设计边界见 [文档索引](docs/README.md)；交互基线、手测和正式记录分别维护。

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
