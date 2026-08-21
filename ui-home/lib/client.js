// camind-ui-home browser bundle — hand-written, no build step.
// New-session home for /camind's "/" route: the Camind brand block
// (blobatar mascot + wordmark, consistent with camind-ui-brand) with example
// prompt cards directly below it, layered ABOVE the official conversation
// through ui-shell's `shell.home` chain — the official workspace row, preset
// chip and composer stay untouched, so drafts/uploads/submission keep stock
// runtime behavior.
//
// Layout: the official hero self-centers inside its own scroll container
// (`[data-phase=hero] [data-conversation-scroll] { justify-content:center }`),
// which would leave a large gap under our brand block. HOME_CSS undoes that
// centering and vertically centers the OUTER column instead, so brand +
// examples + workspace row + composer read as ONE centered group (`safe
// center` keeps short viewports scrollable from the top).
//
// Draft flow: example clicks write the official composer through
// inputActions.setDraft. The root-scope home component cannot reach the input
// machine, so an invisible `conversation.input.dock` entry (InputBridge,
// session scope) exposes the live blank session's inputActions and applies
// the stashed prompt once the hero mounts. With no session at all the click
// stashes the prompt (pendingDraft) and calls workspaces.startSession() —
// the recent workspace's blank session connects and the bridge fills it in.
//
// The official HeroShell (fish logo + "探索未至之境" + preview badge) has no
// slot and locale re-registration throws (dsh-client-locale), so it is hidden
// by the structural selector in HOME_CSS — anchored on data-phase /
// data-composer-seat / data-chain-overlay-fallback only, never on hashed
// CSS-module classes. Re-verify after every dsh upgrade (docs/dsh-upgrade.md).
//
// MASCOT_SVG / MOTION_CSS are byte-identical copies of camind-ui-brand's frozen
// assets (ui-brand/lib/client.js) — keep both files in sync when the brand
// changes. Only platform seed modules may be required.
window.__ModuleLoader__.load({ id: "camind-ui-home", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useEffect } = React

const MASCOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="24" height="24" aria-hidden="true" style="--mo-phase:-2438ms;--mo-bob-phase:-1596ms;--mo-blink:4435ms;--mo-blink-phase:-3578ms;--mo-look-x:2.06;--mo-look-mx:2.06;--mo-look-y:1.41;--mo-look-my:1.41;--mo-saccade:7079ms;--mo-saccade-phase:-5919ms;--mo-head:#7ea5fd;--mo-eye:#0b0f18"><g class="mo-root mo-always"><g class="mo-breathe"><g class="mo-bob"><g fill="#7ea5fd"><path d="M85.21 50.6C85.21 73.67 72.78 85.76 49.06 85.76C25.35 85.76 12.91 73.67 12.91 50.6C12.91 27.53 25.35 15.43 49.06 15.43C72.78 15.43 85.21 27.53 85.21 50.6Z"/></g><g fill="#0b0f18" class="mo-eyes"><g class="mo-eye" style="--mo-wrap:-1;--mo-lean:3.95;transform-origin:38.69px 43.68px"><path d="M42.07 43.92C41.5 52.09 41.26 52.6 38.09 52.38C34.91 52.16 34.75 51.63 35.31 43.45C35.87 35.28 36.11 34.77 39.29 34.99C42.46 35.21 42.63 35.74 42.07 43.92Z"/></g><g class="mo-eye" style="--mo-wrap:1;--mo-lean:7.34;transform-origin:60.64px 45.05px"><path d="M64.14 45.5C62.92 54.98 62.63 55.56 59.34 55.13C56.05 54.71 55.92 54.08 57.14 44.6C58.36 35.12 58.65 34.54 61.94 34.97C65.23 35.39 65.36 36.02 64.14 45.5Z"/></g></g></g></g></g></svg>`

const MOTION_CSS = `@property --mo-amp{syntax:"<number>";inherits:true;initial-value:0}@property --mo-esx{syntax:"<number>";inherits:true;initial-value:1}@property --mo-esy{syntax:"<number>";inherits:true;initial-value:1}@property --mo-tilt{syntax:"<number>";inherits:true;initial-value:0}@property --mo-edy{syntax:"<number>";inherits:true;initial-value:0}@property --mo-edx{syntax:"<number>";inherits:true;initial-value:0}@property --mo-esx2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-esy2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-tilt2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-edy2{syntax:"<number>";inherits:true;initial-value:0}@property --mo-lock{syntax:"<number>";inherits:true;initial-value:0}@property --mo-shake{syntax:"<number>";inherits:true;initial-value:0}@property --mo-rock{syntax:"<number>";inherits:true;initial-value:0}@property --mo-rockp{syntax:"<number>";inherits:true;initial-value:1}@property --mo-bdy{syntax:"<number>";inherits:true;initial-value:0}.mo-root,.mo-breathe,.mo-bob{transform-box:view-box;transform-origin:center}.mo-root{--mo-amp:0;--mo-morph:calc(.4s*var(--mo-rate,1));--mo-morph-ease:ease-in-out;--mo-tp:--mo-esx,--mo-esy,--mo-tilt,--mo-edy,--mo-edx,--mo-esx2,--mo-esy2,--mo-tilt2,--mo-edy2,--mo-lock,--mo-shake,--mo-rock,--mo-bdy;--mo-md:var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph),var(--mo-morph);--mo-me:var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease),var(--mo-morph-ease);transition-property:--mo-amp,transform,var(--mo-tp);transition-duration:calc(.4s*var(--mo-rate,1)),calc(.16s*var(--mo-rate,1)),var(--mo-md);transition-timing-function:ease-out,cubic-bezier(.23,1,.32,1),var(--mo-me);animation:mo-shake calc(.112s*var(--mo-rate,1))linear infinite}.mo-bob>g:not(.mo-eyes){fill:var(--mo-head);transition:fill var(--mo-morph)var(--mo-morph-ease)}.mo-eyes{fill:var(--mo-eye);transition:fill var(--mo-morph)var(--mo-morph-ease)}@keyframes mo-shake{0%,to{translate:calc(.62px*var(--mo-shake))calc(-.34px*var(--mo-shake))}25%{translate:calc(-.7px*var(--mo-shake))calc(.22px*var(--mo-shake))}50%{translate:calc(.38px*var(--mo-shake))calc(.66px*var(--mo-shake))}75%{translate:calc(-.44px*var(--mo-shake))calc(-.6px*var(--mo-shake))}}.mo-root.mo-expr{--mo-morph:calc(.3s*var(--mo-rate,1));--mo-morph-ease:cubic-bezier(.45,.05,.5,1)}.mo-root:hover{--mo-amp:1;transition-duration:calc(.4s*var(--mo-rate,1)),calc(.22s*var(--mo-rate,1)),var(--mo-md);transform:translateY(-1.5px)scale(1.04)}.mo-root.mo-always{--mo-amp:1}.mo-breathe{animation-name:mo-breathe;animation-duration:calc(2.8s*var(--mo-rate,1));animation-delay:calc(var(--mo-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-direction:alternate;animation-timing-function:ease-in-out}@keyframes mo-breathe{to{transform:scaleX(calc(1 + .022*var(--mo-amp)))scaleY(calc(1 - .018*var(--mo-amp)))}}.mo-bob{translate:0 calc(var(--mo-bdy)*1px);animation-name:mo-bob;animation-duration:calc(3.4s*var(--mo-rate,1));animation-delay:calc(var(--mo-bob-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-direction:alternate;animation-timing-function:ease-in-out}@keyframes mo-bob{0%{transform:translateY(0)}to{transform:translateY(calc(-1.1px*var(--mo-amp)))}}.mo-eye{transform-box:view-box;--mo-sel:calc((var(--mo-wrap,1) + 1)/2);--mo-x:calc(var(--mo-esx) + var(--mo-esx2)*var(--mo-sel));--mo-y:calc(var(--mo-esy) + var(--mo-esy2)*var(--mo-sel));--mo-t:calc(var(--mo-tilt) + var(--mo-tilt2)*var(--mo-sel));--mo-ph:calc(var(--mo-sel)*(1 - var(--mo-rock)) + var(--mo-rock)*((1 + var(--mo-wrap,1)*var(--mo-rockp))/2));translate:calc(var(--mo-edx)*var(--mo-wrap,1)*1px)calc((var(--mo-edy) + var(--mo-edy2)*var(--mo-ph))*1px);rotate:calc((var(--mo-t)*var(--mo-wrap,1) - var(--mo-lean,0)*var(--mo-lock))*1deg);transform:rotate(calc(var(--mo-lean,0)*1deg))scaleX(var(--mo-x))scaleY(var(--mo-y))rotate(calc(var(--mo-lean,0)*-1deg));animation-name:mo-rock;animation-duration:calc(.9s*var(--mo-rate,1));animation-iteration-count:infinite;animation-timing-function:ease-in-out}@keyframes mo-rock{0%,to{--mo-rockp:1}50%{--mo-rockp:-1}}.mo-eye>*{transform-box:fill-box;transform-origin:center;animation-name:mo-blink,mo-wrap;animation-duration:calc(var(--mo-blink,4.8s)*var(--mo-rate,1)),calc(var(--mo-saccade,5.6s)*var(--mo-rate,1));animation-delay:calc(var(--mo-blink-phase,0s)*var(--mo-rate,1)),calc(var(--mo-saccade-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-timing-function:linear}@keyframes mo-blink{0%,97.2%{transform:rotate(calc(var(--mo-lean,0)*1deg))scaleY(1)rotate(calc(var(--mo-lean,0)*-1deg));animation-timing-function:ease-in}98.6%{transform:rotate(calc(var(--mo-lean,0)*1deg))scaleY(calc(1 - .92*var(--mo-amp)))rotate(calc(var(--mo-lean,0)*-1deg));animation-timing-function:ease-out}to{transform:rotate(calc(var(--mo-lean,0)*1deg))scaleY(1)rotate(calc(var(--mo-lean,0)*-1deg))}}.mo-eyes{animation-name:mo-saccade;animation-duration:calc(var(--mo-saccade,5.6s)*var(--mo-rate,1));animation-delay:calc(var(--mo-saccade-phase,0s)*var(--mo-rate,1));animation-iteration-count:infinite;animation-timing-function:linear}@keyframes mo-saccade{0%,15%{translate:0}16.5%,31%{translate:calc(-.8px*var(--mo-look-x,1.4)*var(--mo-amp))calc(-.9px*var(--mo-look-y,1.1)*var(--mo-amp))}32.5%,47%{translate:calc(1px*var(--mo-look-x,1.4)*var(--mo-amp))calc(.1px*var(--mo-look-y,1.1)*var(--mo-amp))}48.5%,63%{translate:calc(-.15px*var(--mo-look-x,1.4)*var(--mo-amp))calc(.85px*var(--mo-look-y,1.1)*var(--mo-amp))}64.5%,79%{translate:calc(.75px*var(--mo-look-x,1.4)*var(--mo-amp))calc(-.8px*var(--mo-look-y,1.1)*var(--mo-amp))}80.5%,98.5%{translate:calc(-1px*var(--mo-look-x,1.4)*var(--mo-amp))calc(-.15px*var(--mo-look-y,1.1)*var(--mo-amp))}to{translate:0}}@keyframes mo-wrap{0%,15%{scale:1;rotate:none}16.5%,31%{scale:calc(1 - .0176*var(--mo-look-mx,1.4)*var(--mo-amp) + .008*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .027*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(.648deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}32.5%,47%{scale:calc(1 - .022*var(--mo-look-mx,1.4)*var(--mo-amp) - .01*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .003*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(.09deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}48.5%,63%{scale:calc(1 - .0033*var(--mo-look-mx,1.4)*var(--mo-amp) + .0015*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .0255*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(-.115deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}64.5%,79%{scale:calc(1 - .0165*var(--mo-look-mx,1.4)*var(--mo-amp) - .0075*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .024*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(-.54deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}80.5%,98.5%{scale:calc(1 - .022*var(--mo-look-mx,1.4)*var(--mo-amp) + .01*var(--mo-look-x,1.4)*var(--mo-wrap,1)*var(--mo-amp))calc(1 - .0045*var(--mo-look-my,1.1)*var(--mo-amp));rotate:calc(.135deg*var(--mo-look-x,1.4)*var(--mo-look-y,1.1)*var(--mo-wrap,1)*var(--mo-amp))}to{scale:1;rotate:none}}@media not ((hover:hover) and (pointer:fine)){.mo-root:hover{--mo-amp:0;transform:none}.mo-root.mo-always{--mo-amp:1}.mo-root:not(.mo-always),.mo-root:not(.mo-always) *{animation-play-state:paused}.mo-root.mo-expr:not(.mo-always) .mo-eye{animation-play-state:running}}.mo-slow{--mo-rate:5}@media (prefers-reduced-motion:reduce){.mo-root,.mo-breathe,.mo-bob,.mo-eyes,.mo-eye,.mo-eye>*{animation:none;transition:none}.mo-bob>g:not(.mo-eyes){transition:none}}`

// Example prompts under the brand block. Click behavior: blank hero live ->
// setDraft straight into the official composer; no session -> stash +
// startSession() (recent workspace's blank session). Plain constants — edit
// freely.
const EXAMPLES = [
  { title: '解读加工程序', text: '读取我上传的数控加工程序，解释它的加工流程，并标出潜在的干涉与过切风险。' },
  { title: '总结上传文件', text: '总结本次上传文件的要点，列出其中的关键尺寸、公差与材料信息。' },
  { title: '沉淀工艺经验', text: '把这次讨论确认的加工参数与注意事项保存到记忆库，方便以后检索复用。' },
  { title: '检索记忆库', text: '在记忆库中检索与薄壁件加工变形控制相关的知识和经验。' },
]

const HOME_CSS = `
/* Group centering: the official hero scroll container self-centers its
   content; undo that (specificity must beat the official
   .root[data-phase=hero] .scrollBody rule, hence the doubled attribute) and
   center the outer column as one group instead. Only applies while the home
   entry is on screen (:has), and only at "/" — the entry renders nowhere
   else. */
.official-home:has([data-camind-home]) {
  justify-content: safe center;
  overflow-y: auto;
}
.official-home:has([data-camind-home]) .official-home-conversation {
  flex: none;
  height: auto;
  min-height: 0;
}
.official-home:has([data-camind-home]) [data-phase="hero"] [data-conversation-scroll][data-conversation-scroll] {
  justify-content: flex-start;
}

/* Slash menu / popupSelect open UPWARD from the composer (bottom-anchored
   absolute cards, up to 320px tall). Here the hero scroll body collapses to
   the composer stack's height, so its overflow-y:auto clips the popup to a
   one-row sliver. The scroll body never scrolls in hero phase (the outer
   .official-home is the scroller), so let it overflow visibly. Scoped to the
   home hero — official /web keeps its own clipping. */
.official-home:has([data-camind-home]) [data-phase="hero"] [data-conversation-scroll][data-conversation-scroll] {
  overflow: visible;
}

/* Hide the official hero chrome (fish logo + headline + preview badge). The
   chain fallback keeps the hero DOM mounted; the HeroShell block is the div
   right after the HeroGlow svg inside the composer stack. Structural hooks
   only — re-check on dsh upgrades. */
[data-phase="hero"] [data-composer-seat] [data-chain-overlay-fallback="conversation.composer"] > div > svg:first-child + div {
  display: none;
}

[data-camind-home] {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 748px;
  margin: 0 auto 30px;
  padding: 0 24px;
  text-align: center;
}
.fh-brand { display: inline-flex; align-items: center; gap: 16px; }
.fh-mascot { display: inline-flex; flex: none; line-height: 0; }
/* The mascot spans both text lines (title + tagline). The blobatar figure
   only fills ~70% of its 100 viewBox (composed for plated avatars), so the
   84px box reads ~59px — matching the two-line text stack. */
.fh-mascot > svg { width: 84px; height: 84px; }
.fh-text {
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 2px; text-align: left;
}
.fh-wordmark {
  font-size: 26px; font-weight: 600; letter-spacing: 0.01em; line-height: 1.3;
  color: var(--dsw-alias-label-primary);
}
.fh-badge {
  display: inline-block; margin-left: 4px; padding: 2px 6px; border-radius: 5px;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base, var(--bg));
  font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; line-height: 1.5; vertical-align: 2px;
}
.fh-tagline {
  color: var(--dsw-alias-label-secondary);
  font-size: 14px; line-height: 1.7;
}
.fh-examples {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 10px;
  width: 100%;
  margin-top: 26px;
}
.fh-example {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  text-align: left; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.fh-example:hover {
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-interactive-bg-hover);
}
.fh-example-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.fh-example-text {
  font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
`

// Client ctx captured at apply time (workspaces.startSession), the stashed
// prompt handed from the no-session screen to the bridge, and the live blank
// session's input actions while the hero is on screen.
let official = null
let pendingDraft = null
let sessionInput = null

function pickExample(text) {
  if (sessionInput) {
    sessionInput.inputActions.setDraft(text)
    return
  }
  pendingDraft = text
  // No-arg startSession connects the most recent workspace's blank session
  // (with zero workspaces it stays on the new-session view and the official
  // workspace row takes over); the bridge applies the stash once mounted.
  official?.workspaces.startSession()
}

function HomeHero() {
  return h('div', { 'data-camind-home': '' },
    h('div', { className: 'fh-brand' },
      h('span', { className: 'fh-mascot', dangerouslySetInnerHTML: { __html: MASCOT_SVG } }),
      h('span', { className: 'fh-text' },
        h('span', { className: 'fh-wordmark' }, 'Camind', h('span', { className: 'fh-badge' }, 'Harness')),
        h('span', { className: 'fh-tagline' }, 'Agent 助你驾驭 CAM 加工的复杂'))),
    h('div', { className: 'fh-examples' },
      EXAMPLES.map((ex) => h('button', {
        key: ex.title, type: 'button', className: 'fh-example',
        onClick: () => pickExample(ex.text),
      },
        h('span', { className: 'fh-example-title' }, ex.title),
        h('span', { className: 'fh-example-text' }, ex.text)))))
}

// Invisible session-scope bridge: while the blank hero is live it exposes the
// session's inputActions to the root-scope home component and applies any
// stashed prompt once (without overwriting an existing draft). Renders null.
function InputBridge({ session, input, inputActions }) {
  // Mirrors ConversationRoot's in-session hero condition
  // (dsh-client-ui-conversation: composerPhase "blank" once open).
  const hero = Boolean(session && session.composerPhase === 'blank' && session.openState === 'open')
  useEffect(() => {
    if (!hero) return
    sessionInput = { inputActions }
    if (pendingDraft != null) {
      const text = pendingDraft
      pendingDraft = null
      if (!input || !input.draft) inputActions.setDraft(text)
    }
    return () => { sessionInput = null }
  })
  return null
}

function apply(ctx) {
  official = ctx

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-ui-home', '')
    style.textContent = MOTION_CSS + HOME_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  ctx.slots.inject('shell.home', () =>
    ctx.slots.register({
      name: 'shell.home',
      priority: 100,
      select: ({ pathname }) => (pathname === '/' ? {} : null),
    }, HomeHero))

  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'camind-home-input-bridge',
      order: 20,
    }, InputBridge))
}

exports.name = 'ui-home-client'
exports.inject = ['slots', 'workspaces']
exports.apply = apply

return module.exports; } });
