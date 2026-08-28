# CAM 加工场景设计（camind-tool-cam + camind-service-machine + cam-machining skill）

> 状态：设计稿（未实现；2026-08-22 依据 dsh 0.1.0-rc.7 官方机制与本工作区现状成文；同日执行层方案由「复用 Camindbase CLI」改为「直连 CAM-Agent proxy HTTP 协议」，见 §1.2）
> 范围：CAM 编程交付场景端到端（读件 → 声明问齐 → 排工艺 → NX 远程执行 → 机器自检 → 人工签字 → 交付 → 经验沉淀）；**不含报价场景**（另行设计）、不含机床管理页面、不含范本库独立插件（被经验库扩展吸收）
> 执行层前提：NX 远程执行**直连 Windows 侧 CAM-Agent proxy 的 HTTP 协议**（全部端点 POST、统一信封、`/submit`+`/poll` 长任务、sha256 传输校验），协议契约由旧 Camind 项目 `backend/app/services/nx/client.py`（NxClient）生产验证，本设计在插件内用 Node.js 移植等价客户端；断点续跑、op 终态、完整性护栏等确定性执行语义按旧 Camind `flows/cam_job` + `services/cam` 的现成语义在插件内实现最小集合，不发明新机制

## 1. 第一性原理：dsh 里没有"流程引擎"，也不需要

原 Camind 项目以自研 workflow 引擎（Task/Flow/Node DSL）驱动业务流程。迁移到 dsh 后不搬引擎，原因是两层：

1. **dsh 的 agent loop 本身就是编排机**。每个回合模型看现状 → 选工具 → 看结果 → 再决定，这正是原项目"host 会话主 Agent"的角色；原项目的红线"确定性工作流当 worker，动态性收敛在闭集决策点"在 dsh 里变成原生形态：**动态判断（问人、查经验、拍板）归对话，确定执行（读件、排工艺、算刀路、检查、打包）收进少数几个粗粒度、带代码闸门的工具**。
2. **原流程里每一步的确定性语义已有归宿**：确认卡在 `ask_user_question`；人工批准在 dsh 的 approval 缝；进度观测在 session 事件流；proxy 协议、submit+poll 纪律、断点续跑、机器自检在旧 Camind 里有生产验证过的完整实现（`services/nx` + `services/cam` + `flows/cam_job`），逐条移植进插件，不重写语义。"流程图"降级为 SKILL 里的操作规程文字，模型照着走、闸门关着，走不错。

### 1.1 dsh 原生机制映射表

| 流程需求 | 原 Camind 实现 | dsh 机制 | 落位 |
|---|---|---|---|
| 意图理解、流程推进 | host 主 Agent + Flow 派发 | agent loop 本体 + skill 规程 | `cam-machining` skill |
| 确认卡（候选孔预填勾选） | InteractionCard schema 表单 | `ask_user_question` 工具（`dsh-tool-ask-user`）：options/multiSelect/custom，推荐项置首标 `(Recommended)`，`plan-review` intent | 模型直接调，零开发 |
| 人工签字放行 | HumanNode park/resume | approval 缝（`dsh-user-approval`）：`tools/pre-execute` 返回 `{kind:'ask'}` 自动路由弹卡，fail-closed，`approval/asked`+`approval/decided` 审计入日志 | camind-tool-cam 闸门 |
| 长任务后台执行（NX 独占 ~8 分钟） | 进程内 asyncio runner | proxy `/submit`+`/poll` 轮询循环包进 `ctx.jobs` 后台任务 + `job_*` 工具 | camind-tool-cam |
| 进度/报告观测 | 自研 EventLog + SSE | 扩展 `SessionEventMap`（model-visible means logged）+ `ConversationNodeDefinition` 自定义会话卡片渲染 | camind-tool-cam（Host + client） |
| 流程选择入口 | 钉住 flow / CreateTaskDialog | agent preset（按会话组合工具与 skill）+ `/` 斜杠命令（`ctx.commands`，不过模型） | preset「CAM 加工」 |
| 断点续跑 | flow state `cam_ops` 状态表 + `sdk.step` 缓存 + suffix 定格 | camPipeline run 目录 op 状态表：`ok` 跳过、`generated` 只补 post、其余重跑；suffix 首次执行定格防旧 | camind-tool-cam（语义移植，不新设计） |
| NX 互斥 | 进程内 `asyncio.Lock` + proxy 文件队列天然串行 | 同左：插件进程内互斥，真正互斥靠 proxy 队列（单进程前提，多实例共用 proxy 时再议外置锁） | camind-tool-cam |
| 经验沉淀 | experience 库 | tool-memory 现成（`extract_memory` → draft → 页面审核） | 复用 + 小升级（§5） |

**明确不用 `dsh-tool-workflow`**：它是"模型现场写 JS 脚本扇出 subagent"的多智能体编排缝——无断点、无保存的流程、官方限定"用户显式要求大型编排时才用"。CAM 交付主干要求确定性与可续跑，与该工具的定位相反；留作将来"批量零件并行分析"类需求的后备（§8）。

### 1.2 执行层方案变更记录（Camindbase CLI → 直连 proxy）

本文档初稿的执行层前提是 spawn 外部项目 Camindbase 的 `camindbase` CLI（JSONL 事件流 + exit code 契约）。改为直连 proxy HTTP 协议的理由：

