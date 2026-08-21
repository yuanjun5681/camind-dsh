# 会话上传文件

Camind 对所有 Agent 模式使用同一套上传协议。上传文件不会写入 session cwd，工作区只在
Agent 明确产出交付物时发生写入。

## 存储结构

```text
$DSH_HOME/uploads/<session-id>/<batch-id>/
├── manifest.json
├── files/                       # 用户上传的原始文件，包括原始 ZIP
└── extracted/<archive-name>/    # ZIP 自动解压结果，保留包内相对目录
```

每次 Composer 选择形成一个独立批次。批次提交完成后写入单独的 `.pending` 标记；待发送文件附件 rail
以 `conversation.input.dock` 为生命周期锚点，通过 portal 显示在 Composer 卡片内、textarea 上方，
不写入 textarea draft，也不创建额外的发送按钮。下一条普通用户消息进入
`agent/pre-step` 时，Host 把不透明 `batch-id`、原始文件名和 ZIP 解压摘要作为独立的插件上下文
追加到同一次模型请求；请求获准进入后只消费这次捕获的 pending 标记。页面刷新或进程重启不会丢失
尚未发送的批次，也不会向模型暴露宿主机绝对路径。

附件卡片右上角的移除按钮只把对应原始文件从“下一条消息”的选择集合中移除，语义与官方图片附件
一致，不立即删除 `$DSH_HOME/uploads` 中的上传事实或 Workbench 历史。工作台「本次上传」在页面刷新后
从该会话的上传批次 manifest 恢复，不依赖浏览器内存。若原始文件是 ZIP，它对应的
解压条目会同时退出本轮上下文。旧版仅含时间戳的 `.pending` 标记按整批选中读取，首次变更后升级为
带所选 `upload://` 引用列表的 JSON 标记。

Composer 支持从系统文件管理器拖拽：官方支持的 PNG/JPEG/WebP/GIF 仍进入图片附件 rail，其他文件
进入通用文件 rail；混合拖拽由 ui-shell 在 capture 阶段统一分流，避免官方 document 级图片 drop
监听重复处理。第一版不递归读取文件夹，文件夹应先压缩为 ZIP。文件选择器与拖拽共用同一上传路径和
限制：单文件 8 MiB、单批最多 32 个原始文件、原始文件合计最多 64 MiB；上传 JSON 请求体按 Base64
膨胀预留后限制为 96 MiB。ZIP 解压仍单独执行下述条目数和展开大小限制。

## 插件边界

- `ui-shell` Host：接收浏览器字节、校验单文件大小、保存批次、自动解压 ZIP、生成带 SHA-256 的
  `manifest.json`，维护待发送标记，在 `agent/pre-step` 注入上传上下文，并提供 Workbench 预览。
- `camind-tool-upload`：所有模式全局加载，提供 Cordis `uploads` 服务以及
  `list_uploaded_files` / `read_uploaded_file`；服务从调用上下文取得 session ID，只接受本会话
  manifest 声明的文件，并集中完成归属、路径和完整性校验。

“上传文件”本身不设计成模型 tool：用户设备的文件选择和字节传输必须由 UI/Host 发起，模型既无法
访问用户设备，也不应获得任意导入宿主机路径的能力。

## ZIP 行为与限制

扩展名为 `.zip` 或具有 ZIP 文件头的上传会自动解压。当前限制为：

- 单个上传文件最大 8 MiB；
- 每个 ZIP 最多 1000 个条目；
- 单个解压文件最大 32 MiB；
- 单个 ZIP 解压总量最大 128 MiB；
- 拒绝绝对路径、`..` 越界路径、重复路径和不支持的压缩算法；
- 解压失败时整个批次不提交，并清理该批次的部分文件。

ZIP 中的链接条目不会作为系统链接创建，只会成为普通文件内容。嵌套 ZIP 不递归解压。

## 生命周期

上传批次属于 session，不属于 workspace。不同 session 即使使用同一工作区，也不能通过上传工具
互相列出或读取文件。`.dsh/` 已整体 gitignore，原始上传和解压内容不会进入工作区版本管理。
