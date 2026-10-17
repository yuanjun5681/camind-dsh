# 2D/3D 图纸查看与交互迁移开发任务计划

> 来源：`docs/viewer-2d3d-migration-design.md` v0.3。
> 本计划只把设计转为可执行任务，不扩大或缩减设计范围；冲突时以设计文档为准。
> 工作分支：`feature/viewer-2d3d-migration`。
> 涉及仓库：camind-dsh、Camind-desktop、CAM-Agent。

## 当前执行状态与后续任务（2026-10-18）

M1-01～M1-03 与 M6 已完成；M1-04 的离线自检、构建复现和 Codex 审核已完成，真实桌面冒烟尚未执行。不得将 M1 描述为全部完成。

| 任务 | 当前状态 | 后续动作与解锁条件 |
|---|---|---|
| **M1-04-live：`dsh-app://` 合成图冒烟** | **DOING（环境延后）** | 安装或提供 Camind/DeepSeek Harness 桌面环境后，先运行 `scripts/desktop.sh --remote-debugging-port=9236`，再运行 `DESKTOP_REPO=/private/tmp/camind-desktop-viewer-2d3d CAM_AGENT_REPO=/Users/yj/Desktop/CAM-Agent node ui-drawing-viewer/acceptance-desktop.mjs`。验收通过并提交 Codex 审核后，M1 才能闭合 |
| M2～M5 | 未启动 | M1-04-live 通过后按 M2 → M3 → M4 → M5 顺序启动；不得以离线结果替代桌面验收 |

## 1. 所有任务强制执行的通用规则

以下规则适用于本计划中的每一个任务，包括代码、测试、构建、文档、审计和条件退役任务；任何开发者、任何仓库、任何并行工作流均不得例外。

### 1.1 固定开发范式

每个任务必须严格按以下闭环执行：

1. **确认任务边界**：阅读本计划、设计文档及目标仓库的 AGENTS.md/README；只修改本任务负责的交付物，不带入无关改动。
2. **使用工作分支**：与本设计有关的提交不得直接落在 `main`。本仓库统一使用 `feature/viewer-2d3d-migration`；Camind-desktop 与 CAM-Agent 在各自改动前也须从适当基线建立同名或明确对应的功能分支。
3. **实现并自验**：完成本任务交付物，运行表中列出的测试、静态检查、自检或手动验收，保存真实结果。测试未过不得送审。
4. **提交 Codex 审核**：任务实现完成后，必须调用本地 `codex review`，审核范围必须覆盖该任务的完整差异，而非只审查最后一处修补。
5. **逐条处理意见**：收到意见后必须逐条修正或改动，并重跑受影响的验证。不得静默忽略；确有证据表明意见不适用时，必须记录理由并由用户确认处理方向。
6. **Codex 复审**：修正后必须再次提交 Codex 审核，且复审范围仍覆盖任务完整差异。持续“修正 → 验证 → 复审”，直到没有未处理的审核意见。
7. **记录并完成任务**：记录任务提交、验证结果、Codex 审核轮次、意见处理与最终结论。只有实现、验证、审核、修正、复审全部闭合，任务才可标记为完成。
8. **提交与推送**：任务相关提交只进入对应功能分支；推送时创建同名远程新分支，不直接推送或覆盖主分支。未经用户要求不执行远程推送。

可用命令（按任务是否已提交选择其一）：

```sh
# 审核当前任务的完整未提交差异；执行前须隔离其他任务的未提交改动
codex review --uncommitted

# 审核已独立提交的任务
codex review --commit <TASK_COMMIT>

# 任务跨多笔提交时，从任务前基线分支审核完整差异
codex review --base <TASK_BASE_BRANCH>
```

注意：本机 codex-cli 0.163.0 不允许把 `--uncommitted` / `--commit` / `--base` 与自定义 prompt 同时使用，因此不要在上述命令后追加审核说明文字；审核范围由分支、提交与工作区隔离保证。

修正后必须再次调用 Codex。若修正分布在多个提交中，最终复审必须覆盖整个任务差异，不能只运行最后一个修正提交的审查。

### 1.2 不可跳过的横向要求

