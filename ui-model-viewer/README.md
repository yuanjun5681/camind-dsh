# 模型与 NC 联合加工查看器

`camind-ui-model-viewer` 复用现有 NX 工作台配置，使用 WebGL2 显示 PRT 的完整显示网格，并支持旋转、平移、缩放、七种标准视图、正交/透视投影、边线和面拾取。不是 PRT 二进制解析器，也不创建刀路。


2026-10-18 gp-2 责任纠正：当前端侧执行仓为 **camind-dsh**。生产端合同/身份报告接收对象、
已补C组底层兼容证据及尚未实现的Host持久revision/B字段/零体状态等，见
[端侧交接](../docs/gp2-client-handoff.md)。原Desktop测试不抵本仓产品验收；默认切换需先补接入。

## 使用

2026-10-12 工作台首期改版后，日常入口改为一级“工作台 → 输入”，预览直接嵌入画布，原生输入框保持可见。下列“右侧工作台”“独立预览标签”的入口描述及历史验收属于旧布局；查看器能力与安全边界不变。新版验收见 [ui-workbench/README.md](../ui-workbench/README.md)。

重启 Web 服务或 Camind 桌面应用后，在会话上传 PRT，或在桌面添加本地 PRT 路径引用，然后在右侧「工作台 → 输入」点击文件，统一进入「预览」页。独立「3D 模型」标签已移除。桌面拖入/选择普通文件时生成的是 `@path` 或 `@"含空格的路径"` 文本引用，不上传字节；引用和官方 Composer 附件需发送到会话后才能列出，未发送的草稿不读取。通用上传批次也可列出。

右侧「工作台 → 输入」列出上传文件、官方附件和已发送的本地文件引用；引用标注「本地引用」，鼠标停留可查看原路径，点击文件在「预览」页打开，PRT 自动走三维渲染器。工作区原有的文件「预览」入口同样支持 `.prt`，通过 `cam.model.preview` 席位显示。

绝对路径引用可以位于工作区外，但必须出现在当前会话的用户消息中。预览使用 `reference://<id>` 句柄，Host 每次按会话记录重新验证；未引用的路径、跨会话句柄、敏感路径和已变更的符号链接目标都不能预览。丢失文件在列表中标为不可预览。工作台输入列表每 3 秒刷新。

顶部用下拉菜单提供七种标准视图、正交/透视和全部/模型/当前工序适配。点击「选择面」进入临时选面工具，Esc 退出；可输入面编号（如 `F000001`，多个编号用空格或逗号分隔）进行多面选择，查看编号、曲面类型与面积；单击选面，Ctrl/Cmd + 单击增减选择。曲面类型支持多选、全部与全不选，未勾选类型的面压暗且不可选，已有选择会同步移除。无效编号或被筛选排除的编号会提示，不改变原选择。

「显示 → 隐藏体透视（X-ray）」让隐藏体以 50% 有序抖动镂空显示并保持拾取；关闭后恢复剔除。开启 X-ray 时，隔离体以外的隐藏体仍以透视显示；需要严格隔离请先关闭 X-ray。它不是平滑混合，隐藏体边线不跟随透视（仍按显隐剔除），同相位叠层仍会互相遮挡。ID 拾取按完整隐藏体进行，不跟随 4×4 抖动孔；点击后层可见像素所在位置仍可能命中前层隐藏体。在 A=128 时，角色默认透视体的相位 1 与普通 X-ray 体的相位 0 掩码互补；保留其他源透明度时不保证互补。隐藏的角色透视体与另一个可见角色透视体同为相位 1，重叠时仍可能互相遮挡。声明体即使透视显示仍不可选；选中的面与悬停面保持不透明高亮。通过 X-ray 选中后关闭透视会保留选择集，但不表示该面仍可见。相位 1 只由默认透视体集合（`setDefaultTranslucentBodies`）决定，角色声明（`setSelectableBodies`）只过滤选择、不自动产生相位，生产角色接线需同时设置两者。角色默认透视的 API 保留源透明度，生产电极角色声明接线仍未完成，不按名称猜角色。WebGL context 恢复目前只有 GL mock 覆盖，真实 Chrome context loss 未验证；GPU 自检的点击使用合成 PointerEvent，未覆盖 OS 级指针输入。

