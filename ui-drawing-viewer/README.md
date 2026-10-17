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
```

## 构建与检查

```sh
node ui-drawing-viewer/build.mjs
ui-shell/node_modules/typescript/bin/tsc -p ui-drawing-viewer/tsconfig.json
```

`npm run init` 的 web/desktop 模板包含本插件，并在 ui-shell 构建后构建本插件。
日常代码修改直接重跑 `node ui-drawing-viewer/build.mjs`，不为升级重复 init。

## Draft 核心镜像来源

- 上游仓库：相邻 `Camind-desktop`
- 上游 commit：`703ce90efb1c15c53997e07141671f31ad955dec`
- 同步日期：2026-10-17
- 上游目录：`packages/viewer/src/draft/`
- 本地目录：`ui-drawing-viewer/src/draft/`
- 完整性：`mirror-manifest.json` 记录逐文件 SHA256；本次复制另经 `diff -qr` 验证完全一致。

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

当前 `src/draft/` 没有本地补丁或功能分叉。宿主适配只允许出现在 `src/client.ts` 及后续 Host 文件，
不得修改镜像核心来绕开上游公共接口。以后新增补丁必须在本表同时记录：补丁文件、理由、对应测试、
来源文件映射和同步 commit；未记录的核心分叉不得合入。