- M0 是无例外的硬门槛；三方 packcheck 差分测试未全绿，不得进入 M1。
- 适配层永远不得访问 DraftPane 私有成员，也不得在本地自绘应由上游核心实现的功能。上游暂不收接口扩展时，唯一允许路径是维护一个具备同一公共接口 v2 与测试的上游分支再镜像；禁止“暂存适配层”例外。
- M1 起，每个涉及运行行为的任务都要执行对应的 `dsh-app://` 桌面纵向冒烟，不得全部拖延到 M5。
- DWG/DXF 的远程 provider 只能显式配置启用；本地 CLI 缺失时不得静默上传。
- dwg2dxf 始终是用户自装的外部 CLI，不进入安装包，不破坏 GPL 隔离。
- I1–I9 通过不代表图纸完整、尺寸正确或已经审图；代码、日志、UI 与文档均不得过度宣称。
- 每个任务的提交只包含该任务文件。仓库中任务开始前已有的改动不得混入；若确需纳入，先由用户确认归属。

## 2. 执行角色与总依赖

建议按以下角色分配；角色是工作流标识，不要求一定由不同人员担任。

| 角色 | 主要责任 |
|---|---|
| D：Desktop/TS | DraftPane 公共接口、交互、WebGL 恢复、TS packcheck、上游镜像源 |
| J：Converter/JS | JS converter、DXF worker、转换身份、JS packcheck |
| P：CAM-Agent/Python | Python packcheck 与正本测试 |
| H：Host/Node | drawingPreview、缓存、作业治理、安全路由、引用核验 |
| U：UI/React/TS | ui-preview、ui-workbench、适配层、皮肤与原生草稿引用 |
| Q：验收/审计 | 三方差分、行为验收、性能与生命周期、三壳矩阵、3D 漂移审计 |

总依赖保持 `M0 → M1 → M2 → M3 → M4 → M5`。只有表内明确列出的任务可跨工作流并行；M6 从 M2 阶段起并行。每个里程碑除单项验收外，还必须通过里程碑出口检查。

## 3. 开发任务计划表

### M0：上游接口与三方契约守门

| ID | 仓库 / 角色 | 具体开发与交付物 | 验收标准 | 依赖 / 并行 |
|---|---|---|---|---|
| M0-01 | Camind-desktop / D | 定义 DraftPane `messageVersion: 2` 公共契约及类型：新增 `zoomToRect`、`locateTarget`、`setSelection`、`clearSelection`、`getCamera`、`setCamera`、`setViewportInsets`；`load` 增加 `provenance`；出向增加 `selectionChanged`，`loaded` 带 pack 指纹与降级标记；保留旧消息兼容；同步消息表文档 | vitest 覆盖 v2 入向/出向、旧消息兼容、非法参数；公共类型与文档一致 | 无前置；与 M0-04/05/06/07 准备并行 |
| M0-02 | Camind-desktop / D | 实现接口对应行为：搜索定位与实体组高亮、选择设置/清除/恢复、相机读写、框选放大、Composer 视区 insets；补齐双击 fit，并明确区分拖动与点击 | vitest/交互测试覆盖定位、高亮、选择恢复、相机往返、insets、zoomToRect、双击与拖动；不得经私有成员绕过接口 | M0-01；与 M0-03 可并行但须错开冲突文件 |
| M0-03 | Camind-desktop / D | 补齐 2D WebGL 上下文丢失与恢复链，恢复后保留应有图纸、相机和选择状态，释放失效 GPU 资源 | 自动化触发 context lost/restored；恢复结果及 dispose 资源断言通过 | M0-01；与 M0-02 可并行 |
| M0-04 | Camind-desktop / D | 修复 TS `packcheck.ts` 的 `geometryPoints()` 数组处理，使圆/圆弧几何进入 bbox 校验；加入“半径 10、bbox 全 0”反例 | writer/reader 相关路径均返回标准化 `DRAFT_E_BBOX`；既有好包不回归 | 无前置；与 M0-01/05/06 并行 |
| M0-05 | camind-dsh / J | 在 service-draft-converter 补齐与 TS 一致的 dims 载荷校验，包括畸形 `def_points`、字符串 `dimlfac`；不得放宽校验来迁就转换差异 | JS writer/reader 双档拒绝畸形 dims，错误码标准化；converter 自检通过 | 无前置；与 M0-01/04/06 并行 |
| M0-06 | CAM-Agent / P | 在 Python 正本补齐 dims 载荷校验，覆盖 writer/reader 两档；加入同一畸形 dims 反例 | Python writer/reader 均拒绝畸形 dims；原有好包与既有测试通过 | 无前置；与 M0-01/04/05 并行 |
| M0-07 | 三仓 / Q，D/J/P 配合 | 建立 Python/JS/TS 三方差分基线：同一批好包/坏包、writer/reader 双档、标准化错误码比较；纳入两组已知反例；形成可重复运行入口 | 三仓差分结果全绿；两组反例均入基线；记录实际命令与结果 | 用例与协议准备可与 M0-04/05/06 并行；最终完成依赖 M0-04/05/06 |