在一级工作台选面后，可点「添加到提问」插入原生引用 chip，点选本身不写草稿或执行。引用绑定当前会话、PRT SHA256、几何清单 SHA256 和最多 100 个面编号。发送前及当前用户请求的 Agent 步骤前重新核验；跨会话、源件变更、几何变更或不存在的面会拒绝。历史引用不阻断后续的新版本讨论，重新使用须重新选面。只读工具 `read_model_selection` 返回已核验的面编号、曲面类型及显示包面积，不调用 NX，也不是实时精确量测或执行授权。

首次没有几何包时，查看 PRT 即自动开始生成（每个源文件版本自动一次，无需点击），界面显示进度。NX 必须就绪、队列为空、没有未保存或无法确认修改状态的模型——这些前置检查仍是服务端硬闸门。导出上传独立副本，再按顺序执行面表、粗网格、细网格、边线、清单五步。导出成功后仅关闭本次 UUID 命名的标记副本，丢弃导出导致的临时修改，避免阻塞后续读件；不自动保存或关闭其他模型，不覆盖源 PRT。前置检查失败（NX 不可达/忙碌/有未保存件/另一导出进行中）显示原因并可直接重试；标记副本在 NX 上打开之后的失败仍 fail-closed 保留在进程内，请核实远端执行状态、排除问题后重启服务再试。

缓存位于 `$DSH_HOME/model-previews/<session>/<source-sha256>/`。同一会话中同一源文件复用已验证缓存；损坏包明确报错，不自动重复写件步骤。开副本后的失败状态在进程内保留，确认远端执行状态、排除问题后重启服务再试。

## 迁移来源

来源：相邻 `Camind-desktop` 仓库，提交 `320dd531ff035dbb530505cf8d4988074012a6ba`。

- `packages/core/src/`：CMGM/CMGE 读端、清单/面表、相机、数学、拾取、选择、缓冲和渲染器引用的刀路类型。
- `packages/viewer/src/`：`GeomView`、`SceneRenderer`、选择适配与 GLSL 着色器。
- `tests/fixtures/box/`：合成合同包，不包含用户零件。

保留 TS 核心，不迁移 Electron/Qt 壳、云端设置、旧的单面 facet 预览或 CAM 提交 UI。几何包文件读取留在 Host；浏览器改用有界 HTTP/gzip 读端，仍校验 SHA256、计数、面段和索引。迁移后补齐了 GeomView 的事件释放、pointercancel 和初始化失败反馈。

独立插件的 `index.js` 和 `lib/models.js` 编排 Host 服务；`src/client.ts` 接入 dsh 席位。输出 `lib/client.js` 为 dsh module-loader 格式，浏览器不包含 Node 内建依赖。

## 漂移审计与本地补丁清单

2026-10-18 以 `320dd531` 为共同基线完成三方审计，完整决策见
[docs/viewer-3d-drift-audit.md](../docs/viewer-3d-drift-audit.md)。2026-10-19 又按 INT-03/04
选择性合并上游 `b5196e6` 的多体显隐、声明体、排除体读端和最终独立相位 X-ray，逐文件记录见
[mirror-manifest.json](./mirror-manifest.json)。当前仍不能宣称与上游完全等价：帧时统计、生产角色声明接线、
真实 NX/GP-1 语料与真实桌面多体验收另行挂账；本地同时保留 PRT/NC 联合查看、播放和引用能力，不整文件覆盖。

| 本地分叉文件 | 分叉理由与内容 | 对应验证 | 来源映射 |
|---|---|---|---|
| `src/viewer/geom_view.ts` | 本地事件释放、pointercancel、播放区间、face/path 拾取；合并显隐、隔离、声明体、X-ray 与角色默认透视 | `selfcheck-visibility.mjs`、`selfcheck-xray.mjs`、播放与桌面验收 | 上游 `packages/viewer/src/geom_view.ts`；双方状态机选择性合并 |
| `src/viewer/scene_renderer.ts` | 本地播放区间、未来段和 path 拾取；合并面/边可见索引、X-ray 与独立相位缓冲 | `selfcheck-visibility.mjs`、`selfcheck-xray.mjs`、`selfcheck-xray-gpu.mjs` | 上游 `packages/viewer/src/scene_renderer.ts`；保留双方绘制与拾取语义 |
| `src/viewer/shaders.ts` | 本地播放、未来段和刀路显示；合并 `aPhase/vPhase` 互补抖动掩码 | `selfcheck-xray.mjs`、`selfcheck-xray-gpu.mjs` | 上游 `packages/viewer/src/shaders.ts`；A=128 相位 0/1，非 A=135 旧方案 |
| `src/client.ts`、`controls.ts`、`scene.ts`、`styles.ts` | PRT/NC 联合查看、工位/工序、源码定位、引用和扩大视区 | `selfcheck-joint.mjs`、播放/布局与桌面验收 | 本地宿主适配，无上游同构单文件；保留分叉并评审是否回上游 |
| `src/core/nc/parser.ts` | 无分叉，与上游字节一致 | `packages/core/test/nc.test.ts` 与 `diff -q` | 上游 `packages/core/src/nc/parser.ts` |

