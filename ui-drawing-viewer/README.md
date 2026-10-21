# 2D 图纸查看器

`camind-ui-drawing-viewer` 用于在 dsh 预览席位中显示 camind-draft-pack v1。TypeScript client source
经 ui-shell 已安装的 esbuild 生成 dsh module-loader 格式的 `lib/client.js`，不新增构建依赖。
Host `drawingPreview` 服务把授权源快照、worker 转换、有界作业和六项身份缓存串为本地 provider。

## Host 作业与取包

路由统一半注册在 `/camind/api/drawings/sessions/<sid>`，并先经过官方
`connection.requestRejection`：`POST /packs` 以 `{ "path": "<会话图纸引用>" }` 启动转换；
`GET /packs/<jobId>/status` 查询状态；`POST /packs/<jobId>/cancel` 取消；
`POST /packs/<jobId>/retry` 重试可重试失败；`GET /packs/<identity>?path=<会话图纸引用>`
读取就绪 descriptor（含 `packText`）。取包必须带当前引用以重新授权并核对源 SHA，响应始终
`Cache-Control: no-store`，`X-Pack-SHA256` 只声明实际 pack 字节指纹。派生缓存位于
`$DSH_HOME/draft-previews/<session>/`，不写入会话工作区；交付或归档必须显式导出快照。

`POST /refs/verify` 接收 DrawingReference v1（也可包在 `{ "reference": ... }` 中）。返回前强制核验
URL 会话、授权源快照 SHA、实际 pack 字节 SHA、六项转换身份、pack 内源 SHA 和 dim/entity 目标存在性；
成功返回规范化引用、不含 `packText` 的 descriptor，以及从实际 pack 提取的有界 `targetContent`（尺寸显示值/公差、文字或有界几何）。缺少可信来源的内容模式只允许查看，不能签发引用。

```sh
node ui-drawing-viewer/selfcheck-routes.mjs
node ui-drawing-viewer/selfcheck-reference.mjs
# 实际 converter + HTTP + curl 的 M2 集成验收（不替代 dsh-app:// 桌面冒烟）
node ui-drawing-viewer/acceptance-host.mjs
# 伞自检（含 selfcheck-client/selfcheck-adapter/三方差分子进程；自身解析 DESKTOP_REPO 并转发）
node ui-drawing-viewer/selfcheck.mjs
# selfcheck-client 单独运行需显式 DESKTOP_REPO（无相邻仓库回退）：
DESKTOP_REPO=/path/to/Camind-desktop node ui-drawing-viewer/selfcheck-client.mjs
# 镜像 loader/renderer/pane/client 的 2D 综合验收与生命周期验收（合成实体 + Desktop gl_mock）
# （DESKTOP_REPO 只校验为存在目录，隔离性由运行约定保证，不由脚本机器保证）
# acceptance-2d：10 个综合场景（断言总数随帧数线性变化，不是固定契约；2026-10-21 本机
# Node v25.7.0 实测约 373 项）
DESKTOP_REPO=/path/to/Camind-desktop CAM_AGENT_REPO=/path/to/CAM-Agent node ui-drawing-viewer/acceptance-2d.mjs
DESKTOP_REPO=/path/to/Camind-desktop node ui-drawing-viewer/acceptance-lifecycle.mjs
```

上游 pinned `gl_mock.ts` 没有 `scissor`（`draft_view.ts` 的 insets 裁剪每帧调用）；`selfcheck-client.mjs`、
`acceptance-2d.mjs`、`acceptance-lifecycle.mjs` 在本地为 mock 补记录型 `scissor`，不改 pinned fixture；
上游一旦补上 scissor，本地 shim 会响亮报错提醒移除。`acceptance-2d.mjs`（至少 degradation
场景）、`acceptance-lifecycle.mjs` 与 `selfcheck-client.mjs` 均用共享 `with-scissor.mjs` 的配对断言（计数相等 + 逐条同参，覆盖单帧
漏调用与任意帧参数错配；`selfcheck-client.mjs` 另以字面值钉住 insets 换算的 viewport 矩形，
依据 `draft_view.ts:434-435` 同表达式设置，自检宿主 DPR=1）。shim 只验证 scissor 与 viewport
参数一致：同帧同参已钉，但 scissor/viewport 同错（insets 计算错误同时传给两者）在
acceptance-2d/acceptance-lifecycle 不检出——字面值矩形由 `selfcheck-client.mjs` 钉住
（`[40, 30, 740, 560]`）；不验证真实 WebGL2 裁剪效果，真实 GL 裁剪验证待补。修复前这些用例为红（exit 1），
已在 base `fd9c345`（INT-04 终点、本修复引入前）实跑复现：`selfcheck-client.mjs` 以
`AssertionError /sync-reference-failure/` 失败（scissor TypeError 被 pane 容错展示掩盖引用回调）、
`acceptance-2d.mjs` 以 `TypeError: gl.scissor is not a function`（DraftView.drawGL）失败、
`acceptance-lifecycle.mjs` 以 `AssertionError 0 !== 1` 失败（引用计数为零）。故障链：`draft_pane.ts`
的 `handle()` catch（emit `error` 消息）把 load→`setColorMode`→render 的 `gl.scissor` TypeError
吞在初始加载里，`view`/`draft` 未赋值导致后续点击的 `preparePick` 空返回，引用回调永远不触发。

