// camind-ui-foundation browser bundle — shared semantic tokens and stateless
// page-level React patterns for dynamic /camind client plugins.
window.__ModuleLoader__.load({ id: 'camind-ui-foundation', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h } = React
const {
  Button,
  Input,
  Modal,
  Pill,
  Tooltip,
  IconCloseOutline16,
  IconRefreshOutline14,
} = require('@deepseek-ai/dsh-client-ui-primitives')

const FOUNDATION_CSS = `
body[data-camind-ui] {
  --camind-color-text: var(--dsw-alias-label-primary);
  --camind-color-text-secondary: var(--dsw-alias-label-secondary);
  --camind-color-text-tertiary: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  --camind-color-accent: var(--dsw-alias-state-business-primary, var(--dsw-alias-label-primary));
  --camind-color-success: var(--dsw-alias-state-success-primary, var(--camind-color-accent));
  --camind-color-warning: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, var(--camind-color-text-secondary)));
  --camind-color-danger: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error));
  --camind-color-on-strong: var(--dsw-alias-label-primary-inverted, #fff);

  --camind-surface-page: var(--dsw-alias-bg-base, var(--dsw-alias-background-base));
  --camind-surface-sidebar: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, var(--camind-surface-page)));
  --camind-surface-layer: var(--dsw-alias-bg-layer-1, var(--dsw-alias-background-container));
  --camind-surface-raised: var(--dsw-alias-bg-layer-2, var(--camind-surface-layer));
  --camind-surface-code: var(--dsw-alias-markdown-code-block, var(--camind-surface-layer));
  --camind-surface-hover: var(--dsw-alias-interactive-bg-hover);
  --camind-surface-active: var(--dsw-alias-interactive-bg-active, var(--camind-surface-hover));
  --camind-surface-warning: color-mix(in srgb, var(--camind-color-warning) 12%, transparent);

  --camind-border-subtle: var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
  --camind-border-default: var(--dsw-alias-border-l2);
  --camind-border-strong: var(--dsw-alias-border-l3, var(--camind-border-default));
  --camind-focus-ring: var(--dsw-alias-border-l4, var(--camind-color-accent));
  --camind-shadow-card: var(--dsw-shadow-lv2, 0 2px 8px rgb(0 0 0 / 6%));

  --camind-space-1: 4px;
  --camind-space-2: 8px;
  --camind-space-3: 12px;
  --camind-space-4: 16px;
  --camind-space-5: 24px;
  --camind-space-6: 32px;
  --camind-radius-sm: 6px;
  --camind-radius-control: 8px;
  --camind-radius-card: 12px;
  --camind-radius-dialog: 14px;
  --camind-control-height-sm: 28px;
  --camind-control-height-md: 32px;
  --camind-page-inline: clamp(16px, 3vw, 32px);
  --camind-page-inline-wide: clamp(24px, 5vw, 64px);
  --camind-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

body[data-camind-ui] .cui-page { box-sizing: border-box; min-height: 100%; color: var(--camind-color-text); background: var(--camind-surface-page); }
body[data-camind-ui] .cui-page[data-variant="standard"] { padding: 32px var(--camind-page-inline-wide) 64px; }
body[data-camind-ui] .cui-page[data-variant="wide"] { padding: 24px var(--camind-page-inline) 48px; }
body[data-camind-ui] .cui-page[data-variant="split"] { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; }
body[data-camind-ui] .cui-page-header { display: flex; align-items: flex-start; gap: 10px; }
body[data-camind-ui] .cui-page-header-main { flex: 1; min-width: 0; }
body[data-camind-ui] .cui-page-header-title { margin: 0; font-size: 24px; line-height: 32px; font-weight: 600; }
body[data-camind-ui] .cui-page-header-description { margin: 8px 0 0; color: var(--camind-color-text-secondary); font-size: 14px; line-height: 22px; }
body[data-camind-ui] .cui-page-header-actions { display: flex; align-items: center; gap: var(--camind-space-2); }
body[data-camind-ui] .cui-page-body { min-height: 0; padding: 24px var(--camind-page-inline-wide) 64px; }
body[data-camind-ui] .cui-page-body[data-density="compact"] { padding-top: 12px; }

body[data-camind-ui] .cui-scroll { overflow-y: auto; scrollbar-width: thin; }
body[data-camind-ui] .cui-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
body[data-camind-ui] .cui-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l2, var(--camind-border-default)); border-radius: 4px; }
body[data-camind-ui] .cui-scroll::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l2, var(--camind-border-strong)); }

body[data-camind-ui] .cui-icon-button {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: var(--camind-control-height-sm); height: var(--camind-control-height-sm); padding: 0;
  border: 0; border-radius: var(--camind-radius-control); background: transparent;
  color: var(--camind-color-text-secondary); font: inherit; cursor: pointer;
  transition: background var(--ds-transition-duration-fast, 100ms) ease, color var(--ds-transition-duration-fast, 100ms) ease;
}
body[data-camind-ui] .cui-icon-button:hover:not(:disabled) { background: var(--camind-surface-hover); color: var(--camind-color-text); }
body[data-camind-ui] .cui-icon-button[data-tone="danger"]:hover:not(:disabled) { color: var(--camind-color-danger); }
body[data-camind-ui] .cui-icon-button:disabled { opacity: .5; cursor: default; }

body[data-camind-ui] .cui-badge {
  display: inline-flex; align-items: center; gap: 4px; flex: none; min-height: 18px;
  padding: 0 6px; border: 1px solid var(--camind-border-default); border-radius: var(--camind-radius-sm);
  color: var(--camind-color-text-secondary); font-size: 11px; line-height: 17px; white-space: nowrap;
}
body[data-camind-ui] .cui-badge[data-tone="accent"] { border-color: transparent; color: var(--camind-color-accent); background: color-mix(in srgb, var(--camind-color-accent) 12%, transparent); }
body[data-camind-ui] .cui-badge[data-tone="success"] { border-color: transparent; color: var(--camind-color-success); background: color-mix(in srgb, var(--camind-color-success) 12%, transparent); }
body[data-camind-ui] .cui-badge[data-tone="warning"] { border-color: transparent; color: var(--camind-color-warning); background: color-mix(in srgb, var(--camind-color-warning) 12%, transparent); }
body[data-camind-ui] .cui-badge[data-tone="danger"] { border-color: transparent; color: var(--camind-color-danger); background: color-mix(in srgb, var(--camind-color-danger) 10%, transparent); }
body[data-camind-ui] .cui-badge[data-mono] { font-family: var(--camind-font-mono); }

body[data-camind-ui] .cui-chip {
  min-height: 28px; padding: 3px 10px; border: 1px solid var(--camind-border-default); border-radius: 999px;
  background: transparent; color: var(--camind-color-text-secondary); font: inherit; font-size: 12px; cursor: pointer;
}
body[data-camind-ui] .cui-chip:hover { color: var(--camind-color-text); }
body[data-camind-ui] .cui-chip[aria-pressed="true"] { border-color: var(--camind-color-accent); color: var(--camind-color-accent); background: color-mix(in srgb, var(--camind-color-accent) 10%, transparent); }

body[data-camind-ui] .cui-card {
  display: block; width: 100%; padding: 16px 18px; border: 1px solid var(--camind-border-default);
  border-radius: var(--camind-radius-card); background: var(--camind-surface-layer); color: var(--camind-color-text); text-align: left;
  transition: border-color var(--ds-transition-duration-fast, 100ms) ease, box-shadow var(--ds-transition-duration-fast, 100ms) ease, background var(--ds-transition-duration-fast, 100ms) ease;
}
body[data-camind-ui] button.cui-card { cursor: pointer; }
body[data-camind-ui] button.cui-card:hover { border-color: var(--camind-border-strong); box-shadow: var(--camind-shadow-card); }
body[data-camind-ui] .cui-card[data-selected] { border-color: var(--camind-color-accent); background: color-mix(in srgb, var(--camind-color-accent) 7%, var(--camind-surface-layer)); }
body[data-camind-ui] .cui-card[data-dimmed] { opacity: .68; }

body[data-camind-ui] .cui-tabs { display: flex; gap: 2px; margin-top: 8px; border-bottom: 1px solid var(--camind-border-default); }
body[data-camind-ui] .cui-tab {
  padding: 8px 12px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent;
  background: transparent; color: var(--camind-color-text-secondary); font: inherit; font-size: 13px; cursor: pointer;
}
body[data-camind-ui] .cui-tab:hover:not(:disabled) { color: var(--camind-color-text); }
body[data-camind-ui] .cui-tab[aria-selected="true"] { color: var(--camind-color-text); font-weight: 600; border-bottom-color: var(--camind-color-accent); }
body[data-camind-ui] .cui-tab-count { margin-left: 4px; color: var(--camind-color-text-tertiary); font-weight: 400; }

body[data-camind-ui] .cui-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
body[data-camind-ui] .cui-field-label { font-size: 12px; line-height: 18px; color: var(--camind-color-text-secondary); }
body[data-camind-ui] .cui-field-hint { font-size: 11px; line-height: 17px; color: var(--camind-color-text-tertiary); }
body[data-camind-ui] .cui-field-error { font-size: 11px; line-height: 17px; color: var(--camind-color-danger); }

body[data-camind-ui] .cui-state {
  max-width: 520px; margin-top: 24px; padding: 18px 20px; border: 1px solid var(--camind-border-default);
  border-radius: var(--camind-radius-card); background: var(--camind-surface-layer); color: var(--camind-color-text-secondary);
  font-size: 13px; line-height: 20px;
}
body[data-camind-ui] .cui-state[data-kind="loading"] { border-color: transparent; background: transparent; padding-inline: 0; }
body[data-camind-ui] .cui-state-title { margin: 0 0 4px; color: var(--camind-color-text); font-size: 14px; line-height: 22px; font-weight: 600; }
body[data-camind-ui] .cui-state-description { margin: 0; overflow-wrap: anywhere; }
body[data-camind-ui] .cui-state-action { margin-top: 12px; }

body[data-camind-ui] .cui-dialog-shell {
  width: min(560px, 92vw); max-height: 88vh; gap: 0; padding: 0;
  border-radius: var(--camind-radius-dialog); background: var(--camind-surface-page);
}
body[data-camind-ui] .cui-dialog-shell.cui-dialog-shell-wide { width: min(980px, calc(100vw - 64px)); }
body[data-camind-ui] .cui-dialog { display: flex; min-height: 0; flex: 1; flex-direction: column; }
body[data-camind-ui] .cui-dialog-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--camind-border-default); }
body[data-camind-ui] .cui-dialog-title { flex: 1; margin: 0; color: var(--camind-color-text); font-size: 16px; line-height: 24px; font-weight: 600; }
body[data-camind-ui] .cui-dialog-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px; }
body[data-camind-ui] .cui-dialog-footer { flex: none; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--camind-border-default); }

body[data-camind-ui] .cui-sidebar-action {
  flex: none; display: flex; align-items: center; border: 0; background: transparent;
  color: var(--camind-color-text); font: inherit; cursor: pointer; overflow: hidden;
}
body[data-camind-ui] .cui-sidebar-action[data-wide] { width: calc(100% + 4px); height: 42px; justify-content: flex-start; gap: 8px; margin: 4px -2px; padding: 0 10px 0 8px; border-radius: 12px; }
body[data-camind-ui] .cui-sidebar-action:not([data-wide]) { width: 36px; height: 36px; justify-content: center; margin: 4px 0; padding: 0; border-radius: 50%; }
body[data-camind-ui] .cui-sidebar-action:hover { background: var(--camind-surface-hover); }
body[data-camind-ui] .cui-sidebar-action[aria-current="page"] { background: var(--camind-surface-active); font-weight: 600; }
body[data-camind-ui] .cui-sidebar-action-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

body[data-camind-ui] .cui-icon-button:focus-visible,
body[data-camind-ui] .cui-chip:focus-visible,
body[data-camind-ui] .cui-card:focus-visible,
body[data-camind-ui] .cui-tab:focus-visible,
body[data-camind-ui] .cui-sidebar-action:focus-visible {
  outline: 2px solid var(--camind-focus-ring); outline-offset: 2px;
}

@media (max-width: 736px) {
  body[data-camind-ui] .cui-page[data-variant="standard"],
  body[data-camind-ui] .cui-page[data-variant="wide"] { padding-inline: 16px; }
  body[data-camind-ui] .cui-page-body { padding-inline: 16px; }
  body[data-camind-ui] .cui-page-header { flex-wrap: wrap; }
  body[data-camind-ui] .cui-page-header-actions { width: 100%; }
  body[data-camind-ui] .cui-dialog-shell.cui-dialog-shell-wide { width: calc(100vw - 24px); }
}

@media (prefers-reduced-motion: reduce) {
  body[data-camind-ui] .cui-icon-button,
  body[data-camind-ui] .cui-card { transition: none; }
}
`

function cx(...values) {
  return values.flatMap((value) => {
    if (!value) return []
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.filter(Boolean)
    return Object.entries(value).filter(([, enabled]) => enabled).map(([name]) => name)
  }).join(' ')
}

function Page({ variant = 'standard', className, children, ...rest }) {
  return h('div', { className: cx('cui-page', className), 'data-variant': variant, ...rest }, children)
}

function PageHeader({ title, description, icon, actions, back, className, ...rest }) {
  const backProps = typeof back === 'function' ? { onClick: back } : back
  return h('header', { className: cx('cui-page-header', className), ...rest },
    backProps ? h(IconButton, {
      label: backProps.label || '返回',
      icon: backProps.icon || '←',
      onClick: backProps.onClick,
    }) : null,
    icon || null,
    h('div', { className: 'cui-page-header-main' },
      h('h1', { className: 'cui-page-header-title' }, title),
      description ? h('p', { className: 'cui-page-header-description' }, description) : null),
    actions ? h('div', { className: 'cui-page-header-actions' }, actions) : null)
}

function PageBody({ scroll, density, className, children, ...rest }) {
  return h('div', {
    className: cx('cui-page-body', scroll && 'cui-scroll', className),
    'data-density': density,
    ...rest,
  }, children)
}

function Tabs({ items, value, onChange, ariaLabel = '页面标签', className }) {
  function move(event, index) {
    const enabled = items.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => !item.disabled)
    if (enabled.length === 0) return
    const current = enabled.findIndex(({ itemIndex }) => itemIndex === index)
    let target = null
    if (event.key === 'ArrowRight') target = enabled[(current + 1) % enabled.length]
    if (event.key === 'ArrowLeft') target = enabled[(current - 1 + enabled.length) % enabled.length]
    if (event.key === 'Home') target = enabled[0]
    if (event.key === 'End') target = enabled[enabled.length - 1]
    if (!target) return
    event.preventDefault()
    onChange(target.item.value)
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[target.itemIndex]?.focus()
  }
  return h('div', { className: cx('cui-tabs', className), role: 'tablist', 'aria-label': ariaLabel },
    items.map((item, index) => h('button', {
      key: item.value,
      type: 'button',
      role: 'tab',
      className: 'cui-tab',
      'aria-selected': item.value === value,
      tabIndex: item.value === value ? 0 : -1,
      disabled: item.disabled,
      onClick: () => onChange(item.value),
      onKeyDown: (event) => move(event, index),
    }, item.label, item.count == null ? null : h('span', { className: 'cui-tab-count' }, item.count))))
}

