# DwgPane 功能对等清单（M4-00 冻结版 v1）

> 冻结日期：2026-10-18。旧实现证据：`ui-workbench/lib/client.js` 的 `DwgPane`、原生 drawing-question 控制器及既有 acceptance；新实现证据：`ui-drawing-viewer`、`ui-preview`、`ui-workbench` 的 DrawingReference 链。
>
> 本清单是 M4 的验收基线。**不得为了切换而删减旧能力，也不得用旧 SVG DOM 细节阻碍新实现。** 行为语义以本表为准；DOM、GPU 与消息接口以实现新语义的 `DraftPane v2` 为准。任何变更须重新评审，不能静默改小范围。

## 1. 验收编号与共同口径

- `H-*`：Host/服务与数据契约；`R-*`：渲染与交互；`Q-*`：原生引用、发送与任务生命周期；`L-*`：生命周期/性能；`D-*`：桌面实机。
- 自动验收必须指出具体脚本与断言场景。桌面项只能由真实 `dsh-app://` 结果关闭，浏览器或 DOM/GL 替身不能代替。
- 内容模式（调用方自持 pack 文本、无可信来源）只能查看，不能签发可发送引用。
- packcheck 全过、抽稀/截断概览和 I1–I9 均不得表述为「已审图」「尺寸正确」。

## 2. 冻结清单

