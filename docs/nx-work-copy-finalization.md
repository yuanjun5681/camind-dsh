# NX 加工工作副本收尾修复

2026-10-14。修复“NC 已生成后，NX 遗留未保存副本，导致下一任务三维预览被阻断”的流程缺口。

## 行为

正式 CAM 批次在 NC 对账、生产检查调用之后增加单独收尾阶段：

1. 只对本批次 output 目录下、带固定 suffix 的 `_work_<suffix>.prt` 调用 `/cam_finalize_work_copy`。
2. NX 服务必须找到唯一已打开的目标，修改状态读取明确；不打开其他模型。
3. SaveComponents=False 保存目标，不保存装配子件；确认非空落盘文件与 IsModified=False。
4. CloseWholeTree=False 仅关闭目标；重新扫描确认目标不再打开。不使用旧接口的 close_tree/UF/CloseAll 降级。
5. 保存、状态回读、关闭任一步失败，保留副本、记录 cleanup=pending 和具体原因。NC 执行结果保留；工作台、加工记录及交付报告显示副本待处理。超时/连接不明保留执行状态未知。

异常或停止的加工不自动保存/关闭，以免把失败的修改落盘。既有 input 工作副本不自动处理。预览护栏继续保护整个 NX 会话。

## 修改范围

- Camind：cam_run 编排、正式任务阶段、加工记录时间线、交付报告与模拟执行回归。
- CAM-Agent：`nx_windows_agent/nx_worker/handlers/cleanup.py` 新安全接口、endpoint_registry 注册、API 说明；版本最初为 `t444-work-copy-finalize-720`，合入最新基线后调整为 `t481-work-copy-finalize-722` 与版本记录。

## 已验证

- Camind 正式任务、执行集成、工作台自检全部通过；覆盖正常收尾、关闭失败及收尾调用异常时 NC 结果仍保留，且不调用旧关闭接口。
- CAM-Agent 43 项离线测试通过：单件范围、禁止源件、重复/不存在目标、修改状态不明、保存失败/仍脏、关闭失败不降级，以及注册、既有清理和版本约束。
- 生成本地更新镜像：`.dsh/updates/nx-finalize-720`（模板配置，不能覆盖现有凭据/配置）。

## 部署与真机验证（已完成核心接口链路）

用户确认已保存需要保留的模型，并授权部署与重启 NX。推送预检发现原 CAM-Agent 检出落后 origin/main 324 个提交；没有绕过基线检查。将修复合入最新基线，解决版本记录冲突并调整为 722，再通过 43 项离线测试。更新已部署，NX 与代理均已重启，读取到工作站版本 `t481-work-copy-finalize-722`。

真实批次：`20261014-203924-ZM26030-704`，沿用“CAM加工原始文件上传回归测试”中已归档并通过工作台审图的原始 PRT/DWG。实际 NX 读件和几何包齐备后，接口测试以固定虚拟材料、毛坯、基准和夹持条件冻结一道粗铣。图纸原文及审图确认保持，原件 SHA 不变。

验证结果：

- 实际 NC 为 `ZM26030_ROUGH_e41ff262.nc`；回读 T3、S8000、F2400 与冻结方案一致（指令存在核对，不是机床仿真）。
- `/cam_finalize_work_copy` 返回 saved=true、save_verified=true、modified_after_save=false、closed=true、ok=true。输出副本保存在本批次 output 目录，扫描确认已不在 NX 打开列表；其他干净输入仍保留。
- 问题包完整，manifest 的 package_complete=true、execution_overall=ok、production_overall=incomplete；证据不足的生产放行尝试被拒绝。
- 加工后 NX 修改状态未知数及未保存数均为 0。
- 用同一原件在新的预览上下文重新执行五步几何导出，state=ready；导出后未保存数仍为 0。覆盖“本批次结束后下一任务预览被阻断”的原问题。

测试方式边界：本轮桌面中实际恢复了原件预览并完成 cam_survey；桌面输入自动化随后无法稳定操作输入框。因此规划参数确认、授权、实际生成和打包采用正式任务接口/真实 cam_plan、cam_run、cam_deliver 核心实现执行，保留来源、冻结与放行门禁。任务接口动作不是审批弹窗的真实点击验收，工作台审核与打包审批卡的完整点击链仍待补测。没有把本地模拟 NX 返回值当作真机证据。

证据保存在 `.dsh/workbench-acceptance/finalize-live/result.json` 与 `next-preview.json`，交付文件在对应 cam-runs 批次及会话工作区 delivery 镜像中。

代码提交：Camind `e9c23f5`；CAM-Agent 最新基线上的修复 `7c1159f0`，主检出集成为 `5b4ffed1`。原部署台账修改保留，临时检出已清理。