function Card({ interactive, selected, dimmed, className, children, onClick, ...rest }) {
  const clickable = interactive || Boolean(onClick)
  return h(clickable ? 'button' : 'div', {
    ...(clickable ? { type: 'button' } : {}),
    className: cx('cui-card', className),
    'data-selected': selected ? '' : undefined,
    'data-dimmed': dimmed ? '' : undefined,
    onClick,
    ...rest,
  }, children)
}

function Badge({ tone = 'neutral', mono, className, children, ...rest }) {
  const normalizedTone = tone === 'warn' ? 'warning' : tone === 'error' ? 'danger' : tone
  return h('span', {
    className: cx('cui-badge', className),
    'data-tone': normalizedTone,
    'data-mono': mono ? '' : undefined,
    ...rest,
  }, children)
}

function Chip({ selected, className, children, ...rest }) {
  return h('button', {
    type: 'button',
    className: cx('cui-chip', className),
    'aria-pressed': Boolean(selected),
    ...rest,
  }, children)
}

function Field({ label, hint, error, required, children, className, ...rest }) {
  return h('label', { className: cx('cui-field', className), ...rest },
    h('span', { className: 'cui-field-label' }, label, required ? ' *' : null),
    children,
    hint ? h('span', { className: 'cui-field-hint' }, hint) : null,
    error ? h('span', { className: 'cui-field-error' }, error) : null)
}

