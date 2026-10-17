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
dc.info()                              // { dwg2dxf, libredwg, converter } 版本面
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

先在 Camind-desktop 检出中生成并自验共享夹具，再从本仓库根目录运行差分器：

```sh
cd /path/to/Camind-desktop
python3 tools/gen_draft_fixtures.py --selfcheck
cd /path/to/camind-dsh
DESKTOP_REPO=/path/to/Camind-desktop CAM_AGENT_REPO=/path/to/CAM-Agent \
  node service-draft-converter/selfcheck-three-way.mjs
# Python 不在默认位置时可显式指定：CAM_AGENT_PYTHON=/path/to/python
```

差分器读取 Desktop `tests/fixtures/draft/manifest.json`，对同一批好包/坏包在 writer/reader
双档逐包比较标准化错误码集合，并比较 reader 的 `skipped`。当前基线含圆 bbox 漏检、畸形
`def_points` + 字符串 `dimlfac`、非数组 dims 容器三组 M0 反例。任何一方不一致都会整体失败；
全部通过只证明校验器行为一致，不代表图纸已审或尺寸正确。
