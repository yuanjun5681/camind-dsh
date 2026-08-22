# CAM 加工场景设计（camind-tool-cam + camind-service-machine + cam-machining skill）

> 状态：设计稿（未实现；2026-08-22 依据 dsh 0.1.0-rc.7 官方机制与本工作区现状成文）
> 范围：CAM 编程交付场景端到端（读件 → 声明问齐 → 排工艺 → NX 远程执行 → 机器自检 → 人工签字 → 交付 → 经验沉淀）；**不含报价场景**（另行设计）、不含机床管理页面、不含范本库独立插件（被经验库扩展吸收）
> 执行层前提：NX 远程执行复用外部项目 [Camindbase](../Camindbase)（`camindbase` CLI：ping/survey/validate/run/resume/status，自带 NX 串行锁、断点续跑、exit code 契约、fail-closed 完整性护栏），本设计只做封装，不重写其任何机制

## 1. 第一性原理：dsh 里没有"流程引擎"，也不需要

原 Camind 项目以自研 workflow 引擎（Task/Flow/Node DSL）驱动业务流程。迁移到 dsh 后不搬引擎，原因是两层：

1. **dsh 的 agent loop 本身就是编排机**。每个回合模型看现状 → 选工具 → 看结果 → 再决定，这正是原项目"host 会话主 Agent"的角色；原项目的红线"确定性工作流当 worker，动态性收敛在闭集决策点"在 dsh 里变成原生形态：**动态判断（问人、查经验、拍板）归对话，确定执行（读件、排工艺、算刀路、检查、打包）收进少数几个粗粒度、带代码闸门的工具**。
2. **原流程里每一步的确定性语义已有归宿**：NX 串行锁、断点续跑、工序↔NC 完整性护栏在 Camindbase；人工批准在 dsh 的 approval 缝；确认卡在 `ask_user_question`；进度观测在 session 事件流。"流程图"降级为 SKILL 里的操作规程文字，模型照着走、闸门关着，走不错。

### 1.1 dsh 原生机制映射表（rc.7 核实）

| 流程需求 | 原 Camind 实现 | dsh 机制 | 落位 |
|---|---|---|---|
| 意图理解、流程推进 | host 主 Agent + Flow 派发 | agent loop 本体 + skill 规程 | `cam-machining` skill |
| 确认卡（候选孔预填勾选） | InteractionCard schema 表单 | `ask_user_question` 工具（`dsh-tool-ask-user`）：options/multiSelect/custom，推荐项置首标 `(Recommended)`，`plan-review` intent | 模型直接调，零开发 |
| 人工签字放行 | HumanNode park/resume | approval 缝（`dsh-user-approval`）：`tools/pre-execute` 返回 `{kind:'ask'}` 自动路由弹卡，fail-closed，`approval/asked`+`approval/decided` 审计入日志 | camind-tool-cam 闸门 |
| 长任务后台执行（NX 独占 ~8 分钟） | 进程内 asyncio runner | `ctx.jobs` 后台任务 + `job_*` 工具 | camind-tool-cam |
| 进度/报告观测 | 自研 EventLog + SSE | 扩展 `SessionEventMap`（model-visible means logged）+ `ConversationNodeDefinition` 自定义会话卡片渲染 | camind-tool-cam（Host + client） |
| 流程选择入口 | 钉住 flow / CreateTaskDialog | agent preset（按会话组合工具与 skill）+ `/` 斜杠命令（`ctx.commands`，不过模型） | preset「CAM 加工」 |
| 断点续跑 | Flow checkpoint | Camindbase `runstate`（op 粒度、指纹防旧） | 不重写 |
| 经验沉淀 | experience 库 | tool-memory 现成（`extract_memory` → draft → 页面审核） | 复用 + 小升级（§5） |

**明确不用 `dsh-tool-workflow`**：它是"模型现场写 JS 脚本扇出 subagent"的多智能体编排缝——无断点、无保存的流程、官方限定"用户显式要求大型编排时才用"。CAM 交付主干要求确定性与可续跑，与该工具的定位相反；留作将来"批量零件并行分析"类需求的后备（§8）。

## 2. 目标与非目标

目标：

1. 用户在会话里用自然语言发起编程交付：上传 `.prt`（必传）/ `.dwg`（可选），交代材料、机床、高风险声明；系统自动走完"读件 → 问齐 → 排工艺 → 执行 → 自检 → 签字 → 打包"。
2. 全程红线硬编码：高风险项（攻丝/沉窝）无书面声明则 `cam_run` fail-closed；钱的计算无（本场景不涉及）；机床参数不经模型转手。
3. 每一次人工判断沉淀进经验库，下次同类零件普通项免问、高风险项预填。

非目标（列入 §8）：报价、机床管理页面、范本库独立插件、多 Agent 并行编排、DAG 进度视图、仿真级碰撞检查。