**M0 出口**：M0-01～07 全部完成并分别通过 Codex 闭环；DraftPane v2 可用；三方 writer/reader 差分全绿。未满足时禁止开始 M1 镜像。

### M1：ui-drawing-viewer 骨架、核心镜像与桌面纵向链路

| ID | 仓库 / 角色 | 具体开发与交付物 | 验收标准 | 依赖 / 并行 |
|---|---|---|---|---|
| M1-01 | camind-dsh / U | 新建 `ui-drawing-viewer/`（`camind-ui-drawing-viewer`）：package/cordis 声明、TS src、复用 ui-shell esbuild 的 build.mjs、入库 `lib/client.js`；按 ui-model-viewer 先例配置 web + desktop profile，headless 不挂 UI；同步必要的 AGENTS.md/README 插件清单 | 钉版工具链可重现构建；`--dump-config` 仅 web/desktop 出现插件；包名与模块 ID 一致 | M0 出口 |
| M1-02 | camind-dsh / D→U | 从通过 M0 的上游固定 commit 镜像 `packages/viewer/src/draft/`；记录来源 commit、同步日期、来源文件映射、本地补丁清单及每项补丁对应测试；本地补丁仅限宿主适配，不改核心绕开上游 | 镜像来源可追溯；无未记录核心分叉；构建产物可从固定来源重现 | M1-01 |
| M1-03 | camind-dsh / U | ui-preview 声明 keyed `cam.drawing.preview`，新插件注册渲染条目；建立 `owner props { descriptor, onReference? } ↔ 消息接口 v2` 适配层；接入镜像 packcheck reader 档；descriptor 不再使用裸 JSON 文本充当契约 | 合成 descriptor 可加载；非法 pack 被 reader 门禁拒绝；props/消息有类型与测试；适配层无私有成员访问 | M1-02 |
| M1-04 | camind-dsh / Q+U | 新建 `ui-drawing-viewer/selfcheck.mjs`：converter 合成包 → packcheck writer → loader/pick/camera 断言 → 三方差分基例回放；延续 `DRAFT_GOLDEN_DWG` + `DRAFT_GOLDEN_PY` 黄金对照纪律；完成桌面纵向冒烟 | selfcheck 常开部分全绿；敏感图纸不入库；`dsh-app://` 完成插件图加载、取合成包、渲染；`--dump-config` 正确 | M1-03 |

**M1 出口**：独立插件可构建、可加载、可渲染合成图，核心来源与补丁均可追溯，桌面链路已打通。

### M2：Host drawingPreview、转换治理、缓存与引用核验

本节路由中的 `...` 均指 `/camind/api/drawings/sessions/<sid>`；完整路径与 HTTP 方法以设计文档 §4 为准。

