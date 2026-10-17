# 3D 查看器三方漂移审计（M6-01）

> 审计日期：2026-10-18。共同基线：Camind-desktop `320dd531ff035dbb530505cf8d4988074012a6ba`。
> 上游现状：Camind-desktop 当前迁移工作树。本地现状：camind-dsh `ui-model-viewer/`。
> 本审计只覆盖 3D；2D `packages/viewer/src/draft/` 已由 M0/M1 单独镜像，不在此重复处理。
> CAM-Agent 的 gp-1 几何包契约本期不变，不要求新增 3D 接口。

## 1. 审计方法与边界

- 上游增量：`git diff 320dd531..HEAD -- packages/viewer/src packages/core/src`。
- 本地增量：`git diff c4a1a5ec..HEAD -- ui-model-viewer/src/viewer ui-model-viewer/src/core`，其中 `c4a1a5ec` 是首个 PRT 预览迁移提交。
- 对当前文件再做逐项差异和符号核查，避免仅凭提交标题判断功能等价。
- `ui-model-viewer/src/core/nc/parser.ts` 与上游 `packages/core/src/nc/parser.ts` 经 `diff -q` 验证字节一致。
- “同步”表示将上游能力合并到 dsh；“保留分叉”表示保留本地能力并纳入补丁清单；“回上游”表示将本地能力贡献回 Camind-desktop。均不在本审计任务中直接改代码。

## 2. 逐项差异与决策

| 范围 | 上游增量（320dd531 后） | 本地增量/差异 | 决策 |
|---|---|---|---|
| `core/nc/parser.ts` | 无实质差异 | 与上游字节一致 | 保持共同实现，不作为漂移项 |
| `core/pick.ts` | 新增 `visibleFace` 谓词，CPU 拾取与 GPU 隐藏体一致 | 本地仍全量求交，没有可见性谓词 | **同步**。与本地 `pickMode` 的 face/path 分支一起验收，不能只同步 GPU 索引而漏掉 CPU |
| `core/select/selection.ts` + `viewer/selection_port.ts` | 新增 bodyAffiliation、declaredBodies，以及 `passesTypeFilter` 与 `isSelectable` 分离；声明体不响应点击、已选面按过滤决定去留 | 本地只有类型过滤和单击/多选，没有声明体语义 | **同步**。保留本地 FID 选择 UI；验证声明体热更新、过滤压暗、已选面保留和点击早退 |
| `core/geompack/manifest.ts` + 新增 `excluded.ts` | 新增 `ExcludedBody`、`excluded_bodies`、排除原因、enumerated count、manifest revision、blanked/stable_key 及公式校验 | 本地仅有基础 bodies/n_faces 校验，没有排除体契约 | **同步**。在启用上游多体功能前，先补齐读端契约和坏包负例，避免渲染层消费不完整身份 |
| `viewer/scene_renderer.ts` | 新增面/边可见索引、体显隐换档保持、NO_FACE 处理、全显零开销与恢复重建 | 本地有播放区间、播放头、path 拾取分支，但无体/边可见索引 | **合并双方**。不得整文件覆盖；同时保留本地播放区间和 path 拾取，补“显隐 × 播放 × 拾取 × 换档恢复”组合测试 |
| `viewer/geom_view.ts` | 新增 hiddenBodies 真值、visibilityChanged、隐藏体悬停清理、fitToBody/隔离、声明体选择语义、帧时统计；恢复时重应用隐藏体 | 本地有事件释放、pointercancel、播放区间、face/path 拾取模式、初始化失败反馈 | **双向合并**：上游能力同步到 dsh；本地 pointercancel/播放/拾取/释放回上游。禁止用上游文件直接覆盖本地 |
| `viewer/synthetic_pack.ts` | 新增多体交错、体位偏移等合成能力 | 本地主要使用单体合同包 | **同步**。用上游多体夹具验证合并后的显隐和拾取，不把单体验收外推为多体等价 |
| `viewer/shaders.ts` | 本期无同类新增 | 本地为刀路播放/未来段/拾取模式做过调整 | **保留分叉**。与渲染器合并一起回归，不覆盖本地播放相关 shader 语义 |
| `viewer/index.ts` | 增加 Draft 与 3D 新能力导出 | 本地 Draft 已迁往独立 `ui-drawing-viewer` | 只核 3D 导出；不重复引入 Draft 依赖或形成第二份核心 |
| 帧时统计（`geom_view` / overlay） | 新增 gap/render 环形统计、p50/p95 与显示开关 | 本地 NC 播放控制没有同构统计 | **后续同步**。先完成核心合并，再评估与本地播放 UI 的接入点，不把本地播放时长当帧时统计 |
| `src/client.ts`、Host models/joint | 无对应上游同构实现 | 本地有 PRT/NC 联合查看、工位/工序、源码定位、选择引用和扩大视区 | **保留分叉**。属于本地宿主能力，纳入补丁清单；是否回上游另行评审，不在本期执行 |

## 3. 必须先处理的冲突项

1. **状态机冲突**：上游 hiddenBodies/visibilityChanged 与本地播放区间、path 拾取、pointercancel 修改同一 `GeomView`/`SceneRenderer` 状态。合并时必须定义组合状态和恢复顺序，不能二选一覆盖。
2. **拾取一致性**：上游 CPU `visibleFace` 与 GPU 可见索引必须同时合并；只合 GPU 会造成“看不见却点得到”或反之。
3. **契约顺序**：先同步 manifest/excluded_bodies 的解析和负例，再启用多体显隐，避免用不完整的体身份驱动渲染。
4. **测试来源**：本地 Draft/2D 插件与 3D 镜像必须保持独立，禁止为了省事把 Draft 重新塞回 ui-model-viewer 形成第二份核心。

## 4. 建议的后续合并顺序（非本期实现）

1. manifest/excluded_bodies 读端与坏包负例。
2. `SelectionModel` 声明体与过滤谓词、CPU `visibleFace`。
3. SceneRenderer 面/边可见索引 + 多体夹具。
4. GeomView 双方状态机合并与恢复链。
5. 帧时统计及本地播放 UI 接入评估。

每一步都要同时运行上游既有测试和本地 PRT/NC 验收；未通过组合验收前不得宣称 3D 已与上游功能等价。

## 5. 审计结论

当前不是“3D 已迁完”，而是**双方都有有效能力且已实质分叉**。本期只做审计与纪律落档，不直接实现上述合并项。后续补丁必须能追溯到本表的上游/本地文件、决策和对应测试。
