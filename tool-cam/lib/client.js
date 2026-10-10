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
const { Button, IconApiOutlineRegular, Input } = require('@deepseek-ai/dsh-client-ui-primitives')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const { SidebarAction } = require('camind-ui-foundation')

const NS = 'tool-cam'
const BUNDLE_NAME = 'camind-tool-cam'
// apply 的 ctx 存模块级：菜单项点击时要够到 slots 内部面（见 openNxSettings）。
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

// --- settings section + sidebar entry -----------------------------------------------------

// 「NX 工作台」是官方设置面板里的一节（settings.section id cam-nx）。侧栏底部菜单项
// 直接打开该节：面板的开合与选节在官方 settings shell store（挂在 sidebar.settings
// 条目上，root scope），经 slots 内部 hostFace().storeOf 触达——与 ui-preview 的切页
// 同一类非公开面，防御式降级（失败只在 console 留痕，菜单项还在）。
// 两个壳通用：/camind 与官方 /web 的设置面板是同一注册。
function openNxSettings(ctx) {
  try {
    const entry = ctx.slots.entriesOfSlot('sidebar.settings')[0]
    const store = entry && ctx.slots.hostFace().storeOf(entry, undefined)
    if (store?.actions?.openSection) {
      store.actions.openSection('cam-nx')
      return true
    }
  } catch { /* fall through */ }
  console.warn('[tool-cam] 打开设置面板失败：settings shell store 不可达')
  return false
}

function CamNxMenuItem({ wide }) {
  return h(SidebarAction, {
    wide,
    active: false,
    icon: h(IconApiOutlineRegular, { size: wide ? 16 : 18 }),
    label: 'NX 工作台',
    onClick: () => { openNxSettings(applyCtx) },
  })
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

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'cam-nx-page',
      order: 30,
      label: 'NX 工作台',
    }, CamNxMenuItem))
}

exports.name = 'tool-cam-client'
exports.inject = ['slots', 'remote', 'remote.credentials', 'configForms']
exports.apply = apply

return module.exports; } });
