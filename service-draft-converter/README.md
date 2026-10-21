# service-draft-converter

DWG/DXF → [camind-draft-pack v1](契约正本在 CAM-Agent 仓 `Drawing_parser/draft_pack_contract_v1.md`)
图纸包的纯 JS 转换器，Cordis `draftConverter` 服务。

CAM-Agent `Drawing_parser/dwg_to_draft_v1.py`（ezdxf 链）的移植正本。移植后运行时唯一
外部依赖是用户自装的 `dwg2dxf` CLI（LibreDWG）：**GPL 铁律——LibreDWG 只以命令行子进程
调用，永不进任何安装包**。Windows 可用官方 GitHub Releases 的 Win32/Win64 ZIP（免编译）。

## 服务 API

```js
const dc = ctx.draftConverter          // 或 inject 声明后 ctx.get('draftConverter')
await dc.convertDwg('/abs/path/part.dwg') // worker 转换 → 契约 v1 包对象（失败抛错，err.checkErrors 带拒绝码）
await dc.convertDxf(dxfText, { sourceName }) // DXF 直读（同一有界 worker；支持 AbortSignal 与超时终止）
dc.toSvg(pack)                          // → SVG（保留原色与简单虚线，背景由画布提供）
dc.preview(pack)                        // → { svg, targets }，同源文字/尺寸实体索引
dc.check(pack, 'writer' | 'reader')    // packcheck 校验（码表与 CAM-Agent draft_packcheck.py 同源）
await dc.info()                        // { dwg2dxf, libredwg, converter } 版本面（异步子进程探测）
dc.activeWorkers()                     // 当前活动转换 worker 数（启动/退出可观测）
await dc.identities(sourceSha256)      // autocad/nx/unknown 三种出身的六项身份候选，供转换前缓存探测
```

`dwg2dxf` 路径解析序：条目 config `dwg2dxfPath`（volatile 热更）> 环境变量
`CAMIND_DWG2DXF` > PATH。

## CLI

```sh
node service-draft-converter/cli.mjs 零件.dwg out.json          # DWG（spawn dwg2dxf）
node service-draft-converter/cli.mjs 零件.dxf out.json          # DXF 直读
```

## 结构

```
lib/dxfparse.js   DXF 组码解析（HEADER/TABLES/BLOCKS/ENTITIES；子类标记纪律见 convert）
lib/expand.js     INSERT/*D 虚拟展开、2D 仿射、spline/ellipse 弦高离散、HATCH 解析
lib/text.js       plain_mtext 等价剥码、\S 堆叠预线性化、%% 控制码、\U+XXXX
lib/hatch.js      边界段 + 45° 图案线求交（v1 简化口径）
lib/convert.js    转换主链（颜色判序/语义层 dims/self_check 对账/bbox/单位/出包自检）
lib/packcheck.js  契约 I1~I9 校验（writer/reader 两档）
lib/dwg.js        dwg2dxf 子进程编排（超时/缺二进制响亮报错/临时文件即删）
lib/worker.js     服务异步转换入口（子进程等待与 DXF 解析不阻塞宿主）
lib/svg.js        图纸包 SVG 渲染（Y 翻转、文字旋转、简单虚线、dwg-e-<id> 实体标识）
                 + 搜索目标索引（尺寸 entity_ids 整组 / 非尺寸文字单实体，不作模糊关联）
lib/aci.js        ACI 1~255 → RGB 表（ezdxf DXF_DEFAULT_COLORS dump，与渲染端同源）
```

## 与 Python 版的已知分歧

1. LWPOLYLINE 的 bulge 读真实凸度字段（Python `pts_payload` 误取起点线宽；无线宽/无
   凸度输入下两版输出逐字节一致）——契约 §3 凸度语义靠它，已在 selfcheck 钉住。
2. `conversion.tool/commit/ezdxf` 字段如实标注 JS 版身份（契约允许）。
3. 未圆整标量（text.h 等）允许末位 ULP 差：ezdxf 走 numpy 矩阵乘，结合序不可复刻；
   黄金对照容差 1e-9（契约 I2 是 1e-3，远在其上）。
4. 尺寸标注块中的 `POINT + Defpoints` 仍不出图，但从 `unsupported_block_entity` 单独
   归为 `ignored_dimension_defpoint`，供预览区分正常省略与真实缺失；其他图层 POINT 不豁免。
   两切面对账总数不变。与旧 Python 黄金包对照时，仅将此理由合并回旧类别再比较。

