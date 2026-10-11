// camind-tool-cam browser bundle — hand-written, no build step.
// One `plugins.bundle.config` card (key `camind-tool-cam`, rendered on the bundle's
// detail page while the Host serves the `tool-cam` entry config form) on the
// official Plugins page (dsh-client-ui-plugin-manager): NX workbench (CAM-Agent
// proxy) connection settings. The baseURL field rides the `tool-cam` entry config
// via configForms; the token is write-only and goes
// through the credentials remote domain, addressed by the reference the section
// names (default CAMIND_NX_AGENT_TOKEN) — its literal never crosses the wire back.
// The "test connection" button calls the plugin's Host route POST /camind/api/cam/ping
// (the browser cannot call the proxy directly: CORS, and the token must stay
// Host-side). Only platform seed modules may be required. UI copy is hardcoded
// Chinese, matching the workspace's model-facing language convention.
//
// 会话卡片已退役（2026-08-26）：cam/stage、cam/check-report、cam/delivered
// 三个会话事件及其 keyed `conversation.chat.node` 渲染器曾在此实现，但
// dsh-session-persistence 拒绝重载含未知且未标 ignorable 事件类型的会话
// （append() 无 ignorable 形参、无注册面）——事故实证后 tool-cam 停发全部
// cam/* 会话事件。加工过程视图由 ui-shell 工作台「加工」页签承担（数据源
// run 目录 runstate.history，重启免疫）；`cam.nc.preview` 刀路挂点席位改由
// ui-shell 在 root entry 声明。
//
// Styling: one effect-owned stylesheet (classes prefixed camnx-) driven by
// the official --dsw-alias-* design tokens, so the card follows the shell's
// light/dark theme.
window.__ModuleLoader__.load({ id: "camind-tool-cam", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useState } = React
const { Button, IconGaugeOutlineRegular, Input } = require('@deepseek-ai/dsh-client-ui-primitives')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')

const NS = 'tool-cam'
const BUNDLE_NAME = 'camind-tool-cam'
// apply 的 ctx 存模块级：右侧栏页签的 filePreview/sidebarRight 运行期活查。
let applyCtx = null
const BASE_URL_FIELD = 'baseURL'
const TOKEN_FIELD = 'token'
const DEFAULT_TOKEN_REF = 'CAMIND_NX_AGENT_TOKEN'
const PING_API = '/camind/api/cam/ping'

// --- stylesheet ------------------------------------------------------------------

const cardCss = `
/* 0.2.0：卡片镀铬由官方插件页提供，这里只保留表单域样式；camnx-page 是详情页根。 */
.camnx-page .camnx-body { border-top: 0; margin: 0; }
.camnx-card {
  list-style: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary); font: inherit;
  transition: border-color .16s, background .16s;
}
.camnx-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.camnx-card-open { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
.camnx-card *, .camnx-card *::before, .camnx-card *::after { box-sizing: border-box; }
.camnx-header {
  appearance: none; width: 100%; font: inherit; color: inherit; text-align: left;
  cursor: pointer; background: none; border: 0; border-radius: 12px;
  align-items: center; gap: 12px; padding: 14px 16px; display: flex;
}
.camnx-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.camnx-headtext { flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex; }
.camnx-name { font-size: 15px; font-weight: 600; line-height: 1.4; }
.camnx-desc { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
.camnx-chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; }
.camnx-chevron-open { transform: rotate(180deg); }
.camnx-pending {
  white-space: nowrap; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary);
  border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px;
}
.camnx-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }
.camnx-readonly { color: var(--dsw-alias-label-tertiary); margin: 12px 0 0; font-size: 12px; line-height: 1.5; }
.camnx-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.camnx-field + .camnx-field { border-top: 1px solid var(--dsw-alias-border-l2); }
.camnx-head { display: flex; align-items: center; gap: 8px; }
.camnx-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5; }
.camnx-badge {
  white-space: nowrap; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary);
  border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px;
}
.camnx-badge-muted {
  white-space: nowrap; color: var(--dsw-alias-label-tertiary);
  border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px;
}
.camnx-reset {
  font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer;
  background: none; border: none; padding: 0; font-size: 12px; line-height: 1.5;
}
.camnx-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.camnx-input { width: 100%; }
.camnx-hint { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; }
.camnx-test { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.camnx-test-result { min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.camnx-test-result.ok { color: var(--dsw-alias-state-success-primary, var(--dsw-alias-state-business-primary)); }
.camnx-test-result.fail { color: var(--dsw-alias-label-error); }
.camnx-footer {
  border-top: 1px solid var(--dsw-alias-border-l2);
  display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0 4px;
}
.camnx-failed { flex: 1; min-width: 0; color: var(--dsw-alias-label-error); margin: 0; font-size: 12px; line-height: 1.5; }
`

// --- controller --------------------------------------------------------------------

// Staged form over the `cam-nx` namespace plus the credentials domain, in the
// shape of the official WebSearchCardController: staged text writes only on
// save; the token is the one control living outside the section (write-only).
// 0.2.0: the namespace scope comes from ctx.configForms.get(NS) (writes are
// revision-fenced mutate ops), credentials ride ctx.remote.credentials.
class CamNxCardController {
  constructor(scope, ctx) {
    this.scope = scope
    this.ctx = ctx
    this.staged = new Map()
    this.saving = false
    this.failed = false
    this.credential = { ref: '', configured: false, writable: true }
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => {
      this.readCredential()
      this.publish()
    })
    this.readCredential()
  }

  refOf() {
    const declared = this.scope.getSnapshot().value?.tokenEnv
    return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_TOKEN_REF
  }

  stored(field) {
    const user = this.scope.getSnapshot().user
    return user !== undefined && Object.hasOwn(user, field)
  }

  sectionText(field) {
    const value = this.scope.getSnapshot().value?.[field]
    return typeof value === 'string' ? value : ''
  }

  field(field) {
    if (field === TOKEN_FIELD) return { text: this.staged.get(field) ?? '', overridden: false }
    const staged = this.staged.get(field)
    if (staged === undefined) return { text: this.sectionText(field), overridden: this.stored(field) }
    return { text: staged, overridden: staged.trim() !== '' }
  }

  // Every staged edit a save would write, in staging order.
  plan() {
    const writes = []
    for (const [field, text] of this.staged) {
      if (field === TOKEN_FIELD) {
        const value = text.trim()
        if (value !== '') writes.push(() => this.writeToken(value))
        continue
      }
      const trimmed = text.trim()
      if (trimmed === this.sectionText(field)) continue
      if (trimmed === '') {
        if (this.stored(field)) {
          writes.push(async () => {
            await this.scope.mutate([{ op: 'unset', path: [field] }])
            return !this.stored(field)
          })
        }
      } else {
        writes.push(async () => {
          await this.scope.mutate([{ op: 'set', path: [field], value: trimmed }])
          return this.scope.getSnapshot().user?.[field] === trimmed
        })
      }
    }
    return writes
  }

  projection() {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.plan().length > 0,
      saving: this.saving,
      failed: this.failed,
      baseURL: this.field(BASE_URL_FIELD),
      token: this.field(TOKEN_FIELD),
      tokenConfigured: this.credential.configured,
      tokenWritable: this.credential.writable,
    }
  }

  publish() {
    this.store.set(this.projection())
  }

  inject() {
    return {
      hooks: { camNxCard: this.store },
      edit: (field, text) => {
        this.staged.set(field, text)
        this.failed = false
        this.publish()
      },
      resetField: (field) => {
        const base = this.scope.getSnapshot().base?.[field]
        this.staged.set(field, typeof base === 'string' ? base : '')
        this.failed = false
        this.publish()
      },
      save: () => this.save(),
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  async save() {
    const writes = this.plan()
    if (writes.length === 0 || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) landed = (await write()) && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  // Ask the credentials domain about the reference the section currently names;
  // the literal never rides a response, only {configured, writable}.
  async readCredential() {
    const ref = this.refOf()
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.publish()
    }
    let response
    try {
      response = await this.ctx.remote.credentials.describe([ref])
    } catch {
      return
    }
    if (!response.ok || ref !== this.refOf()) return
    const view = response.value[ref]
    const next = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.publish()
  }

  // Re-read after the Host reports a change to the reference this card watches.
  refreshCredential(ref) {
    if (ref !== this.credential.ref) return
    this.readCredential()
  }

  async writeToken(value) {
    try {
      await this.ctx.remote.credentials.set(this.refOf(), value)
    } catch {
      return false
    }
    await this.readCredential()
    return this.credential.configured
  }
}

// --- card component ------------------------------------------------------------------

function Field({ label, badge, hint, children }) {
  return h('div', { className: 'camnx-field' },
    h('div', { className: 'camnx-head' },
      h('span', { className: 'camnx-label' }, label),
      badge),
    children,
    hint ? h('p', { className: 'camnx-hint' }, hint) : null)
}

function CamNxCard(props) {
  const state = props.useCamNxCard((snapshot) => snapshot)
  const [test, setTest] = useState({ phase: 'idle', message: '' })
  if (!state.available) return null
  const disabled = !state.writable

  const runTest = async () => {
    setTest({ phase: 'running', message: '' })
    try {
      const response = await fetch(PING_API, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      setTest({ phase: body.ok === true ? 'ok' : 'fail', message: body.message ?? `请求失败（${response.status}）` })
    } catch (error) {
      setTest({ phase: 'fail', message: `请求失败：${error.message}` })
    }
  }

  // plugins.bundle.config 只会以 'page' 渲染（bundle 详情页拥有自己的标题）；
  // 防御其他 view 时不画任何东西。
  if (props.view !== undefined && props.view !== 'page') return null

  return h('div', { className: 'camnx-page' },
    h('div', { className: 'camnx-body' },
      disabled ? h('p', { className: 'camnx-readonly', role: 'status' }, '本部署的设置为只读。') : null,
      h(Field, {
        label: '连接地址',
        hint: '留空使用环境变量 CAMIND_NX_AGENT_URL；示例 http://192.168.31.77:8888',
        badge: state.baseURL.overridden
          ? h(React.Fragment, null,
            h('span', { className: 'camnx-badge' }, '已覆盖'),
            h('button', { type: 'button', className: 'camnx-reset', disabled, onClick: () => props.resetField(BASE_URL_FIELD) }, '恢复默认'))
          : null,
      },
        h(Input, {
          className: 'camnx-input',
          type: 'text',
          value: state.baseURL.text,
          placeholder: 'http://192.168.31.77:8888',
          disabled,
          onChange: (event) => props.edit(BASE_URL_FIELD, event.target.value),
        })),
      h(Field, {
        label: '访问令牌',
        hint: '不写入设置文件；留空保持当前密钥。',
        badge: h('span', { className: state.tokenConfigured ? 'camnx-badge' : 'camnx-badge-muted' },
          state.tokenConfigured ? '已配置' : '未配置'),
      },
        h(Input, {
          className: 'camnx-input',
          type: 'password',
          autoComplete: 'off',
          value: state.token.text,
          disabled: !state.tokenWritable,
          onChange: (event) => props.edit(TOKEN_FIELD, event.target.value),
        })),
      h('div', { className: 'camnx-test' },
        h(Button, { variant: 'outline', size: 'sm', disabled: test.phase === 'running', onClick: runTest },
          test.phase === 'running' ? '测试中…' : '测试连接'),
        test.message !== ''
          ? h('p', { className: `camnx-test-result ${test.phase === 'ok' ? 'ok' : 'fail'}`, role: 'status' }, test.message)
          : null),
      h('div', { className: 'camnx-footer' },
        state.failed ? h('p', { className: 'camnx-failed', role: 'status' }, '保存失败：本部署没有接受这些值，已保留供你修改。') : null,
        h(Button, { variant: 'ghost', size: 'sm', disabled: !state.dirty || state.saving, onClick: props.discard }, '放弃修改'),
        h(Button, { variant: 'primary', size: 'sm', disabled: !state.dirty || state.saving, onClick: props.save },
          state.saving ? '保存中…' : '保存'))))
}

// --- registration ----------------------------------------------------------------------

function apply(ctx) {
  applyCtx = ctx
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-tool-cam-settings', '')
    style.textContent = cardCss
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'tool-cam: settings stylesheet')

  const controller = new CamNxCardController(ctx.configForms.get(NS), ctx)
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => controller.refreshCredential(ref)),
    'tool-cam: credential invalidations',
  )
  // 0.2.0 起设置 = 插件条目 config；本卡注册到官方插件页「插件」里本 bundle
  // 的详情页（plugins.bundle.config，key = 包名，仅 view 'page'）。旧的
  //  settings.plugin.item keyed 席位随 Settings 插件页退役。
  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register({
      name: 'plugins.bundle.config',
      key: BUNDLE_NAME,
      inject: () => controller.inject(),
    }, CamNxCard))), 'tool-cam: plugins page card')

  // 配置页本体：官方设置面板的一节（0.2.0 的 settings.section 席位；账户/通用/
  // 模型/插件同席）。入口：设置面板左侧导航，或侧栏底部菜单「NX 工作台」直达。
  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'cam-nx',
      order: 30,
      label: 'NX 工作台',
      inject: () => controller.inject(),
    }, CamNxCard))), 'tool-cam: settings section')

  registerRunsTab(ctx)
}