1. **文件中转与进度观测是 proxy 协议原生能力**（`/fs_upload`/`/fs_zip`/`/submit`+`/poll`），CLI 路线下这两个面反而是未验证的集成缝隙；
2. **协议契约已被旧 Camind 生产验证**：信封格式、错误分类（`error_class: refused/internal_error`）、sha256 传输、路径白名单在 `client.py` 一个文件里就是完整规格，踩坑记录（zip 实数不信头、`src`/`dst` 需显式绝对化等）全部在案；
3. 去掉对本机 Python/uv 环境的依赖，插件自包含。

代价：NX 锁、断点续跑、exit code 语义不再"白拿"，需在插件内按旧 Camind 语义移植最小集合（§4.1）。Camindbase 项目保留为契约参照（其事件/exit code 语义分析仍有价值），不再作为执行依赖。

## 2. 目标与非目标

目标：

1. 用户在会话里用自然语言发起编程交付：上传 `.prt`（必传）/ `.dwg`（可选），交代材料、机床、高风险声明；系统自动走完"读件 → 问齐 → 排工艺 → 执行 → 自检 → 签字 → 打包"。
2. 全程红线硬编码：高风险项（攻丝/沉窝）无书面声明则 `cam_run` fail-closed；钱的计算无（本场景不涉及）；机床参数不经模型转手。
3. 每一次人工判断沉淀进经验库，下次同类零件普通项免问、高风险项预填。

非目标（列入 §8）：报价、机床管理页面、范本库独立插件、多 Agent 并行编排、DAG 进度视图、仿真级碰撞检查、语义级刀路体检（Z-map）与非确定性复跑护栏（旧 Camind 语义在案，重投资项，需要时移植）。

## 3. 总体架构

```text
会话（agent loop，preset「CAM 加工」装备）
│
├─ skill: cam-machining            操作规程（路由/顺序/红线/经验用法）
│
├─ camind-tool-cam（headless + web 全局加载）
│  ├─ Cordis 服务 camPipeline       CAM-Agent proxy HTTP 客户端（NxClient 移植）：
│  │                                信封/错误分类、submit+poll、fs 传输、
│  │                                run 目录状态归集、ctx.jobs 后台、自检编排
│  ├─ 模型工具 ×4                   cam_survey / cam_plan / cam_run / cam_deliver
│  ├─ tools/pre-execute 闸门        高风险声明 fail-closed + 签字 approval 路由
│  └─ client bundle                 会话卡片渲染器（预检清单/检查报告/交付卡）
│
├─ camind-service-machine（headless + web 全局加载）
│  ├─ 存储 $DSH_HOME/machines/*.yaml（gitRepository 自动 commit）
│  ├─ Cordis 服务 machineRegistry   读/校验/任务快照
│  └─ 模型工具 ×2（只读）           list_machines / read_machine
│
├─ tool-memory 小升级               经验 schema +signature/refs；extract_memory
│                                   增加"范本反推"来源（§5）
└─ 复用现成                         tool-upload（.prt/.dwg 会话上传）、
                                    memoryBank（经验检索/沉淀）、gitRepository、
                                    page-memory（经验审核 UI）
```

关键决策：

1. **服务与工具同插件**（照 tool-upload / tool-memory 先例）：camPipeline 服务供工具层与将来其他插件 `inject` 消费，不拆两个包。
2. **模型可见的只有 4 个粗粒度工具**，闭集决策选错率低；proxy 的 105 个 worker 端点永远不平铺给模型。
3. **机床参数不绕模型**：`cam_plan` 经 Cordis `inject: ['machineRegistry']` 直读精确数值；模型工具只服务于"问答"（"这活 CV-850 能不能干"）。
4. **数据落 DSH_HOME 级**：机床档案 `$DSH_HOME/machines/`、范本原件 `$DSH_HOME/memory/reference/`，均 git 版本化；会话工作区只放当次交付物。
5. **preset 基线版本化进仓库**：`agent-presets/cam-machining/`（preset.yml + agent.cordis.yml），init 同步到 `$DSH_HOME/.agent-presets/`（受管文件以仓库为准；用户自建 preset 不动）。

## 4. camind-tool-cam 详细设计

### 4.1 服务层：camPipeline

职责（不含任何领域判断，纯传输与状态归集）。协议细节全部以旧 Camind `backend/app/services/nx/client.py` 与 `docs/nx_endpoint_contract_v1.md` 为准，以下为移植要点：

