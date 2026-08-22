# camind-ui-sidebar

`/ui` 专用的 Sidebar Cordis 客户端插件。它以官方
`@deepseek-ai/dsh-client-ui-sidebar@0.1.1-rc.2` 为兼容基线，保留官方的
Workspace、Settings、折叠动画、新会话契约和 0.1.1 起上游原生的
`sidebar.brand.mark` / `sidebar.brand.name` 品牌席位（未注册时分别回退到官方
`FishLogo` / “DSH Local Build” 文本），本地改动为：

- `sidebar.footer.action` owner props 扩展：这个官方 list 席位（「设置」上方）额外收到 `{ pathname, navigate }`，让底部菜单项可以按路由高亮并做 SPA 跳转；官方契约的超集，存量注册方忽略多余字段。
- 账号页脚行：左侧用户块（固定显示名 `user`），右侧 `sidebar.settings` 固定以 `wide: false` 渲染官方 36px 圆形纯图标 trigger；`SidebarRoot.module.css` 里 `.footerActions` 改为纵向排列（官方横向 flex 在多菜单项时互相挤压裁剪）。

`ui-shell` 通过把本插件的 factory 预注册到官方 Sidebar 的模块 ID，
因此只影响 `/ui`，不会改变官方 `/` 页面。locale 命名空间保持
`customSidebar`：官方 `sidebar` 命名空间属于上游包，重复注册会 throw。

## 上游基线

- Repository: `deepseek-ai/deepseek-harness`
- Package: `packages/client/ui-sidebar`
- Tag: `dsh-v0.1.1-rc.2`
- Commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

升级时先同步上述目录的官方实现，再重放 `sidebar.footer.action` owner
props 扩展与账号页脚行（含 `.footerActions` 纵向排列）两处本地改动。
复制的官方代码继续遵循根目录 `LICENSE` 中的 MIT License。
