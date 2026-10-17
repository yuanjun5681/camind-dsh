// Local drawing-viewer styles. Camind semantic tokens have official --dsw-alias fallbacks.
export const drawingCss = `
.cdv { position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-height:0;
  color:var(--camind-text-primary, var(--dsw-alias-text-primary)); background:var(--camind-bg-base, var(--dsw-alias-bg-base)); }
.cdv-meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; padding:6px 8px;
  font:12px/1.4 var(--camind-font-family, var(--dsw-alias-font-family)); color:var(--camind-text-secondary, var(--dsw-alias-text-secondary)); }
.cdv-meta strong { color:var(--camind-text-primary, var(--dsw-alias-text-primary)); font-weight:600; }
.cdv-badge { display:inline-flex; align-items:center; border:1px solid var(--camind-border-default, var(--dsw-alias-border-default));
  border-radius:4px; padding:1px 5px; color:var(--camind-text-warning, var(--dsw-alias-text-warning)); }
.cdv-error { margin:6px 8px; padding:8px; border:1px solid var(--camind-border-danger, var(--dsw-alias-border-danger));
  color:var(--camind-text-danger, var(--dsw-alias-text-danger)); background:var(--camind-bg-danger-subtle, var(--dsw-alias-bg-danger-subtle)); }
.cdv-missing { margin:0 8px 6px; color:var(--camind-text-warning, var(--dsw-alias-text-warning)); }
.cdv-canvas { position:relative; flex:1; min-height:240px; min-width:0; overflow:hidden; }
`
