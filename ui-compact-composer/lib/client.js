// Layout adapter for dsh 0.2.0-rc.2. The official editor, keymap and submit
// button remain mounted: never replace the draft, relay keystrokes or send RPCs.
window.__ModuleLoader__.load({ id: 'camind-ui-compact-composer', factory: require => {
  const React = require('react'), h = React.createElement
  const css = `
.wb-floating-composer[data-compact-layout]:not(.wb-composer-confirmation) { left:var(--wb-composer-center)!important; width:min(360px,var(--wb-composer-width))!important; transform:translateX(-50%); transition:width .18s ease; }
.wb-floating-composer[data-compact-layout][data-compact-expanded]:not(.wb-composer-confirmation),.wb-floating-composer[data-compact-layout][data-compact-draft]:not(.wb-composer-confirmation) { width:var(--wb-composer-width)!important; }
@media(prefers-reduced-motion:reduce) { .wb-floating-composer[data-compact-layout] { transition:none; } }

.wb-floating-composer:not(.wb-composer-confirmation) [data-compact-hidden] { display:none!important; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-composer-card] { display:grid!important; grid-template-columns:minmax(0,1fr) 34px; align-items:center; gap:6px; padding:5px 8px!important; width:100%; max-width:none; min-height:44px; border-radius:14px; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-compact-submit-path] { display:contents!important; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-compact-submit] { grid-column:2; grid-row:1; align-self:end; transform:none!important; width:32px!important; height:32px!important; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-input-scroll] { grid-column:1; grid-row:1; min-width:0; min-height:30px!important; height:auto!important; max-height:min(180px,30vh)!important; padding:0!important; overflow:auto!important; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-input-scroll] > div { min-height:30px!important; padding:0!important; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-composer-input] { min-height:30px!important; padding:5px 4px!important; font-size:14px; line-height:20px!important; white-space:pre-wrap!important; overflow-wrap:anywhere; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-composer-input] p { margin:0!important; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-composer-placeholder] { top:5px!important; left:4px!important; line-height:20px; font-size:14px; white-space:nowrap!important; overflow:hidden; text-overflow:ellipsis; }
.wb-floating-composer:not(.wb-composer-confirmation) [data-composer-card] > :not([data-input-scroll]):not([data-compact-submit-path]):not([data-compact-hidden]) { grid-column:1 / -1; }
.wb-compact-response { display:flex; align-items:center; gap:10px; height:44px; padding:0 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); box-shadow:0 4px 18px #0003; }
.wb-compact-response .wb-progress { width:8px; height:8px; flex:none; border-radius:50%; background:var(--dsw-alias-state-business-primary); }
.wb-compact-response span { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:13px; }
`
  function latestLine(text) { return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) || '' }
  function latestActivity(chat) {
    const nodes = chat?.nodes ?? [], start = nodes.findLastIndex(node => node.kind === 'user')
    const turn = chat?.partial?.turn ?? nodes[start]?.turn
    let activity = ''
    const blocks = list => { for (const block of list ?? []) {
      if (block.kind === 'text' && latestLine(block.text)) activity = latestLine(block.text)
      else if (block.kind === 'tool-call' && block.name) activity = `调用 ${block.name}`
    } }
    for (const node of nodes.slice(start + 1)) {
      if (node.kind === 'assistant') blocks(node.blocks)
      else if (node.kind === 'tool-result' && node.call?.name) activity = `${node.call.name} · ${node.isError ? '失败' : '已完成'}`
    }
    blocks(chat?.partial?.blocks)
    for (const call of chat?.runningCalls ?? []) {
      if (turn !== undefined && call.turn !== turn) continue
      if (chat?.partial && call.step < chat.partial.step) continue
      if (call.name) activity = `调用 ${call.name}`
    }
    return activity
  }
  function apply(ctx) {
    ctx.provide('compactComposer', { latestActivity,
      renderResponse({ state, dock }) {
        const text = state.activity ?? latestLine(state.text)
        if (!text) return null
        return h('section', { className: 'wb-agent wb-compact-response', style: dock, 'aria-label': 'Agent 当前响应' },
          h('i', { className: 'wb-progress', 'aria-hidden': true }),
          h('span', { role: 'status', title: text }, text))
      }
    })
    ctx.effect(() => {
      const style = document.createElement('style'); style.dataset.camindCompactComposer = ''; style.textContent = css; document.head.appendChild(style)
      const marked = new Set()
      const mark = (el, key) => { if (!el) return; el.setAttribute(`data-compact-${key}`, ''); marked.add(el) }
      const sync = () => {
        for (const el of marked) if (!el.isConnected) marked.delete(el)
        for (const seat of document.querySelectorAll('.wb-floating-composer')) {
          const card = seat.querySelector('[data-composer-card]'), scroll = card?.querySelector('[data-input-scroll]')
          if (!card || !scroll) continue // Unknown upstream structure: keep the full composer.
          const row = card.lastElementChild
          const buttons = row ? [...row.querySelectorAll('button')] : []
          const submit = buttons.at(-1)
          if (!submit || row === scroll || !row.contains(submit)) continue
          mark(seat, 'layout')
          seat.toggleAttribute('data-compact-draft', Boolean(card.querySelector('[data-composer-input]')?.textContent.trim()))
          mark(submit, 'submit')
          let branch = submit
          while (branch.parentElement && branch.parentElement !== card) {
            const parent = branch.parentElement
            for (const sibling of parent.children) if (sibling !== branch) mark(sibling, 'hidden')
            mark(parent, 'submit-path'); branch = parent
          }
          // Hide native task/accessory/context rows outside the input card.
          branch = card
          while (branch.parentElement && branch !== seat) {
            const parent = branch.parentElement
            for (const sibling of parent.children) if (sibling !== branch && !sibling.matches('[role="alert"], [role="status"]')) mark(sibling, 'hidden')
            branch = parent
          }
        }
      }
      const expand = event => {
        const seat = event.target.closest?.('.wb-floating-composer[data-compact-layout]')
        if (seat && (event.type === 'pointerdown' || event.relatedTarget)) mark(seat, 'expanded')
      }
      const collapse = event => {
        const seat = event.target.closest?.('.wb-floating-composer[data-compact-layout]')
        if (seat && !seat.contains(event.relatedTarget)) seat.removeAttribute('data-compact-expanded')
      }
      document.addEventListener('pointerdown', expand, true)
      document.addEventListener('focusin', expand, true)
      document.addEventListener('focusout', collapse, true)
      const observer = new MutationObserver(sync)
      observer.observe(document.body, { childList:true, characterData:true, subtree:true })
      sync()
      return () => { observer.disconnect(); style.remove(); document.removeEventListener('pointerdown', expand, true); document.removeEventListener('focusin', expand, true); document.removeEventListener('focusout', collapse, true); for (const el of marked) for (const key of ['hidden','submit','submit-path','layout','expanded','draft']) el.removeAttribute(`data-compact-${key}`) }
    })
  }
  return { name:'ui-compact-composer-client', inject:['slots'], apply, latestLine, latestActivity }
}})