| ID | 能力与不得回退的语义 | 新实现 / Owner | 验收编号与当前状态 |
|---|---|---|---|
| H-01 | 通用 DWG/DXF 可经授权引用打开；任务域只能读冻结 `task-input://` URI，不得重解析用户原路径 | `drawingPreview` + `previewFiles` / H | `acceptance-host.mjs` 已覆盖通用域；M4-01 补任务域 |
| H-02 | 启动作业、排队/轮询、就绪 descriptor、取消、错误分类与过期请求隔离 | `drawingPreview` 作业 API / H | M2-06/08 已覆盖通用域；M4-01 接入工作台状态 |
| H-03 | 六项身份缓存、pack SHA、源 SHA 与转换身份；缓存命中仍重新授权 | Host 缓存与 descriptor / H | M2-01/05/06 已覆盖 |
| H-04 | 引用必须核验会话、源 SHA、pack SHA/身份与 dim/entity 目标；无可信来源不得签发 | `/refs/verify` / H | M2-07、M3-02 已覆盖 |
| H-05 | 引用发送内容含真实且有界的尺寸/文字/几何；截断必须标原长度与原因 | `targetContent` / H | M3-02 已覆盖 dim/text/polyline/tolerance/depth |
| R-01 | WebGL2 线段 + Canvas2D 文字，支持契约实体、ACI/真彩、图层显隐 | DraftView / D+U | `acceptance-2d.mjs` 已覆盖 |
| R-02 | 左/中键拖动平移；滚轮以指针为锚缩放；按钮 +/−；双击适配；F 适配 | DraftPane / D+U | M0 与 `acceptance-2d.mjs` 已覆盖；M4-02 补宿主入口 |
| R-03 | 框选放大 zoomToRect，框选后回平移；Esc 取消；拖动与点击严格区分 | DraftPane v2 / D+U | M0 已覆盖核心；M4-02 补工作台适配 |
| R-04 | 图层显隐、隐藏时不可拾取、恢复只重建必要状态 | DraftView/Pane / D+U | `acceptance-2d.mjs` 与生命周期验收已覆盖 |
| R-05 | 默认提亮低对比色，且可切「原始配色」核对；不改源文件 | 旧 DwgPane 有开关；**M4-02 必须补齐适配** | **待实现，不得删除该能力** |
| R-06 | 搜索侧栏：默认收起、空查询不展开、计数、增量结果、显示更多、Esc 关闭、方向键只浏览 | M4-02 适配层 + `locateTarget` / U | **待实现**；M4-05 保留行为断言 |
| R-07 | 搜索命中明确高亮；尺寸按 entity_ids 整组，普通文字仅自身；不得按文字或距离猜关联 | `locateTarget` + DraftView 选择优先 / D+U | M3-03/05 已覆盖核心；M4-02 接搜索 |
| R-08 | 点击图元/Enter 选择；尺寸详情、measured 比对标红、公差文案与出身徽标/手动改判 | DraftDetail/Pane / D+U | M3-03 已覆盖核心；M4-02 接入搜索详情 |
| R-09 | 转换状态、缺失/兼容提示与可复制诊断；已知辅助点省略不冒充错误 | descriptor `missing/degraded` + M4-02 适配 / U | **待实现**；M4-05 保留状态与诊断验收 |
| R-10 | WebGL2 不可用与转换失败分态；不可用时给下载/外部打开，不启动转换 | `DrawingBody` / U | M3-01 已覆盖 |
| Q-01 | 点击图元设置一个可替换的原生提问引用；新选择只替换自己的 chip，不改问题/附件/手动引用 | `cam-drawing-ref` + occurrence span / U | M3-02 已覆盖替换与内容保留 |
| Q-02 | 原生引用 ×、清空选择或 Esc 可清选择；选择失效/卸载使待核验插入作废 | DrawingPreview invalidation + 选择序列 / U | M3-02 与生命周期验收已覆盖；M4-02 接 UI 清除 |
| Q-03 | 写入可发送草稿前和 codec 序列化时都必须 `/refs/verify`；失败或跨会话不能发送 | `cam-drawing-ref` codec / U+H | M3-02 已覆盖 |
| Q-04 | 发送快照不可变；后续选择不改已发送对象；失败恢复草稿，旧请求不回写新选择 | 原生 input + codec / U | M3-02 已覆盖提交边界；M4-04 补完整发送链 |
| Q-05 | 发送后保留对象以连续追问；普通文字编辑不丢引用，提交/重置边界不得串入下一题 | 选择序列 + 无参订阅 / U | M3-02 已覆盖 |
| Q-06 | 源件、pack 或转换身份换版时旧引用失效；待核验与已保留引用都不得复用 | descriptor 身份 + verify / U+H | M3-02 已覆盖通用域；M4-03/04 接任务域 |
| Q-07 | 既有任务校验器兼容：`session_id + ids` 展开，preview 指纹从 SVG+targets 切到 pack SHA+转换身份 | tool-cam 适配 / H+U | **M4-03 待实现** |
| Q-08 | 任务授权、原生草稿、引用替换、发送快照和任务输入共享同一核验链；未经核验不得进入 | 工作台 + camTasks / U+H | M4-03/04 待实现 |
| L-01 | A 晚于 B 不覆盖 B；切会话清理旧对象/相机/引用；B 失败不把 A 错标为 B | 适配层与作业 generation / U | M3-01/04 已覆盖 |
| L-02 | 重挂载、隐藏/零尺寸、DPR、pointercancel、context lost、dispose 均无泄漏 | DraftPane / D+U | M3-04 已覆盖自动断言；桌面另列 |
| L-03 | 6000 段/240 字只限每帧绘制，全量数据/GPU/CSR 索引保留；选择目标仍高亮 | DraftView / D+U | M3-05 已覆盖合成基线；真机性能另列 |
| D-01 | `/camind`、官方 `/web`、`dsh-app://` 的取包、渲染与原生引用可用 | 三壳 / Q+D | **M5-03 待实机验收** |
| D-02 | 官方壳没有 `--camind-*` 时必须回退 `--dsw-alias-*`；主题/暗色可读 | token 皮肤 / U+D | **M5-02 待实现** |

## 3. 执行约束

1. M4-01 只切 drawing 槽与数据源，R-05/R-06/R-09 的缺口不得被当作「已完成」。
2. M4-02 必须逐项关闭 R-02/R-03/R-05/R-06/R-07/R-08/R-09，并只走 DraftPane v2 公共接口，不访问私有成员、不自绘核心高亮。
3. M4-03/04 关闭 Q-07/Q-08 后，才允许 M4-05 把行为验收切到新 DOM/GPU 断言。
4. M5-01 默认切换前，本表 H/R/Q/L 项必须全部关闭；D-01/D-02 与桌面纵向项在 M5 指定阶段完成。
5. M5-05 删除旧 DwgPane 只能在一个版本无回滚事件后经用户确认执行，不属于当前 M4 工作。