同步纪律：

1. 每次同步都记录上游 commit、同步日期和来源文件映射；新增补丁必须同时写理由、对应测试和映射，不能只写同步日期。
2. 先审 `docs/viewer-3d-drift-audit.md` 的决策，再实施；上游 hiddenBodies/可见索引与本地播放/拾取必须做组合验收。
3. 构建复用 ui-shell 的 esbuild，产物必须可重现；运行 `node ui-model-viewer/build.mjs` 和适用自检后再进入 Codex 审核，按意见修正并复审。
4. 2D Draft 归独立 `ui-drawing-viewer`，不得重新塞进本插件形成第二份核心。

## 工序驱动联合检查

`cam.model.preview` 与 `cam.nc.preview` 现在由同一个 WebGL2 GeomView 渲染。旧 `ui-toolpath-viewer` 插件已删除（2026-10-12 并入本插件；NC 解析器已直译为 `src/core/nc/parser.ts`）。纯 PRT 和纯 NC 都可以独立使用；纯 NC 不调用 NX。

从工作台「加工」的「加工检查」打开有对齐证据的批次，或在 PRT 顶部选择同源加工批次。工序按工位分组：勾选控制显示、点击行切换当前工序、播放只推进当前工序；切换不重置相机。当前轨迹完整着色，参照工序压暗。「仅当前」「本工位全部」快速切换显隐。默认拾取刀路，临时选面时不抢拾取。提供快移/切削/未走轨迹/模型/边线/刀路穿透/工位坐标轴开关与扩大视区。

回放按段距离/F估时，快移假定8000、缺F假定500单位/分钟，不包含加减速、停留、换刀。显示程序刀位标记、当前文件行号、当前工位XYZ及F；标记可穿过遮挡，不是刀具实体。播放控制（播放/暂停、单步、进度、速度）位于画布上方，底部留给工作台原生输入框。默认只显示动画画布；预览信息与程序核对收在顶部“检查”入口，使用独立模态弹窗，打开时暂停回放、关闭后返回原刀位，不压缩画布，近似轨迹说明也在顶部，不占底部控制位置。单击轨迹暂停并定位刀位，不自动展开源码；已打开源码时同步跟随行号。程序核对弹窗支持跳行、跟随刀位与手动浏览（手动滚动停止跟随）；“跟随刀位”每次点击都立即定位当前行并启用跟随，当前行用蓝色底色、左侧标记和加粗文字突出，长程序只挂载可见行。画布聚焦时空格播放、左右键单步；输入框和按钮不抢快捷键。每个 NC 独立解析，不拼接程序、不串模态。

### 对齐证据与数据边界

只读接口：`GET /camind/api/models/sessions/<session>/runs?path=<PRT引用>` 列同源批次；`GET .../runs/<runId>` 取已校验的联合数据。写件仍归 CAM/NX 生产者，查看器不执行加工。

生产者将 `preview.json` 落到 `$DSH_HOME/cam-runs/<session>/<runId>/`，NC 留在 `delivery/nc_batch.zip`。`lib/joint.js` 的 `createJointManifest` 可从实际 NX 结果和回收的 NC 字节生成清单。版本1字段：`units=mm`、`frame=package_to_nc`、`model_path`（会话已授权的PRT引用）、`source_sha256`、`geometry_sha256`（原始几何清单字节SHA256）、`stations[{name,part_to_nc:{r,t}}]`、`operations[{name,file,station,sha256,fid?}]`。多工位必须显式绑定每道工序，不默认第一个工位；有向量回读错误的结果拒绝生成证据。

Host 每次验证会话引用、源PRT内容、几何包版本、NC字节、面关联及右手正交矩阵；拒绝run目录中的符号链接。浏览器按 `p_nc=R×p_package+t` 的逆变换逐工序装入共同场景。联合显示拒绝英制、非G17平面、解析不完整、旋转轴和未支持的G指令；不能靠包围盒或手动拖拽猜对齐。单个NC限4MiB、批次总内容8MiB、最多128道工序、总刀路100万段。