| ID | 仓库 / 角色 | 具体开发与交付物 | 验收标准 | 依赖 / 并行 |
|---|---|---|---|---|
| M2-01 | camind-dsh / J+H | 在 converter README 建立唯一权威身份规范：六项 `source_sha256 + pipeline_version + origin.channel + conversion 身份 + rules_version + view_rule_version` 的字段顺序、编码、空值处理和哈希算法；`pack.identity = sha256(规范化六项身份)`；conversion 项使用综合转换指纹；`conversion.commit` 改为真实 converter 发布版本用于展示溯源；综合指纹包含 converter 代码版本、dwg2dxf CLI 版本及影响输出的选项 | 固定测试向量跨调用结果一致；改变任一身份项会改变缓存键；不再只以源 SHA 或包版本标识转换 | M1 出口；与 M2-02/03、M6-01 并行 |
| M2-02 | camind-dsh / H | 基于注入的 `previewFiles` 实现授权引用解析与稳定源快照：覆盖工作区、上传批次、官方附件、本地引用、`task-input://`；任务域只读冻结 `task.inputs.dwg.uri`；先快照再算 SHA 再转换；明确 DXF 载体/编码并拒绝未知输入 | 各来源正例通过；跨会话、越权、任务原路径改解析均失败；转换期间替换原路径不影响快照；不支持载体/编码有明确中文错误 | M1 出口；与 M2-01/03 并行 |
| M2-03 | camind-dsh / J | 将同步 `convertDxf` 迁入 worker/子进程；DWG/DXF 统一支持真实取消和超时终止（terminate/kill）；落实内存预算与进程退出后的资源回收 | 大 DXF 不阻塞 Host 事件循环；取消/超时后执行实体确实消失；压力测试无遗留 worker/子进程；converter 自检通过 | M1 出口；与 M2-01/02 并行 |
| M2-04 | camind-dsh / H | 实现可替换 provider 的作业语义与本地 provider：启动 202 + jobId、状态/进度、读取、取消、重试、过期请求隔离；全局与会话级有界队列、排队和内存预算；建立工具缺失/超时/超限/坏包/源件改变/转换不完整错误分类与中文文案 | 并发上限、排队、重试、取消、过期隔离有自动化验证；队列不会导致越权或串会话；远程模式只能显式启用 | M2-02、M2-03；接口骨架可提前并行 |
| M2-05 | camind-dsh / H | 实现 `$DSH_HOME/draft-previews/<session>/` 缓存：六项身份键、packcheck 后 tmp+rename、字节数与独立 pack SHA sidecar、命中完整性检查、容量上限 + LRU、会话删除清理、损坏重建、同键单飞、当前引用显示名；命中仍重新 `previewFiles.resolve()`；realpath 防 symlink 逃逸 | 原子写入、LRU、清理、损坏重建、单飞均有测试；缓存命中仍执行授权；异名同字节不错用显示名；symlink 越界拒绝 | M2-01、M2-02 |
| M2-06 | camind-dsh / H | 半注册 pack 作业路由并统一经过 `connection.requestRejection`：`POST .../packs`、`GET .../status`、`GET .../packs/<key>`、`POST .../cancel`；就绪包带 `X-Pack-SHA256`、`Cache-Control: no-store`；GET 命中保持快速；日志脱敏 | curl 正/负例覆盖未授权连接、会话边界、取消与读取；SHA 头只声明字节一致；无敏感日志；桌面取包冒烟通过 | M2-04、M2-05 |
| M2-07 | camind-dsh / H | 实现 DrawingReference v1 与 `POST .../refs/verify`：强制核验会话授权、源 SHA、pack SHA/转换身份、dim/entity 目标存在性；descriptor 明确来源与缺失信息；无可信来源的内容模式不得签发可发送引用 | 合法 dim/entity 通过；错误会话、源 SHA、pack 身份、不存在目标均拒绝；核验通过是引用签发必经路径 | M2-02、M2-05；与 M2-06 可并行，集成时统一门禁 |
| M2-08 | camind-dsh / H+Q | 完成 M2 集成测试与验收脚本：作业全流程、并发单飞、缓存完整性、越界/授权负例、真实取消、中文错误分类、桌面取包；验证交付/归档需显式导出快照而非依赖派生缓存 | 所有正负例可重复执行且通过；缓存不污染会话工作区；`dsh-app://` 取包与渲染链路通过 | M2-04～07 |

**M2 出口**：本地转换、缓存、作业、路由和引用核验形成安全闭环；不能只用单元测试代替路由与桌面验收。

### M3：通用 DWG/DXF 预览与 DrawingReference 落地

