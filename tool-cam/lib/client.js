// camind-tool-cam browser bundle — hand-written, no build step.
// Two surfaces:
//  1. One keyed `settings.plugin.item` card (key `cam-nx`) rendered by the official
//     configurable-plugins tab (dsh-client-ui-settings-plugins): NX workbench
//     (CAM-Agent proxy) connection settings. The baseURL field rides the
//     `cam-nx` settings namespace via settingsScope; the token is write-only and
//     goes through the credentials wire API, addressed by the reference the
//     section names (default CAMIND_NX_AGENT_TOKEN) — its literal never crosses
//     the wire back. The "test connection" button calls the plugin's Host route
//     POST /camind/api/cam/ping (the browser cannot call the proxy directly:
//     CORS, and the token must stay Host-side). Only platform seed modules may
//     be required. UI copy is hardcoded Chinese, matching the workspace's
//     model-facing language convention.
//  2. Chat cards for the three CAM session events (cam/stage, cam/check-report,
//     cam/delivered): ConversationEvent definitions plus keyed
//     `conversation.chat.node` renderers (keys cam-stage / cam-check-report /
//     cam-delivered). The delivered card declares the keyed child slot
//     `cam.nc.preview` (scope root) — the toolpath viewer plugin
//     (camind-ui-toolpath-viewer, developed separately) registers key
//     `toolpath-viewer` there and receives owner props { content, fileName };
//     without a registration the card shows no viewer entry. Downloads ride the plugin's
//     read-only Host route GET /camind/api/cam/runs/<session>/<runId>/delivery/<file>
//     (NC entries are extracted from nc_batch.zip by that route).
//
// Definition contract note (dsh-client-runtime ConversationEventRegistry +
// the official definitions in dsh-client-ui-conversation): match() returns
// {id, role} and kind+id converge events into one context. All three
// definitions here deliberately emit only role 'update' and fold their whole
// model from context.matches on every buildViewNode, never splitting
// start/update: cam_run resume re-emits a full cam/stage round under the SAME
// run_id, so an ensure_ready-as-start scheme would die on the runtime's
// "more than one start Match" invariant; an all-update fold is immune, keeps
// one updating card per run across resumes, and matches the official
// fallbackState idiom for windows loaded mid-stream. anchorSeq follows the
// latest round's opening event, so a resumed run's card moves with the new
// round instead of staying at the stale position.
//
// Styling: scoped <style> blocks (classes prefixed camnx-/camcard-) driven by
// the official --dsw-alias-* design tokens, so the cards follow the shell's
// light/dark theme.
window.__ModuleLoader__.load({ id: "camind-tool-cam", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useState, useSyncExternalStore } = React
const { IconChevronDownOutline14, StateDot } = require('@deepseek-ai/dsh-client-ui-primitives')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-runtime/client')

const NS = 'cam-nx'
const BASE_URL_FIELD = 'baseURL'
const TOKEN_FIELD = 'token'
const DEFAULT_TOKEN_REF = 'CAMIND_NX_AGENT_TOKEN'
const PING_API = '/camind/api/cam/ping'

// --- stylesheet ------------------------------------------------------------------

const cardCss = `
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
.camnx-input {
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3);
  height: 34px; font: inherit; color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 0 12px; font-size: 13px; line-height: 1.5;
}
.camnx-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.camnx-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.camnx-hint { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; }
.camnx-test { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.camnx-test-result { min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.camnx-test-result.ok { color: var(--dsw-alias-state-success-primary, var(--dsw-alias-state-business-primary)); }
.camnx-test-result.fail { color: var(--dsw-alias-label-error); }
.camnx-btn {
  appearance: none; font: inherit; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary); background: none;
}
.camnx-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.camnx-btn:disabled { opacity: 0.5; cursor: default; }
.camnx-btn-save {
  appearance: none; font: inherit; cursor: pointer; border: 1px solid transparent;
  border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary-inverted, #fff);
  background: var(--dsw-alias-button-contrast-fill, var(--dsw-alias-label-primary));
}
.camnx-btn-save:hover:not(:disabled) { opacity: 0.88; }
.camnx-btn-save:disabled { opacity: 0.5; cursor: default; }
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
class CamNxCardController {
  constructor(scope, api) {
    this.scope = scope
    this.api = api
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
            await this.scope.unset(field)
            return !this.stored(field)
          })
        }
      } else {
        writes.push(async () => {
          await this.scope.set(field, trimmed)
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
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch {
      return
    }
    if (!response.result.ok || ref !== this.refOf()) return
    const view = response.result.value.credentials[ref]
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
      await this.api.credentials.set({ ref: this.refOf(), value })
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
  // Disclosure is card-local state, matching the official PluginCard: staged
  // edits outlive collapsing, so the header marks a card holding unsaved edits.
  const [open, setOpen] = useState(false)
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

  return h('li', { className: open ? 'camnx-card camnx-card-open' : 'camnx-card' },
    h('style', null, cardCss),
    h('button', {
      type: 'button',
      className: 'camnx-header',
      'aria-expanded': open,
      'aria-label': `${open ? '收起设置' : '展开设置'}：NX 工作台`,
      onClick: () => setOpen(!open),
    },
      h('span', { className: 'camnx-headtext' },
        h('span', { className: 'camnx-name' }, 'NX 工作台'),
        h('span', { className: 'camnx-desc' }, 'CAM-Agent proxy（Windows 侧 NX 远程执行）的连接配置。')),
      state.dirty ? h('span', { className: 'camnx-pending' }, '未保存') : null,
      h(IconChevronDownOutline14, { className: open ? 'camnx-chevron camnx-chevron-open' : 'camnx-chevron' })),
    open ? h('div', { className: 'camnx-body' },
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
        h('input', {
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
        h('input', {
          className: 'camnx-input',
          type: 'password',
          autoComplete: 'off',
          value: state.token.text,
          disabled: !state.tokenWritable,
          onChange: (event) => props.edit(TOKEN_FIELD, event.target.value),
        })),
      h('div', { className: 'camnx-test' },
        h('button', { type: 'button', className: 'camnx-btn', disabled: test.phase === 'running', onClick: runTest },
          test.phase === 'running' ? '测试中…' : '测试连接'),
        test.message !== ''
          ? h('p', { className: `camnx-test-result ${test.phase === 'ok' ? 'ok' : 'fail'}`, role: 'status' }, test.message)
          : null),
      h('div', { className: 'camnx-footer' },
        state.failed ? h('p', { className: 'camnx-failed', role: 'status' }, '保存失败：本部署没有接受这些值，已保留供你修改。') : null,
        h('button', { type: 'button', className: 'camnx-btn', disabled: !state.dirty || state.saving, onClick: props.discard }, '放弃修改'),
        h('button', { type: 'button', className: 'camnx-btn-save', disabled: !state.dirty || state.saving, onClick: props.save },
          state.saving ? '保存中…' : '保存'))) : null)
}

// === chat cards: cam/stage + cam/check-report + cam/delivered ==================

const CAM_STAGE_LABELS = {
  ensure_ready: '开工检查',
  upload: '上传零件',
  work_copy: '工作副本',
  prepare: '加工准备',
  ops: '执行工序',
  op: '执行工序',
  check: '自检',
  done: '完成',
}
const CAM_OP_STATUS_LABELS = { ok: '完成', generated: '缺 NC', empty: '空刀路', error: '失败', skip: '跳过（沿用）' }
const CAM_OVERALLS = {
  ok: { label: '通过', modifier: 'ok' },
  incomplete: { label: '含未决项', modifier: 'warn' },
  error: { label: '失败', modifier: 'err' },
}
const CAM_FILE_KIND_LABELS = { nc_archive: 'NC 批次', delivery_report: '交付报告', setup_sheet: '加工设定单' }

const camCardCss = `
.camcard {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);
  font: inherit; padding: 12px 16px; max-width: min(680px, 100%);
  flex-direction: column; gap: 8px; display: flex;
}
.camcard *, .camcard *::before, .camcard *::after { box-sizing: border-box; }
.camcard-head { align-items: center; gap: 8px; display: flex; }
.camcard-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.camcard-badge {
  white-space: nowrap; border-radius: 999px; padding: 1px 8px;
  font-size: 11px; font-weight: 500; line-height: 17px;
}
.camcard-badge-ok { background: var(--dsw-alias-state-success-secondary); color: var(--dsw-alias-state-success-primary); }
.camcard-badge-warn { background: var(--dsw-alias-state-warn-secondary); color: var(--dsw-alias-state-warn-label); }
.camcard-badge-err { background: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary); }
.camcard-badge-muted { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.camcard-stage { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
.camcard-ops { list-style: none; margin: 0; padding: 0; flex-direction: column; gap: 4px; display: flex; }
.camcard-op { align-items: center; gap: 8px; font-size: 12px; line-height: 1.5; display: flex; }
.camcard-op-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.camcard-op-status { color: var(--dsw-alias-label-tertiary); flex: none; }
.camcard-note { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.camcard-warn { color: var(--dsw-alias-state-warn-label); margin: 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.camcard-section { color: var(--dsw-alias-label-tertiary); margin: 4px 0 0; font-size: 12px; font-weight: 500; line-height: 1.5; }
.camcard-files { flex-direction: column; gap: 6px; display: flex; }
.camcard-file { align-items: center; gap: 8px; font-size: 13px; line-height: 1.5; display: flex; }
.camcard-file-name { flex: none; max-width: 45%; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.camcard-file-kind, .camcard-file-size { color: var(--dsw-alias-label-tertiary); flex: none; font-size: 12px; }
.camcard-file-actions { flex: 1; justify-content: flex-end; gap: 10px; display: flex; }
.camcard-action {
  appearance: none; font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer;
  background: none; border: none; padding: 0; font-size: 12px; line-height: 1.5; text-decoration: none;
}
.camcard-action:hover:not(:disabled) { color: var(--dsw-alias-label-primary); text-decoration: underline; }
.camcard-action:disabled { opacity: 0.5; cursor: default; }
.camcard-viewer { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 8px; flex-direction: column; gap: 6px; display: flex; }
.camcard-viewer-head { align-items: center; justify-content: space-between; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; display: flex; }
.camcard-nc-raw {
  margin: 0; max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  background: var(--dsw-alias-markdown-code-block); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px; padding: 10px 12px; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5;
}
`

if (typeof document !== 'undefined' && document.querySelector('style[data-camcard]') === null) {
  const tag = document.createElement('style')
  tag.dataset.camcard = ''
  tag.textContent = camCardCss
  document.head.appendChild(tag)
}

// --- folds (pure; see the header note for the update-only rationale) -----------

function camRunIdOf(event) {
  const runId = event?.data?.run_id
  return typeof runId === 'string' && runId.length > 0 ? runId : null
}

// chat 节点对象（照 dsh-client-ui-goal 的内联形状；key 与 target 由 runtime 校验）。
function camChatNode(context, kind, anchorSeq, data) {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data,
  }
}

// cam/stage 事件流 → 阶段卡模型。ops 以 index 键控、后到事件覆盖；ensure_ready
// 标志着新一轮执行（首跑/续跑），清零重来并把锚点移到新一轮起点。
// 同时吃同 run 的 cam/check-report：run.js 中途失败（failStage/取消）只发
// check-report(error) 不发 done 阶段——不终结的话阶段卡会永远停在「进行中」。
function foldCamStage(matches) {
  let model = null
  for (const match of matches) {
    const event = match.event
    if (event.type !== 'cam/stage' && event.type !== 'cam/check-report') continue
    const data = event.data ?? {}
    if (model === null) {
      model = { runId: camRunIdOf(event) ?? '', stage: '', total: 0, ops: new Map(), done: null, anchor: event.seq }
    }
    if (event.type === 'cam/check-report') {
      // 只补「未终态」的洞；done 阶段事件是正常终态来源，不被覆盖。
      if (model.done === null && typeof data.overall === 'string') model.done = data.overall
      continue
    }
    switch (data.stage) {
      case 'ensure_ready':
        model.stage = 'ensure_ready'
        model.total = 0
        model.ops = new Map()
        model.done = null
        model.anchor = event.seq
        break
      case 'ops':
        model.stage = 'ops'
        model.total = Number.isSafeInteger(data.total) ? data.total : 0
        break
      case 'op': {
        model.stage = 'op'
        const index = Number.isSafeInteger(data.index) ? data.index : model.ops.size
        const previous = model.ops.get(index)
        const entry = {
          index,
          name: typeof data.name === 'string' && data.name !== '' ? data.name : `op_${index}`,
          action: previous?.action,
          status: previous?.status,
        }
        // 带 action 的是「开始执行」（清掉上一轮终态）；带 status 的是落定。
        if (typeof data.action === 'string') {
          entry.action = data.action
          entry.status = undefined
        }
        if (typeof data.status === 'string') entry.status = data.status
        model.ops.set(index, entry)
        break
      }
      case 'done':
        model.stage = 'done'
        model.done = typeof data.status === 'string' ? data.status : null
        break
      default:
        if (typeof data.stage === 'string') model.stage = data.stage
        break
    }
  }
  return model
}

// cam/check-report（报告本体）+ 同 run 的 cam/stage op 落定（逐工序终态）→
// 报告卡模型。报告事件未到则不出卡（未物化过，允许一直 null）。
function foldCamCheckReport(matches) {
  const ops = new Map()
  let report = null
  for (const match of matches) {
    const event = match.event
    const data = event.data ?? {}
    if (event.type === 'cam/stage' && data.stage === 'op' && typeof data.status === 'string') {
      const index = Number.isSafeInteger(data.index) ? data.index : ops.size
      ops.set(index, {
        index,
        name: typeof data.name === 'string' && data.name !== '' ? data.name : `op_${index}`,
        status: data.status,
      })
    } else if (event.type === 'cam/check-report') {
      report = { data, seq: event.seq }
    }
  }
  return report === null ? null : { report, ops: [...ops.values()].sort((a, b) => a.index - b.index) }
}

// cam/delivered：同一 run 重复交付时最新一次覆盖（卡片在原地更新）。
function foldCamDelivered(matches) {
  let delivered = null
  for (const match of matches) {
    if (match.event.type !== 'cam/delivered') continue
    delivered = { data: match.event.data ?? {}, seq: match.event.seq }
  }
  return delivered
}

const camStageDefinition = {
  kind: 'cam-stage',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'cam/stage' && event.type !== 'cam/check-report') return null
    const runId = camRunIdOf(event)
    return runId === null ? null : { id: runId, role: 'update' }
  },
  start: () => ({}),
  update: (context) => context.state,
  buildViewNode: (context) => {
    const model = foldCamStage(context.matches)
    if (model === null || model.stage === '') return null
    return camChatNode(context, 'cam-stage', model.anchor, {
      ...model,
      ops: [...model.ops.values()].sort((a, b) => a.index - b.index),
    })
  },
}

const camCheckReportDefinition = {
  kind: 'cam-check-report',
  target: 'chat',
  match: (event) => {
    if (event.type === 'cam/check-report') {
      const runId = camRunIdOf(event)
      return runId === null ? null : { id: runId, role: 'update' }
    }
    if (event.type === 'cam/stage' && event.data?.stage === 'op' && typeof event.data?.status === 'string') {
      const runId = camRunIdOf(event)
      return runId === null ? null : { id: runId, role: 'update' }
    }
    return null
  },
  start: () => ({}),
  update: (context) => context.state,
  buildViewNode: (context) => {
    const model = foldCamCheckReport(context.matches)
    if (model === null) return null
    return camChatNode(context, 'cam-check-report', model.report.seq, model)
  },
}

const camDeliveredDefinition = {
  kind: 'cam-delivered',
  target: 'chat',
  match: (event) => {
    const runId = event.type === 'cam/delivered' ? camRunIdOf(event) : null
    return runId === null ? null : { id: runId, role: 'update' }
  },
  start: () => ({}),
  update: (context) => context.state,
  buildViewNode: (context) => {
    const model = foldCamDelivered(context.matches)
    if (model === null) return null
    return camChatNode(context, 'cam-delivered', model.seq, model.data)
  },
}

// --- card components -------------------------------------------------------------

function camOverallDot(overall) {
  return overall === 'ok' ? 'done' : overall === 'incomplete' ? 'warning' : 'error'
}

function camOpDot(op) {
  if (op.status === undefined) return 'ongoing'
  if (op.status === 'ok' || op.status === 'skip') return 'done'
  if (op.status === 'error') return 'error'
  return 'warning'
}

function camOpStatusText(op) {
  return op.status === undefined ? '进行中…' : CAM_OP_STATUS_LABELS[op.status] ?? op.status
}

function CamBadge({ overall }) {
  const view = CAM_OVERALLS[overall] ?? { label: overall ?? '未知', modifier: 'muted' }
  return h('span', { className: `camcard-badge camcard-badge-${view.modifier}` }, view.label)
}

function CamOpRows({ ops }) {
  return h('ul', { className: 'camcard-ops' },
    ops.map((op) => h('li', { key: op.index, className: 'camcard-op' },
      h(StateDot, { state: camOpDot(op) }),
      h('span', { className: 'camcard-op-name' }, op.name),
      h('span', { className: 'camcard-op-status' }, camOpStatusText(op)))))
}

function CamStageCard({ node }) {
  const model = node.data
  const runningOp = model.done === null
    ? model.ops.find((op) => op.action !== undefined && op.status === undefined)
    : undefined
  const headline = model.done !== null
    ? `完成：${CAM_OVERALLS[model.done]?.label ?? model.done}`
    : model.stage === 'op'
      ? `执行工序（${(runningOp?.index ?? model.ops.at(-1)?.index ?? 0) + 1}/${model.total || model.ops.length || '?'}）${runningOp ? `：${runningOp.name}` : ''}`
      : CAM_STAGE_LABELS[model.stage] ?? model.stage
  return h('div', { className: 'camcard' },
    h('div', { className: 'camcard-head' },
      h(StateDot, { state: model.done === null ? 'ongoing' : camOverallDot(model.done) }),
      h('span', { className: 'camcard-title' }, `CAM 远程执行 · ${model.runId}`),
      model.done !== null ? h(CamBadge, { overall: model.done }) : null),
    h('div', { className: 'camcard-stage' }, headline),
    model.ops.length > 0 ? h(CamOpRows, { ops: model.ops }) : null)
}

function CamCheckReportCard({ node }) {
  const model = node.data
  const report = model.report.data
  const runId = typeof report.run_id === 'string' ? report.run_id : ''
  const hasNc = Number.isSafeInteger(report.expected_nc) || Number.isSafeInteger(report.found_nc)
  const missing = Array.isArray(report.missing) ? report.missing : []
  const emptyOps = Array.isArray(report.empty_ops) ? report.empty_ops : []
  const ncLine = hasNc
    ? `NC 对账：期望 ${report.expected_nc ?? '?'} 个 / 实数 ${report.found_nc ?? '?'} 个`
      + (missing.length > 0 ? `；缺：${missing.join('、')}` : '')
      + (emptyOps.length > 0 ? `；空刀路：${emptyOps.join('、')}` : '')
    : null
  return h('div', { className: 'camcard' },
    h('div', { className: 'camcard-head' },
      h(StateDot, { state: camOverallDot(report.overall) }),
      h('span', { className: 'camcard-title' }, `CAM 自检报告 · ${runId}`),
      h(CamBadge, { overall: report.overall })),
    typeof report.failed_stage === 'string' && report.failed_stage !== ''
      ? h('p', { className: 'camcard-warn' }, `阶段 ${CAM_STAGE_LABELS[report.failed_stage] ?? report.failed_stage} 失败。`)
      : null,
    typeof report.msg === 'string' && report.msg !== ''
      ? h('p', { className: 'camcard-warn' }, report.msg)
      : null,
    typeof report.reason === 'string' && report.reason !== ''
      ? h('p', { className: 'camcard-note' }, report.reason)
      : null,
    model.ops.length > 0 ? h(CamOpRows, { ops: model.ops }) : null,
    ncLine !== null ? h('p', { className: 'camcard-note' }, ncLine) : null)
}

// 刀路查看器挂点：cam.nc.preview（keyed/scope root）有 key 'toolpath-viewer'
// 的注册才显示「查看刀路」入口——viewer 插件（camind-ui-toolpath-viewer）
// 缺席时交付卡退化为纯文件清单。
function useNcPreviewAvailable(camSlots) {
  return useSyncExternalStore(
    (notify) => (typeof camSlots?.subscribe === 'function' ? camSlots.subscribe('cam.nc.preview', notify) : () => {}),
    () => typeof camSlots?.entriesOfSlot === 'function'
      && camSlots.entriesOfSlot('cam.nc.preview').some((entry) => entry.options?.key === 'toolpath-viewer'),
  )
}

// 下载 URL（Host 只读路由；session 与 run 目录的 safeSessionId 口径一致）。
function camDeliveryUrl(sessionId, runId, file) {
  const session = String(sessionId ?? 'global').replace(/[^A-Za-z0-9_-]/g, '_')
  const tail = String(file).split('/').map(encodeURIComponent).join('/')
  return `/camind/api/cam/runs/${encodeURIComponent(session)}/${encodeURIComponent(runId)}/delivery/${tail}`
}

function camBytesLabel(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function camBasename(p) {
  const text = String(p)
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return slash >= 0 ? text.slice(slash + 1) : text
}

function CamDeliveredCard({ node, sessionId, openFile, renderSlot, camSlots }) {
  const data = node.data
  const runId = typeof data.run_id === 'string' ? data.run_id : ''
  const files = Array.isArray(data.files) ? data.files : []
  const ncFiles = Array.isArray(data.nc_files) ? data.nc_files : []
  const workspaceDir = typeof data.workspace_dir === 'string' && data.workspace_dir !== '' ? data.workspace_dir : null
  const hasViewer = useNcPreviewAvailable(camSlots)
  // {fileName, phase: 'loading'|'ready'|'error', content?, error?}
  const [viewer, setViewer] = useState(null)

  const openNcViewer = async (name) => {
    setViewer({ fileName: name, phase: 'loading' })
    try {
      const response = await fetch(camDeliveryUrl(sessionId, runId, `nc/${name}`), { headers: { Accept: 'text/plain' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setViewer({ fileName: name, phase: 'ready', content: await response.text() })
    } catch (error) {
      setViewer({ fileName: name, phase: 'error', error: error?.message ?? String(error) })
    }
  }

  return h('div', { className: 'camcard' },
    h('div', { className: 'camcard-head' },
      h(StateDot, { state: camOverallDot(data.overall) }),
      h('span', { className: 'camcard-title' }, `CAM 交付 · ${runId}`),
      h(CamBadge, { overall: data.overall })),
    data.overall !== undefined && data.overall !== 'ok'
      ? h('p', { className: 'camcard-warn' }, '检查未全过，交付含未决项——以交付报告与签字结论为准。')
      : null,
    h('p', { className: 'camcard-section' }, '交付包'),
    h('div', { className: 'camcard-files' },
      files.length === 0
        ? h('p', { className: 'camcard-note' }, `交付目录：${data.delivery_dir ?? '未知'}`)
        : files.map((file) => {
          const name = camBasename(file?.path ?? '')
          const size = camBytesLabel(file?.bytes)
          return h('div', { key: name, className: 'camcard-file' },
            h('span', { className: 'camcard-file-name', title: file?.path }, name),
            h('span', { className: 'camcard-file-kind' }, CAM_FILE_KIND_LABELS[file?.kind] ?? '文件'),
            size !== null ? h('span', { className: 'camcard-file-size' }, size) : null,
            h('span', { className: 'camcard-file-actions' },
              h('a', { className: 'camcard-action', href: camDeliveryUrl(sessionId, runId, name) }, '下载'),
              workspaceDir !== null && typeof openFile === 'function'
                ? h('button', {
                  type: 'button',
                  className: 'camcard-action',
                  title: '在运行 dsh 的机器上打开（会话工作区副本）',
                  onClick: () => openFile(`${workspaceDir}/${name}`),
                }, '打开')
                : null))
        })),
    ncFiles.length > 0 ? h('p', { className: 'camcard-section' }, `NC 程序（${ncFiles.length}）`) : null,
    ncFiles.length > 0 ? h('div', { className: 'camcard-files' },
      ncFiles.map((name) => h('div', { key: name, className: 'camcard-file' },
        h('span', { className: 'camcard-file-name', title: name }, name),
        h('span', { className: 'camcard-file-actions' },
          h('a', { className: 'camcard-action', href: camDeliveryUrl(sessionId, runId, `nc/${name}`) }, '下载'),
          hasViewer
            ? h('button', {
              type: 'button',
              className: 'camcard-action',
              disabled: viewer?.phase === 'loading',
              onClick: () => openNcViewer(name),
            }, '查看刀路')
            : null)))) : null,
    viewer !== null ? h('div', { className: 'camcard-viewer' },
      h('div', { className: 'camcard-viewer-head' },
        h('span', null, `刀路预览：${viewer.fileName}`),
        h('button', { type: 'button', className: 'camcard-action', onClick: () => setViewer(null) }, '收起')),
      viewer.phase === 'loading'
        ? h('p', { className: 'camcard-note' }, '读取 NC 中…')
        : viewer.phase === 'error'
          ? h('p', { className: 'camcard-warn', role: 'status' }, `NC 读取失败：${viewer.error}`)
          : typeof renderSlot === 'function'
            ? renderSlot('cam.nc.preview', { content: viewer.content, fileName: viewer.fileName }, {
              entryKey: 'toolpath-viewer',
              // 席位注册在点击与渲染之间被卸载时的兜底：纯文本 NC。
              fallback: h('pre', { className: 'camcard-nc-raw' }, viewer.content),
            })
            : h('pre', { className: 'camcard-nc-raw' }, viewer.content)) : null)
}

// --- registration ----------------------------------------------------------------------

function apply(ctx) {
  const { api } = ctx.get('connection')
  const controller = new CamNxCardController(ctx.settingsScope.bind({ namespace: NS }), api)
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => controller.refreshCredential(ref)),
    'tool-cam: credential invalidations',
  )
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      key: NS,
      inject: () => controller.inject(),
    }, CamNxCard))

  // 会话卡片：三个事件定义 + 三个 keyed 渲染器（渲染键 = 节点 kind）。
  ctx.conversationEvents.register(camStageDefinition)
  ctx.conversationEvents.register(camCheckReportDefinition)
  ctx.conversationEvents.register(camDeliveredDefinition)
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register({ name: 'conversation.chat.node', key: 'cam-stage' }, CamStageCard))
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register({ name: 'conversation.chat.node', key: 'cam-check-report' }, CamCheckReportCard))
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'cam-delivered',
      // 刀路查看器挂点（弱耦合）：viewer 插件注册
      // { name: 'cam.nc.preview', key: 'toolpath-viewer' }，渲染时拿到
      // owner props { content, fileName }。
      children: { 'cam.nc.preview': { kind: 'keyed', scope: 'root' } },
      inject: () => ({ camSlots: ctx.slots }),
    }, CamDeliveredCard))
}

exports.name = 'tool-cam-client'
exports.inject = ['slots', 'connection', 'remote', 'settingsScope', 'conversationEvents']
exports.apply = apply

return module.exports; } });
