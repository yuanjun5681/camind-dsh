# dsh 版本升级流程

dsh 处于 developer preview，迭代快、**不保证磁盘格式兼容**（旧版写入的会话日志等数据可能被新版拒绝打开）。本工作区有多处依赖同一个 dsh 版本，约定：**唯一需要人工修改的版本源是根目录 `dsh-version.json`**，其余位置由脚本同步或校验。

## 版本消费点

| 位置 | 消费方式 |
| --- | --- |
| `scripts/dsh.mjs` | 启动器：`npx -y @deepseek-ai/dsh@<version>` 运行本体，不随 npm `latest` 漂移 |
| `ui-shell/package.json` | devDependencies 里 4 个客户端包（`dsh-client-modules`、`dsh-client-ui-slots`、`dsh-client-ui-theme`、`dsh-client-web`）+ `package-lock.json`；vendor 源码的运行时依赖（katex/shiki/micromark 等）也在这里显式固定（0.1.1 起官方包不再传递它们） |
| `ui-shell/vendor/*` | 两份上游源码快照（ui-attachment、ui-primitives），各自 `package.json` 的 version 被校验 |
| `ui-sidebar/package.json` | `dshUpstream.version/tag/commit`（version 被校验）；`peerDependencies` 里的 `@deepseek-ai/*` 也钉着版本 |
| `ui-foundation/lib/client.js` | 官方 theme token 到 `--camind-*` 的映射，以及 Button/Input/Modal/Tooltip/图标 API |
| `desktop/scripts/prepare-vendor.mjs` | 打包时安装 `@deepseek-ai/dsh@<version>` 本体，开始前先跑 `--check` |

0.1.1 的上游结构变化（升级到此版本时的已知适配，供后续升级对照）：

- `dsh-client-web-react` 被删除（slot renderer 并入 `dsh-client-ui-renderer`，作为图内 fetch bundle 加载）；`dsh-client-web` 的静态表只剩平台单例（react/cordis/ui-slots/ui-primitives）。
- `ClientModuleSystem` 删除 `registerStatic`：本地替换模块（layout shim、定制 Sidebar、图外 app-shell 行）改为在建系统前压入 `window.__ModuleLoader__` 待处理队列（`ui-shell/src/web/officialClient.ts`）。
- `ui-attachment` 的包根变成 Host 存根：官方附件 UI 改由 fetch bundle 提供（自带样式，无需别名），ui-shell 自用的 `DropOverlay` 相对导入 vendor 源码；vite 只剩 ui-primitives 一个别名。
- `ui-theme` 的五张全局样式表改由官方 ui-theme 客户端插件激活时注入，ui-shell 不再静态引入。
- 官方前端的 fallback 只在 dist 根与 `/index.html` 提供入口（任意路径不再回退 SPA），ui-shell 注册了 exact `/web` 302 到 `/index.html`。
- 官方 Sidebar 新增 `sidebar.brand.mark` / `sidebar.brand.name` 席位，且图内新增 `ui-brand-official` 行（priority 0）：camind-ui-brand 以 priority -10 注册压过它（single 席位同优先级重复注册会 throw，低优先级渲染）。

不需要动的部分：profile 里的内置 bundle（`@deepseek-ai/dsh-base` 等）始终从正在运行的 dsh 安装自身解析，随 dsh 一起升级；`link:` 挂载的本工作区插件与 dsh 版本解耦。

## 工具脚本

- `scripts/dsh-version.mjs`：读取并校验 `dsh-version.json`（semver 格式检查），导出客户端包清单，是所有脚本的公共版本源。
- `npm run sync:dsh-version`：把 ui-shell 的 4 个客户端包改到目标版本并重算 lock（`npm install --package-lock-only --ignore-scripts`），结束后自校验。
- `npm run check:dsh-version`：只校验不修改。覆盖 ui-shell 的 package.json / lock 根依赖 / lock 实装版本、两份 vendor 快照的 version、ui-sidebar 的 `dshUpstream.version`。

## 升级步骤