| ID | 仓库 / 角色 | 具体开发与交付物 | 验收标准 | 依赖 / 并行 |
|---|---|---|---|---|
| M3-01 | camind-dsh / U | ui-preview 增加 `.dwg`/`.dxf` 分发到 `cam.drawing.preview`；接入启动作业、轮询、就绪包、取消和 descriptor；WebGL 不可用显示明确原因及下载/外部打开入口，且与转换失败分态 | 任意已授权 DWG/DXF 不依赖任务域即可打开；加载/失败/取消/WebGL 不可用状态明确；普通文件预览不回归 | M2 出口 |
| M3-02 | camind-dsh / U | 通用预览接通 DrawingReference：查看器选择经 `onReference` 透出，写入可发送草稿前必须调用 `/refs/verify`；经 inputTriggers codec 插入原生引用；内容模式只允许查看，不出现可发送引用 | 合法引用可进入原生草稿；核验失败不能发送；内容模式无可发送引用；引用包含 session/source/pack/target 完整契约 | M3-01；与 M3-03/04/05 可并行后集成 |
| M3-03 | camind-dsh / U+Q | 建立 2D 功能迁移验收：WebGL2 线段 + Canvas2D 文字、256 列 R8 stipple LUT（像素周期 clamp [4,16]）、line/circle/arc/polyline（凸度）/point/hatch/solid/text/mtext/leader/mleader/tolerance、ACI/真彩、图层显隐、64×64 CSR 拾取与标注文字优先、dims `display_text`/measured 比对标红与公差文案、出身徽标与手动改判、每帧抽稀/文字预算和可见降级徽标 | Web 上传 DWG/DXF 后逐项目检与自动断言通过；未知类型跳过、抽稀、文字截断均可见；不得把概览宣称为完整审图 | M3-01 |
| M3-04 | camind-dsh / Q+U | 自动化生命周期与错误态：A 请求晚于 B 返回不覆盖 B；切会话清理旧对象/相机/引用；B 加载失败不把保留 A 错标为 B，适配层先清场再 load；React 重挂载、隐藏视区、零尺寸、DPR、pointercancel、context lost、dispose | 全部场景有确定断言；监听器、观察器、GPU 资源、请求订阅无泄漏；桌面纵向冒烟通过 | M3-01；与 M3-02/03/05 并行 |
| M3-05 | camind-dsh / Q | 建立性能基线与预算测试：实体数、展开段数、字符串、线型、空间索引规模上限；首次可交互时间、峰值内存、交互帧时 p95；验证 6000 段/240 字仅限制绘制而非全量数据与索引 | 输出可复现的性能报告和阈值；超限触发可见降级；搜索目标仍能明确高亮；无敏感图纸入库 | M3-01；与 M3-02/03/04 并行 |

**M3 出口**：通用预览、原生可核验引用、迁移功能、生命周期和性能基线全部通过。

### M4：工作台切换与既有引用链适配

| ID | 仓库 / 角色 | 具体开发与交付物 | 验收标准 | 依赖 / 并行 |
|---|---|---|---|---|
| M4-00 | camind-dsh / Q+U | 在改代码前冻结 DwgPane 功能对等清单：平移、锚点缩放、框选放大、搜索侧栏、点击图元提问 chip、引用替换、发送快照、任务授权、版本绑定、换版失效，以及新渲染器既有功能；逐项映射新实现和验收用例 | 清单经评审冻结；每项都有 owner、实现位置和验收编号；后续不得为通过切换而删减旧能力 | M3 出口；是 M4 其余任务前置 |
| M4-01 | camind-dsh / U | ui-workbench drawing 槽改嵌新席位；任务数据源切换 drawingPreview，并只使用冻结 `task-input://` URI；接入作业状态、描述符和错误态 | 任务域画布由新查看器渲染；不重解析用户原始路径；普通对话与其他画布槽不回归 | M4-00；与 M4-03 并行 |
| M4-02 | camind-dsh / U | 将搜索侧栏、定位、高亮、选择恢复、提问 chip 迁入适配层，经 v2 `locateTarget`/`setSelection`/`clearSelection` 等公共接口实现；Composer 避让使用 viewport insets | 搜索命中明确高亮；选择、相机与引用状态一致；不访问查看器私有成员，不自绘核心高亮 | M4-01 |
| M4-03 | camind-dsh / H+U | 适配 tool-cam 既有任务校验器：DrawingReference 展开为既有 `session_id + ids` 入参；preview 指纹由“SVG + targets”切换为“pack SHA + 转换身份”；保留源 DWG SHA、会话和目标存在性核验 | 新旧输入边界有测试；换 pack/转换身份后旧引用失效；未经 `/refs/verify` 的引用不能进入任务输入或可发送草稿 | M4-00；与 M4-01 并行 |
| M4-04 | camind-dsh / U | 完成工作台原生草稿、引用替换、发送快照和任务授权整合；跨查看器协调由工作台承担，查看器只负责选择与展示 | 引用核验链端到端通过；替换、发送、换版、会话切换均无陈旧引用；内容模式仍不可签发引用 | M4-02、M4-03 |
| M4-05 | camind-dsh / Q+U | 更新既有 `acceptance-*.mjs`：保留行为断言，替换 SVG DOM 细节断言；逐项执行冻结的对等清单和桌面任务域验收 | 对等清单全项通过；既有行为不回归；不得为保留旧 DOM 断言而阻碍新实现 | M4-04 |

