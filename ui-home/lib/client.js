// camind-ui-home browser bundle — new-session home for /camind.
// Brand assets come from camind-ui-brand; shared card chrome and semantic
// tokens come from camind-ui-foundation. This bundle owns only the home layout,
// example prompts, and the inputActions bridge into the official composer.
window.__ModuleLoader__.load({ id: 'camind-ui-home', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useEffect } = React
const { Card } = require('camind-ui-foundation')
const { BrandLockup } = require('camind-ui-brand')

const EXAMPLES = [
  { title: '解读加工程序', text: '读取我上传的数控加工程序，解释它的加工流程，并标出潜在的干涉与过切风险。' },
  { title: '总结上传文件', text: '总结本次上传文件的要点，列出其中的关键尺寸、公差与材料信息。' },
  { title: '沉淀工艺经验', text: '把这次讨论确认的加工参数与注意事项保存到记忆库，方便以后检索复用。' },
  { title: '检索记忆库', text: '在记忆库中检索与薄壁件加工变形控制相关的知识和经验。' },
]

const HOME_CSS = `
/* The official hero centers its own scroll body. The Camind home centers the
   brand + examples + workspace row + composer as one safe group instead. */
.official-home:has([data-camind-home]) { justify-content: safe center; overflow-y: auto; }
.official-home:has([data-camind-home]) .official-home-conversation { flex: none; height: auto; min-height: 0; }
.official-home:has([data-camind-home]) [data-phase="hero"] [data-conversation-scroll][data-conversation-scroll] { justify-content: flex-start; overflow: visible; }

/* Upstream has no seat for HeroShell. These hash-free structure anchors are
   an explicit dsh-upgrade checkpoint in docs/dsh-upgrade.md.
   0.2.0: HeroShell root is the composer stack's first child div (fish +
   headline + preview badge inside); the workspace row and composer bar are
   later siblings and stay visible. */
[data-phase="hero"] [data-composer-seat] [data-chain-overlay-fallback="conversation.composer"] > div > div:first-child { display: none; }

[data-camind-home] {
  display: flex; flex-direction: column; align-items: center;
  width: 100%; max-width: 748px; margin: 0 auto 30px; padding: 0 24px; text-align: center;
}
.camhome-examples {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 10px; width: 100%; margin-top: 26px;
}
.camhome-example { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; }
.camhome-example-title { font-size: 13px; font-weight: 600; color: var(--camind-color-text); }
.camhome-example-text {
  font-size: 12px; line-height: 20px; color: var(--camind-color-text-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
`

let official = null
let pendingDraft = null
let sessionInput = null

function pickExample(text) {
  if (sessionInput) {
    sessionInput.setDraft(text)
    return
  }
  pendingDraft = text
  official?.get('uiWorkspace')?.startSession()
}

function HomeHero() {
  return h('div', { 'data-camind-home': '' },
    h(BrandLockup, { variant: 'hero', tagline: 'Agent 助你驾驭 CAM 加工的复杂' }),
    h('div', { className: 'camhome-examples' },
      EXAMPLES.map((example) => h(Card, {
        key: example.title,
        className: 'camhome-example',
        onClick: () => pickExample(example.text),
      },
        h('span', { className: 'camhome-example-title' }, example.title),
        h('span', { className: 'camhome-example-text' }, example.text)))))
}

// Root-scope home content cannot reach the session input machine. This
// invisible session entry exposes the live blank composer's actions and applies
// a prompt stashed while no session existed, without overwriting a user draft.
// 0.2.0: the dock owner no longer carries inputActions; the entry's own inject
// factory resolves the session input facade (conversation.input.for(actx)).
function InputBridge({ session, input, setDraft }) {
  const hero = Boolean(session && session.blank && session.openState === 'open')
  useEffect(() => {
    if (!hero || !setDraft) return
    sessionInput = { setDraft }
    if (pendingDraft != null) {
      const text = pendingDraft
      pendingDraft = null
      if (!input || !input.draft) setDraft(text)
    }
    return () => { sessionInput = null }
  })
  return null
}

function apply(ctx) {
  official = ctx
  if (location.pathname === '/camind' || location.pathname.startsWith('/camind/')) {
    ctx.effect(() => {
      const style = document.createElement('style')
      style.setAttribute('data-camind-ui-home', '')
      style.textContent = HOME_CSS
      document.head.appendChild(style)
      return () => { style.remove() }
    }, 'ui-home: stylesheet')
  }

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
      inject: (sessionId) => {
        const actx = ctx.get('sessions')?.scope(sessionId)
        const input = actx?.get('conversation')?.input.for(actx)
        return input ? { setDraft: (text) => input.setDraft(text) } : {}
      },
    }, InputBridge))
}

exports.name = 'ui-home-client'
exports.inject = ['slots']
exports.apply = apply

return module.exports; } });
