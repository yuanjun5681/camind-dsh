# 2D 图纸查看器

`camind-ui-drawing-viewer` 用于在 dsh 预览席位中显示 camind-draft-pack v1。TypeScript client source
经 ui-shell 已安装的 esbuild 生成 dsh module-loader 格式的 `lib/client.js`，不新增构建依赖。
Host `drawingPreview` 服务按计划在 M2 引入。

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
