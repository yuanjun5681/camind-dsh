# 文档

## 项目专题

- [自定义 UI 架构](custom-ui.md)：`/camind` 定制前端（ui-shell / ui-sidebar / 页面插件）如何工作
- [Slot 插槽清单](slots.md)：`/camind` 下所有可注入的 UI slot（自定义 + 官方），含注册规则与现状
- [会话上传文件](uploads.md)：所有模式统一上传、会话隔离工具与 ZIP 安全解压协议
- [记忆库设计](memory-design.md)：知识库 + 经验库（OKF v0.2 bundle），camind-tool-memory 工具与 camind-page-memory 页面
- [CAM 加工场景设计](cam-machining-design.md)：无流程引擎的插件化方案（camind-tool-cam + camind-service-machine + skill/preset），approval/ask_user_question/jobs 原生机制映射（设计稿，未实现）
- [dsh 版本升级流程](dsh-upgrade.md)：`dsh-version.json` 唯一版本源 + 同步/校验 SOP

## 上游官方文档

本目录原先存放的上游文档快照已移除。Camind 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh），官方文档请直接查阅上游仓库：

<https://github.com/deepseek-ai/deepseek-harness/tree/master/docs>

dsh 处于 developer preview，迭代很快，具体行为以最新版上游文档为准。