1. 修改根目录 `dsh-version.json` 的 `version`。
2. `npm run sync:dsh-version`，同步 ui-shell 客户端包。
3. **手动更新两份 vendor 源码快照**：从上游仓库对应 tag（`deepseek-ai/deepseek-harness`，tag 形如 `dsh-v<version>`）复制 `packages/client/ui-attachment/src` 与 `packages/client/ui-primitives/src`，更新各自 `package.json` 的 version 和 README 里的 tag/commit。
4. **手动更新 ui-sidebar**：同步上游 `packages/client/ui-sidebar` 源码，重放 `sidebar.footer.action` owner props 扩展与账号页脚行（含 `.footerActions` 纵向排列）两处本地改动（基线与做法见 `ui-sidebar/README.md`；品牌席位 0.1.1 起上游原生，无需再重放），更新 `dshUpstream` 的 version/tag/commit、README 的「上游基线」，以及 `peerDependencies` 里钉死的 `@deepseek-ai/*` 版本。
5. `npm run check:dsh-version`，应全部通过。
6. 复核 `ui-foundation/lib/client.js`：官方 `--dsw-*` token 与 Button/Input/Modal/Tooltip/图标 API 仍然有效；动态插件的 `dsh.client.external` 无缺失 provider 或环。
7. `cd ui-shell && npm install && npm run build`，重建前端。
8. 需要桌面打包时 `cd desktop && npm run dist`（prepare-vendor 会先跑 `--check`，不一致直接失败）。
9. 冒烟：`node scripts/dsh.mjs --profile headless --dump-config` 确认组合配置正常，再开 `http://127.0.0.1:3080/camind/` 验证自定义前端。
10. 把本次升级过程记录到 `docs/upgrades/<目标版本>.md`：版本起止与 tag/commit → 上游 breaking changes → 本地适配点（带文件路径）→ 验证结果 → 遗留事项；先翻上一份记录对照哪些适配已做过。

## 注意

- 版本不一致时，ui-shell 的 `prebuild`/`predev` 和 desktop 的 prepare-vendor 都会拒绝继续——这是设计行为，按上面步骤补齐即可，不要绕过。
- vendor 快照与 ui-sidebar 是**人工维护**的上游源码复制，sync 脚本只校验不更新；升级漏了这两处会在 check 阶段报出来。
- `/camind` 冒烟必须覆盖 light/dark/system、键盘焦点、Dialog Escape、360px 窄屏，并确认官方 `/web` 没有 `data-camind-ui` 和 `.cui-*` 样式。详细矩阵见 `docs/ui-design-standards.md`。
- ui-home 用结构选择器 CSS 隐藏官方 HeroShell（锚点 `[data-phase="hero"]`/`[data-composer-seat]`/`[data-chain-overlay-fallback]`，见 `ui-home/lib/client.js` 头注释）。升级后冒烟时确认新会话页 `/` 不再出现官方鱼标/「探索未至之境」/预览徽章；官方 hero 的 DOM 结构若变，需同步该选择器。
- ui-home 另有一条 hero 阶段 `[data-conversation-scroll]` 的 `overflow: visible` 覆盖：官方斜杠菜单/popupSelect 从 composer 向上展开（底部锚定 absolute，最高 320px），首页布局里 hero 滚动容器只有 composer 栈那么高，`overflow-y: auto` 会把弹层剪到只剩一行。升级后冒烟时在 `/` 输入 `/` 确认命令列表完整浮在示例卡片上方；官方若改弹层定位或滚动容器结构，需复核该规则。
- 「预览」标签页（camind-ui-preview 插件，注册进官方 `conversation.view` id=preview）的切页动作走官方未公开内部面：`slots.hostFace().storeOf(chat 视图 entry, sessionId).actions.setView('preview')`（`ui-preview/lib/client.js`，防御式降级——失效时不切页但 tab 仍在）。升级后冒烟时点一次「预览」确认自动切到「预览」标签；若官方公开了切页 API 或 chatStore 结构变了，同步该处。另有一条同文件内的结构选择器 `[data-phase]:has(.campv-view) [data-composer-seat]`（预览 tab 激活时隐藏底部 composer 输入组件）：官方 conversation 根/composer 的 DOM 结构或 data 锚点若变，需复核该规则。
- 升级不要重跑 `npm run init`：init 只负责新检出的环境重建（profile、skills symlink、ui-shell 构建），版本变化按上面步骤执行；完成后日常运行仍是 `node scripts/dsh.mjs web`。
- 升级后先用 `--dump-config` 快速验证组合，再考虑重建 `.dsh/` 数据（磁盘格式可能不兼容）。
