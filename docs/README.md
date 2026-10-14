# 文档

## 当前工作台：阅读顺序

2026-10-14 已同步模型主工作区、右侧图标资料栏、浮动紧凑输入、逐题向导与只读加工要求。维护时先更新对应正文，不再只在设计稿末尾追加补充。

1. [工作台交互设计](cam-workbench-interaction-design.md)：当前场景 1 的布局、状态、向导与要求展示；后续目标单独标明。
2. [CAM 界面手测](ui-manual-test-cam.md)：桌面启动、场景 1 操作和布局/输入/清单回归；后续编程场景分别验收。
3. [正式任务记录](cam-formal-task-records.md)：输入版本、回答、清单冻结与失效、方案授权及执行边界。
4. [工作台插件](../ui-workbench/README.md) / [紧凑输入插件](../ui-compact-composer/README.md)：实现职责、官方数据复用与自检。

[2026-10-13 场景 1 报告](cam-workbench-scenario1-review-2026-10-13.md) 保留历史问题与后续回归，不作为当前操作说明。旧版作业面设计属于方案历史；当前 UI 冲突时以上述交互基线为准。桌面 UI 通过不代表生产加工条件已通过。

## 项目专题

- [自定义 UI 架构](custom-ui.md)：`/camind` 定制前端（ui-shell / ui-sidebar / 页面插件）如何工作
- [Slot 插槽清单](slots.md)：`/camind` 下所有可注入的 UI slot（自定义 + 官方），含注册规则与现状
- [会话上传文件](uploads.md)：所有模式统一上传、会话隔离工具与 ZIP 安全解压协议
- [记忆库设计](memory-design.md)：知识库 + 经验库（OKF v0.2 bundle），camind-tool-memory 工具与 camind-page-memory 页面
- [CAM 加工场景设计](cam-machining-design.md)：无流程引擎的插件化方案（camind-tool-cam + camind-service-machine + skill/preset），approval/ask_user_question/jobs 原生机制映射（含目标能力，当前实现边界见正式任务记录）
- [CAM 作业面交互设计](cam-job-interaction-design.md)：历史方案，当前交互以工作台设计为准；编程交付作业面（件头 / 四阶段 / 当前序 / 冻结与例外 / 交班）；场景包与壳的席位切分；第一张桌子是铣削新件。线框：[cam-job-interaction-wireframes.html](cam-job-interaction-wireframes.html)
- [CAM 能力市场与产品顾问设计](cam-capability-market-design.md)：企业客户桌面端、Camind 服务端、产品顾问模式、创造模式与能力交付流程
- [dsh 版本升级流程](dsh-upgrade.md)：`dsh-version.json` 唯一版本源 + 同步/校验 SOP；每次升级的过程记录存 [upgrades/](upgrades/)（按目标版本命名）

## NX Windows 工作台接口

接口文档直接引用相邻 `CAM-Agent` 仓库，不在本项目复制维护：

- [HTTP API 完整参考](../../CAM-Agent/nx_windows_agent/docs/API.md)：认证、请求格式、队列、文件传输、管理与 worker 接口。
- [客户端调用指南](../../CAM-Agent/nx_windows_agent/docs/CLIENT_GUIDE.md)：上传、任务编排、轮询、产物回收与错误处理。
- [当前 worker 端点注册表](../../CAM-Agent/nx_windows_agent/nx_worker/endpoint_registry.py)：文档未覆盖的新端点以注册表和对应 handler 为准。
- [几何包格式规范](../../CAM-Agent/Doc/几何包格式规范_v1.md)：网格、法线、边线、FID 与文件校验。
- [热重载边界](../../CAM-Agent/nx_windows_agent/docs/HOT_RELOAD_BOUNDARY.md)：维护与升级时参考。

本项目相关讨论与实测保留在 [西门子 NX 概览](siemens-nx-overview.md) 和 [PRT 3D 渲染](prt-3d-rendering.md)。以上相对链接要求 `CAM-Agent` 与本仓位于同一父目录。

## 上游官方文档

本目录原先存放的上游文档快照已移除。Camind 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh），官方文档请直接查阅上游仓库：

<https://github.com/deepseek-ai/deepseek-harness/tree/master/docs>

dsh 处于 developer preview，迭代很快，具体行为以最新版上游文档为准。