## 3. 总体架构

```text
会话（agent loop，preset「CAM 加工」装备）
│
├─ skill: cam-machining            操作规程（路由/顺序/红线/经验用法）
│
├─ camind-tool-cam（headless + web 全局加载）
│  ├─ Cordis 服务 camPipeline       封装 camindbase CLI：spawn、JSONL 事件→
│  │                                session 事件、ctx.jobs 后台、交付物归集
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
2. **模型可见的只有 4 个粗粒度工具**，闭集决策选错率低；Camindbase 的 96 个 NX 端点永远不平铺给模型。
3. **机床参数不绕模型**：`cam_plan` 经 Cordis `inject: ['machineRegistry']` 直读精确数值；模型工具只服务于"问答"（"这活 CV-850 能不能干"）。
4. **数据落 DSH_HOME 级**：机床档案 `$DSH_HOME/machines/`、范本原件 `$DSH_HOME/memory/reference/`，均 git 版本化；会话工作区只放当次交付物。
5. **preset 是用户侧配置**：放 `$DSH_HOME/.agent-presets/`，按本仓库约定不同步进 git；文档只给出内容模板（§6）。

## 4. camind-tool-cam 详细设计

### 4.1 服务层：camPipeline

职责（不含任何领域判断，纯传输与状态归集）：

- `spawn camindbase <subcommand>`（经 `uv run`，安装路径与连接配置走 Camindbase 自带的 `camindbase.json`/环境变量层；插件只注入工作目录与 run-id 约定）；
- 逐行解析 stdout JSONL 事件（`queued/stage/progress/log/artifact/review/result`），转发为 session 事件（§4.4）；末行 `result` 与 exit code 映射为工具结果（10/11 → 需人复核提示，12 → 交付不完整，20 → NX 侧离线可重试）；
- 长调用（`run`/`resume`）注册为 `ctx.jobs` 后台任务，模型可继续对话，`job_*` 工具可查询/停止；
- 上传文件中转：`.prt/.dwg` 经 tool-upload 落在 `$DSH_HOME/uploads/<session>/<batch>/`，**执行前需传输到 NX 主机输入目录**（CAM-Agent proxy 协议的文件写入能力，落 `E:\CAM-Agent` 白名单内）；交付包反向回收到会话工作区。**这两个传输面是实现期需先验证的集成点**（§7 冒烟第 3 条）。

### 4.2 模型工具（中文 description，对齐本工作区惯例）

| 工具 | 职责 | 要点 |
|---|---|---|
| `cam_survey` | 读件：解析 3D 模型（特征/孔位/尺寸）+ 解析 2D 图纸（材料/热处理/螺纹/公差/颜色规则）+ 交叉核对 | 输出事实与疑似高风险候选清单；不做任何判断 |
| `cam_plan` | 事实 + 用户声明 → 排工艺（三阶段套路）、选刀、定参数，产出显式工序单 `job.json` | 内部 `inject` machineRegistry 取机床参数；选刀纯规则；plan 前模型应先 `search_memory`（skill 规定） |
| `cam_run` | `job.json` → `camindbase run/resume` 后台执行，自动含机器自检（NC 扫描/完整性/翻面验证/特征核对） | **闸门**：`tools/pre-execute` 检查高风险声明齐全（不齐 → deny + 中文缺失清单）→ 齐全则返回 `{kind:'ask'}` 弹签字卡 |
| `cam_deliver` | 汇总检查结论，生成中文交付报告 + 加工设定单 + 刀路查看器，打包为会话交付物 | 同样过 approval 签字；检查未过也要人确认才打包（报告写清每项决定来源） |

"问人"不是工具：缺声明时模型在对话里直接问，或用 `ask_user_question` 把 `cam_survey` 发现的候选孔预填成多选卡（推荐项置首），用户勾选后续跑。

### 4.3 硬闸门（tools/pre-execute 监听器）

瀑布监听器，只拦截 `cam_run` / `cam_deliver`：

1. 校验工序单内每项高风险工序（攻丝/沉窝）都有对应用户声明记录（声明作为 `cam_plan` 入参落盘进 run 目录，闸门读盘核对，不认对话记忆）；
2. 缺失 → `{kind:'deny', reason: <中文缺失清单>}`，模型拿清单回去问人；
3. 齐全 → `{kind:'ask', reason: <签字卡文案：件号/工序数/检查结论摘要>}`，tools 管线自动路由 approval 缝；策略为 `never` 或无应答方时 fail-closed；
4. 批准一次性有效，审计事件入 session log；模型只看到最终工具结果。

### 4.4 会话事件与卡片（client bundle）

- 扩展 `SessionEventMap`：`cam/stage`（阶段推进）、`cam/check-report`（自检结论）、`cam/delivered`（交付包清单）——持久、可回放，ui-shell「交付物」页签从事件取 artifact；
- 注册 `ConversationNodeDefinition` + keyed renderer（client bundle 手写格式照 page-memory/lib/client.js）：预检清单卡、检查报告卡（通过/需复核 + 逐项结论）、交付卡（文件列表 + 下载）。

## 5. 机床档案与经验库扩展

### 5.1 camind-service-machine

- 存储：`$DSH_HOME/machines/<machine-id>.yaml`（一台一个文件；frontmatter 式字段：行程/主轴/工作台/控制器/刀库 T 位/刀具名义+实测/夹具/材料切削参数 + `version`/`approval` 状态），写操作经 `gitRepository` best-effort 自动 commit；
- 服务 `machineRegistry`：`list()` / `get(id)` / `snapshot(id)`——**任务开跑时冻结快照存进 run 目录**，之后改机床参数不影响在跑任务（原项目 JobConstraintSnapshot 语义）；
- 工具 `list_machines` / `read_machine` 只读；写操作（录入/改版）v1 靠直接编辑 YAML 文件，管理页面缓建（第二台机床进场、非开发人员要改参数时再做，照 page-memory 抄结构）。

### 5.2 tool-memory 小升级（范本库被经验库吸收）

范本（老师傅历史编程成品）的本质是经验的另一来源：经验库装"从人工纠正里沉淀的判断"，范本是"从成品里反推的判断"。不做独立插件，扩展两处：

1. **经验 schema 加两个可选字段**（OKF 合法扩展键）：
   - `signature`：特征签名（材料/孔数档/工序类型/关键尺寸档），检索"元数据粗排"阶段做精确过滤，语义重排不变；
   - `refs`：归档原件的 bundle 相对路径列表（`.prt` 原件落 `$DSH_HOME/memory/reference/`，条目是索引、原件是附件）；
2. **`extract_memory` 增加范本来源模式**：入参接受 `.prt` 路径（uploads 或 reference 目录），后台走"反推 → 三段式草稿 → `metadata_status: pending` → draft"，复用 page-memory 现成的 pending → ready/failed 轮询与审核流转 UI，零新增页面。

## 6. SKILL 与 preset

### 6.1 skill `cam-machining`（`skills/cam-machining/SKILL.md`，经 `.dsh/skills` symlink 全局生效）

内容大纲（全是规矩，不含可执行物）：

- 路由：什么用户输入是编程交付任务；
- 顺序：`cam_survey` → 声明问齐（高风险必须书面确认，`ask_user_question` 预填候选）→ `search_memory` 查同类经验 → `cam_plan` → `cam_run`（签字）→ `cam_deliver`（再签字）→ `extract_memory` 沉淀；
- 红线：高风险项经验只能预填不能跳过确认；来料状态不猜；机床参数以 `read_machine` 为准不以记忆为准；
- 结果解读：Camindbase exit code 与检查报告各结论的含义与处置建议。

### 6.2 preset「CAM 加工」（`$DSH_HOME/.agent-presets/cam-machining/`，用户侧配置不进仓库）

组合：`cam_*` 4 工具 + `list_machines`/`read_machine` + 上传 + 记忆 4 工具 + skill `cam-machining`。新建会话选此模式 = 进场领这套装备，无关工具物理不可见。报价等将来场景另建 preset，互不污染。

## 7. 分期与冒烟验证

分期：

1. **P1 camind-tool-cam**：服务 + 4 工具 + 闸门 + 事件（先无自定义卡片，会话里纯文本结论即可跑通）；
2. **P2 camind-service-machine** + skill + preset；
3. **P3 会话卡片渲染器**；**P4 经验库扩展**。

冒烟（对齐本工作区"无自动化测试、手动冒烟"策略）：

1. `node scripts/dsh.mjs --profile headless --dump-config`：确认两个新插件行出现；
2. headless 直调：`cam_survey` 读真实 `.prt`、`cam_plan` 出工序单、缺高风险声明时 `cam_run` 必须被闸门拦下并返回中文清单；
3. 端到端（需 Windows NX 侧在线）：web 会话上传 `.prt/.dwg` → 文件成功中转到 NX 主机输入目录 → `cam_run` 弹签字卡 → 后台跑完 → 检查报告 → 签字 → 交付包回收到会话工作区，「交付物」页签可见；
4. 记忆闭环：交付后 `extract_memory` 落 draft，page-memory 审核采纳，下次同类任务 `search_memory` 命中。

## 8. 后续方向（非目标清单）

报价场景（独立设计，费率纯函数 + LLM 估工时）；机床管理页面；范本自动对标（按 signature 主动推相似范本而非等模型搜）；批量零件并行编排（`dsh-tool-workflow` 是官方答案，届时评估）；DAG/甘特进度视图（session 事件流已够用时不做）；仿真级碰撞检查（留给人，不接）。
