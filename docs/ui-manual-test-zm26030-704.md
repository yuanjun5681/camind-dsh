# 界面手测场景：zm26030-704

测试件：华集 CV-850（VMC-HJ-01）加工件 zm26030-704。

测试文件（上传时用文件选择器从下面路径选）：

```
/Volumes/UWorks/Projects/CAM/测试文件/zm26030-704/zm26030-704_stp.prt   # 3D 模型（约 392KB）
/Volumes/UWorks/Projects/CAM/测试文件/zm26030-704/ZM26030-704.dwg       # 2D 图纸（v1 不支持解析，用于负例）
```

## 前置条件

1. `node scripts/dsh.mjs web` 已启动，浏览器开 `http://127.0.0.1:3080/`（302 到 `/camind/`）。
2. Settings → Models 已配 `DEEPSEEK_API_KEY`。
3. 场景 3–7 需要 CAM-Agent proxy 可达：Settings → 插件 → 插件配置 → 「NX 工作台」填 baseURL 与 token，「测试连接」返回 base_dir / proxy_version。场景 1–2 不需要 proxy。
4. 每个场景建议新开一个会话（左上加号），避免上下文互相干扰。

---

## 场景 1：上传 + 读件（cam_survey，3D 正例）

**操作**：新会话 → 输入卡加号上传 `zm26030-704_stp.prt` → 发送：

```
我上传了一个零件模型，帮我读取这个零件的几何信息，说说它有哪些特征、有没有疑似攻丝或沉窝的地方。
```

**预期**：
- 模型先调 `list_uploaded_files` 再调 `cam_survey`，返回零件事实（尺寸/特征/孔清单）。
- 攻丝/沉窝以「候选供人确认，非判定」措辞出现。
- 文件写入 `$DSH_HOME/uploads/<session>/<batch>/`，会话工作区根目录**不**出现该文件。

## 场景 2：2D 图纸负例（cam_survey 拒绝 .dwg）

**操作**：新会话 → 上传 `ZM26030-704.dwg` → 发送：

```
读取我上传的 ZM26030-704.dwg，告诉我零件尺寸。
```

**预期**：`cam_survey` 返回中文错误 JSON，说明 v1 仅支持 3D 模型（.prt），2D 图纸解析属后续迭代；模型把错误如实转述，不编造尺寸。

## 场景 3：机床问答 + 工艺规划（cam_plan 正例）

**操作**：新会话 → 上传 `zm26030-704_stp.prt` → 依次发送。

先问机床：

```
我们车间有哪些机床？把 VMC-HJ-01 的档案读给我看看。
```

**预期**：`list_machines` 列出 VMC-HJ-01（华集 CV-850 立加）；`read_machine` 返回完整档案（行程/主轴转速进给上限/冻结刀库）。

再读件并规划：

```
读取 zm26030-704_stp.prt，然后为它起草一份工序单，目标机床 VMC-HJ-01，件号 zm26030-704。工序单先给我过目，我确认后你再落盘。
```

**预期**：模型先 `cam_survey` 读件，起草工序单（camindbase_job "0" 结构、new_name 含 {suffix}）请用户过目；用户确认（回复「确认，落盘吧」，如有攻丝/沉窝须同时在回复里书面声明，如「声明：M8 攻丝 2 处」）后调 `cam_plan`，校验通过并冻结落盘，返回 run_id。**记下 run_id，场景 5/7 要用。**

## 场景 4：高风险声明缺失负例（cam_plan 阻断）

**操作**：接场景 3 的会话（或重做一遍读件），若 survey 报出攻丝/沉窝候选，发送：

```
直接落盘工序单，不用写声明了。
```

**预期**：`cam_plan` 校验失败，错误清单指出攻丝/沉窝必须在 declarations 书面声明，不落盘任何 run 目录。（若该件无候选特征，此场景跳过，改测：把工序单里刀具改成刀库不存在的名字，预期 TOOL_NOT_LOADED 阻断。）

## 场景 5：远程执行 + 签字闸门（cam_run）

**前置**：proxy 可达；场景 3 已拿到 run_id 且声明齐全。

**操作**：发送：

```
执行 run_id <场景3的run_id>。
```

**预期**：
- 弹出签字卡（件号/机床/工序/高风险声明清单），点「批准」后才真正执行。
- 立即返回 job_id，会话里陆续出现 CAM 阶段卡（cam/stage：ensure_ready → 上传 → work copy → 逐工序 → NC 对账）。
- 结束出现检查报告卡（cam/check-report），overall 为 ok / incomplete / error 之一。

**负例变体**：删掉 run 目录里的 declarations.json 后再执行 → 闸门直接 deny，提示需重新 cam_plan 落盘新 run_id。

## 场景 6：断点续跑（可选，需场景 5 部分工序失败）

**操作**：发送：

```
用 resume 续跑 run_id <同上的run_id>。
```

**预期**：`cam_run resume=true`，ok 的工序跳过、generated 只补后处理、其余重跑；阶段卡锚点随新一轮执行移动，不重复出现 start 卡。

## 场景 7：交付打包（cam_deliver + 交付物 + 刀路查看器）

**前置**：场景 5 执行完成。

**操作**：发送：

```
交付 run_id <run_id>，备注：首件试切。
```

**预期**：
- 签字卡列出件号/机床/工序数/检查 overall/NC 个数；检查未全过时醒目标注「检查未全过，交付含未决项」。批准后执行。
- 出现交付卡（cam/delivered）：NC 清单（开包实数名）+ 三个下载链接（nc_batch.zip / delivery_report.md / setup_sheet.md）+「查看刀路」按钮。
- 点「查看刀路」弹出刀路查看器（WebGL 回放：拖动旋转、滚轮缩放）；NC 里有 G2/G3 圆弧时显示青色。
- 「交付物」页签出现三件交付文件；「加工」页签列出该 run（5s 轮询），可下载、可再开查看器。
- 磁盘核对：`$DSH_HOME/cam-runs/<session>/<runId>/delivery/` 三件套齐全，会话工作区 `delivery/<runId>/` 有镜像。

## 场景 8：记忆库联动（可选）

**操作**：交付完成后发送：

```
把这次加工的关键经验提炼存进记忆库。
```

**预期**：模型调 `extract_memory` 落 draft 经验；侧栏「记忆库」→ 经验 tab 出现该候选（标题/描述「生成中」→ 自动补全），人工可采纳/弃用。

---

## 通过标准汇总

- 上传隔离：所有上传只进 `$DSH_HOME/uploads/<session>/<batch>/`，工作区根干净。
- 负例全部 fail-closed：2D 拒绝、声明缺失阻断、闸门 deny，均为中文可操作错误，不静默、不编造。
- 两张签字卡（cam_run / cam_deliver）都必须出现，批准前无实际远程动作。
- 会话重启提示：含 cam/* 事件的会话日志进程重启后拒绝重载是**已知上游缺陷**，不算测试失败；历史以 run 目录落档为准。