## 转换身份与 pack.identity（唯一权威规范）

`conversion.commit` 仅作展示溯源：优先取 `CAMIND_CONVERTER_COMMIT`，否则取当前 Git `HEAD`，
最后才回退到 package.json 版本。它**不是缓存键原料**。实际转换身份由以下三部分组成：
真实构建文件 SHA256、dwg2dxf `--version` 首行、影响输出的规范化选项。构建哈希逐字节覆盖
`lib/aci.js`、`convert.js`、`dwg.js`、`dxfparse.js`、`expand.js`、`hatch.js`、`packcheck.js`、`text.js`、`worker.js`，
因此未提交源码变化也会改变身份。

`pack.identity = sha256(JSON.stringify(六项数组))`，六项顺序固定为：
`source_sha256`、`pipeline_version`、`origin.channel`、综合转换指纹、`rules_version`、`view_rule_version`。
字符串按 NFC 规范化；对象键排序、数组保序；`null`/`undefined` 归为空字符串；数字与布尔按 `String()`。
该身份只在 descriptor/缓存 sidecar 中使用，**不写入 pack JSON**，因此不破坏 writer 顶层白名单。
服务 API：`conversionIdentity(options)` 计算综合指纹，`identity(pack, options)` 返回 `{ fields, identity }`。

## 自检

```sh
node service-draft-converter/selfcheck.mjs          # 合成用例 + SVG 与 worker 回归
# 真图黄金对照（敏感图纸不入库，只读环境变量指向的本地文件）：
DRAFT_GOLDEN_DWG=/path/x.dwg DRAFT_GOLDEN_PY=/path/python版包.json \
  node service-draft-converter/selfcheck.mjs
```

## Python / JS / TS 三方 packcheck 差分

先在 Camind-desktop 检出中生成并自验共享夹具，再从本仓库根目录运行差分器（`DESKTOP_REPO` 与
`CAM_AGENT_REPO` 都必须是 git 工作树，差分会在探针前后核对两仓库全仓工作树的 git 状态不变）：

```sh
cd /path/to/Camind-desktop
python3 tools/gen_draft_fixtures.py --selfcheck
cd /path/to/camind-dsh
DESKTOP_REPO=/path/to/Camind-desktop CAM_AGENT_REPO=/path/to/CAM-Agent \
  node service-draft-converter/selfcheck-three-way.mjs
# Python 不在默认位置时可显式指定：CAM_AGENT_PYTHON=/path/to/python
```

