# Web 统一样式与组件基础层设计

> 状态：v1（2026-08-28）  
> 范围：`/camind` 定制前端中的主题接入、产品语义 token 和公共页面组件  
> 基线：DeepSeek Harness `0.1.1-rc.2`

## 1. 目的

Camind 的 Web UI 同时包含 Vite + React 的 `ui-shell` 和由 dsh client module system 动态加载的手写 bundle。过去 Shell、记忆库、内容预览、刀路查看器和 NX 设置卡分别维护颜色别名与常用控件，造成主题升级、交互状态和可访问性难以统一。

本设计新增 `camind-ui-foundation`，但不新增第二套主题引擎，也不合并现有插件。官方 `ui-theme` 继续拥有 light/dark/system 和全部 `--dsw-*` token；foundation 只增加稳定的 Camind 产品语义与无业务组合组件。

## 2. 分层与所有权

| 层 | 所有者 | 责任 |
|---|---|---|
| 主题状态 | 官方 `ui-theme` | light/dark/system、主题事件、`--dsw-*` |
| 官方原子组件 | 官方 `ui-primitives` | Button、Input、Modal、Pill、Tooltip、图标 |
| 产品基础层 | `camind-ui-foundation` | `--camind-*`、Page、Tabs、Card、Badge、Field、State、Dialog |
| Shell | `ui-shell` | AppFrame、会话布局、Workbench、Overlay、Host 桥 |
| 品牌 | `ui-brand` | Mascot、BrandLockup、品牌图片路由 |
| 领域插件 | `page-*`、`ui-preview`、`ui-toolpath-viewer`、`tool-cam` | 路由、数据、领域布局与可视化 |

实现位置按以下顺序选择：

1. 官方 primitive 已满足语义时直接使用；
2. 至少两个 Camind 界面拥有相同语义和行为时进入 foundation；
3. 只属于一个领域时留在对应插件；
4. 品牌资产留在 `ui-brand`；
5. Host、路由、slot 与业务 store 不进入 foundation。

## 3. 客户端边界

`camind-ui-foundation` 是 client-only provider：Host half 为空，不注册 HTTP、工具、命令、页面或 slot。动态插件在 `dsh.client.external` 声明它，并通过 `require('camind-ui-foundation')` 消费同一个 React 实例下的公共组件。

`ui-shell` 不从动态 bundle import React 组件。Shell 继续静态 import 官方 primitives，只消费 foundation 的 `--camind-*` 视觉契约；Shell 独有布局组件不进入公共库。只有未来确有复杂组件同时被 Shell 与多个动态页面消费时，才评估同源双产物构建。

Foundation 仅在 `/camind` 激活：

- 给 `body` 添加 `data-camind-ui`；
- 以 Cordis effect 注入唯一 stylesheet，卸载时清理；
- 公共规则只匹配 `body[data-camind-ui] .cui-*`；
- 官方 `/web` 不获得属性与公共样式。

## 4. Token

三层关系：

```text
官方语义 token      --dsw-alias-label-primary
        ↓
Camind 产品语义     --camind-color-text
        ↓
组件局部状态        .cui-badge[data-tone="danger"]
```

初始 token 分为：

- 文字与状态：`--camind-color-text*`、`accent/success/warning/danger`；
- 表面：`--camind-surface-page/layer/raised/code/hover/active`；
- 边界：`--camind-border-subtle/default/strong`、`--camind-focus-ring`；
- 几何：4px 间距网格、6/8/12/14px 圆角、28/32px 紧凑控件高度；
- 排版：继承官方字体，代码使用 `--camind-font-mono`。

业务页面不再建立 `--pmm-*` 这类对官方 token 的一比一映射。领域可视化可以保留固定颜色，例如刀路快移/切削/圆弧/孔位和 CAD 深色画布，但必须与普通 UI chrome 分开。

## 5. v1 公共 API

官方再导出：`Button`、`Input`、`Modal`、`Pill`、`Tooltip`。

组合组件：`Page`、`PageHeader`、`PageBody`、`Tabs`、`Card`、`Badge`、`Chip`、`Field`、`IconButton`、`StateView`、`StateNotice`、`Dialog`、`DialogBody`、`DialogFooter`、`SidebarAction`。

辅助函数：`cx`。

Foundation 组件必须受控、无业务 store、无 Host 调用，并透传适用的原生属性。Tabs 提供 tablist/tab 语义和方向键/Home/End；IconButton 强制非空 label；Dialog 复用官方 Modal 的 portal、mask、Escape 和 dialog aria。

## 6. 品牌共享

`ui-brand` 是独立品牌 provider，导出 `Mascot`、`BrandLockup` 和品牌 slot occupant，并由 Host 提供选定的 mascot PNG。`ui-home` 通过 client external 消费这些导出，不再复制品牌图片或样式。品牌固定色属于批准的视觉资产，不进入产品主题 token；展示容器仍复用 foundation 的圆角 token（紧凑标记 6px、首页品牌图 12px）。

## 7. 升级策略

dsh 升级时优先集中核对：

1. 官方 theme token 的新增、删除与重命名；
2. foundation 的 `--dsw-*` → `--camind-*` 映射；
3. Button、Input、Modal、Tooltip 与图标 API；
4. `/camind` 的 light/dark/system 与 `/web` 隔离；
5. `dsh.client.external` 图无 missing provider 或 cycle。

页面领域 CSS 不依赖官方 hash class。`ui-home` 和 `ui-preview` 因上游缺少公开 slot/API 而保留的结构选择器，继续登记在 `docs/dsh-upgrade.md`。
