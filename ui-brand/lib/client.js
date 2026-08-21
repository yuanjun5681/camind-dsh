// camind-ui-brand browser bundle — hand-written, no build step.
// Claims ui-sidebar's `sidebar.brand` single seat (empty by default, so this
// registration replaces the BrandWordmark/FishLogo fallbacks). The brand mark
// is a frozen, always-animated blobatar mascot: SSR'd once from blobatar@2.1.0
// (MIT, https://github.com/Alain00/blobatar) and embedded below as static
// markup, so the runtime carries no blobatar code. Regenerate with:
//   npm i blobatar@2.1.0 react react-dom
//   renderToStaticMarkup(<Blobatar name="anasage-mascot-3" hue={265} tone={0.5}
//     background={false} animate="always" size={24} />)
// Motion is pure CSS: blobatar's dist/motion.css (vendored verbatim below; all
// classes, keyframes and @property names are mo- prefixed) is injected into
// <head> on activation and removed with the plugin; it already honors
// prefers-reduced-motion. Wide mode adds the wordmark with the theme-inverted
// "Harness" badge; the collapsed rail renders the mascot alone.
window.__ModuleLoader__.load({ id: "camind-ui-brand", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h } = React

// Frozen SSR output of the mascot: a round blob (seed anasage-mascot-3),
// body #7ea5fd (brand-adjacent indigo), dark navy eyes that stay legible on
// both light and dark themes. The inline style carries the seeded motion
// timing (blink/saccade/phase offsets) motion.css reads.
// The svg's 24px width/height attrs are overridden by BRAND_CSS below.
const MASCOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="24" height="24" aria-hidden="true" style="--mo-phase:-2438ms;--mo-bob-phase:-1596ms;--mo-blink:4435ms;--mo-blink-phase:-3578ms;--mo-look-x:2.06;--mo-look-mx:2.06;--mo-look-y:1.41;--mo-look-my:1.41;--mo-saccade:7079ms;--mo-saccade-phase:-5919ms;--mo-head:#7ea5fd;--mo-eye:#0b0f18"><g class="mo-root mo-always"><g class="mo-breathe"><g class="mo-bob"><g fill="#7ea5fd"><path d="M85.21 50.6C85.21 73.67 72.78 85.76 49.06 85.76C25.35 85.76 12.91 73.67 12.91 50.6C12.91 27.53 25.35 15.43 49.06 15.43C72.78 15.43 85.21 27.53 85.21 50.6Z"/></g><g fill="#0b0f18" class="mo-eyes"><g class="mo-eye" style="--mo-wrap:-1;--mo-lean:3.95;transform-origin:38.69px 43.68px"><path d="M42.07 43.92C41.5 52.09 41.26 52.6 38.09 52.38C34.91 52.16 34.75 51.63 35.31 43.45C35.87 35.28 36.11 34.77 39.29 34.99C42.46 35.21 42.63 35.74 42.07 43.92Z"/></g><g class="mo-eye" style="--mo-wrap:1;--mo-lean:7.34;transform-origin:60.64px 45.05px"><path d="M64.14 45.5C62.92 54.98 62.63 55.56 59.34 55.13C56.05 54.71 55.92 54.08 57.14 44.6C58.36 35.12 58.65 34.54 61.94 34.97C65.23 35.39 65.36 36.02 64.14 45.5Z"/></g></g></g></g></g></svg>`

// blobatar@2.1.0 dist/motion.css, vendored verbatim.
const MOTION_CSS = `@property --mo-amp{syntax:"<number>";inherits:true;initial-value:0}@property --mo-esx{syntax:"<number>";inherits:true;initial-value:1}@property --mo-esy{syntax:"<number>";inherits:true;initial-value:1}@property --mo-tilt{syntax:"<number>";inherits:true;initial-value:0}@property --mo-edy{syntax:"<number>";inherits:true;initial-value:0}@property --mo-edx{syntax:"<number>";inherits:true;initial-value:0}@property --mo-esx2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-esy2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-tilt2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-edy2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-lock{syntax:"<number>";inherits:true;initial-value:0}@property --mo-shake{syntax:"<number>";inherits:true;initial-value:0}@property --mo-rock{syntax:"<number>";inherits:true;initial-value:0}@property --mo-rockp{syntax:"<number>";inherits:true;initial-value:1}@property --mo-bdy{syntax:"<number>";inherits:true;initial-value:0}.mo-root,.mo-breathe,.mo-bob{transform-box:view-box;transform-origin:center}.mo-root{--mo-amp:0;--mo-morph:calc(.4s*var(--mo-rate,1));--mo-morph-ease:ease-in-out;--mo-tp:--mo-esx,--mo-esy,--mo-tilt,--mo-edy,--mo-edx,--mo-esx2,--mo-esy2,--mo-tilt2,--mo-edy2,--mo-lock,--mo-shake,--mo-rock,--mo-bdy;--mo-md:var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph);--mo-me:var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease);transition-property:--mo-amp,transform,var(--mo-tp);transition-duration:calc(.4s*var(--mo-rate,1)),calc(.16s*var(--mo-rate,1)),var(--mo-md);transition-timing-function:ease-out,cubic-bezier(.23,1,.32,1),var(--mo-me);animation:mo-shake calc(.112s*var(--mo-rate,1))linear infinite}.mo-bob>g:not(.mo-eyes){fill:var(--mo-head);transition:fill var(--mo-morph)var(--mo-morph-ease)}.mo-eyes{fill:var(--mo-eye);transition:fill var(--mo-morph)var(--mo-morph-ease)}@keyframes mo-shake{0%,to{translate:calc(.62px*var(--mo-shake))calc(-.34px*var(--mo-shake))}25%{translate:calc(-.7px*var(--mo-shake))calc(.22px*var(--mo-shake))}50%{translate:calc(.38px*var(--mo-shake))calc(.66px*var(--mo-shake))}75%{translate:calc(-.44px*var(--mo-shake))calc(-.6px*var(--mo-shake))}}.mo-root.mo-expr{--mo-morph:calc(.3s*var(--mo-rate,1));--mo-morph-ease:cubic-bezier(.45,.05,.5,1)}.mo-root:hover{--mo-amp:1;transition-duration:calc(.4s*var(--mo-rate,1)),calc(.22s*var(--mo-rate,1)),var(--mo-md);transform:translateY(-1.5px)scale(1.04)}.mo-root.mo-always{--mo-amp:1}.mo-breathe{animation-name:mo-breathe;animation-duration:calc(2.8s*var(--mo-rate,1));animation-delay:calc(var(--mo-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-direction:alternate;animation-timing-function:ease-in-out}@keyframes mo-breathe{to{transform:scaleX(calc(1 + .022*var(--mo-amp)))scaleY(calc(1 - .018*var(--mo-amp)))}}.mo-bob{translate:0 calc(var(--mo-bdy)*1px);animation-name:mo-bob;animation-duration:calc(3.4s*var(--mo-rate,1));animation-delay:calc(var(--mo-bob-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-direction:alternate;animation-timing-function:ease-in-out}@keyframes mo-bob{0%{transform:translateY(0)}to{transform:translateY(calc(-1.1px*var(--mo-amp)))}}.mo-eye{transform-box:view-box;--mo-sel:calc((var(--mo-wrap,1) + 1)/2);--mo-x:calc(var(--mo-esx) + var(--mo-esx2)*var(--mo-sel));--mo-y:calc(var(--mo-esy) + var(--mo-esy2)*var(--mo-sel));--mo-t:calc(var(--mo-tilt) + var(--mo-tilt2)*var(--mo-sel));--mo-ph:calc(var(--mo-sel)*(1 - var(--mo-rock)) + var(--mo-rock)*((1 + var(--mo-wrap,1)*var(--mo-rockp))/2));translate:calc(var(--mo-edx)*var(--mo-wrap,1)*1px)calc((var(--mo-edy) + var(--mo-edy2)*var(--mo-ph))*1px);rotate:calc((var(--mo-t)*var(--mo-wrap,1) - var(--mo-lean,0)*var(--mo-lock))*1deg);transform:rotate(calc(var(--mo-lean,0)*1deg))scaleX(var(--mo-x))scaleY(var(--mo-y))rotate(calc(var(--mo-lean,0)*-1deg));animation-name:mo-rock;animation-duration:calc(.9s*var(--mo-rate,1));animation-iteration-count:infinite;animation-timing-function:ease-in-out}@keyframes mo-rock{0%,to{--mo-rockp:1}50%{--mo-rockp:-1}}.mo-eye>*{transform-box:fill-box;transform-origin:center;animation-name:mo-blink,mo-wrap;animation-duration:calc(var(--mo-blink,4.8s)*var(--mo-rate,1)),calc(var(--mo-saccade,5.6s)*var(--mo-rate,1));animation-delay:calc(var(--mo-blink-phase,0s)*var(--mo-rate,1)),calc(var(--mo-saccade-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-timing-function:linear}@keyframes mo-blink{0%,97.2%{transform:rotate(calc(var(--mo-lean,0)*1deg))scaleY(1)rotate(calc(var(--mo-lean,0)*-1deg));animation-timing-function:ease-in}98.6%{transform:rotate(calc(var(--mo-lean,0)*1deg))scaleY(calc(1 - .92*var(--mo-amp)))rotate(calc(var(--mo-lean,0)*-1deg));animation-timing-function:ease-out}to{transform:rotate(calc(var(--mo-lean,0)*1deg))scaleY(1)rotate(calc(var(--mo-lean,0)*-1deg))}}.mo-eyes{animation-name:mo-saccade;animation-duration:calc(var(--mo-saccade,5.6s)*var(--mo-rate,1));animation-delay:calc(var(--mo-saccade-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-timing-function:linear}@keyframes mo-saccade{0%,15%{translate:0}16.5%,31%{translate:calc(-.8px*var(--mo-look-x,1.4)*var(--mo-amp))calc(-.9px*var(--mo-look-y,1.1)*var(--mo-amp))}32.5%,47%{translate:calc(1px*var(--mo-look-x,1.4)*var(--mo-amp))calc(.1px*var(--mo-look-y,1.1)*var(--mo-amp))}48.5%,63%{translate:calc(-.15px*var(--mo-look-x,1.4)*var(--mo-amp))calc(.85px*var(--mo-look-y,1.1)*var(--mo-amp))}64.5%,79%{translate:calc(.75px*var(--mo-look-x,1.4)*var(--mo-amp))calc(-.8px*var(--mo-look-y,1.1)*var(--mo-amp))}80.5%,98.5%{translate:calc(-1px*var(--mo-look-x,1.4)*var(--mo-amp))calc(-.15px*var(--mo-look-y,1.1)*var(--mo-amp))}to{translate:0}}@keyframes mo-wrap{0%,15%{scale:1;rotate:none}16.5%,31%{scale:calc(1 - .0176*var(--mo-look-mx,1.4)*var(--mo-amp) + .008*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .027*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(.648deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}32.5%,47%{scale:calc(1 - .022*var(--mo-look-mx,1.4)*var(--mo-amp) - .01*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .003*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(.09deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}48.5%,63%{scale:calc(1 - .0033*var(--mo-look-mx,1.4)*var(--mo-amp) + .0015*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .0255*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(-.115deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}64.5%,79%{scale:calc(1 - .0165*var(--mo-look-mx,1.4)*var(--mo-amp) - .0075*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .024*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(-.54deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}80.5%,98.5%{scale:calc(1 - .022*var(--mo-look-mx,1.4)*var(--mo-amp) + .01*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .0045*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(.135deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}to{scale:1;rotate:none}}@media not ((hover:hover) and (pointer:fine)){.mo-root:hover{--mo-amp:0;transform:none}.mo-root.mo-always{--mo-amp:1}.mo-root:not(.mo-always),.mo-root:not(.mo-always) *{animation-play-state:paused}.mo-root.mo-expr:not(.mo-always) .mo-eye{animation-play-state:running}}.mo-slow{--mo-rate:5}@media (prefers-reduced-motion:reduce){.mo-root,.mo-breathe,.mo-bob,.mo-eyes,.mo-eye,.mo-eye>*{animation:none;transition:none}.mo-bob>g:not(.mo-eyes){transition:none}}`

// Mascot display sizing, injected together with MOTION_CSS. The blobatar
// figure only fills ~70% of its 100 viewBox (it is composed for plated
// avatars), so at the raw 24px the creature reads ~17px — too small. The wide
// logo row has a 44px content box (60px row, 8px padding), the collapsed
// rail's toggle button is 36px: size the mascot to 36px / 28px accordingly.
const BRAND_CSS = `
.camind-brand-mascot{display:inline-flex;flex:none;line-height:0}
.camind-brand-mascot>svg{width:36px;height:36px}
.camind-brand-mascot.camind-brand-rail>svg{width:28px;height:28px}
`

const styles = {
  wide: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  wordmark: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '0.01em',
    color: 'var(--dsw-alias-label-primary)',
  },
  // deepseek-HARNESS 风格的反白徽章：底色/字色随主题反转
  badge: {
    display: 'inline-block',
    marginLeft: 2,
    padding: '1px 5px',
    borderRadius: 4,
    background: 'var(--dsw-alias-label-primary)',
    color: 'var(--dsw-alias-bg-base, var(--bg))',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    lineHeight: 1.5,
    verticalAlign: '1px',
  },
}

function Mascot({ rail }) {
  return h('span', {
    className: rail ? 'camind-brand-mascot camind-brand-rail' : 'camind-brand-mascot',
    dangerouslySetInnerHTML: { __html: MASCOT_SVG },
  })
}

function CamindBrand({ wide }) {
  if (!wide) return h(Mascot, { rail: true })
  return h('span', { style: styles.wide },
    h(Mascot, { rail: false }),
    h('span', { style: styles.wordmark },
      'Camind',
      h('span', { style: styles.badge }, 'Harness')))
}

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-ui-brand-motion', '')
    style.textContent = MOTION_CSS + BRAND_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  ctx.slots.inject('sidebar.brand', () =>
    ctx.slots.register({
      name: 'sidebar.brand',
    }, CamindBrand))
}

exports.name = 'ui-brand-client'
exports.inject = ['slots']
exports.apply = apply

return module.exports; } });