子进程以 `-I` 隔离模式运行并过滤 `sys.path` 的空/cwd 项：忽略 `PYTHONPATH` 与 user site（`-I`
不含 `-S`，系统 site-packages 仍在搜索路径上，依赖面不是强制约束；当前被测模块实际只用到
标准库，本仓库不以探针充当依赖面守门）。零漂移判定为全仓 git 可见状态（未跟踪文件 `-uall`
逐文件列出，未跟踪与 ignored 目录均不再折叠——目录内新增文件均可检出；status 调用统一带
`-c core.fsmonitor=false -c core.untrackedCache=false`，不被这两个性能特性遮蔽）。
已知盲区逐项：①既有文件的内容改写——git status 不比对内容，已被 git 状态覆盖的路径
（既有 ` M`/`??`/`!!`）发生不改变状态文本的改写不在承诺范围（`.pyc` 改写由代码内
`sys.dont_write_bytecode = True` 抑制，`-I` 隐含 `-E`，环境变量不生效，没有第二条抑制
机制）；②检查点之间写入后还原/删除的瞬时写盘；③含转义/引号路径的极端形态（porcelain
按行切片，`-z` 待办）；④`.git` 内部（config/hooks/info/exclude 等 status 不可见写盘）与
两仓库之外的路径；⑤`.DS_Store` 级 ??/!! 抖动被显式过滤（rename 行与 tracked 修改不过滤）；
⑥`assume-unchanged`/`skip-worktree` 标记文件的改写（两仓**全仓**前置断言拒绝任何小写 tag
或大写 `S`——`ls-files -v` 小写 = assume-unchanged 叠加，`skip-worktree`+`assume-unchanged`
组合输出 `s`；附临时仓负控）。两仓均无子模块（无 `.gitmodules`；子模块内写盘对 status
不可见的形态不适用）。夹具目录 `tests/fixtures/draft/` 必须是已提交且被跟踪的干净
基线（读取夹具前的断言：逐文件 `git ls-files --error-unmatch` + 目录 status 为空；目录级
断言在生成器探针之后、读取包字节之前执行）。空目录本就不进入
git 状态，不是本守卫的盲区而是 git 不变量。git 调用统一经 `gitSafe` 清理重定向/注入类环境
变量（`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_COMMON_DIR`/`GIT_OBJECT_DIRECTORY`/
`GIT_ALTERNATE_OBJECT_DIRECTORIES`/`GIT_NAMESPACE`/`GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT`/
`GIT_EXEC_PATH` 及 `GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*` 配对族与 `GIT_TRACE*` 追踪族，
附 `core.excludesFile` 注入与 `GIT_TRACE2_EVENT` 写盘负控；负控的
raw 镜像调用在临时仓内刻意传未清理 env，是反例构造而非生产路径），真实
仓库的 status 调用一律带 `--no-optional-locks`（不刷新 `.git/index`）。oracle 传递导入面：
`runPython` 经 `sys.path.insert(0, parserDir)` 前插导入，前置断言 `Drawing_parser/` 目录状态
行全为 `!!`（零 `??`、零受控改动；`.venv`/`__pycache__` 等本地 ignored 噪音允许存在），
且顶层不允许存在 ignored `.py`（sys.path 前插会遮蔽 stdlib/传递导入），
收窄「兄弟模块 dirty 但 drift 判不出」的盲区（ignored 非 .py 资源仍允许存在，属已知残余面）。守卫的承诺精确为：**任何不在上述①~⑥盲区
内、且在检查点仍改变 git 可见状态的持久写盘都会被判定为漂移**（「git 可见状态」= 上述
`git status --ignored=traditional` 输出；错误信息中列出实际漂移行）；覆盖范围 = Desktop/
CAM-Agent 两仓库的工作树（探针的「模块级无副作用」是辅助说明而非安全论据）。运行差分期间相邻仓库（Desktop/CAM-Agent）必须保持静默（编辑器 swap、Finder 元数据等非
`.DS_Store` 新文件也会被判定为漂移；并行工作时请先停写）。本机实测环境：git 2.54.0
（Apple Git-157），全仓 status 行数 Desktop≈9.0k / CAM-Agent≈26.6k，两仓合计耗时本机实测
160~520ms 波动（随 ignored 体量与磁盘缓存，量级记录而非契约）；
更大的 ignored 体量可能触发 maxBuffer/超时（会以专属中文错误 fail-closed）。

差分器经 Python 子进程导入 Desktop 生成器 `tools/gen_draft_fixtures.py` 的 `BAD_CASES` 取得各坏包的期望
错误码集合（唯一事实源，不再读取单独的 `manifest.json`；好包文件名也从生成器源码解析），
对同一批好包/坏包在 writer/reader 双档逐包比较标准化错误码集合，并比较 reader 的 `skipped`。
当前基线含圆 bbox 漏检、畸形 `def_points` + 字符串 `dimlfac`、非数组 dims 容器三组 M0 反例，
另有 views/title_block/tech_requirements/dims 新增语义形态的 JS/TS 双端负例（Python 旧版不覆盖
这些新增形态）。生成器写法规约（`good_path = os.path.join(OUT, "<双引号>.json")` 唯一赋值点与
`BAD_CASES` 三元组形态）与坏包名精确集合是差分器的硬耦合点，生成器改动需同步本仓库断言。任何一方不一致都会整体失败；比对只覆盖错误码与 `skipped`，不绑定包内容哈希——
生成器改包内容而未改期望码时漂移不可见。两档哈希语义须分清：运行日志打印的逐包 sha256
指纹仅记录不作断言；生成器/draft_packcheck.py/钉住清单的全部夹具（good 包 + `EXPECTED_BAD_CASES`
19 项）另有「运行前后字节不变」断言
（受控内容零漂移：清单内文件被内容改写必被发现，覆盖「受控路径上已有 git 状态条目时的内容
改写」这一 status 盲区；清单外文件的内容改写不可见，属盲区①）。
夹具未提交漂移由 status 守卫发现，已提交漂移需代码评审/提交历史确认。
全部通过只证明校验器行为一致，不代表图纸已审或尺寸正确。
