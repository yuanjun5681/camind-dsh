# Camind 平台设计外部事实核查

研究日期：2026-10-19。已先读 `camind-platform-design.md`；仅写本研究记录，不修改三份设计，不访问 `.env`、`.dsh`。范围：ClawSynapse 通信边界、现场顾问 Agent ↔ 云支持 Agent、ESP32 现场用途。

## 摘要

**ClawSynapse 可作为现场与云支持 Agent 的候选通信通道，但不能直接视为已验收的多租户支持平台、可靠工单系统或设备安全控制层。** 仓库确有节点身份、信任、消息、JetStream 持久订阅及文件传输实现；部分文档停留在建议/规划阶段，应按固定代码版本验证。ESP32 官方资料支持工业 HMI、数据可视化和网关等产品用途，不证明 Camind 客户需要 ESP32，也不证明整机具备功能安全资格。

## 核查基线与证据

通用搜索未检出项目；改用 [GitHub 官方搜索 API](https://api.github.com/search/repositories?q=clawsynapse) 找到唯一同名非 fork 仓库 [jiey616/clawsynapse](https://github.com/jiey616/clawsynapse)。本文将其作为项目维护者的一手来源，未独立确认其与用户所指项目的组织归属一致。核查 `main` 的树 SHA 为 **`3a2d8cd702905a0523a70f0a5b9c0f270dafdf19`**（[API 基线](https://api.github.com/repos/jiey616/clawsynapse/git/trees/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19?recursive=1)）。以下代码链接固定到此版本。

### 1. 真实架构：本地守护进程 + NATS + Agent 适配器

- **事实｜直接证据｜高置信：** [README](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/README.md) 自称 “local networking layer”，提供 `clawsynapsed` 和 CLI；[集成文档](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/docs/integration.md) 提供 Adapter 和 HTTP Webhook，不要求两端运行同一种 Agent。
- **研究判断：** 可以让现场与云端各跑 daemon，经可达的 NATS 通信，再桥接 Camind/dsh。未见已完成的 Camind 专用适配器；Webhook 接入不等于已有工单应用。

### 2. 身份与认证：认证的是节点密钥，不是工程师或企业角色

- **事实｜直接证据｜高置信：** README 说明本地 Ed25519 公钥派生 `did:key` 与 `nodeId`；[认证实现](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/internal/auth/service.go) 包含 challenge/response/ack 验签。[信任文档](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/docs/trust.md) 明确区分 `authenticated` 与 `trusted`，并注明 `open` 不验签、`trustAutoApprove` 可自动授信。
- **边界｜研究判断：** 节点身份不能代替“哪个客户、哪个站点、哪位用户、能批准什么”。客户/站点绑定、用户认证、动作权限和批准内容由 Camind 管理；生产不采用 `open` 或任意自动授信。
- **安全未知：** 文档提出 X25519 与对称加密的推荐分层，不能据此宣称现有消息已端到端加密；抽查发送代码看到的是签名后的 JSON 内容。跨网必须另验 TLS 与服务器访问权限。

### 3. 云站点连接 / NAT：可主动出站连接 broker，不是 NAT 打洞产品

- **事实｜直接证据｜高置信：** [NATS 客户端实现](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/internal/natsbus/client.go) 使用 `nats.Connect`，支持断线重连；没有在此实现中看到点对点 NAT 穿透。
- **推论｜中置信：** 两端都能出站访问云 NATS 时，Agent 通道通常无需工厂公网入站端口；仍取决于现场防火墙、代理、DNS、证书及允许协议。它不自动提供 Bot APP 登录、中继服务或移动端审批。
- **关键缺口：** [运行文档](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/docs/operations.md) 提及 NATS token/凭据及 TLS，但抽查 `Connect` 未见显式传入 token、creds 文件或 TLS 客户端配置。不能假定文档列出的配置均已完整接通，须连接启用认证的真实 broker 验证。

### 4. 持久化和去重：有实现，但不是业务“恰好执行一次”

- **事实｜直接证据｜高置信：** `client.go` 的 `SubscribeDurable` 使用 JetStream 文件流，代码创建流时保留期为 24 小时，显式 ACK、60 秒 AckWait、最多投递 5 次；**JetStream 不可用或订阅失败时会警告并降级 Core NATS**。已有流配置不一定等于这些创建默认值。
- **事实｜直接证据｜高置信：** [消息实现](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/internal/messaging/service.go) 在开启 replay guard 后按 envelope ID 做 24 小时去重；接纳并入本地会话队列后可返回 ACK，不等于加工/工单业务已完成。[Outbox](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/internal/messaging/outbox.go) 为 Agent 回复先落盘再重试，存在重试预算，重试生成新 envelope ID。
- **边界｜研究判断：** 不能把“同一报文去重”写成“同一任务永不重复执行”。Camind 仍需持久业务 ID、请求指纹、执行状态、结果回查和副作用幂等；恢复场景不能只靠对话或通信 ACK。生产若要求可靠通道，应阻止无持久能力的降级，或在业务层显式报不可用。

### 5. 文件传输：确有 broker 对象存储，不等于机床接收

- **事实｜直接证据｜高置信：** [文件服务](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/internal/transfer/service.go) 经 NATS JetStream ObjectStore 存取文件，记录对象 digest，接收端落盘后发出通知；没有 JetStream 时文件服务不可用。发送侧 `completed` 在对象上传成功后设置，不能解释为远端 Agent、尤其机床已接收。
- **边界｜研究判断：** Camind 须独立核对内容 SHA、任务与文件版本绑定、站点/设备目标、接收凭据。抽查还看到传输记录/已下载判断保存在内存，接收路径使用对象头文件名拼接；重启去重、路径约束、接收限额和对象写入者身份需专门验证，不应直接承诺安全接收任意客户文件。此为审查风险，非已复现漏洞结论。

### 6. 租户隔离：没有证据支持“开箱即用”

- **事实｜直接证据｜高置信：** 项目运行文档要求使用 NATS subject 权限；抽查流使用 `clawsynapse.>`，节点 inbox 以 `nodeId` 路由，不是业务 tenant 模型。[NATS 官方 Accounts 文档](https://docs.nats.io/running-a-nats-service/configuration/securing_nats/accounts) 才明确提供 account 的独立 subject namespace 和受控跨 account 共享。
- **判断｜解释｜中置信：** 不能把节点互信、独立 inbox 或 bucket 名当客户隔离。首期可选独立 broker/部署边界，或经验证的 NATS accounts/ACL；对象存储、发现广播、管理 API、云支持 Agent 上下文和业务数据库均须一起隔离。未核实 ClawSynapse 已支持所需跨 account 流程。
- **补充一手依据｜父会话已核实，本次未重复检索：** [Microsoft 多租户生命周期](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenant-life-cycle) 覆盖租户开通、停用/恢复、退出及数据保留期；[AWS The isolation mindset](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/the-isolation-mindset.html) 明确认证授权不等于租户隔离。**AWS 页面已标为 historical reference，仅作原则性历史参考，不据此推荐当前部署方案。**
- **Camind 建议｜研究推论：** 租户生命周期应归平台业务层：开通时建立客户、站点、凭据与数据边界；停用/恢复时显式调整访问与任务权限；退出时撤销连接及凭据，并按约定处理导出、保留期和删除。以上不是 ClawSynapse 已提供能力的证据，也不要求照搬 Azure/AWS 产品。

## 推荐边界：现场顾问 Agent ↔ 云支持 Agent

**建议有条件试用，不作为已定型基础设施。** 最小链路为：现场顾问 → 本地受限桥 → ClawSynapse/NATS → 云端受限桥 → 支持 Agent。首先只承载咨询、经授权的诊断摘要、证据引用和进度，不授予远程启动、现场正式版本启用或任意代码执行权。

| 通信层可以承担 | Camind 工单业务层仍须承担 |
| --- | --- |
| 节点身份、信任、消息路由、有限重投/去重、对象传输 | 客户/站点/用户权限，工单受理、归属、状态、补充信息、关闭/重开 |
| 技术接纳及投递通知 | 业务接受、处理结果、验收结论、版本关联与审计 |
| 会话键及消息元数据 | 持久工单 ID、附件授权/脱敏/保留期、副作用幂等 |

源码已有 `todo.*` 状态、取消及任务适配逻辑（[handler.go](https://github.com/jiey616/clawsynapse/blob/3a2d8cd702905a0523a70f0a5b9c0f270dafdf19/internal/messaging/handler.go)）；因此不是“完全没有任务辅助能力”，但也不能由这些消息名推导它已经提供 Camind 所需的客户支持工单生命周期。支持 Agent 收到的文本及附件均按不可信输入处理，不因节点 trusted 就允许其内容直接触发高权限工具。

## ESP32：可证用途与安全边界

1. **用途｜直接证据｜高置信：** [Espressif HMI Smart Displays](https://www.espressif.com/solutions/hmi/smart-displays) 明确列出 ESP32 系列的数据可视化、工业控制面板和工业网关用途。**研究推论：** 状态/异常/待办小屏是合理候选，但应先验证现场可见性、断网提示及安装条件；官方产品页不是客户访谈或实际采购需求证据。
2. **网络与固件安全｜直接证据｜高置信：** [ESP-IDF ESP32 Security Overview](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/security.html) 推荐对外通信使用 TLS 并验证服务器身份、生产开启 Secure Boot、生产 Flash Encryption 使用 Release Mode 和逐设备密钥；OTA 应使用安全传输并考虑验证后启用/回退。具体能力随芯片和修订版核对，不能把 ESP32 家族视为完全相同。
3. **功能安全｜研究建议：** ESP32 首期只读、最小状态数据、独立凭据且可撤销，不保存加工控制或云管理员密钥；断网/过期显示“状态未知”，不能继续显示为可靠“正常”。不承担急停、门锁互锁、开工许可或安全传感器职能。安全启动/加密是信息安全能力，不等于机械功能安全验证。
4. **标准证据限制：** 检索定位 [ISO 13849-1:2023 官方入口](https://www.iso.org/standard/73481.html)，其主题是机械安全相关控制系统，但原页抓取返回 403；本记录未取得标准正文，不引用具体条款，也未找到目标 ESP32 整机具备相应 PL/SIL 认证的证据。实际设备安全架构需另行风险评估和验证。

## 矛盾、未知与最小下一步

- **文档时效矛盾：** `operations.md` 仍把去重/重试、死信等列入阶段规划，而固定版本已存在 durable/outbox 等代码；`trust.md` 大量使用“应/建议”。以上以已查代码为能力证据，不把规划当交付承诺。
- **交叉校验限制：** 已运行 `source_check`，搜索未覆盖 ClawSynapse 源码且自动语义判定不可用；关键结论改由直接逐段读取维护者代码/官方文档核实，不宣称自动验证通过。
- **未解决：** 用户所指项目归属确认；选定 release 与上述 main 的对应关系；认证配置实际接通、TLS/密钥轮换、跨租户对象权限、断电恢复和附件边界；真实厂网可达性；ESP32 客户需求、工况与安全资格。未运行项目或硬件测试。
- **只需下一步：** 固定版本做两节点最小试验：启用认证/TLS/隔离的 broker，验证拒绝越权和跨租户读写、断网/重启/重复请求、持久化失效告警、附件落盘及结果回查；同时用一次现场访谈确认是否真的需要 ESP32 小屏。通过前设计应写“候选通道，待验收”，而非“平台已保证”。

未检查实际部署、客户需求或标准正文；剩余风险是将通信能力误当业务可靠性、客户隔离或设备安全保证。