function IconButton({ label, icon, tone, className, ...rest }) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('ui-foundation: IconButton requires a non-empty label')
  }
  const button = h('button', {
    type: 'button',
    className: cx('cui-icon-button', className),
    'data-tone': tone,
    'aria-label': label,
    ...rest,
  }, icon)
  return h(Tooltip, { label, delayMs: 500 }, button)
}

function StateView({ kind = 'empty', title, description, action, className, ...rest }) {
  return h('div', { className: cx('cui-state', className), 'data-kind': kind, ...rest },
    title ? h('h3', { className: 'cui-state-title' }, title) : null,
    description ? h('p', { className: 'cui-state-description' }, description) : null,
    action ? h('div', { className: 'cui-state-action' }, action) : null)
}

function StateNotice({ onRetry, children, className }) {
  return h(StateView, {
    kind: 'error',
    className,
    description: children,
    action: onRetry ? h(Button, { variant: 'outline', size: 'sm', icon: h(IconRefreshOutline14, { size: 14 }), onClick: onRetry }, '重试') : null,
  })
}

function DialogBody({ className, children, ...rest }) {
  return h('div', { className: cx('cui-dialog-body', className), ...rest }, children)
}

function DialogFooter({ className, children, ...rest }) {
  return h('div', { className: cx('cui-dialog-footer', className), ...rest }, children)
}

