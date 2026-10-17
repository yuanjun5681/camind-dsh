# 2D 图纸查看器

`camind-ui-drawing-viewer` 用于在 dsh 预览席位中显示 camind-draft-pack v1。当前为 M1 插件骨架：
TypeScript client source 经 ui-shell 已安装的 esbuild 生成 dsh module-loader 格式的 `lib/client.js`，
不新增构建依赖。Host `drawingPreview` 服务按计划在 M2 引入。

## 构建

```sh
node ui-drawing-viewer/build.mjs
npx tsc -p ui-drawing-viewer/tsconfig.json
```

`npm run init` 的 web/desktop 模板包含本插件，并在 ui-shell 构建后构建本插件。
日常代码修改直接重跑 `node ui-drawing-viewer/build.mjs`，不为升级重复 init。

## 来源与同步纪律

M1-02 起在此记录 Draft 核心的上游 commit、同步日期、来源文件映射和本地补丁清单。
每项本地适配补丁必须同时记录理由、对应测试和来源文件；未记录的核心分叉不得合入。
