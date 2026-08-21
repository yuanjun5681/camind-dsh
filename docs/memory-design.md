# 记忆库（知识库 + 经验库）设计

> 状态：已落地（camind-tool-memory + camind-page-memory；2026-08-21 冒烟通过：服务层 CRUD/检索/git、Host API、LLM 元数据补全（含检索别名 aliases）、三阶段检索（查询改写+RRF+语义重排）、headless 工具实调、client bundle 加载）
> 范围：知识库与经验库的存储、检索、页面与 Agent 工具；**不实现**轨迹（trajectory）、向量检索、自动注入与后台蒸馏管道
> 存储标准：知识条目与经验条目全部是符合 [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 的 concept，记忆库根目录是一个 OKF bundle

## 1. 背景：原项目记忆库分析

原项目（FastAPI + React 单体应用）的记忆子系统分三层：**磁盘 markdown 真相源 → 派生索引库 → 检索/注入服务层**。权威文档是其 `docs/memory_and_knowledge_design.md`，以下为代码现状（`backend/app/services/{knowledge,experience,memory}/`）。

### 1.1 三个组成部分

- **知识库（knowledge）** `workspace/knowledge/<name>.md`：人工维护的领域事实（行业/工艺/电路类型/企业规范），一条知识一个 markdown 文件，YAML frontmatter 是检索元数据，正文是规范文档。独立 git 仓库，写操作自动 commit。
- **经验库（experience）** `workspace/experience/exp-*.md`：run 后由 LLM 自动蒸馏的「情境化教训」，正文强制三段式「情境/教训/做法」，有 `candidate → validated → deprecated` 生命周期与 0~1 置信度。独立 git 仓库。**只能由蒸馏产生，无手工新建 API**；人工负责审核晋升/弃用/合并。
- **memory 服务** `services/memory/`：不拥有内容，只是索引（`memory_index.db`，sqlite-vec 向量 + 元数据 + 关系边 + usage 遥测）、检索（HybridRetriever；无 embedding 时降级为纯元数据匹配，这是设计内的一等路径）、注入（run 启动时把 top-k 知识卡片与经验全文前置进 Designer/Coder 输入）与蒸馏/生命周期引擎。

分工边界（其设计 §4.7）：经验是「避开什么坑」的情境教训，知识是「领域事实」；反思巩固产出的稳定原则可人工转写为知识，构成「run 产经验 → 反思炼原则 → 原则沉淀为知识」的输送带。

另有一个与本设计直接相关的机制：知识条目的**元数据自动补全**——上传缺 `description` 的文档时先落 `metadata_status: pending`，后台用轻量 LLM 一次性生成 title/description/category/circuit_types/tags/related，成功转 `ready`、失败标 `failed`，前端每 3 秒轮询并在卡片上显示「生成中/生成失败」徽标（`services/knowledge/metadata.py`）。用户不需要手动填写任何检索元数据。

### 1.2 关键数据模型

知识条目 frontmatter：`name`（kebab-case = 文件名，禁 `exp-` 前缀）、`title`、`description`（≤1024，召回关键，必填）、`category`（`industry|process|circuit|enterprise|general`）、`circuit_types`（最强检索信号）、`tags`、`related`、`enabled`、`source`、`metadata_status`。单文件 ≤512KB。

经验条目 frontmatter：`name`（强制 `exp-` 前缀，`exp-YYYY-MM-<token>-NN`）、`status`（candidate/validated/deprecated）、`confidence`（蒸馏初值 0.55，随证据调整）、`trigger`（触发条件）、`evidence`（`[{source, ref, outcome, at}]`）、`circuit_types`/`tags`/`related`。正文三段式 `**情境**：/ **教训**：/ **做法**：`，单文件 ≤256KB。

### 1.3 检索与消费

- 检索打分（元数据路径）：`circuit_types` 命中 ×10 > tag ×3 > title/description 词重叠 ×1（封顶 5）；向量路径另加相似度分与 1-hop 图扩展；deprecated 硬过滤。
- Agent 消费是「推 + 拉」：推 = run 启动时注入知识 top-3 卡片 + 经验 top-2 全文（candidate 受双闸门：最多 1 条且检索分 ≥8.0）；拉 = Designer/Coder 的 `read_knowledge(name)` 工具读全文。经验无拉取工具（已全文注入）。
- 生命周期引擎：run 终态按证据与注入成败自动晋升/降级经验；candidate 池上限 200 淘汰。

### 1.4 轨迹（trajectory，本次不实现）

成功 run 的索引卡片（只存指针不存正文），召回命中后以「相似成功轨迹」卡片注入，模型用 `read_trajectory(ref)` 拉取该 run 的设计文档与最终识别器代码作 few-shot。与经验互补：经验告诉模型「避开什么坑」，轨迹给模型「照着什么抄」。本次迁移不做，列入后续方向（§10）。

### 1.5 前端布局（复刻参考）

`MemoryPage`（`/memory`）+ `KnowledgeDetailPage`（`/memory/:name`），侧边导航「记忆库」一项。布局要点：

- 单页双 tab：顶栏 Brain 图标 + Tabs「知识库 / 经验库」+ 说明文案；右侧仅知识 tab 显示「上传」「新建条目」。
- 知识 tab：过滤条（搜索框「搜索名称 / 描述 / 标签」+ category 圆形 chip 组 + 计数 `N / M 条`）；下方响应式卡片网格（`grid-cols-1 md:2 xl:3`）。卡片：标题 + mono 名称 + 两行 description + 徽标行（生成中/生成失败/category 彩色徽标 / circuit_type mono 徽标 / tag chip / 相对更新时间），右上角下拉（启用/禁用、删除），点击整卡进详情。
- 经验 tab：status chip（全部/候选 N/已采纳 N/已弃用 N）+ circuit_type chip + 搜索框；卡片网格候选置顶，显示置信度、证据数、注入成功率；选中后 master-detail 展开：触发条件→情境→**教训**（高亮左边条）→做法 四段，操作按钮（采纳/弃用/恢复/编辑/删除），下方证据链列表。
- 知识详情页：返回 + mono 名称 + 启停/编辑/删除；H1 标题 + description + 徽标行 + 关联 chip；分隔线下 ReactMarkdown 渲染正文。编辑是大对话框：左栏元数据表单，右栏 markdown 编辑/预览切换。

### 1.6 迁移时的取舍结论

原项目的记忆系统运行在一个 FastAPI 进程 + 单一 workspace 内，有 embedding 配置和后台 worker；本工作区是 dsh 插件工作区，无构建、无数据库、session 可绑定任意工作区。因此本设计保留其**磁盘格式、数据语义、生命周期、页面布局与元数据自动补全**，放弃其**索引库、向量层、后台蒸馏/反思管道与自动注入**——其中「元数据匹配检索」在原项目本来就是设计内的一等降级路径，直接升格为唯一实现（§5）；「提取记忆」由模型在会话中显式调用工具完成（§6），不需要后台蒸馏管道。元数据补全需要的唯一一次轻量 LLM 调用，dsh 恰好以 `llm` Cordis 服务的形式暴露给插件（§7.4），不引入任何新基础设施。

## 2. 目标与非目标

目标：

1. 记忆库落盘格式**完全符合 OKF v0.2**：记忆库根目录是一个 OKF bundle，每条知识/经验是一个 OKF concept（一个 `.md` 文件 = YAML frontmatter + markdown body，frontmatter 必有非空 `type`）。
2. `camind-tool-memory` 工具插件：给 Agent 提供搜索、读取、保存、提取四个记忆工具；同时以 Cordis 服务形式导出领域逻辑供页面插件复用。
3. `camind-page-memory` 页面插件：左侧边栏底部「记忆库」菜单 + 两级页面（列表 → 详情），布局参考原项目前端；**支持上传文档（.md/.txt），元数据（title/description/category/circuit_types/tags）由 LLM 自动生成，用户无需手动填写**。
4. 记忆跨 session、跨工作区沉淀（DSH_HOME 级），git 版本化可恢复。

非目标（列入 §10 后续方向）：轨迹、向量检索 / embedding、prompt 自动注入、usage 遥测与生命周期自动引擎、反思巩固、后台蒸馏、条目关系图、markdown 渲染增强。

## 3. 总体架构

```text
$DSH_HOME/memory/                 OKF bundle（独立 git 仓库，DSH_HOME 级，所有 session 共享）
├── index.md                      frontmatter 声明 okf_version: "0.2"；body 是目录清单
├── knowledge/                    知识库
│   ├── index.md                  条目清单（写操作后重建）
│   └── <name>.md                 type: Knowledge
└── experience/                   经验库
    ├── index.md
    └── exp-YYYY-MM-<slug>-NN.md  type: Experience

camind-tool-memory（tool-memory/）   headless + web 全局加载
├── 提供 Cordis 服务 memoryBank（解析/校验/CRUD/检索/git 提交）
└── 注册 4 个模型工具：search_memory / read_memory / save_memory / extract_memory

camind-page-memory（page-memory/）   仅 web profile
├── Host：prefix /camind/api/memory（裸 req/res，消费 memoryBank 服务）；
│   上传/缺元数据时经 dsh llm 服务后台自动补全
└── Client：sidebar.footer.action「记忆库」菜单 + shell.content 两级页面
```

关键决策：

1. **DSH_HOME 级共享**。记忆是长期资产，session 是短暂的；跨会话沉淀才能「越用越聪明」。与 skills 同级（`$DSH_HOME/`），不按 session 或工作区隔离。默认启动器下即项目根 `.dsh/memory/`，已整体 gitignore。
2. **服务与工具同插件**。照 tool-upload 先例（提供 `uploads` 服务 + 注册工具）：`camind-tool-memory` 既 `ctx.provide('memoryBank', …)` 又注册 4 个工具；`camind-page-memory` 通过 `inject: ['webServer', 'memoryBank']` 消费同一服务，**不**走相对路径动态 import。
3. **纯元数据检索**，无索引库、无向量。条目量级是几十到几百个文件，每次检索直接扫描解析 frontmatter 即可，无需缓存层。
4. **拉取式消费**。v1 记忆只通过工具被模型显式搜索/读取（pull），不做 run 启动时的自动注入（push）。
5. **git 版本化**。写操作经 `gitRepository` 服务 best-effort 自动 commit（失败仅告警）；只读操作不 `git init`（沿用 GET 不 init 原则）。v1 不提供历史/diff/回滚 UI，仓库只为可恢复。
6. **元数据自动补全复用 dsh `llm` 服务**。dsh 以 Cordis 服务形式暴露 LLM 调用（`@deepseek-ai/dsh-llm` 的 `LlmRuntime`，服务名 `llm`，`stream(options)` 一次性流式调用；默认模型由 `agentDefaultModel` 服务的 `currentSelection()` 给出；API key 走 dsh 统一的 credentials 层，与 Web Models 页/环境变量同源）。插件不需要也不允许自己管理模型配置与密钥。

## 4. 存储设计：OKF bundle

### 4.1 OKF v0.2 采用方式

OKF（Open Knowledge Format）是 Google 提出的知识交换格式，自我定位为「intentionally minimal: a directory of markdown files with YAML frontmatter」。其 v0.2 一致性要求只有三条（SPEC §11）：

1. 树内每个非保留 `.md` 文件含有可解析的 YAML frontmatter；
2. 每个 frontmatter 含有非空 `type` 字段；
3. 保留文件名 `index.md` / `log.md` 出现时须符合各自结构。

`type` 值不做中心注册，生产者选描述性值，消费者必须对未知字段、未知 type、断链宽容。任意额外的 frontmatter 键都是合法的生产者扩展。本设计的映射：

| OKF 概念 | 本设计 |
|---|---|
| Knowledge Bundle | `$DSH_HOME/memory/`（git 仓库是 OKF 推荐的分发形式） |
| Concept | 一条知识 / 一条经验 = 一个 `.md` 文件 |
| Concept ID | bundle 内相对路径去 `.md`：`knowledge/<name>`、`experience/<name>` |
| `type`（唯一必填） | `Knowledge` / `Experience` |
| `okf_version` | 根 `index.md` frontmatter 声明 `"0.2"`（index.md 唯一允许 frontmatter 处） |
| 生命周期 `status` | `draft` / `stable`（默认）/ `deprecated` —— 经验三态直接映射：candidate=draft、validated=stable、deprecated=deprecated |
| 信任 `generated` / `verified` | 工具写入记 `generated.by`；人工 promote 记 `verified` |
| 溯源 `sources` | 可选，工具/页面不强制 |
| Actor 约定 | agent 用 `<agent>/<model>`，人用 `human:`，自动流程用 `process:` |
| 领域字段 | OKF 合法扩展键：`category` / `circuit_types` / `aliases` / `trigger` / `confidence` / `evidence` / `metadata_status` |
| 条目关联 | 不做 `related` 字段与图边；需要关联时直接写正文 markdown 链接（推荐 bundle 相对 `/knowledge/<name>.md` 形式，断链合法） |
| 保留文件名 | `index.md`、`log.md` 禁止用作条目名；`log.md` v1 不生成（git 历史覆盖） |

### 4.2 知识条目（`knowledge/<name>.md`）

```yaml
---
type: Knowledge
title: BGR 电路类型规范
description: 带隙基准电路的 ptnSet 生成规范，涵盖电路结构识别、Pattern 分组与 rotation 规则。
tags: [bgr, bandgap, pattern]
category: circuit            # 扩展键：industry | process | circuit | enterprise | general
circuit_types: [bgr]         # 扩展键：最强检索信号
aliases: [带隙基准, bandgap, BGR, 基准电压]   # 扩展键：检索别名（同义词/中英文/缩写，补全时 LLM 生成；Contextual Retrieval 写入侧）
status: stable               # OKF 原生；知识直接 stable
metadata_status: ready       # 扩展键：pending | ready | failed；仅「元数据缺失待补全」时为 pending/failed
generated: { by: human:user, at: 2026-08-21T06:40:00Z }
sources:                     # 可选 OKF provenance
  - id: bgr-wiki
    resource: https://example.internal/bgr-spec
    title: BGR 设计规范
---
# BGR 电路类型规范
正文 markdown……
```

约束（沿用原项目）：`name` 为 kebab-case（`^[a-z0-9][a-z0-9-]*$`），禁 `exp-` 前缀，禁保留文件名；单文件 ≤512KB；UTF-8。上传条目的 `name` 由文件名派生（去扩展名、转 kebab-case，重名追加 `-2`/`-3`…），**上传全程不需要用户输入任何字段**。`description` 是召回关键，但**不要求用户填写**：任何来源的条目只要缺 `description`（或缺 `title`）就落 `metadata_status: pending`，由后台 LLM 补全（§7.4）后转 `ready`，失败标 `failed`（可编辑手填或等待重试）。工具保存的条目（`save_memory`）由模型当场给出元数据，直接 `ready`。

### 4.3 经验条目（`experience/exp-YYYY-MM-<slug>-NN.md`）

```yaml
---
type: Experience
title: 共享网络分组时排除电源/地节点
description: 以电源/地网络作为共享节点不应构成有效耦合组，分组前需显式过滤。
tags: []
circuit_types: []
trigger: 当识别逻辑按「多个器件连接同一网络」划分候选组时   # 扩展键
confidence: 0.55                                            # 扩展键，提取初值 0.55
evidence:                                                   # 扩展键
  - { source: session, ref: <session-id>, outcome: pass, at: 2026-08-21 }
status: draft                # candidate=draft；人工采纳后 stable；弃用 deprecated
generated: { by: dsh-agent/deepseek, at: 2026-08-21T06:40:00Z }
verified: []                 # promote 时追加 { by: human:user, at: … }
---
**情境**：若耦合节点恰为电源或地网络，会把大量无关器件错误并入同一组，导致伪匹配

**教训**：以电源/地网络作为共享节点时不应构成有效耦合组，需在分组前显式过滤

**做法**：判断共享网络前先检查网络属性，若为电源或地则跳过该节点……
```

约束：`name` 强制 `exp-` 前缀，由服务按 `exp-YYYY-MM-<slug>-NN` 生成（NN 为当月序号）；正文强制三段式（与原项目解析格式兼容）；单文件 ≤256KB。**经验无手工新建入口**——只能由 `extract_memory` 工具产生（或直接往目录里放文件），人工在页面审核流转。

### 4.4 生命周期操作映射

| 操作 | frontmatter 变化 |
|---|---|
| `extract_memory` | 新建 `status: draft`、`confidence: 0.55`、`evidence` 自动附当前 session |
| promote（采纳） | `status: stable`，`verified` 追加 `{ by: human:user, at }` |
| deprecate（弃用） | `status: deprecated`（检索硬过滤，页面默认折叠） |
| 编辑 stable 经验 | 自动退回 `status: draft`（沿用原项目「编辑已采纳条目退回复核」规则） |
| 删除 | 移除文件（git 历史保留，可恢复） |

置信度自动调整、注入成功率、候选池淘汰属于生命周期引擎，v1 不做——`confidence` 只是展示字段。

### 4.5 index.md 与 git

- 根 `index.md`：frontmatter 仅 `okf_version: "0.2"`，body 按 OKF §8 结构列出两个子目录。`knowledge/index.md`、`experience/index.md` 列出各自条目（`* [title](name.md) - description`），每次写操作后重建，失败不阻塞。
- 首次写操作时 `gitRepository.initRepository({ repoRoot: <memory-root>, bootstrapGlobs: ['**/*.md'] })`，之后每次写操作 `commit({ worktreePath: <memory-root>, message, addGlobs: ['**/*.md'] })`；commit message 沿用原项目风格（`feat(memory): create knowledge <name>` / `chore(memory): deprecate <name>` 等）。所有 git 失败仅 `console.warn`，不阻塞写。

## 5. 检索设计（三阶段：查询改写 → 元数据粗排 + RRF → LLM 语义重排）

**阶段 0：LLM 查询改写**（`lib/expand.js`）。把查询改写成 3-4 个检索变体（同义词、中英文对照、缩写/全称、领域惯用语，如 `power` → `电源 / power supply / VCC/VDD / 供电`），治「同义词召回不到」。改写失败退化为原查询单路。

**阶段 1：元数据粗排 + RRF 融合**。`memoryBank.search` 直接扫描条目文件、解析 frontmatter 打分（原项目 MetadataRetriever 的简化版），每个变体各召回一版，按 RRF（k=60）融合成候选池（≤50 条；关键词命中不足 20 条时用近期条目补足，给阶段 2 救回「词不匹配但语义相关」条目的机会）：

```text
score = circuit_types 命中 ×10
      + tag 命中 ×3
      + aliases 命中 ×2（检索别名，Contextual Retrieval 写入侧钩子）
      + title/description 词重叠 ×1（封顶 5）
      + body 子串命中 ×1（封顶 2）
```

**阶段 2：LLM listwise 重排**（`lib/rerank.js`）。候选池交给模型按语义相关性重排：一次 `llm.stream` 调用，输入查询 + 候选摘要清单，输出编号数组。

三个阶段全部 fail-soft：`llm` / `agentDefaultModel` 经 `ctx.get` 防御式读取（共享层 `lib/llm.js`），任何阶段不可用或输出无法解析都回退到前一阶段的结果（无改写 → 单路召回；无重排 → RRF/元数据序）。返回 JSON 带 `ranked_by: llm | metadata` 与 `expanded_queries`（改写成功时）。浏览式调用（`q` 为空）跳过全部 LLM 阶段。一次带关键词的搜索最多两次轻量 LLM 调用（maxTokens 256 + 512）。

- 过滤：`type`（Knowledge/Experience）、`status`、`category`、`tag`、`circuit_type`；`deprecated` 默认排除（显式 `status: deprecated` 才返回）。
- `q` 为空白字符分隔的关键词集合，命中任一即计分；大小写不敏感。
- 粗排结果按 score 降序，同分按 `generated.at` 新者优先；返回 summary（不含 body）+ score。
- draft 经验照常返回但标注状态，由模型自行判断信任度（原项目的 candidate 双闸门属于注入层，v1 无注入层故不需要）。
- `metadata_status: pending` 的知识条目照常参与检索（body 关键词仍可能命中），但摘要里标注元数据生成中。

## 6. camind-tool-memory（工具插件）

目录 `tool-memory/`，三文件结构 + `lib/` + `tools/`，照 tool-upload 模式：`inject: ['tools', 'gitRepository']`，每个工具一个 `tools/*.js`，共享实现放 `lib/`（frontmatter 解析/序列化手写，不引依赖——frontmatter 只用 YAML 子集：标量、行内列表、嵌套 mapping；解析器按现有条目形状实现，序列化器保证输出可解析）。

```js
// index.js
export const name = 'tool-memory'
export const inject = ['tools', 'gitRepository']

export function apply(ctx) {
  const memoryBank = createMemoryBankService({ gitRepository: ctx.gitRepository })
  ctx.provide('memoryBank', memoryBank)
  registerSearchMemory(ctx, memoryBank)
  registerReadMemory(ctx, memoryBank)
  registerSaveMemory(ctx, memoryBank)
  registerExtractMemory(ctx, memoryBank)
}
```

记忆根 = `path.join(process.env.DSH_HOME, 'memory')`（dsh 进程必有 `DSH_HOME`；缺省时拒绝写操作并报错）。服务方法（`exec` 首参约定同 tool-upload，用于取 session id 记 evidence）：

```js
{
  listEntries({ type, status, category, tag, circuit_type, q, limit }),
  readEntry(type, name),                       // → { frontmatter, body, markdown } | null
  saveKnowledge(exec, { name?, title, description, category?, circuit_types?, tags?, aliases?, body }),
  importKnowledge(exec, { filename, content }),  // 页面上传：name 从文件名派生，frontmatter 合并，缺元数据落 pending
  updateEntry(exec, type, name, patch),        // 编辑 stable 经验自动退回 draft
  deleteEntry(exec, type, name),
  extractExperience(exec, { title, trigger, situation, lesson, action, circuit_types?, tags? }),
  setExperienceStatus(exec, name, 'stable' | 'deprecated'),
  search({ q, type, status, limit }),
}
```

### 6.1 四个模型工具

工具定义用与 tool-upload 相同的 `toolDefinition(name, 中文 description, JSONSchema, async (args, exec) => 字符串)` 形状；错误返回中文描述字符串，不 throw。

| 工具 | 参数 | 行为与返回 |
|---|---|---|
| `search_memory` | `{ q?, type?, status?, tag?, circuit_type?, limit=8 }` | 搜索知识库与经验库，返回 JSON 摘要列表（`name/type/title/description/status/category/circuit_types/tags/score`）。description 中说明：做设计/编码决策前先搜是否已有相关知识与教训；无结果时提示可用 `save_memory`/`extract_memory` 沉淀。 |
| `read_memory` | `{ type, name }` | 按类型+名称读条目全文（frontmatter + body 的完整 markdown）；不存在返回错误串。 |
| `save_memory` | `{ name?, title, description, category?, circuit_types?, tags?, body }` | 保存**知识**条目（新建或按 name 覆盖更新）；name 缺省时从 title 派生 kebab-case。直接 `status: stable` + `metadata_status: ready`，`generated.by` 记 `dsh-agent/<model，取不到则 unknown>`。返回条目路径提示。 |
| `extract_memory` | `{ title, trigger, situation, lesson, action, circuit_types?, tags? }` | 把当前会话中验证过的做法提炼为**经验候选**：服务生成 `exp-…` 名，`status: draft`、`confidence: 0.55`，`evidence` 自动附 `{ source: 'session', ref: <session-id>, outcome: 'pass', at }`。返回提示「已保存为候选经验，需在记忆库页面人工审核采纳后生效」。 |

`save_memory` 与 `extract_memory` 的语义边界写在 description 里（沿用原项目）：知识 = 稳定领域事实/规范，保存即生效；经验 = 情境化教训（什么情境、什么坑、怎么做），以候选身份落库，人工采纳后才稳定。

工具在 headless 与 web 两个 profile 全局加载（同 tool-upload），所有模式的 Agent 都能用。

## 7. camind-page-memory（页面插件）

目录 `page-memory/`，结构与 tool-memory 相同的三文件形态加 `lib/`：`package.json`（`dsh.bundle` + `dsh.client` + `./client` export）、`cordis.patch.yml`、`index.js`（Host）、`lib/server.js`、`lib/client.js`。`inject: ['webServer', 'memoryBank']`。

### 7.1 菜单与路由

- `sidebar.footer.action` 注册「记忆库」菜单项（`order: 20`，「设置」之上），图标从 `@deepseek-ai/dsh-client-ui-primitives` 选近似（数据库/书本形）；组件接 owner props `{ wide, pathname, navigate }`，分展开/折叠两态渲染。
- `shell.content` 注册路由 `/camind/pages/memory`（chain `select` 匹配该前缀，`priority: 100`）。深链接刷新有效（select 每次从 pathname 重算）。

### 7.2 Host API（prefix `/camind/api/memory`）

最长前缀优先，与 ui-shell 的 `/camind/api` 错开。裸 `req/res` 路由 + `sendJson`/`readBody` helper。GET 不 `git init`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/entries?type=&q=&status=&category=&tag=&circuit_type=` | 条目摘要列表 |
| GET | `/entries/<type>/<name>` | 详情（含 body 与完整 markdown） |
| POST | `/entries/knowledge/upload` | 上传文档（知识条目唯一页面入口）：body 为 JSON `{ files: [{ filename, content }] }`（浏览器 `FileReader` 读文本，**不解析 multipart**；仅 .md/.txt，单文件 ≤512KB，单请求 ≤8MB，逐文件容错）。缺元数据的条目落 `metadata_status: pending` 并触发后台补全（§7.4） |
| PUT | `/entries/<type>/<name>` | 更新（编辑 stable 经验退回 draft） |
| DELETE | `/entries/<type>/<name>` | 删除 |
| POST | `/entries/experience/<name>/promote` | 采纳（→ stable，记 verified） |
| POST | `/entries/experience/<name>/deprecate` | 弃用（→ deprecated） |

### 7.3 页面布局（参考原项目）

手写 client bundle（`window.__ModuleLoader__.load`，id = `camind-page-memory`），React `createElement` 不用 JSX，样式作用域前缀 `pmm-`，全部用 `--dsw-alias-*` 设计令牌跟随明暗主题，`fetch` 裸调 API + `useApi` hook 三态。

**一级 `/camind/pages/memory`**——单页双 tab（tab 状态同步 URL query，可深链）：

- 顶栏：Tabs「知识库 / 经验库」+ 一行灰色说明文案；右侧仅知识 tab 显示「上传」。**上传零表单**：点「上传」弹系统文件选择器（hidden file input，多选 .md/.txt），选完即传即处理——不出现任何表单、确认框或元数据填写步骤；卡片直接出现在网格里并显示「生成中」，name 从文件名派生，其余元数据全部由后台自动补全（§7.4）。知识条目的页面入口只有上传（Agent 侧另有 `save_memory`）。
- 知识 tab：过滤条（搜索框「搜索名称 / 描述 / 标签」+ category 圆形 chip「全部/行业规范/工艺规范/电路类型/企业知识/通用」+ 右侧计数）；下方响应式卡片网格。卡片：标题（truncate）+ mono 名称 + 两行 description + 徽标行（**生成中/生成失败**（`metadata_status`）/category 彩色徽标 / circuit_type mono 徽标 / 前 3 个 tag chip / 相对更新时间）；pending/failed 卡半透明；点击整卡进二级详情。存在 pending 条目时每 3 秒轮询列表。
- 经验 tab：status chip「全部 / 候选 N / 已采纳 N / 已弃用 N」+ 搜索框；卡片网格候选置顶。卡片：status 徽标 + 标题 + mono 名称 + 置信度 + 证据数 + trigger 一行摘要；点击进二级详情。

**二级 `/camind/pages/memory/<type>/<name>`**——详情页：

- 顶栏「← 返回列表」+ mono 名称；右侧操作：编辑、删除（ConfirmDialog，文案提示 git 保留历史）；经验另有「采纳」「弃用」按钮（按当前 status 显隐）。
- 正文居中限宽：H1 标题 + description 段落 + 徽标行（type/category/circuit_types/tags/status/置信度/相对时间）；`metadata_status` 为 pending/failed 时显示「元数据生成中 / 生成失败，可编辑手填」横幅（pending 时 3 秒轮询）；分隔线下展示正文——**v1 用等宽 `<pre>` 展示 markdown 源文**（client bundle 种子模块无 markdown 渲染器；渲染增强见 §10）。
- 经验详情额外按序展示 触发条件 → 情境 → 教训（高亮左边条）→ 做法 四段，以及证据链列表（source/ref/outcome/at）。
- 编辑（仅针对已有条目的显式管理动作，与上传/新建流程无关）：对话框左栏元数据字段（名称/标题/描述/category/circuit_types/tags，逗号分隔输入——全部可留空，留空则保存后进入自动补全），右栏 body 大 textarea（v1 无预览）。

### 7.4 元数据自动补全（LLM）

复刻原项目 `services/knowledge/metadata.py` 的行为，用 dsh 自带能力实现，不加新基础设施：

- **触发**：`/entries/knowledge/upload` 落盘的条目缺 `description`（或缺 `title`）时，置 `metadata_status: pending` 并立即返回，后台异步补全；编辑保存后元数据被清空的同样进入补全。
- **调用**：Host 侧防御式读取 `ctx.get('llm')`（可选服务的防御式写法，不作为 `inject` 硬依赖——`llm` 不可用时页面其余功能不受影响）；provider/model 取 `ctx.get('agentDefaultModel')?.currentSelection()`（用户当前默认模型），都取不到则直接标 `failed`。一次性 `llm.stream({ provider, model, messages, … })` 调用，按 `@deepseek-ai/dsh-llm` 的 `BlockAssembler` 语义聚合文本；prompt 要求只输出 JSON `{ title, description, category, circuit_types, tags, aliases }`（category 限定五值词表；`aliases` 是 5-10 个检索别名——同义词、中英文对照、常见缩写/全称，即 Contextual Retrieval 的写入侧增强，参与 §5 打分 ×2），正文截断送入（如前 8000 字符）。
- **落盘**：解析 JSON 成功 → 合并进 frontmatter（不覆盖用户已手填的字段）、`metadata_status: ready`、自动 commit；调用或解析失败 → `metadata_status: failed`，正文与已有元数据不动。
- **可见性**：卡片与详情的「生成中/生成失败」徽标 + 3 秒轮询（§7.3）；failed 条目用户可在编辑对话框手填，保存即 `ready`（手填视为人工确认，不重触发补全）。
- **分寸**：这是唯一的后台 LLM 用途。不引入模型分档（原项目用 curation 档轻模型，我们直接用默认模型）、不做定时重试、不对经验条目补全（经验由 `extract_memory` 给出完整元数据）。

## 8. 安全与约束

- 记忆库存私有电路领域知识：`$DSH_HOME/memory/` 在默认启动器下位于已整体 gitignore 的项目根 `.dsh/` 内，不提交、不外传（同 `.dsh/` 既有安全约定）。
- 元数据补全会把上传文档的内容（截断后）发送给用户在 dsh 中配置的模型提供商——这与任何一次 Agent 会话的数据出域同级别、同通道（dsh credentials 层），不新增出域面；不使用第三方服务。
- 条目名严格校验（kebab-case 白名单、禁 `..`/斜杠/保留文件名/ `exp-` 前缀混用），写路径限定在 `$DSH_HOME/memory/{knowledge,experience}/` 内，防路径穿越；上传按 `filename` 同样校验并强制 .md/.txt 扩展名。
- 大小上限：知识单文件 ≤512KB、经验 ≤256KB、上传单请求 ≤8MB；列表/搜索接口有 `limit` 上限（默认 8、最大 50）。
- 工具与页面共享同一服务，所有校验（命名、尺寸、status 迁移合法性）只在服务层实现一份。

## 9. 登记与验证

实现时的登记步骤：

1. `scripts/init.mjs` profile 模板：`camind-tool-memory` 进 headless + web 两个模板，`camind-page-memory` 只进 web 模板；跑 `npm run init` 重建 profile。
2. 根 `AGENTS.md`：目录结构、插件分工、测试策略三节补记忆库条目；`docs/README.md` 项目专题登记本文档。
3. 验证一（无需 API key）：`node scripts/dsh.mjs --profile headless --dump-config` 确认两个插件行出现。
4. 验证二（headless 工具冒烟）：`node scripts/dsh.mjs --profile headless "用 save_memory 保存一条关于 BGR 电路的知识，然后 search_memory 找到它，再 extract_memory 提炼一条经验"`，检查 `$DSH_HOME/memory/` 落盘文件符合 OKF（frontmatter 有非空 `type`、根 index.md 声明 `okf_version`）、git log 有自动提交。
5. 验证三（页面冒烟）：`node scripts/dsh.mjs web` 后侧栏底部出现「记忆库」，进入 `/camind/pages/memory`：知识/经验 tab 列表、搜索过滤、详情、编辑、删除、经验采纳/弃用；刷新深链接保持页面。**上传一个无 frontmatter 的 .md 文档**：条目先显示「生成中」，数秒内 title/description/category/tags/aliases 自动填好（无需任何手填），失败时显示「生成失败」且可编辑手填。

## 10. 后续方向

### 10.1 检索增强路线（2026 年前沿方案评估）

检索方案的选型前提是：语料为几十到几百条 markdown、消费者是会多轮调工具的 Agent。按此评估 2026 年前沿方案：

**已落地（2026-08）**：

1. 工具描述引导多关键词/同义词检索（零成本，`search_memory` description）。
2. LLM listwise 语义重排（`lib/rerank.js`，元数据粗排候选池的第二阶段）。
3. LLM 查询改写 multi-query + RRF 融合（`lib/expand.js`，治「同义词召回不到」；一次带关键词搜索最多两次轻量 LLM 调用）。
4. 写入侧 Contextual Retrieval：元数据补全生成检索别名 `aliases`（同义词/中英文/缩写，打分 ×2；Anthropic Contextual Retrieval 的简化版——我们的「chunk 情境前置」就是 description + aliases，且条目本身就是完整文档无需再切块）。
5. Agentic 检索本就成立：`search_memory` + `read_memory` 组合即「查 → 读 → 再查」的推理循环，小语料 + 会迭代的消费者大幅降低对检索器精度的要求。

**未做，按优先级**：

6. **目录注入（retrieval-free 轻注入）**：把根 `index.md`（标题 + 一句话描述清单）注入会话，模型用 `read_memory` 点名——OKF progressive disclosure 的设计本意；长上下文时代小语料（全库几百 KB）的正经方案，也是 §10.2-2「prompt 自动注入」的最轻形态，建议先于完整注入层实现。
7. **embeddings 向量层**：dsh `llm` 服务只暴露聊天流式调用、**无 embeddings 接口**，需直连用户配置的 provider 的 OpenAI 兼容 `/embeddings`（凭据走 dsh credentials 层），向量落 sqlite-vec 或 plain JSON 文件；元数据路径保留为降级。条目规模到几千再论证。
8. **轻量条目关系图**：`related` / 共现边、「经验→知识」转写链（原项目 edges 思路）。不上图数据库、不做 GraphRAG——LinearRAG 实证关系抽取质量不高时图检索反而不如 naive RAG。

**评估后明确不采用**：late interaction / 多向量（ColBERT/ColPali，infra 重、为大规模语料设计）；Self-RAG/CRAG 纠错检索（Agent 行为层，工具描述引导已获大部分收益）；Agent 记忆框架 Mem0/Letta/Zep（解决聊天历史记忆，与本设计「人工审核的领域知识库」定位不同；可借鉴 Mem0 的去重合并见 §10.2-3、Zep 的时序演化）。

### 10.2 系统演进（本次不实现）

1. **轨迹（trajectory）**：成功 run 的索引卡片 + `read_trajectory` 拉取 few-shot，依赖业务工具链的 run 产物指针。
2. **prompt 自动注入**：Agent 在设计/编码类任务前检索 top-k 知识卡片与经验全文前置进输入（push），以及 candidate 双闸门；轻量版见 §10.1-6。
3. **usage 遥测与生命周期引擎**：注入成败回写、置信度自动调整、候选池淘汰、近似经验去重合并。
4. **反思巩固**：同类经验簇归纳为高层原则并人工转写为知识。
5. **markdown 渲染增强**：详情页正文接渲染（可复用 web profile 已有的 `dsh-markdown-preview` 的 server 端 markdown-it，或引入渲染能力）。
6. **log.md 与 backlinks**：按 OKF §9 的更新日志、正文链接图视图。
7. **元数据补全的模型分档与重试**：用轻量模型做补全、失败自动重试、批量补全。
