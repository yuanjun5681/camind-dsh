# Camind Web UI 设计规范

> 状态：v1（2026-08-28）  
> 适用范围：`/camind` 下由 Shell、品牌、预览、页面和领域插件共同组成的 Web UI

## 1. 基本原则

- 继承官方主题，不复制独立 light/dark 色板。
- 语义优先于具体色值和偶然尺寸。
- 同一行为使用同一组件与状态模型。
- 键盘、窄屏、长文本、失败状态和 reduced-motion 优先于装饰。
- Foundation 只收纳跨领域且语义一致的模式，不成为领域组件杂物箱。

## 2. 组件选择

新增界面必须依次判断：官方 primitive → foundation 组合组件 → 领域组件。

- Button、Input、Modal、Pill、Tooltip 优先使用官方实现；
- 页面框架、Tabs、Card、Badge、Field、IconButton、StateView 使用 foundation；
- Workbench、CAM run 时间线、记忆正文、文件预览和刀路查看器属于领域组件；
- 禁止仅因调用方式不顺手而复制按钮、输入框或对话框样式。

## 3. 样式与命名

- 产品 token 使用 `--camind-*`；公共组件 class 使用 `.cui-*`；
- 页面/领域 class 保持现有前缀，如 `.pmm-*`、`.campv-*`、`.tpv-*`、`.camnx-*`；
- 禁止无作用域的 `button {}`、`input {}`、`h1 {}` 和通用 `.card`；
- 禁止依赖官方构建产生的 hash class；结构选择器必须写明升级风险；
- 功能 CSS 禁止新增十六进制或 rgb 主题色。品牌资产、内容本身、最小启动 fallback 和有明确语义的领域可视化除外；
- 动态 stylesheet 必须由 `ctx.effect()` 管理，不在模块 factory 执行时直接修改 DOM。

## 4. 排版与几何

| 角色 | 字号/行高 | 字重 |
|---|---:|---:|
| 页面标题 | 24/32 | 600 |
| 区域标题 | 20/28 | 500 |
| 卡片/对话框标题 | 16/24 | 500–600 |
| 正文/主要控件 | 14/22 | 400–500 |
| 紧凑正文 | 13/20 | 400–500 |
| 元数据 | 12/18 | 400–500 |
| 微型标签 | 11/17 | 500 |

产品布局使用 4/8/12/16/24/32px 间距。普通控件圆角 8px、卡片 12px、密集 Dialog 14px；官方 primitive 的内部尺寸与圆角不得在调用点随意覆盖。
带完整底色的方形品牌图像由品牌插件在展示层使用产品几何 token 裁切：紧凑标记使用 6px，首页品牌图使用 12px；原始品牌资产保持不变。

## 5. 状态与可访问性

- 每个交互控件覆盖 default、hover、active/selected、focus-visible、disabled 和 busy；
- focus-visible 必须有至少 2px 可见轮廓，禁止无补偿地移除 outline；
- loading、empty、error、partial、polling 和 cancelled 使用可理解文本，不能只靠颜色；
- 可点击 Card 使用原生 button；IconButton 必须有 aria-label 与 Tooltip；
- Tabs 使用 tablist/tab、aria-selected，并支持方向键、Home、End；
- Dialog 必须复用官方 Modal，具备 aria、Escape 和可预测关闭方式；
- 所有主要操作必须可只用键盘完成；200% 缩放下不得丢失；
- `prefers-reduced-motion: reduce` 下关闭非必要动画。

## 6. 响应式与滚动

至少检查 1440、1024、736 和 360px 宽度及低高度窗口。每个独立区域只拥有一个主要纵向滚动容器；正文与错误允许换行并使用 `overflow-wrap: anywhere`，代码、日志与 NC 内容可以横向滚动。

## 7. 验收矩阵

每次 UI 改动至少覆盖：

- light、dark、system 跟随系统；
- 鼠标、键盘、Escape 和焦点顺序；
- default、hover、active、focus、disabled、loading、empty、error；
- 长中文、长英文、长路径、空值和大列表；
- reduced-motion、100%/200% 缩放；
- 深链接刷新、前进后退；
- `/camind` 生效且官方 `/web` 不受影响。

有意偏离规范时，必须在实现旁说明适用组件、原因、替代方案为何不可用以及 dsh 升级时是否需要复核。
