# gp-2 端侧接收任务与切换依赖（2026-10-18）

用户明确当前端侧执行仓为 camind-dsh，落点 ui-model-viewer；原 Camind/Camind-desktop 的方案编号和实现仅供追溯。
本交接不将该仓二维迁移 M2 与原方案 M2-C2 混为一项，也不将 M6 已完成的审计当作 3D 功能已实现。

权威合同：CAM-Agent `Doc/几何包格式规范_v1.md` §8；用户已确认空排除key/零体非零bbox用InvalidValue，
四项顶层计数负数或超值域用BadJson，缺枚举计数及公式不成立用CountMismatch。
具体材料：CAM-Agent `Doc/gp2_camind-dsh端侧交接与切换依赖_20261018.md`。

| 本仓待接收的工作对象 | 关联生产端任务 | 落点/验收要求 |
|---|---|---|
| Host 接入持久revision的几何入口 | T-549、T-556 | `lib/models.js::exportPart` 当前直调worker未传revision；不能固定1或自行内存计数，需使用统一持久作用域，切默认前验完整导出 |
| B字段解析与坏包负例 | T-553 | `src/core/geompack/manifest.ts`；使用CAM-Agent导出的B组14例，按契约拒码；当前尚未接入完整B校验 |
| 排除清单/零体状态/未知值展示 | T-551、T-553 | Host仍拒空网格；须区分未提供与无排除，未知reason按other、policy按unknown；纯文本detail截断200码点；按reason分列计数 |
| revision防旧响应覆盖 | T-549、T-556 | lookup/缓存/界面联动，只接受同源同管线更大revision；版本隔离和恢复另验 |
| blanked初始显隐与拾取 | T-550 | 初始按包内blanked，后续按当前有效显隐；旧包缺字段全可见 |
| 有条件的stable_key关联 | T-555 | 只在已核同源SHA且双方键非空唯一时自动关联；跨编辑/文件身份不明转软匹配/人工确认 |

以上是后续工作对象，尚未标记实施完成；正式开工时按本仓任务登记方式取号，不把CAM-Agent T号当本仓任务号。
本次仅归属纠正与交接文档，不实现上述端侧产品功能，不触碰现有未提交UI/lockfile改动。

CAM-Agent T-554本轮新增底层C组回归，钉本仓10be8643：三类零体包/缺字段旧包Package、双LOD、边线通过，
真实Chrome/WebGL四空场景加有几何对照通过；源码SHA与原始结果保存在CAM-Agent Doc/attachments/gp2_dsh_20261018。
这不替代本仓产品Host/桌面纵向验收，不声称端侧gp2已交付。

当前生产默认gp1。CAM-Agent T-556发现现役Host接入缺口后保持未切；端侧接入与完整回归是安全切换前置。

审核：本次交接及README链接已执行本地 `codex review --uncommitted`（exit0，无缺陷），并纳入CAM-Agent侧Kimi Code R17完整送审（76.2秒，exit0，无必改）。原文/输入SHA保存在CAM-Agent `Doc/attachments/gp2_dsh_20261018/`。审核只覆盖交接，不抵端侧产品实现验收。