// --- CAM runs rightbar tab -------------------------------------------------------------------
// 「加工」面板：官方右侧栏页签（0.2.0 的 sidebar.right.pane.tab，/camind 与桌面
// 官方壳通用）。数据源 = tool-cam 只读路由 /camind/api/cam/runs（run 目录落盘，
// 与会话事件无关）。样式自含，token 走 --dsw-alias-*（不依赖 ui-shell/foundation）。
// 内容移植自 ui-shell 工作台 CamRuns（本地状态，不依赖其 store）。

const RUNS_TAB_ID = 'camind-tool-cam/runs'
const RUNS_TAB_KIND = 'cam-runs'
const RUNS_API = '/camind/api/cam/runs'

const runsCss = `
.camrun-list { display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.camrun-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); padding: 10px 11px; }
.camrun-head { width: 100%; min-width: 0; display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary); }
.camrun-badge { flex: none; border-radius: 999px; padding: 2px 9px; font-size: 12px; line-height: 17px; }
.camrun-badge-ok { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.camrun-badge-warn { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
.camrun-badge-err { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.camrun-badge-muted { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }
.camrun-badge-run { color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent); }
.camrun-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.camrun-live { margin: 8px 0 0; color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 1.55; }
.camrun-tl { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
.camrun-tl > li { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 13px; }
.camrun-tl-time { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.camrun-tl-icon { flex: none; width: 13px; text-align: center; }
.camrun-tl > li[data-tone="ok"] .camrun-tl-icon { color: var(--dsw-alias-state-success-primary); }
.camrun-tl > li[data-tone="warn"] .camrun-tl-icon { color: var(--dsw-alias-state-warn-primary); }
.camrun-tl > li[data-tone="err"] .camrun-tl-icon { color: var(--dsw-alias-state-error-primary); }
.camrun-tl > li[data-tone="run"] .camrun-tl-icon { color: var(--dsw-alias-state-business-primary); }
.camrun-tl > li[data-tone="muted"] .camrun-tl-icon { color: var(--dsw-alias-label-tertiary); }
.camrun-tl-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow-wrap: anywhere; }
.camrun-tl-sub { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.camrun-tl-err { color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
.camrun-section-title { margin: 12px 0 6px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.camrun-facts { margin: 8px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; font-size: 12px; }
.camrun-facts > div { display: contents; }
.camrun-facts dt { color: var(--dsw-alias-label-tertiary); }
.camrun-facts dd { margin: 0; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.camrun-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.55; }
.camrun-warn { margin: 8px 0 0; color: var(--dsw-alias-state-warn-primary); font-size: 12px; line-height: 1.55; }
.camrun-files { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.camrun-file { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--dsw-alias-label-primary); }
.camrun-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.camrun-file small { flex: none; color: var(--dsw-alias-label-tertiary); }
.camrun-file-actions { flex: none; display: flex; gap: 8px; }
.camrun-file-actions a, .camrun-file-actions button { border: 0; padding: 0; background: transparent; color: var(--dsw-alias-state-business-primary); font-size: 12px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.camrun-file-actions button:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.camrun-op-list { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.camrun-op-list li { display: flex; align-items: baseline; gap: 7px; min-width: 0; font-size: 13px; color: var(--dsw-alias-label-primary); }
.camrun-op-dot { width: 8px; height: 8px; flex: none; display: inline-block; border-radius: 50%; background: var(--dsw-alias-label-tertiary); align-self: center; }
.camrun-op-dot[data-status="ok"] { background: var(--dsw-alias-state-success-primary); }
.camrun-op-dot[data-status="generated"], .camrun-op-dot[data-status="empty"] { background: var(--dsw-alias-state-warn-primary); }
.camrun-op-dot[data-status="error"] { background: var(--dsw-alias-state-error-primary); }
.camrun-op-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.camrun-op-status { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.camrun-op-error { flex: none; max-width: 100%; color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
.camrun-empty { padding: 28px 16px; font-size: 13px; line-height: 1.6; text-align: center; color: var(--dsw-alias-label-tertiary); }
`

