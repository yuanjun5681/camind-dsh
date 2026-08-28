// camind-ui-brand browser bundle — hand-written, no build step.
// Claims the upstream-native `sidebar.brand.mark` / `sidebar.brand.name`
// single seats (dsh 0.1.1+; empty by default, so these registrations replace
// the FishLogo / "DSH Local Build" fallbacks). The brand image is served by
// this plugin's Host half and shared by the sidebar and ui-home hero.
window.__ModuleLoader__.load({ id: "camind-ui-brand", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h } = React

const MASCOT_SRC = '/camind/assets/camind-mascot.png'

const BRAND_CSS = `
.camind-brand-mascot{display:inline-flex;flex:none;overflow:hidden;border-radius:var(--camind-radius-sm,6px);line-height:0}
.camind-brand-mascot>img{display:block;width:100%;height:100%;object-fit:cover}
.camind-brand-lockup{display:inline-flex;align-items:center;color:var(--camind-color-text,var(--dsw-alias-label-primary))}
.camind-brand-copy{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left}
.camind-brand-wordmark{font-weight:600;letter-spacing:.01em;line-height:1.3}
.camind-brand-badge{display:inline-block;margin-left:2px;padding:1px 5px;border-radius:4px;background:var(--camind-color-text,var(--dsw-alias-label-primary));color:var(--camind-surface-page,var(--dsw-alias-bg-base));font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;line-height:1.5;vertical-align:1px}
.camind-brand-tagline{color:var(--camind-color-text-secondary,var(--dsw-alias-label-secondary));font-size:14px;line-height:22px}
.camind-brand-lockup[data-variant="sidebar"]{gap:0}.camind-brand-lockup[data-variant="sidebar"] .camind-brand-wordmark{font-size:15px}
.camind-brand-lockup[data-variant="hero"]{gap:16px}.camind-brand-lockup[data-variant="hero"] .camind-brand-mascot{border-radius:var(--camind-radius-card,12px)}.camind-brand-lockup[data-variant="hero"] .camind-brand-wordmark{font-size:26px}.camind-brand-lockup[data-variant="hero"] .camind-brand-badge{margin-left:4px;padding:2px 6px;border-radius:5px;font-size:12px;vertical-align:2px}
`

function Mascot({ size = 24 }) {
  return h('span', {
    className: 'camind-brand-mascot',
    style: { width: size, height: size },
  }, h('img', {
    src: MASCOT_SRC,
    alt: '',
    'aria-hidden': 'true',
    draggable: false,
    decoding: 'async',
  }))
}

function CamindBrandMark({ size }) {
  return h(Mascot, { size })
}

function BrandLockup({ variant = 'sidebar', tagline }) {
  return h('span', { className: 'camind-brand-lockup', 'data-variant': variant },
    variant === 'hero' ? h(Mascot, { size: 84 }) : null,
    h('span', { className: 'camind-brand-copy' },
      h('span', { className: 'camind-brand-wordmark' },
        'Camind', h('span', { className: 'camind-brand-badge' }, 'Harness')),
      tagline ? h('span', { className: 'camind-brand-tagline' }, tagline) : null))
}

function CamindBrandName() {
  return h(BrandLockup, { variant: 'sidebar' })
}

function apply(ctx) {
  // /camind-only: the same graph also boots the official shell (/web), whose
  // brand seats belong to ui-brand-official's stock occupants.
  if (!location.pathname.startsWith('/camind')) return
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-ui-brand', '')
    style.textContent = BRAND_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  // priority -10: the graph's ui-brand-official row registers the same single
  // seats at priority 0; same-priority clashes throw, the lowest renders.
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({
      name: 'sidebar.brand.mark',
      priority: -10,
    }, CamindBrandMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({
      name: 'sidebar.brand.name',
      priority: -10,
    }, CamindBrandName))
}

exports.name = 'ui-brand-client'
exports.inject = ['slots']
exports.apply = apply
exports.Mascot = Mascot
exports.BrandLockup = BrandLockup

return module.exports; } });