**M4 出口**：功能对等清单逐项验收通过，任务域与通用域引用都经过服务端核验，方可进入 M5 默认切换。

### M5：默认切换、回滚、皮肤与最终三壳验收

| ID | 仓库 / 角色 | 具体开发与交付物 | 验收标准 | 依赖 / 并行 |
|---|---|---|---|---|
| M5-01 | camind-dsh / U | 工作台默认渲染器切换为新查看器；旧 DwgPane 仅通过明确配置项作为回滚开关保留一个版本周期；记录启用方式、回滚方式和回滚事件 | 默认路径不渲染旧 DwgPane；配置可回滚且行为可用；回滚开关不影响新引用核验纪律 | M4 出口；与 M5-02 并行 |
| M5-02 | camind-dsh / U | 完成查看器 token 皮肤：内联样式改 `--camind-*` / `--dsw-alias-*`，类名统一 `.cdv-`；确保官方壳存在 `--dsw-alias-*` 回退 | 设计规范 §5/§7 对照通过；三主题/壳无不可读状态；无未前缀化全局样式污染 | M4 出口；与 M5-01 并行 |
| M5-03 | camind-dsh / Q+U+H | 执行 `/camind`、官方 `/web`、`dsh-app://` 三壳验收：插件加载、API 请求、取包、原生引用、取消、token 回退；检查独立插件的实际加载成本 | 三壳矩阵全部有真实结果；原生引用在三壳均经核验；无仅在浏览器裸路径成立的假设 | M5-01、M5-02 |
| M5-04 | camind-dsh / Q | 运行最终回归：三方 packcheck 差分、selfcheck、黄金对照（具备本地条件时）、生命周期、性能、安全负例、桌面纵向链路、GPL 与文案纪律 | 所有强制项通过；黄金对照缺少本地敏感条件时明确标为未执行而非伪造通过；性能/降级结论有证据 | M5-03 |
| M5-05 | camind-dsh / U | **条件任务，不在本期直接执行**：回滚周期持续一个版本且期间无回滚事件后，删除旧 DwgPane 及其重复交互/搜索/引用状态机；如仅需 WebGL 不可用内联查看，另建共用同一 pack 的轻量只读 SVG 降级，不复用旧实现 | 先取得周期与无回滚事件证据并经用户确认；删除后全量行为与三壳验收通过；本任务同样执行 Codex 闭环 | M5-04 + 一个版本周期 + 用户确认 |

**M5 本期出口**：完成“停止默认使用 + 保留回滚”，不是立即删除旧代码。M5-05 是独立的未来条件任务。

### M6：3D 三方漂移审计与同步纪律（从 M2 起并行）

| ID | 仓库 / 角色 | 具体开发与交付物 | 验收标准 | 依赖 / 并行 |
|---|---|---|---|---|
| M6-01 | Camind-desktop + camind-dsh / Q+D | 以 `320dd531` 为共同基线完成三方审计：desktop 体显隐/选择过滤等上游变化、dsh 事件释放/pointercancel/播放区间/拾取模式等本地变化、冲突项；逐项作出同步、保留分叉或回上游决策；记录 NC parser 等已核对项证据 | 审计表覆盖源文件、两侧 commit/差异、冲突、决策、理由和对应测试；不将“已迁移”误写为“功能等价” | M1 出口后可准备，最迟与 M2 并行；不阻塞 M2 |
| M6-02 | camind-dsh / Q+D | 更新 ui-model-viewer README 与同步规程：持续维护补丁清单，每项含分叉理由、对应测试、来源文件映射、同步日期和钉版构建方法；将 2D/3D 已知缺口汇总到后续提案输入 | 审计清单评审通过；README 能据以重现每处分叉及验证；本期不擅自扩展 3D 功能实现 | M6-01；与 M2～M5 并行，最终随 M5 总验收 |