const OVERALL_VIEW = {
  ok: { label: '通过', modifier: 'ok' },
  incomplete: { label: '含未决项', modifier: 'warn' },
  error: { label: '失败', modifier: 'err' },
  planned: { label: '未执行', modifier: 'muted' },
}
const RUNNING_VIEW = { label: '执行中', modifier: 'run' }
const OP_STATUS_LABELS = { ok: '完成', generated: '缺 NC', empty: '空刀路', error: '失败', skip: '跳过（沿用）', interrupted: '中断' }
const OP_TYPE_LABELS = { copy_postprocess: '模板复制', from_scratch_workpiece_op: '从零建工序' }
const STAGE_TEXT = {
  ensure_ready: '开工检查（CAM 工作站健康门禁）',
  upload: '上传零件到工作台',
  work_copy: '复制工作副本（主模型不被写）',
  prepare: '加工准备（建 CAM setup）',
  check: '收尾自检（NC 对账 + 空刀路）',
}
const TERMINAL_STAGES = new Set(['done', 'failed', 'aborted'])

function opStatusLabel(status) {
  return status === null ? '未执行' : OP_STATUS_LABELS[status] ?? status
}

function clockLabel(iso) {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleTimeString('zh-CN', { hour12: false })
}

function timeLabel(iso) {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

function durLabel(startIso, endIso) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function basenameOf(p) {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return slash >= 0 ? p.slice(slash + 1) : p
}

function foldTimeline(history) {
  const rows = []
  const open = new Map()
  history.forEach((entry, i) => {
    const key = `h${i}`
    if (entry.stage === 'op' && typeof entry.index === 'number') {
      const name = entry.name ?? `op ${entry.index}`
      if (entry.status !== undefined) {
        const started = open.get(entry.index)
        if (started !== undefined) {
          started.status = entry.status
          started.endTs = entry.ts
          open.delete(entry.index)
        } else {
          rows.push({ key, kind: 'op', ts: entry.ts, index: entry.index, name, status: entry.status, endTs: entry.ts })
        }
      } else {
        // 同一 index 已有未闭合的起始行 = 上次跑到一半进程死了；旧行标中断，新行接续。
        const stale = open.get(entry.index)
        if (stale !== undefined) stale.status = 'interrupted'
        const row = { key, kind: 'op', ts: entry.ts, index: entry.index, name, action: entry.action }
        rows.push(row)
        open.set(entry.index, row)
      }
      return
    }
    rows.push({
      key, kind: 'stage', ts: entry.ts, stage: entry.stage,
      status: entry.status, total: entry.total, skipped: entry.skipped,
      failedStage: entry.failed_stage, msg: entry.msg,
    })
  })
  return rows
}

function stageRowView(row) {
  switch (row.stage) {
    case 'ops':
      return { icon: '✓', text: `开始逐序执行（共 ${row.total ?? '?'} 道）`, tone: 'ok' }
    case 'upload':
      return { icon: '✓', text: row.skipped === true ? '上传零件（proxy 侧已有，跳过）' : STAGE_TEXT.upload, tone: 'ok' }
    case 'done': {
      const view = OVERALL_VIEW[row.status ?? ''] ?? OVERALL_VIEW.planned
      return { icon: row.status === 'ok' ? '✓' : row.status === 'error' ? '✗' : '!', text: `执行完成：${view.label}`, tone: view.modifier }
    }
    case 'failed':
      return { icon: '✗', text: `失败于「${STAGE_TEXT[row.failedStage ?? ''] ?? row.failedStage ?? '?'}」：${row.msg ?? ''}`, tone: 'err' }
    case 'aborted':
      return { icon: '■', text: `已停止：${row.msg ?? ''}`, tone: 'warn' }
    default:
      return { icon: '✓', text: STAGE_TEXT[row.stage] ?? row.stage, tone: 'ok' }
  }
}

function opRowTone(status) {
  if (status === undefined) return 'run'
  if (status === 'ok') return 'ok'
  if (status === 'skip') return 'muted'
  if (status === 'error') return 'err'
  return 'warn'
}

function opRowIcon(status) {
  if (status === undefined) return '●'
  if (status === 'ok') return '✓'
  if (status === 'skip') return '−'
  if (status === 'error') return '✗'
  return '!'
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  React.useEffect(() => {
    if (intervalMs === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

async function runsApi(sessionId, runId) {
  const suffix = runId === undefined ? `?session=${encodeURIComponent(sessionId)}` : `/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}`
  const response = await fetch(RUNS_API + suffix, { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
  return body
}

function deliveryFileUrl(sessionId, runId, name) {
  return `${RUNS_API}/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}/delivery/${name.split('/').map(encodeURIComponent).join('/')}`
}

function previewService() {
  return applyCtx?.get('filePreview')
}

function DeliveryFileRow({ sessionId, runId, file }) {
  const isMarkdown = file.name.toLowerCase().endsWith('.md')
  return h('div', { className: 'camrun-file' },
    h('span', { className: 'camrun-file-name', title: file.name }, file.name),
    h('small', null, bytesLabel(file.bytes)),
    h('span', { className: 'camrun-file-actions' },
      isMarkdown && h('button', {
        type: 'button',
        title: '预览会话工作区镜像（镜像缺失时会报文件不存在，可改用下载）',
        onClick: () => previewService()?.preview(sessionId, `delivery/${runId}/${file.name}`),
      }, '预览'),
      h('a', { href: deliveryFileUrl(sessionId, runId, file.name) }, '下载')))
}

function NcToolpathButton({ sessionId, runId, name }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState()
  return h(React.Fragment, null,
    h('button', {
      type: 'button',
      disabled: busy,
      title: '在「预览」标签页查看刀路',
      onClick: () => {
        setBusy(true)
        setError(undefined)
        void fetch(deliveryFileUrl(sessionId, runId, `nc/${name}`), { headers: { Accept: 'text/plain' } })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            previewService()?.previewContent(sessionId, name, await response.text())
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false))
      },
    }, '查看刀路'),
    error !== undefined && h('span', { className: 'camrun-op-error' }, `读取失败：${error}`))
}

function Timeline({ rows, runstate, opsTotal, active, now }) {
  const lastKey = rows[rows.length - 1]?.key
  return h('ul', { className: 'camrun-tl' }, rows.map((row) => {
    const isLast = row.key === lastKey
    if (row.kind === 'stage') {
      const view = stageRowView(row)
      const running = active && isLast
      return h('li', { key: row.key, 'data-tone': running ? 'run' : view.tone },
        h('span', { className: 'camrun-tl-time' }, clockLabel(row.ts)),
        h('span', { className: 'camrun-tl-icon' }, running ? '●' : view.icon),
        h('span', { className: 'camrun-tl-body' }, h('span', null, running ? `${view.text}…` : view.text)))
    }
    const op = runstate?.ops?.[row.index]
    const running = row.status === undefined
    const duration = !running && row.endTs !== undefined ? durLabel(row.ts, row.endTs) : null
    const elapsed = running ? durLabel(row.ts, new Date(now).toISOString()) : null
    const timeout = typeof op?.timeout_seconds === 'number' ? `限时约 ${Math.max(1, Math.round(op.timeout_seconds / 60))} 分钟` : null
    return h('li', { key: row.key, 'data-tone': opRowTone(row.status) },
      h('span', { className: 'camrun-tl-time' }, clockLabel(row.ts)),
      h('span', { className: 'camrun-tl-icon' }, opRowIcon(row.status)),
      h('span', { className: 'camrun-tl-body' },
        h('span', null,
          `工序 ${row.index + 1}/${opsTotal} ${row.name}`,
          row.action === 'post' && '（补后处理）',
          row.action === 'full' && op?.type !== undefined && OP_TYPE_LABELS[op.type] !== undefined && `（${OP_TYPE_LABELS[op.type]}）`),
        h('span', { className: 'camrun-tl-sub' },
          running
            ? `计算中…${elapsed !== null ? ` 已运行 ${elapsed}` : ''}${timeout !== null ? ` · ${timeout}` : ''}`
            : `${opStatusLabel(row.status ?? null)}${duration !== null ? ` · ${duration}` : ''}`),
        row.status !== undefined && !['ok', 'skip', 'interrupted'].includes(row.status) && op?.error !== undefined && op.error !== ''
          && h('span', { className: 'camrun-tl-err' }, op.error),
        row.status === 'ok' && op?.nc_files !== undefined && op.nc_files.length > 0
          && h('span', { className: 'camrun-tl-sub' }, `NC：${op.nc_files.map(basenameOf).join('、')}`)))
  }))
}

function CamRunCard({ sessionId, run }) {
  const [detailState, setDetailState] = useState(null)
  React.useEffect(() => {
    let cancelled = false
    setDetailState((prev) => prev ?? { phase: 'loading' })
    void runsApi(sessionId, run.run_id).then((result) => {
      if (!cancelled) setDetailState({ phase: 'ready', detail: result.run })
    }).catch((error) => {
      if (!cancelled) setDetailState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [run.updated_at, run.run_id, sessionId])

  const detail = detailState?.phase === 'ready' ? detailState.detail : null
  const runstate = detail?.runstate ?? null
  const rows = runstate?.history !== undefined && runstate.history.length > 0 ? foldTimeline(runstate.history) : []
  const lastRow = rows[rows.length - 1]
  const active = rows.length > 0 && !(lastRow?.kind === 'stage' && TERMINAL_STAGES.has(lastRow.stage))
  const now = useNow(active ? 1000 : null)
  let runningOp
  if (active) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]
      if (row.kind === 'op' && row.status === undefined) { runningOp = row; break }
    }
  }

  const machine = run.machine.display_name ?? run.machine.id
  const overallView = active ? RUNNING_VIEW : (OVERALL_VIEW[run.overall] ?? OVERALL_VIEW.planned)
  const opsTotal = runstate?.ops?.length ?? run.ops.length
  const runningOpTimeout = runningOp !== undefined ? runstate?.ops?.[runningOp.index]?.timeout_seconds : undefined
  const runningElapsed = runningOp !== undefined ? durLabel(runningOp.ts, new Date(now).toISOString()) : null
  const check = runstate?.check
  const checkWarn = check !== undefined
    && (check.listing_ok === false || (check.missing?.length ?? 0) > 0 || (check.empty_ops?.length ?? 0) > 0)

  return h('section', { className: 'camrun-card' },
    h('div', { className: 'camrun-head' },
      h('span', { className: `camrun-badge camrun-badge-${overallView.modifier}` }, overallView.label),
      h('span', { className: 'camrun-title', title: run.run_id }, run.run_id)),
    h('dl', { className: 'camrun-facts' },
      run.part_id !== null && h('div', null, h('dt', null, '件号'), h('dd', null, run.part_id)),
      machine !== null && h('div', null, h('dt', null, '机床'), h('dd', null, machine)),
      detail?.post_name != null && h('div', null, h('dt', null, '后处理器'), h('dd', null, detail.post_name)),
      detail?.out_dir != null && h('div', null, h('dt', null, '输出目录'), h('dd', { title: detail.out_dir }, detail.out_dir)),
      h('div', null, h('dt', null, '更新'), h('dd', null, timeLabel(run.updated_at)))),
    active && h('p', { className: 'camrun-live' },
      runningOp !== undefined
        ? `正在执行工序 ${runningOp.index + 1}/${opsTotal} ${runningOp.name}`
          + (runningElapsed !== null ? ` · 已运行 ${runningElapsed}` : '')
          + (typeof runningOpTimeout === 'number' ? ` · 限时约 ${Math.max(1, Math.round(runningOpTimeout / 60))} 分钟` : '')
        : `正在执行：${lastRow?.kind === 'stage' ? (STAGE_TEXT[lastRow.stage] ?? lastRow.stage) : ''}…`),
    run.read_error !== undefined && h('p', { className: 'camrun-warn' }, run.read_error),
    run.overall === 'planned' && h('p', { className: 'camrun-note' }, '尚未执行——在会话中让 Agent 对该 run_id 调用 cam_run 首跑。'),
    !active && (run.overall === 'incomplete' || run.overall === 'error')
      && h('p', { className: 'camrun-note' }, '本 run 未全过——可让 Agent 以 cam_run（resume=true）续跑，run_id 不变。'),
    detailState?.phase === 'loading' && h('p', { className: 'camrun-note' }, '读取 run 详情…'),
    detailState?.phase === 'error' && h('p', { className: 'camrun-warn' }, `详情读取失败：${detailState.message}`),
    rows.length > 0 && h(Timeline, { rows, runstate, opsTotal, active, now }),
    detail !== null && rows.length === 0 && runstate?.ops !== undefined && runstate.ops.length > 0 && h(React.Fragment, null,
      h('p', { className: 'camrun-note' }, '本 run 由旧版本落盘（无过程时间线），仅工序终态：'),
      h('ul', { className: 'camrun-op-list' }, runstate.ops.map((op) => h('li', { key: op.index },
        h('span', { className: 'camrun-op-dot', 'data-status': op.status }),
        h('span', { className: 'camrun-op-name', title: op.type }, op.name),
        h('span', { className: 'camrun-op-status' }, opStatusLabel(op.status)),
        op.error !== undefined && op.error !== '' && h('span', { className: 'camrun-op-error' }, op.error))))),
    check !== undefined && h('p', { className: checkWarn ? 'camrun-warn' : 'camrun-note' },
      `自检：NC 对账 期望 ${check.expected ?? '?'} / 实数 ${check.found ?? '?'}`,
      (check.missing?.length ?? 0) > 0 ? `，缺 ${check.missing?.join('、')}` : '，一致',
      (check.empty_ops?.length ?? 0) > 0 && `；空刀路：${check.empty_ops?.join('、')}`,
      check.listing_ok === false && '（out_dir 列举失败，判不出）'),
    run.delivery.length > 0 && h('div', { className: 'camrun-files' },
      run.delivery.map((file) => h(DeliveryFileRow, { key: file.name, sessionId, runId: run.run_id, file }))),
    detail !== null && detail.nc_error !== undefined && h('p', { className: 'camrun-warn' }, detail.nc_error),
    detail !== null && detail.delivered && detail.nc_files.length > 0 && h(React.Fragment, null,
      h('h4', { className: 'camrun-section-title' }, `NC 程序（${detail.nc_files.length}）`),
      h('div', { className: 'camrun-files' }, detail.nc_files.map((name) => h('div', { key: name, className: 'camrun-file' },
        h('span', { className: 'camrun-file-name', title: name }, name),
        h('span', { className: 'camrun-file-actions' },
          h('a', { href: deliveryFileUrl(sessionId, run.run_id, `nc/${name}`) }, '下载'),
          h(NcToolpathButton, { sessionId, runId: run.run_id, name })))))))
}

function CamRunsPanel({ sessionId }) {
  const [state, setState] = useState({ phase: 'loading', runs: [] })
  React.useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await runsApi(sessionId)
        if (!cancelled) setState({ phase: 'ready', runs: result.runs ?? [] })
      } catch (error) {
        if (!cancelled) setState({ phase: 'error', runs: [], message: error instanceof Error ? error.message : String(error) })
      }
    }
    setState({ phase: 'loading', runs: [] })
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId])

  if (state.phase === 'loading') return h('div', { className: 'camrun-empty' }, '读取 CAM run 列表…')
  if (state.phase === 'error') return h('div', { className: 'camrun-empty' }, `CAM run 列表读取失败：${state.message}`)
  if (state.runs.length === 0) {
    return h('div', { className: 'camrun-empty' }, '本会话还没有 CAM run——cam_plan 落盘后出现在这里（数据源是 run 目录，与会话事件无关）。')
  }
  return h('div', { className: 'camrun-list' }, state.runs.map((run) => h(CamRunCard, { key: run.run_id, sessionId, run })))
}

function RunsHeaderButton() {
  return h(Button, {
    variant: 'ghost',
    size: 'sm',
    icon: h(IconGaugeOutlineRegular, { size: 14 }),
    title: '在右侧栏打开「加工」面板',
    onClick: () => {
      const sidebarRight = applyCtx?.get('sidebarRight')
      console.warn('[tool-cam] 加工 click; sidebarRight?', !!sidebarRight, 'openTab?', typeof sidebarRight?.openTab)
      try {
        sidebarRight?.openTab(RUNS_TAB_KIND)
        console.warn('[tool-cam] openTab returned')
      } catch (error) {
        console.warn('[tool-cam] openTab threw:', String(error?.message ?? error).slice(0, 160))
      }
    },
  }, '加工')
}

function registerRunsTab(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-tool-cam-runs', '')
    style.textContent = runsCss
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'tool-cam: runs tab stylesheet')

  ctx.sidebarRightTabs.register({
    id: RUNS_TAB_ID,
    kind: RUNS_TAB_KIND,
    priority: 'builtin',
    title: () => '加工',
  })
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: RUNS_TAB_ID,
  }, CamRunsPanel))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'cam-runs',
    order: 30,
  }, RunsHeaderButton))
}

exports.name = 'tool-cam-client'
exports.inject = ['slots', 'remote', 'remote.credentials', 'configForms', 'sidebarRight', 'sidebarRightTabs']
exports.apply = apply

return module.exports; } });
