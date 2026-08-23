---
name: cam-machining
description: CAM 编程交付的操作规程——任务路由、执行顺序、红线与结果解读。cam_survey / cam_plan / cam_run / cam_deliver 四个工具的使用纪律，以及高风险声明、人工签字、经验沉淀的规矩。
version: 1.0.0
---

# CAM 加工操作规程

把用户的自然语言编程交付请求走完全程：读件 → 声明问齐 → 查经验 → 排工艺 → 签字执行 →
机器自检 → 签字交付 → 经验沉淀。本 skill 只有规矩，工具的协议细节由插件保证。

## 1. 路由：什么输入算编程交付任务

- 用户上传了 3D 零件（.prt/.stp/.step）并要求出程序/加工 → 交付任务，走 §2 全程。
- 只问不做的（「这活 CV-850 能不能干」「这零件有什么特征」「有哪些机床」）→ 用
  read_machine / list_machines / cam_survey 直接答，不启动交付流程。
- 意图不明确（没传文件、没说清要什么）→ 先问一句澄清，不要猜着走流程。

## 2. 顺序（不可跳步、不可乱序）

1. `cam_survey` 读件：入参是**已上传文件名**（用 `list_uploaded_files` 确认，不要
   编造路径）。输出零件事实 + 疑似高风险候选（攻丝/沉窝，供人确认、非判定）。
   2D 图纸解析暂不支持：材料、热处理、螺纹、公差必须用户在对话中声明。
2. **声明问齐**：对照候选清单与用户已声明内容，缺项用 `ask_user_question` 预填候选
   多选卡（推荐项置首）让人勾选；高风险项（攻丝/沉窝/螺纹）必须有书面声明。
3. `search_memory` 查同类零件经验：命中则 `read_memory` 读全文并在草案中引用；
   经验只能预填，不能替代本单确认（见 §3 红线）。
4. `cam_plan` 落盘工序单：起草 operations 时刀具逐字引用 `read_machine` 刀库里的
   tool_assembly_id；`post_name` 必须填**精确的后处理器名**（如「三菱备刀」），不带
   机床型号/系统修饰词，拿不准就问——错名会让整批 NC 报废。校验或绑定被阻断时，
   按返回的中文清单逐项修正后重调。
5. `cam_run` 签字执行：闸门先核对声明（缺 → deny，按清单问齐后**重新 cam_plan
   落盘新 run_id**）；齐全则弹签字卡，用户批准才真正执行。这是后台长任务
   （NX 独占，一件约 8 分钟），返回 job_id 后如实告知用户「已在执行」，不编造进度；
   系统会在完成时通知你。
6. 看 `cam/check-report`：overall=ok 才能进交付；incomplete 用 `cam_run resume=true`
   续跑补齐（ok 跳过 / generated 只补 post / 其余重跑）；error 按错误分类处置（§4）。
7. `cam_deliver` 签字交付：再弹一次签字卡（检查未全过会醒目标注，放行与否是人的
   决定）；交付报告与 NC 包落在 run 目录 delivery/。
8. `extract_memory` 沉淀本次的人工纠正与确认结果（候选需人工在记忆库页面审核）。

## 3. 红线

- 高风险项经验**只能预填不能跳过确认**：上一次干过不等于这一次自动批准。
- 来料状态（毛坯/半成品）不猜，问人。
- 机床参数以 `read_machine` 档案为准，不以记忆为准；刀库里没有的刀不要排
  （cam_plan 会以 TOOL_NOT_LOADED 阻断）。
- 闸门的 deny/签字卡是平台行为：被拦就按提示办，不要找别的路径绕过。
- 主模型永不被写：cam_run 内部走 work copy，你不需要也不应该要求直写原件。

## 4. 结果解读与处置

错误分类（工具返回的 error_class / retryable）：

- 连接失败 / `WorkerTimeout` / `PollTimeout`（retryable: true）→ 可重试；先提示用户
  去 Windows 机确认 proxy 与 worker（或先跑一次设置页的「测试连接」）。
- `error_class: "refused"` → proxy 按设计拒绝，是护栏正常工作的证据：核对入参与前置
  条件，不要原样重试。
- `error_class: "internal_error"` → proxy 内部异常：如实转述关键信息，提示人工排查。
- 没有 error_class → 判不出：如实转述，不要编造原因。

工序四终态（cam_run 逐 op 结论）：

- `ok`：NC 已出且在盘；
- `generated`：刀路已生成但 NC 未出 → resume 只补后处理即可，不会重算刀路；
- `empty`：空刀路（fail-closed）→ 需人看工艺（几何/模板/装夹），不要盲目重跑；
- `error`：执行失败，按 error_class 处置。

检查结论 overall：`ok`（全部 NC 在盘且对账一致）/ `incomplete`（缺 NC 或空刀路，
可续跑补齐）/ `error`（执行失败或被停止）。cam_deliver 在 overall 非 ok 时也会出包，
但交付报告会如实列出未决项。

## 5. 预期管理（对用户如实说）

- NX 是单会话串行资源：一次只能算一件，前面有排队时如实告知（一件约 8 分钟）。
- 大零件读件可能超过一分钟：cam_survey 内部已按长任务纪律轮询，耐心等待结果即可。
- 交付前有两道人工签字（执行前、交付前），这是设计如此，不是故障。