**当前常规 `cam_run` 的接口没有返回完整工位矩阵，因此不会自动产出这份证据。** 缺失的旧/新批次禁用「加工检查」，仍可单独查看NC；验收使用已配置工作台的 `/cam_face_mill_by_fids` 返回真实矩阵并生成清单，不把无证据的任务伪装成已对齐。后续常规流水线接入必须先补NX完整工位回读和来源绑定。

这只是工序驱动的NC轨迹近似检查，不是NX内部刀路、材料去除/IPW、碰撞检查或机床仿真。

## 构建和自检

复用工作区 ui-shell 已安装的 esbuild，不新增构建依赖：

```sh
node ui-model-viewer/build.mjs
node ui-model-viewer/selfcheck.mjs
# GP-2 读端合同：需相邻 CAM-Agent 仓库与 python3；CAM_AGENT_REPO/CAM_AGENT_REF 可覆盖来源。
node ui-model-viewer/selfcheck-gp2.mjs
# 多体显隐/声明体/X-ray：需相邻 Camind-desktop 仓库提供合成包与 GL mock；DESKTOP_REPO 可覆盖路径。
node ui-model-viewer/selfcheck-visibility.mjs
node ui-model-viewer/selfcheck-xray.mjs
# 镜像清单的本地与上游 SHA256；仅核对本地时设 CAMIND_MIRROR_LOCAL_ONLY=1。
node ui-model-viewer/selfcheck-mirror.mjs
node ui-preview/selfcheck.mjs
# 真实浏览器布局、播放和 X-ray 像素/控件回归，需要本机 Playwright 与 Chromium/Chrome。
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core node ui-model-viewer/selfcheck-layout.mjs
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core node ui-model-viewer/selfcheck-playback.mjs
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core CAMIND_CHROMIUM_PATH=/path/to/chrome node ui-model-viewer/selfcheck-xray-gpu.mjs
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core CAMIND_CHROMIUM_PATH=/path/to/chrome node ui-model-viewer/selfcheck-xray-ui.mjs
# 干净 worktree 全量验证：从 HEAD 新建 detached worktree，依次跑构建、基础、镜像、GP-2、显隐、
# X-ray、文件预览自检与播放、布局、真实 Chromium 像素/控件回归，并在构建前后断言工作区无残留改动。
# 「干净」仅指 camind-dsh 工作树；相邻 Desktop/CAM-Agent 仓库只记录 HEAD 与工作树状态、不做隔离，
# GP-2 fixture 来源哈希在日志中记录，pinned fixture 之外的相邻仓库内容不作可复现性保证。
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core CAMIND_CHROMIUM_PATH=/path/to/chrome bash ui-model-viewer/selfcheck-clean.sh
```

`npm run init` 的 web/desktop 模板包含本插件，并在 ui-shell 安装后构建它。运行时不要为升级插件重复 init；当前机器已安装，重启即可。

窄视区的源码/选面/详情抽屉在画布下方换行，画布保留有效宽度；不能让抽屉的 100% 宽度与零 flex basis 的画布挤在同一行。布局回归覆盖窄/宽容器、有/无工序列表；播放回归在真实 React/WebGL 查看器里验证 900/605/400px 视区、顶部播放/暂停、默认折叠检查工具及程序/信息弹窗及画布尺寸不变，不访问 NX。必要时用 `CAMIND_CHROMIUM_PATH` 指定测试浏览器可执行文件。

自检覆盖七种视图、投影切换、面编号校验、多面选择、类型筛选与回调释放，以及真实格式合同包、源版本不符、损坏文件、符号链接逃逸、未保存 NX 模型阻断、完整五步模拟、缓存不重复导出及 HTTP 门禁。

以下是移除独立标签前的历史验收记录；当前入口统一为「预览」。

## 本次真实零件验收

2026-10-11，使用用户指定的 `zm26030-704_stp.prt`，现有工作台 `192.168.31.77:8888`（proxy `8-multibase`）。重新核实就绪、队列为空，回收同 SHA256 的既有几何包，未重新执行 NX 写件/开件步骤。