function Dialog({ size = 'standard', title, onClose, footer, children, className }) {
  return h(Modal, {
    open: true,
    onClose,
    title,
    closeLabel: '关闭',
    headless: true,
    className: cx('cui-dialog-shell', size === 'wide' && 'cui-dialog-shell-wide', className),
  }, h('div', { className: 'cui-dialog', 'data-size': size },
    h('div', { className: 'cui-dialog-head' },
      h('h2', { className: 'cui-dialog-title' }, title),
      h(IconButton, { label: '关闭', icon: h(IconCloseOutline16, { size: 16 }), onClick: onClose })),
    h(DialogBody, null, children),
    footer ? h(DialogFooter, null, footer) : null))
}

function SidebarAction({ wide, active, icon, label, onClick }) {
  const button = h('button', {
    type: 'button',
    className: 'cui-sidebar-action',
    'data-wide': wide ? '' : undefined,
    'aria-label': label,
    'aria-current': active ? 'page' : undefined,
    onClick,
  }, icon, wide ? h('span', { className: 'cui-sidebar-action-label' }, label) : null)
  return h(Tooltip, { label, delayMs: 500, disabled: wide }, button)
}

function isCamindPath() {
  return location.pathname === '/camind' || location.pathname.startsWith('/camind/')
}

function apply(ctx) {
  if (!isCamindPath()) return
  ctx.effect(() => {
    const body = document.body
    const ownedAttribute = !body.hasAttribute('data-camind-ui')
    body.setAttribute('data-camind-ui', '')
    const style = document.createElement('style')
    style.setAttribute('data-camind-ui-foundation', '')
    style.textContent = FOUNDATION_CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
      if (ownedAttribute) body.removeAttribute('data-camind-ui')
    }
  }, 'ui-foundation: stylesheet')
}

exports.name = 'ui-foundation-client'
exports.apply = apply
exports.Button = Button
exports.Input = Input
exports.Modal = Modal
exports.Pill = Pill
exports.Tooltip = Tooltip
exports.Page = Page
exports.PageHeader = PageHeader
exports.PageBody = PageBody
exports.Tabs = Tabs
exports.Card = Card
exports.Badge = Badge
exports.Chip = Chip
exports.Field = Field
exports.IconButton = IconButton
exports.StateView = StateView
exports.StateNotice = StateNotice
exports.Dialog = Dialog
exports.DialogBody = DialogBody
exports.DialogFooter = DialogFooter
exports.SidebarAction = SidebarAction
exports.cx = cx

return module.exports; } });