## 构建与检查

```sh
node ui-drawing-viewer/build.mjs
ui-shell/node_modules/typescript/bin/tsc -p ui-drawing-viewer/tsconfig.json
```

`npm run init` 的 web/desktop 模板包含本插件，并在 ui-shell 构建后构建本插件。
日常代码修改直接重跑 `node ui-drawing-viewer/build.mjs`，不为升级重复 init。

## Draft 核心镜像来源

- 上游仓库：相邻 `Camind-desktop`
- 上游 commit：`b5196e61651a97cb06b3210436dc64b056dc39c1`
- 本地基线：`f15fda354725092680cf6fd43f31034bff30fe2b`；共同基线：`cbb61dff6b9731057cc256fc981ad8547b1fdb9f`
- 同步日期：2026-10-19
- 上游目录：`packages/viewer/src/draft/`
- 本地目录：`ui-drawing-viewer/src/draft/`
- 完整性：`mirror-manifest.json` 记录逐文件 SHA256 与 `identical` / `merged` 状态；merged 文件经本地自检、三方差分和 2D 验收。

| 本地文件 | 上游职责 | 对应上游测试 |
|---|---|---|
| `aci.ts` | ACI 查表与真彩转换 | `draft_loader.test.ts` |
| `draft_camera.ts` | 相机、缩放、平移、world/screen 转换 | `draft_camera.test.ts` |
| `draft_detail.ts` | dim/entity 详情与出身展示 | `draft_dim_origin.test.ts` |
| `draft_loader.ts` | reader 门禁、几何/文字/dims 展开 | `draft_loader.test.ts` |
| `draft_pane.ts` | 公共消息接口 v2、DOM 与交互 | `draft_pane.test.ts` |
| `draft_pick.ts` | 64×64 CSR 网格拾取 | `draft_pick.test.ts` |
| `draft_view.ts` | WebGL2/Canvas2D 渲染、选择、insets、恢复 | `draft_view.test.ts` |
| `packcheck.ts` | I1–I9 writer/reader 校验 | `draft_packcheck.test.ts` 与三方差分基线 |

M1-04 的 `selfcheck.mjs` 还会校验 manifest 中的文件哈希，防止只改镜像不同步记录。

## 本地补丁清单

- `draft_loader.ts`（merged）：合并上游线宽、层 plot、titleBlock/techRequirements/views 与单位偏移装载；保留本地 `skippedTypes` 降级披露，并对 BYLAYER/BYBLOCK/标准负值 sentinel 不落线宽。
- `packcheck.ts`（merged）：合并 views/origin_offset/title_block/tech_requirements 形态校验；保留本地 geometryPoints 修复、dims 容器校验与 skippedTypes 降级语义。
- `aci.ts`、`draft_camera.ts`、`draft_pick.ts`（identical）：与 sourceCommit 逐字一致，并由 selfcheck 直接读取上游对象校验。
- `draft_detail.ts`、`draft_pane.ts`、`draft_view.ts`（local-patch）：保留本地 M0/M4/M5 的 DPR/insets、交互与 token 皮肤，不因本轮同步覆盖。
- 宿主适配只允许出现在 `src/client.ts` 及后续 Host 文件，不得借合并删除本地降级与来源身份语义。

以后新增补丁必须在本表同时记录：补丁文件、理由、对应测试、来源文件映射和同步 commit；未记录的核心分叉不得合入。