- 231 个面、22,839 个顶点、26,314 个三角形、558 条边线。
- 原始 PRT SHA256 未变；各文件 SHA256、gzip、面段、索引和计数校验通过。
- Chrome 实际渲染通过；拾取 `F000084`，平面、面积 16,561.45 mm²。
- 等轴/俯视、滚轮缩放、右键平移、左键旋转均通过图像变化断言，无页面异常。
- 实际 dsh `/camind` 插件图与「3D 模型」标签页渲染通过。
- 私有截图：`.dsh/model-previews/acceptance-dsh.png`、`acceptance-iso.png`、`acceptance-top.png`。

边界：格式 v1 只支持毫米单零件（可多实体），不支持装配。显示网格是近似曲面，选面属性来自该包，不等于实时 NX 精确查询。单文件压缩后限 32 MiB，单文件解压后限 128 MiB，网格限 200 万三角形。告警在界面显示；无网格的面拒绝显示。

初次回收沿用历史诊断中的临时 curl 传输适配；随后再次使用生产 camPipeline 的原生 Node fetch，当前配置下 ping、就绪检查和 400,395 字节几何包回收均成功，SHA256 校验通过。未改传输实现，历史网络问题的根因仍不作推断。本次未重新执行真实 NX 五步导出（离线模拟覆盖）。

## 桌面路径引用验收

2026-10-11 在真实 Camind 桌面窗口（`dsh-app://`）通过 CDP 实测：右侧工作台「输入」显示既有会话的 `zm26030-704_stp.prt` 路径引用及大小；点击后切换「预览」并渲染 231 面、26,314 三角片模型；「3D 模型」页签也能列出同一引用并显示模型，无页面异常。使用同 SHA256 的已校验缓存，没有发送消息或调用模型，也没有执行新的 NX 导出。截图为 `.dsh/model-previews/acceptance-desktop-reference-{preview,model}.png`。

`ui-preview/selfcheck.mjs` 覆盖带空格/CJK/相对路径语法、重复文件名、缺失文件、跨会话与未引用绝对路径拒绝、敏感目录、符号链接目标改变、冷会话只读句柄释放及 HTTP 门禁。

## 2026-10-12 联合查看器桌面验收

以真实 Camind 桌面 `dsh-app://` 窗口为主，完整重启后验收，不用浏览器fixture或reload代替桌面加载。工作台仍为已配置的NX服务；复用同源已校验几何包，在两个独立标记工作副本分别生成Ø10面铣NC。两次覆盖率均0.9584，原始PRT SHA256未变；矩阵不是identity：绕Z旋转30°且 `t=[-4.598076,-1.964102,40.25]`，已逆变换回包坐标。两个独立NC参数相同，字节也相同；跨文件模态和不同工位变换另由离线自检覆盖，不把它说成真实多工位加工验收。

- 实际桌面验证七视图/投影、旋转/缩放/平移、工序显隐与选择、播放/暂停/单步/键盘、轨迹点击定位源码、源码切文件/跳行/停止跟随/虚拟行数、真实面拾取和多面筛选、图层/工位轴/详情/适配、扩大视区，以及工作台联合入口与纯NC回退。页面异常0。
- 在桌面右工作台展开、中央预览不足736px时验证了下置源码/选面抽屉。布局以查看器容器宽度响应，不以整个窗口宽度判断。扩大视区是应用内覆盖，不进入不可靠的macOS系统全屏。
- Ø8试验覆盖率0.9466，被NX结果检查拒绝并删除NC，没有放宽检查；该失败记录不进入联合验收清单。
- 自己创建的独立测试副本已保存，NX最终队列为空、未保存件和不可判定件均0。不调用可能退化为CloseAll的关件接口；工作副本留在NX侧。验收三件套明确标注非生产，不可据此直接上机。
- 私有证据：`$DSH_HOME/model-previews/joint-acceptance.json`、`joint-desktop-report.json`、`joint-desktop-{scene,expanded,nc-only}.png`。离线自检另覆盖多工位绑定、源/几何/NC版本不符、错误矩阵、未支持坐标指令和符号链接拒绝。

复跑桌面UI验收：先用项目DSH_HOME启动Camind桌面调试实例（`--remote-debugging-port=9236`）并激活窗口，保留上述验收数据；安装或指定本机验收用Playwright后执行：

```sh
CAMIND_PLAYWRIGHT_PATH=/path/to/playwright-core node ui-model-viewer/acceptance-desktop.mjs
```

脚本仅连接现有调试桌面，不发送会话消息、不调用模型或NX加工，不启动服务。结束后需退出自己启动的调试实例，保留用户原有Web服务。
