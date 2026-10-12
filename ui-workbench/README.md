# 加工工作台

`camind-ui-workbench` 注册一级会话标签“工作台”，排在“对话”“轨迹”前，在真实桌面、官方 Web 与 `/camind` 共享实现。目标设计见 [交互方案](../docs/cam-workbench-interaction-design.md)。

## 首期已实现

- 输入、交付物、加工记录移到画布左侧，可折叠；既有 run 查询和下载不变。
- 文件、模型、NC 和可信联合预览通过 `filePreview.View` 嵌入中央画布；点击输入或产出不再跳到独立预览标签。
- 预览目标按会话隔离，点击文件会返回画布；切换工作台内容不卸载正在查看的模型。
- Agent 面板订阅官方 `target('chat').legacy`：生成时展开流式公开文本，结束后折叠最近公开回复以保留画布空间（可手动展开），不显示 reasoning；提问使用下方原生 Composer。
- 选面后明确点击“添加到提问”，将文件/几何版本和面编号插入原生可移除引用 chip，保留已有草稿，不自动发送。发送及当前请求进入 Agent 步骤时核验版本；历史引用不会封死新版本讨论。
- 交付物读取官方轮次的 `deliverables` 数据与 CAM run 的真实文件清单；文件存在不代表已获生产放行。
- 没有保存标签偏好、且存在可用 PRT 时默认工作台；保留用户主动选择的标签。纯咨询不自动切换。空白会话仍沿用官方首页，一级工作台在会话有内容后显示。
- 移除右栏工作台注册和 `/camind` 重复列。打开新工作台时关闭当前旧 `cam-workbench` 页并折叠右栏，其他右栏内容不删除。

## 明确占位与边界

DWG 阅读、动态确认向导、正式工序表编辑、完整对象检视和工序引用尚未接入。当前版本化引用仅支持显示几何包中的模型面。占位不保存工艺参数、不放行、不模拟执行成功。

未新增双文件执行门禁、长期任务记录、授权内自主修复或修订服务；现有加工工具与执行/交付审批保持原状。因此首期不是完整设计方案的生产实现，也不能将既有 NC 对账“通过”视为所有生产检查通过。

工作台引用官方会话内部 store 桥完成切页，需要随 DSH 升级复核。原生输入布局使用稳定 data 属性的结构选择器，不能只用单元测试证明桌面布局正确。

## 验证

```sh
node ui-workbench/selfcheck.mjs
node ui-preview/selfcheck.mjs
node ui-model-viewer/build.mjs
node ui-model-viewer/selfcheck.mjs
npm --prefix ui-shell run build
```

真实桌面完整重启后，使用已有会话、已有同源模型缓存，不调用模型/NX、不上传文件：

```sh
# 调试桌面由操作者以项目 DSH_HOME 启动，端口 9236。
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core node ui-workbench/acceptance-desktop.mjs
```

验收覆盖标签排序、旧右栏迁移、缓存模型、占位、折叠面板、输入/交付/加工、回对话不被轮询抢页、原生输入可见及选面引用保留草稿。必须使用空草稿，不发送提问。

真实回复链路另用以下脚本：**会新建独立验收会话并发送一次仅输出数字的模型请求**，记录公开文本的流式更新，检查持久日志中工具调用数为零，并切回原会话。

```sh
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core node ui-workbench/acceptance-response-desktop.mjs
```

此项需要可用模型与 `zstd` 命令；报告仅写入私有数据目录。自检使用真实的官方聊天目标与轮次数据结构，覆盖公开流式/终态、原生 chip、保留草稿、失效及跨会话拒绝。截图与报告在 `$DSH_HOME/workbench-acceptance/`，不提交私有数据。自检另覆盖会话预览隔离、无效/缺失文件不抢页、思考文本不泄入当前响应面板。

结束后退出自己启动的桌面及子服务，不停止用户原有 Web 进程。
