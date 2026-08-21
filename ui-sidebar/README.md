# camind-ui-sidebar

`/ui` 专用的 Sidebar Cordis 客户端插件。它以官方
`@deepseek-ai/dsh-client-ui-sidebar@0.1.0-rc.7` 为兼容基线，保留官方的
Workspace、Settings、折叠动画和新会话契约，并新增：

- `sidebar.brand`：宽栏与折叠轨道共用的单占位品牌区域，未注册时分别回退到官方 `BrandWordmark` / `FishLogo`。
- `sidebar.footer.action` owner props 扩展：这个官方 list 席位（「设置」上方）额外收到 `{ pathname, navigate }`，让底部菜单项可以按路由高亮并做 SPA 跳转；官方契约的超集，存量注册方忽略多余字段。

`ui-shell` 通过 `ClientModuleSystem.registerStatic()` 将本插件注册到官方
Sidebar 的模块 ID，因此只影响 `/ui`，不会改变官方 `/` 页面。

## 上游基线

- Repository: `deepseek-ai/deepseek-harness`
- Package: `packages/client/ui-sidebar`
- Tag: `dsh-v0.1.0-rc.7`
- Commit: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`

升级时先同步上述目录的官方实现，再重放 `sidebar.brand` 席位与
`sidebar.footer.action` owner props 扩展两处小改动。复制的官方代码继续遵循根目录 `LICENSE` 中的 MIT License。