- **信封与认证**：全部端点 POST；普通端点请求体 `{"params": {...}, "timeout_seconds": N}`，队列控制端点 `/submit`/`/poll`/`/cancel` 参数放顶层；响应统一信封 `{"status":"ok","data":{}}` / `{"status":"error","error_type","msg","error_class","error_detail"}`，**判成败只看 `status` 字段，不看 HTTP 码**（`/fs_download`/`/fs_zip` 成功时是文件流，例外）；认证头 `X-CAM-Agent-Token`；连接配置见 §4.5（界面配置为主、环境变量兜底），token 经 dsh 凭据库解析，不进代码/事件流；
- **长任务纪律**：分钟级端点（`/cam_*`、`/generate_toolpath`、`/postprocess`）一律 `/submit` + `/poll`（默认 2s 间隔、1800s deadline）——同步长任务会被 TCP 层掐断；`/poll` 结果**只取一次**，取到 `done:true` 立即落盘；到点先查 `/health` 的 `queue_processing`，还在算则忙碌延展（deadline × 4 硬上限），硬上限到点报不可重试的 `WorkerTooSlow`；超时先 `/cancel` 再报（cancel 只保证撤掉未被 worker 领取的命令）；秒级只读探查走同步转发；
- **错误分类 → 工具结果映射**：连接失败 / `WorkerTimeout` / `PollTimeout` → 可重试提示（去 Windows 机看一眼）；`/health` ready=false → 附 diagnosis 恢复动作；`error_class=refused` → 按设计拒绝（护栏正常工作的证据，如实转述）；`error_class=internal_error` → 报警；旧 worker 无 `error_class` 键时按「判不出」处理，判据不钉 error_type 类名；
- **文件传输**：`.prt/.dwg` 经 tool-upload 落在 `$DSH_HOME/uploads/<session>/<batch>/`，执行前经 `/fs_upload`（客户端算 sha256 放 `X-CAM-SHA256`）推到 proxy `input/<task>/`；交付时 `/fs_zip` 整目录回收 `out_dir` 的 `*.nc`（**不信 `X-CAM-Files` 头，开包实数**）、`/fs_download` 回收 work 副本与设定单视图（校验响应头 sha256）；路径一律相对 `base_dir`，越界即 `PathViolation`；proxy 只自动解析 `prt`/`out`/`out_dir` 三个参数，其余路径参数（如 `src`/`dst`）必须客户端显式绝对化；
- **断点续跑**（移植旧 Camind `cam_ops` 状态表语义）：run 目录维护 op 状态表，每 op 四终态 `ok`（NC 在盘）/ `generated`（有刀路缺 NC）/ `empty`（空刀路，fail-closed 需人看工艺）/ `error`，逐 op 原子落盘；续跑决策 `ok` 跳过、`generated` 只补 post、其余重跑；suffix 首次执行定格进状态，工序单变了不吃旧刀路。**已实现**（`runstate.json`，tmp+rename 原子落盘，job.json 内容指纹 sha256 前 16 位防旧）；
- **NX 互斥**：插件进程内互斥 + proxy 文件队列天然串行（单进程前提成立；多实例共用同一 proxy 时需外置锁，届时再议）；
- 长调用（run/resume）注册为 `ctx.jobs` 后台任务，模型可继续对话，`job_*` 工具可查询/停止；
- **机器自检编排**（`cam_run` 收尾、交付前，移植旧 Camind 最小集合）：NC 数量对账（取件实数 vs 期望）、空刀路 fail-closed、翻面验证（八项检查契约）、特征核对（roster/assertions 对照 survey 与执行结果）；NC 结构纯文本扫描可直接搬；Z-map 语义体检与非确定性两跑属重投资项，后置（§8）。**v1 范围：NC 数量对账（`/fs_list` 实数 vs ok 工序记录的 NC）+ 空刀路 fail-closed（结论走 `cam/check-report` 事件）；翻面验证与特征核对属后续迭代**；

### 4.2 模型工具（中文 description，对齐本工作区惯例）

| 工具 | 职责 | 要点 |
|---|---|---|
| `cam_survey` | 读件：解析 3D 模型（特征/孔位/尺寸）+ 解析 2D 图纸（材料/热处理/螺纹/公差/颜色规则）+ 交叉核对 | 经 proxy `/cam_survey` 等只读端点；输出事实与疑似高风险候选清单；不做任何判断。**v1 已实现（3D；2D 图纸解析下一迭代）** |
| `cam_plan` | 事实 + 用户声明 → 排工艺（三阶段套路）、选刀、定参数，产出显式工序单 `job.json`（`camindbase_job: "0"` schema 沿用旧 Camind jobspec） | 内部 `inject` machineRegistry 取机床参数；选刀纯规则；plan 前模型应先 `search_memory`（skill 规定）。**v1 已实现：不内建自动排工艺规则引擎——工序单草案由会话模型按 skill 起草，cam_plan 只做确定性校验 + 机床绑定 + 冻结落盘（`$DSH_HOME/cam-runs/<session>/<run>/` 的 job.json/declarations.json/machine_snapshot.json），v1 不调 proxy；全自动规则排产是后续迭代** |
| `cam_run` | `job.json` → proxy 后台执行（work copy → prepare → 逐 op submit+poll → 出 NC），自动含机器自检（NC 对账/翻面验证/特征核对） | **闸门**：`tools/pre-execute` 检查高风险声明齐全（不齐 → deny + 中文缺失清单）→ 齐全则返回 `{kind:'ask'}` 弹签字卡。**v1 已实现（2026-08-23）：work copy（主模型不被写）→ prepare（init_setup）→ 逐 op 执行（copy_postprocess / from_scratch_workpiece_op；face_select_generate/tap_holes 落「v1 不支持」error 终态）→ NC 对账 + 空刀路 fail-closed 自检；`ctx.jobs` 后台执行 + runstate 断点续跑（ok 跳过/generated 补 post/指纹不符拒绝）+ `cam/stage`、`cam/check-report` 会话事件；翻面/特征核对后续迭代。真机实证（2026-08-23）：**撞名时 worker 自动改名**（请求 `X` → 实建 `X_01`）且 `postprocess.files` 按实际名键控——判读必须以返回的 `copy.new_name` 为准，实际名记入 runstate 供续跑对准** |
| `cam_deliver` | 汇总检查结论，生成中文交付报告 + 加工设定单 + 刀路查看器，经 `/fs_zip`/`/fs_download` 回收产物，打包为会话交付物 | 同样过 approval 签字；检查未过也要人确认才打包（报告写清每项决定来源）。**v1 已实现（2026-08-23，`lib/tools/deliver.js` + `lib/report.js`）**：`/fs_zip` 回收 out_dir 的 `*.nc` 到 run 目录 `delivery/nc_batch.zip`（sha256 端到端校验、**开包实数对账**、不信 `X-CAM-Files` 头；对账不符 → 结论 incomplete 且报告写明缺的 NC，不静默）+ 中文交付报告 `delivery_report.md`（件号/机床/后处理器/工序逐项结论含每项决定来源[runstate 终态 / machine_snapshot 冻结值 / declarations 留档]/高风险声明留档/NC 清单与对账/检查结论/备注）+ 加工设定单 `setup_sheet.md`（机床/夹具与工件坐标系/冻结刀库引用/后处理器/转速进给上限/工序顺序）+ `cam/delivered` 事件；检查未过（incomplete/error）也出包、结论章如实写未决项；传输级失败（连不上/sha256 不符/开不了包）error 返回且不落盘。**偏差：toolpath_manifest 留 P3，报告备注写明；刀路查看器已独立成插件 `camind-ui-toolpath-viewer` 并实现（2026-08-23，见 §7 P3）** |