**M6 出口**：审计与纪律落档完成。本期 3D 不新增 CAM-Agent 接口，也不要求把体显隐等所有上游能力立即同步实现。

## 4. 推荐并行执行批次

| 批次 | 可并行工作流 | 汇合点 / 限制 |
|---|---|---|
| P0 | D：M0-01 → M0-02/03；D：M0-04；J：M0-05；P：M0-06；Q：准备 M0-07 用例与协议 | M0-07 必须等三向修复完成；M0 全绿前不得启动 M1 |
| P1 | M1-01 → M1-02 → M1-03 → M1-04 主链；Q 可提前准备 M2/M3 性能与安全夹具 | 主链有构建依赖，不为并行而拆分同一文件造成冲突 |
| P2 | J+H：M2-01；H：M2-02；J：M2-03；Q+D：M6-01 | M2-04 等 02/03，M2-05 等 01/02；接口可先约定再并行实现 |
| P3 | H：M2-04 与 M2-05 可在依赖满足后并行；随后 M2-06 与 M2-07 并行；Q+D：M6-02 | M2-08 等全部 Host 工作流汇合；桌面取包不可省略 |
| P4 | U：M3-01 后，M3-02（引用）、M3-03（功能）、Q+U：M3-04（生命周期）、Q：M3-05（性能）并行 | 共用文件先约定接口；M3 出口等四项全部通过 |
| P5 | M4-00 冻结后，U：M4-01 → M4-02 与 H+U：M4-03 并行 | M4-04 等两条链汇合；M4-05 最后执行完整对等验收 |
| P6 | U：M5-01 与 M5-02 并行；Q+D：M6-02 可继续并行 | M5-03 等默认切换和皮肤完成；M5-04 是最终汇合点 |
| P7 | M5-05 只能独立在未来条件满足后启动 | 不与本期“保留回滚”同时执行，不得提前删除旧 DwgPane |

建议最多同时推进的工作流：M0 阶段 4～5 条，M2 阶段 3～4 条，M3 阶段 4 条。每条工作流独立提交、独立调用 Codex，避免多个任务共享一大团未提交差异导致审核范围失真。

## 5. 里程碑总验收清单

- **契约**：Python/JS/TS writer/reader 双档差分全绿，两组反例常驻基线。
- **引用**：所有进入模型的任务域与通用 DWG/DXF 引用均经服务端 `/refs/verify`；内容模式只读。
- **缓存**：六项身份、真实转换指纹、原子写入、完整性、LRU、清理、单飞、命中重授权全部有效。
- **作业**：DWG/DXF 均有执行隔离、有界并发、真实取消/超时、过期隔离和明确中文错误。
- **安全**：全部新路由过 `connection.requestRejection`，文件边界复用 `previewFiles`，无 symlink 逃逸和敏感日志。
- **功能**：上游 2D 迁移面与 DwgPane 对等清单逐项验收，降级和缺失信息可见。
- **稳定性**：生命周期、资源释放、坏包保留旧图的适配语义、A/B 竞态与会话切换全部有自动化覆盖。
- **性能**：规模上限、首次可交互、峰值内存、帧时 p95 有基线；概览不得冒充完整审图。
- **三壳**：`/camind`、官方 `/web`、`dsh-app://` 均通过 API、引用和皮肤验收。
- **3D 纪律**：三方审计和补丁清单完成，无双向漂移失管。
- **流程**：每个任务都有实现证据、验证结果、Codex 审核与修正复审记录；缺任一项不算完成。

## 6. 明确不在本期开发范围内

以下仅作为后续提案输入，不得夹带进本期任务：CAM-Agent 图纸包生产服务化、视图推断、2D↔3D 对象级映射、FID 精确几何查询、持久边 ID、装配、常规 cam_run 完整工位矩阵；端侧 2D 测量、批注、多页布局、3D X-ray 透视拾取。远程转换本期只要求可替换 provider 作业语义与显式配置边界，不实现新的生产远程服务。