"问人"不是工具：缺声明时模型在对话里直接问，或用 `ask_user_question` 把 `cam_survey` 发现的候选孔预填成多选卡（推荐项置首），用户勾选后续跑。

### 4.3 硬闸门（tools/pre-execute 监听器）

> **已实现**（2026-08-23，`tool-cam/lib/gate.js`；已拦 `cam_run` + `cam_deliver`：`cam_run` 核对高风险声明——缺失 → deny 中文缺失清单、齐全 → ask 签字卡；`cam_deliver` 要求 run 目录与 runstate.json 俱在（缺 job.json → deny「先 cam_plan」，缺 runstate → deny「先 cam_run」），否则一律 ask 签字卡（件号/机床/工序数/检查 overall/NC 个数），检查未全过时文案醒目标注「检查未全过，交付含未决项」——fail-closed 的判定权交签字人）。

瀑布监听器，只拦截 `cam_run` / `cam_deliver`：

1. 校验工序单内每项高风险工序（攻丝/沉窝）都有对应用户声明记录（声明作为 `cam_plan` 入参落盘进 run 目录，闸门读盘核对，不认对话记忆）；
2. 缺失 → `{kind:'deny', reason: <中文缺失清单>}`，模型拿清单回去问人；
3. 齐全 → `{kind:'ask', reason: <签字卡文案：件号/工序数/检查结论摘要>}`，tools 管线自动路由 approval 缝；策略为 `never` 或无应答方时 fail-closed；
4. 批准一次性有效，审计事件入 session log；模型只看到最终工具结果。

> 实现注记：本版本 cordis 的 waterfall `next()` 不线程化值（`next({kind:'deny'})` 不生效）——放行 `return next()`，deny/ask **直接 return 决策对象、不调用 next**（veto 语义，见 `dsh-tool-cordis` 事件目录签名与 cordis 源码实证）。

### 4.4 会话事件与卡片（client bundle）

- **⛔ 会话事件与三张聊天卡已退役（2026-08-26，实证事故后）**：原设计扩展 `SessionEventMap`（`cam/stage` 阶段推进 / `cam/check-report` 自检结论 / `cam/delivered` 交付包清单）+ tool-cam client bundle 三个 `conversationEvents` 定义与 keyed `conversation.chat.node` 渲染器。隐患于 2026-08-23 核实源码时已记录在案（下条），2026-08-26 实证爆发：含 cam/* 事件的会话重启后整体拒绝重载（SessionFormatUnsupportedError）。处置：**tool-cam 全面停发 cam/* 会话事件**（run.js 过程时间线只落 runstate.history，deliver.js 不再 append；聊天三卡随之移除），加工过程视图由工作台「加工」页签独立承担（本就是为免疫该隐患而建）；`cam.nc.preview` 席位改由 ui-shell 在 root entry 声明。历史会话日志用 `scripts/repair-cam-session-events.mjs` 把 cam/* 事件标 `ignorable: true` 修复（信封合法键，加载门放行、历史完整保留）。上游给出注册面后可重新评估会话卡片；
- 原隐患记录（2026-08-23 核实源码，至今 0.1.1-rc.2 未变）：`session.append()` 的公开签名无法给事件打 `ignorable: true` 标记（只接受 surface 元数据），而 `dsh-session-persistence` 的 `assertEventsSupported` 在加载/检查/导出路径拒绝「不在本构建 KNOWN_SESSION_EVENT_TYPES 且未标 ignorable」的事件类型——上游原注「下游插件事件的注册面推迟到有消费者再做」；
- **「交付物」页签接线（已实现）**：官方 deliverables 投影（dsh-client-ui-deliverables）从 pending call 视图收集 `card:'generic' + kind:'edit' + locations` 的产出路径（turn 级，`turn.data['deliverables'].produced`）——`cam_deliver` 声明 `presentCall` 列出三件套与 `nc/<name>` 的工作区相对路径（`delivery/<runId>/`），并把三件套与 .nc 实数开包（从 sha256 校验过的 nc_batch.zip 逐个 inflate）镜像落进会话工作区（设计稿 §3 决策 4；best-effort，失败只记 note），ui-shell 现成的 turnTail chips 与「交付物」页签/工作台各「预览」入口自动生效（预览路由以会话工作区为界，内容显示在主对话区「预览」标签页）。已知取舍：cam_deliver 的错误是返回 error JSON 而非抛错（isError=false），传输级失败的交付也会登记 produced 路径，文件不在盘上时预览报「文件不存在」；
- **交付文件访问（已实现，`tool-cam/lib/delivery-route.js`）**：web 下半注册只读 prefix 路由 `GET /camind/api/cam/runs/<session>/<runId>/delivery/<file>`——交付卡「下载」与 NC 内容来源（`nc/<name>` 从 nc_batch.zip 开包抽取，中央目录取压缩参数 + zlib inflate，32 MiB 上限）；session/runId/文件名三重白名单 + realpath 防越界（symlink 逃逸 403），只认 GET。选自建路由而非 ui-shell 会话文件路由：留档在 run 目录（不依赖工作区镜像成败），且官方壳（无 ui-shell 路由）同样可用；
- **刀路挂点**：keyed slot `cam.nc.preview`（scope root；key `toolpath-viewer`，owner props `{ content, fileName }`）——席位与渲染均归 **camind-ui-preview**（原 tool-cam 交付卡 → ui-shell root entry → 随「查看刀路」迁入预览插件）；工作台「加工」页签「查看刀路」经 delivery 路由取 NC 文本后调 `filePreview.previewContent`，「预览」标签页渲染（viewer 本体仍是 camind-ui-toolpath-viewer）。
- **工作台「加工」页签（已实现 2026-08-23，`ui-shell/src/web/CamRuns.tsx` + `tool-cam/lib/runs-route.js`）**：ui-shell Workbench 第三页签，按 session 列 CAM run 的无折叠时间线（run_id/件号/机床/overall 徽章/更新时间 + runstate.history 逐阶段过程流：阶段行、工序起止与耗时、执行中「已运行 X / 限时约 Y」走表、失败/中止行就地展开，旧格式 runstate 回退工序终态列表）——**run 列表从 run 目录落盘读**（新路由 `GET /camind/api/cam/runs?session=<id>` 列表 + `GET /camind/api/cam/runs/<session>/<runId>` 详情，与 delivery 下载同一 prefix、同一白名单/防越界纪律），不读会话事件投影：免疫上面记录的「cam 事件会话重启后拒绝重载」上游限制，也能展示中断后可 resume 续跑的 run（无 runstate → planned 徽章 + 首跑提示，incomplete/error → resume 提示行）。交付文件下载走既有 delivery 路由；报告/设定单可经会话工作区镜像走「预览」标签页；「查看刀路」按钮取 NC 文本后直接渲染 slot 注册表里 `cam.nc.preview`/`toolpath-viewer` 的组件（ui-shell 是 slot runtime 宿主且与官方 bundle 同一 React 实例，viewer 只消费 owner props，故无需逃生门、viewer 本体零改动；页签不重复声明席位——slot 系统对重复声明抛错）。

### 4.5 连接配置与设置界面（照抄官方 dsh-web-search-deepseek 双件套，已核实 dsh 0.1.1-rc.2；**初版已实现**：settings namespace + keyed 设置卡片 + ping，2026-08-23）

- 插件导出 `Config = z.object({ baseURL: z.string(), tokenEnv: z.string().role('credential-ref').default('CAMIND_NX_AGENT_TOKEN') })`，并以 `installSettingsSection(ctx, 'cam-nx', Config, ...)` 注册 settings namespace——界面修改落 `$DSH_HOME/settings.yaml` 的 `cam-nx:` 节，**热更新无需重启**；
- **token 不内联**：Config 只存环境变量名引用（`role('credential-ref')`），真实值经官方 wire API `credentials.set` 写入 `$DSH_HOME/.credentials.yaml`（强制 0600），运行时 `ctx.credentials.resolve(tokenEnv)` 解析；分层兜底自动成立：环境变量 > .credentials.yaml > .env——headless/desktop 场景继续用 `CAMIND_NX_AGENT_URL` / `CAMIND_NX_AGENT_TOKEN` 环境变量，互不影响；
- client bundle 往官方 Settings 弹层注册 `settings.section` 一整页「NX 工作台」（或更省事的 `settings.plugin.item` 卡片；`/camind` 壳经 camind-ui-sidebar 挂的 `sidebar.settings` 进同一弹层）：非密字段经 `settingsScope.bind({namespace:'cam-nx'})` 读写，token 输入框 write-only——`role('secret')` 字段在 describe 时被结构性剥离、只回「已配置」徽标，密文永不过线；附「测试连接」按钮调 `/ping` 回显 `base_dir` / `proxy_version`；
- 官方 Host wire API（`settings.update` / `credentials.set` 等，dsh-host-apiproxy 提供）现成；唯一的自建 HTTP API 是 `POST /camind/api/cam/ping`（初版已实现，exact 路由）：卡片「测试连接」要由 Host 侧持 token 调 proxy，浏览器直连会暴露 token 且受 CORS 限制，其余读写都走官方 wire API。

## 5. 机床档案与经验库扩展

### 5.1 camind-service-machine

> **已实现**（2026-08-23）：`machineRegistry` 服务（list/get/snapshot，只读）+ `list_machines`/`read_machine` 工具；v1 无写方法、不挂 gitRepository（无写操作则无需自动 commit，挂接留待写接口迭代）。

- 存储：`$DSH_HOME/machines/<machine-id>.yaml`（一台一个文件；frontmatter 式字段：行程/主轴/工作台/控制器/刀库 T 位/刀具名义+实测/夹具/材料切削参数 + `version`/`approval` 状态），写操作经 `gitRepository` best-effort 自动 commit（独立 git 仓库，同 memory 约定）；
- **种子基线在仓库** `machines/<machine-id>.yaml`（版本化、走评审；现有 `machines/VMC-HJ-01.yaml` 即旧 Camind `seed_cv850.py` 的 YAML 转换，「未就绪」标记——刀具 measured 空、post DRAFT——原样保留）：`npm run init` 与 desktop `prepare-vendor` 以「目标不存在才拷」同步进 `$DSH_HOME/machines/`，**绝不覆盖运行时改动**；不用 skills 式 symlink，因为机床档案是可写数据，运行时写必须落在 DSH_HOME 级而非源码仓库当前分支。现场改动要升级为出厂基线时，人工把 YAML 拷回仓库提 PR（单向同步 + 人工回流）；
- 服务 `machineRegistry`：`list()` / `get(id)` / `snapshot(id)`——**任务开跑时冻结快照存进 run 目录**，之后改机床参数不影响在跑任务（原项目 JobConstraintSnapshot 语义）；
- 工具 `list_machines` / `read_machine` 只读；写操作（录入/改版）v1 靠直接编辑 YAML 文件，管理页面缓建（第二台机床进场、非开发人员要改参数时再做，照 page-memory 抄结构）。

### 5.2 tool-memory 小升级（范本库被经验库吸收）

> **已实现**（2026-08-23）：schema 两字段 + signature 精确过滤 + extract_memory 范本模式 + page-memory 补全流程复用。落地要点：
>
> - `signature` 扁平 string 键值对（键小写字母/数字/下划线 ≤24，值 ≤48，≤12 键；写路径严格报错、读路径脏键静默跳过）；`refs` 只接受 `reference/<文件名>.prt` 且原件必须已在盘上；两个字段进经验 summary（检索结果可见），经验 summary 同时补 `metadata_status`（存量条目默认 ready，无迁移）。
> - 检索：`search_memory` 新增 `signature` 参数，`listEntries` 在元数据粗排前做逐键 AND 完全匹配（大小写不敏感）；给出签名过滤时无签名的条目（含全部知识条目）一律排除；语义重排不变。
> - `extract_memory` 范本模式（`source_prt` 入参）：来源二选一——记忆库 reference/ 已归档文件名（可带前缀）或当前 session 上传清单（uploads 服务解析，跨 session/越界由 manifest 挡住）；`memoryBank.archiveReference` 归档为 `reference/<sha8>_<文件名>.prt`（内容哈希前缀去重，同内容复用，best-effort 自动 git commit 随记忆库版本化）；随后与 cam_survey 同一协议（uploadFile 到 `input/memory_<session>_<sha8>_<名>` + submit+poll `/cam_survey`）反推几何事实，LLM 一次调用生成 trigger/三段式/signature（args.signature 可覆盖合并，此处优先）；条目落 `status: draft + metadata_status: pending`、title 占位为条目名。camPipeline/uploads/llm 全部执行时点防御式 `ctx.get`，tool-memory 不新增 inject 耦合；任一缺席中文响亮报错。
> - page-memory 复用零新增页面：`metadata.js` 补全泛化为 (type, name)——经验只生成 title/description/tags（正文三段式不动），`server.js` 列表路由对任何 pending 条目自愈调度补全（inFlight 去重），客户端经验 tab 卡片/详情复用「生成中/生成失败」徽章与 3s 轮询，经验详情新增「特征签名」徽章行与「范本原件」ref 列表。
> - 验证：`/tmp` 脚本驱动服务与工具全链（schema/过滤/归档/范本模式 mock camPipeline+llm/补全 pending→ready 与失败 →failed）29 项断言全过。

范本（老师傅历史编程成品）的本质是经验的另一来源：经验库装"从人工纠正里沉淀的判断"，范本是"从成品里反推的判断"。不做独立插件，扩展两处：

1. **经验 schema 加两个可选字段**（OKF 合法扩展键）：
   - `signature`：特征签名（材料/孔数档/工序类型/关键尺寸档），检索"元数据粗排"阶段做精确过滤，语义重排不变；
   - `refs`：归档原件的 bundle 相对路径列表（`.prt` 原件落 `$DSH_HOME/memory/reference/`，条目是索引、原件是附件）；
2. **`extract_memory` 增加范本来源模式**：入参接受 `.prt` 路径（uploads 或 reference 目录），后台走"反推 → 三段式草稿 → `metadata_status: pending` → draft"，复用 page-memory 现成的 pending → ready/failed 轮询与审核流转 UI，零新增页面。

## 6. SKILL 与 preset

### 6.1 skill `cam-machining`（`skills/cam-machining/SKILL.md`，经 `.dsh/skills` symlink 全局生效；已实现 2026-08-23）

内容大纲（全是规矩，不含可执行物）：

- 路由：什么用户输入是编程交付任务；
- 顺序：`cam_survey` → 声明问齐（高风险必须书面确认，`ask_user_question` 预填候选）→ `search_memory` 查同类经验 → `cam_plan` → `cam_run`（签字）→ `cam_deliver`（再签字）→ `extract_memory` 沉淀；
- 红线：高风险项经验只能预填不能跳过确认；来料状态不猜；机床参数以 `read_machine` 为准不以记忆为准；
- 结果解读：proxy 错误分类（`error_class` / `WorkerTimeout` / ready=false diagnosis）、op 四终态（`ok`/`generated`/`empty`/`error`）与检查报告各结论的含义与处置建议。

素材来源（旧 Camind 拆解吸收，**不整迁**——旧 skill 引用的 `nx_health`/`nx_call` 等工具在 dsh 侧不存在，照搬会引入死引用）：

- host `INSTRUCTIONS.md`：CAM 任务路由与意图编译纪律（上传路径取 `→` 后的绝对路径不用裸文件名、`post_name` 填精确后处理器名不带机床/系统修饰词、高风险细节不在入口处问而由规划阶段确认卡带预填问）；
- `nx-agent-http` skill：只吸收预期管理与错误处置片段（队列排队约 8 分钟一件、超时与排障路径）；其端点速查表整体作废——模型不见 proxy 端点（§3 决策 2），「先问健康再干活」落为 camPipeline 内部 `ensure_ready`（代码级，不靠模型自觉）；
- `cam-binding` skill：不以 skill 形态迁移。其读者是规划器内部 LLM（旧 `agents: [planner]`），新落位是 `cam_plan` 工具内部 LLM 调用的 prompt 材料（刀具逐字引用冻结刀号、参数拿不准留空交规则、刚性攻丝 feed = spindle × pitch、job_setup 填写纪律）；`policy/binding_policy.yaml` 的判定数字作为插件数据资产由确定性代码读取，「数字不走 LLM 通道」原则原样保留；
- `quoting` skill：报价是非目标（§8），不迁；将来报价场景设计时随该设计一起处理。

### 6.2 preset「CAM 加工」（仓库 `agent-presets/cam-machining/`，已实现 2026-08-23）

版本化进仓库（机制参考 AnaSageHarness 的 agent-presets）：`preset.yml`（展示元数据）+ `agent.cordis.yml`（会话级组合：persona + agent 级固定配置）。`npm run init` 把受管文件同步到 `$DSH_HOME/.agent-presets/`（**以仓库为准覆盖**——与 machines 的「不存在才拷」相反，因为 preset 是纯配置、无运行时改写；用户自建的其他 preset 不删除、不覆盖），desktop 打包经 prepare-vendor 实体化。

组合：`cam_*` 4 工具 + `list_machines`/`read_machine` + 上传 + 记忆 4 工具 + skill `cam-machining`。新建会话选此模式 = 进场领这套装备。报价等将来场景另建 preset，互不污染。

注记（与原决策的偏差）：原决策「preset 是用户侧配置不进仓库」随本次实施反转——基线 preset 进仓库走评审，用户自建 preset 仍留在 DSH_HOME 级。另：cam_* 工具当前在 web/headless **全局加载**（tool-cam 的 Host 服务/设置卡片/闸门须全局存活，preset 只挂 persona 与 agent 级配置），因此「无关工具物理不可见」v1 未达成——标准模式会话也能看到 cam_* 工具（未配置 NX 时会响亮报错）；将来如需收窄，把工具注册从 tool-cam 拆到独立的 preset 挂载插件。

## 7. 分期与冒烟验证

分期：

1. **P1 camind-tool-cam**：proxy 客户端 + run 状态表 + 4 工具 + 闸门 + 事件（先无自定义卡片，会话里纯文本结论即可跑通）——**已落地 4/4 工具（cam_survey / cam_plan / cam_run / cam_deliver）+ 闸门（拦 cam_run / cam_deliver）+ runstate + 会话事件（cam/stage、cam/check-report、cam/delivered），P1 工具面齐**（2026-08-23；自定义卡片渲染器在 P3）；
2. **P2 camind-service-machine** + skill + preset；
3. **P3 会话卡片渲染器 + 刀路查看器 + 设置页「NX 工作台」**（§4.5 设置页已完成）；**P4 经验库扩展（已完成 2026-08-23，见 §5.2 注记）**。P3 拆两个插件（2026-08-23 决策）：会话卡片（预检清单/检查报告/交付卡）挂在 tool-cam 的 client bundle；**刀路查看器独立为 `camind-ui-toolpath-viewer`**（NC 解析 + WebGL 回放 + keyed 渲染器席位）——职责是呈现而非执行、vendor 资产（旧 Camind `viewer_assets` 的 cnc-simulator，244KB）与构建形态不同、消费方不止交付卡一处（交付物页签、将来报价预览）、WebGL 失败可独立降级。tool-cam 交付卡经 slot 弱耦合消费：viewer 在则渲染回放，不在退化为文件清单。**查看器已实现（2026-08-23）**，要点：
   - **GPL 决策**：旧 cnc-simulator 资产的核心两文件（parseGcode.js / RenderPath.js）是 GPL-3.0-or-later，资产台账 `asset_licenses.json` 标 `CONDITIONAL_GPL_PATH`、`external_authorized: false`、proprietary 外部分发 `BLOCK_UNTIL_VENDOR_FREE`——移植会感染整个 client bundle，故解析器与渲染器全部自写（BSD 的 gl-matrix/webgl-utils 也一并弃用，不再需要）；且 dsh client seed 表无 three.js（手写 bundle 不能装 npm 浏览器依赖），渲染器为自写最小 WebGL lines。
   - **解析器**（`lib/nc-parser.js`，纯函数零依赖 ESM，node 可直接 import 验证）：Fanuc 方言（`%` 定界、O 程序号、N 行号、`(...)` 注释、`;` 行尾注释、`/` 跳段、字母+十进制字）；G0/G1/G2/G3 模态运动分段（快移/切削/圆弧），G17/18/19 平面（G17 精确，G18/G19 在 (Z,X)/(Y,Z) 框架跑同套圆弧数学），G90/G91 绝对/增量，G20/G21 只记录不换算；圆弧按弦差 0.05 细分成线段（IJK 增量圆心 + R 形[负 R 取大弧] + 整圆 + 螺旋第三轴线性插值）；**G73/G74/G76/G81..G89 固定循环展开**——每孔记入 `cycles[]` 并画出到孔快移、下 R 面、进给（G83 按 Q 啄钻并快退到 R，G73 高速啄钻回退 1 mm，G74/G84 攻丝与 G85/G89 进给退刀，G76/G87/G88 仍为单条 R→Z 并一次告警），模态 X/Y 行重复执行到 G80 或组 1 G 码取消；S0 / G20 / 截断写入 `warnings[]`；查看器告警为可点芯片，源码在右侧抽屉（默收），行号与刀位双向跳转。G28/G30 参考点返回只画中间点快移段（到参考点那段无程序坐标，不模拟）；坏行（注释未闭合/杂散字符/无模态运动的轴字）整行跳过并计数，解析对 NC 内容永不 throw；段数上限 100 万防失控（`meta.truncated`）。
   - **bundle 形态**：client.js 是单文件手写 bundle，`PARSER CORE` 标记区间内联 lib/nc-parser.js 的同一字节（区间头注释附 diff 校验命令）——dsh 模块加载器的 require 只解析 seed 词与裸包名（`dsh-client-modules` makeRequire），相对路径直接 throw，故不能同包多文件。
   - **渲染器**：自写最小 WebGL lines：interleaved 顶点缓冲（position+color+kind）`gl.LINES`、深度测试、Z-up 球轨道（拖动旋转/滚轮缩放/Shift 或右键平移）、按需重绘、DPR 自适应、包围盒线框 + 原点 RGB 轴三联；配色快移红/切削蓝/圆弧青/循环琥珀，固定深色视口；播放时已走/当前/未走三段亮度，快移与切削可单独关掉；WebGL 创建失败降级为中文说明面板。
   - **审查壳**：3D 占满预览面；俯视/等轴/复位与播放条叠在画布上；XYZ/行/F HUD 在视区角；进度为比例（按进给估算的时间只作 tooltip，不写成机床循环时间）；源码默认收起为右侧抽屉，点 3D 段或告警芯片打开并对行；空格播放、左右键单步。免责声明在标题 tooltip。
   - **消费契约**：向 keyed slot `cam.nc.preview`（scope root）注册 key `toolpath-viewer`，owner props `{ content, fileName }`；经 `ctx.slots.inject` 等消费方声明席位后才注册，无消费方时整体惰性。消费侧渲染调用为 `renderSlot('cam.nc.preview', { content, fileName }, { entryKey: 'toolpath-viewer' })`。
   - **会话卡片已实现（2026-08-23，tool-cam client bundle）**：cam-stage / cam-check-report / cam-delivered 三卡 + 「交付物」页签接线（cam_deliver 落会话工作区 + presentCall 喂官方投影）+ 只读下载路由 `GET /camind/api/cam/runs/.../delivery/<file>`，交付卡即上述消费方（声明席位、点击取 NC 文本传入）。实现细节与持久化隐患（cam/* 事件未标 ignorable、重启后拒绝重载——插件侧无规避）见 §4.4。

冒烟（对齐本工作区"无自动化测试、手动冒烟"策略）：

1. `node scripts/dsh.mjs --profile headless --dump-config`：确认两个新插件行出现；
2. proxy 客户端离线验证：本地 stub proxy（对照旧 Camind `backend/tests/nx_proxy_mock.py` 的 FakeProxy 用 Node 重写，几十行）验证信封解析、submit+poll 纪律、错误分类映射、断点续跑决策；缺高风险声明时 `cam_run` 必须被闸门拦下并返回中文清单（此条不经 proxy）；
3. 端到端（需 Windows NX 侧在线）：web 会话上传 `.prt/.dwg` → `/fs_upload` 中转到 proxy `input/` → `cam_run` 弹签字卡 → 后台跑完 → 检查报告 → 签字 → 交付包经 `/fs_zip` 回收到会话工作区，「交付物」页签可见；
4. 记忆闭环：交付后 `extract_memory` 落 draft，page-memory 审核采纳，下次同类任务 `search_memory` 命中。

## 8. 后续方向（非目标清单）

报价场景（独立设计，费率纯函数 + LLM 估工时）；机床管理页面；范本自动对标（按 signature 主动推相似范本而非等模型搜）；批量零件并行编排（`dsh-tool-workflow` 是官方答案，届时评估）；DAG/甘特进度视图（session 事件流已够用时不做）；仿真级碰撞检查（留给人，不接）；Z-map 刀路语义体检与非确定性复跑护栏（旧 Camind `toolpath_audit`/`nondeterminism_guard` 语义在案，需要时移植）；多实例共用 proxy 的外置锁；会话内只读问答工具 `nx_query`（旧 Camind `nx_call` 的等价物，白名单直接搬 `services/nx/tools.py` 的 `READONLY_ENDPOINTS` 与带决策依据的排除表——交付主线跑通后若「随手查 proxy 侧目录/工序详情」证明是高频需求再加，此前不加以保持工具闭集）。
