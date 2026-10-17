// Local drawing-viewer styles using the foundation's real semantic tokens and official fallbacks.
export const drawingCss = `
.cdv { position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-height:0;
  color:var(--camind-color-text, var(--dsw-alias-label-primary));
  background:var(--camind-surface-page, var(--dsw-alias-background-base)); }
.cdv-meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; padding:6px 8px;
  font-size:12px; line-height:1.4; color:var(--camind-color-text-secondary, var(--dsw-alias-label-secondary)); }
.cdv-meta strong { color:var(--camind-color-text, var(--dsw-alias-label-primary)); font-weight:600; }
.cdv-badge { display:inline-flex; align-items:center; border:1px solid var(--camind-border-default, var(--dsw-alias-border-l2));
  border-radius:4px; padding:1px 5px; color:var(--camind-color-warning, var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary))); }
.cdv-error { margin:6px 8px; padding:8px; border:1px solid var(--camind-color-danger, var(--dsw-alias-state-error-primary));
  color:var(--camind-color-danger, var(--dsw-alias-state-error-primary)); background:var(--camind-surface-warning, transparent); }
.cdv-missing { margin:0 8px 6px; color:var(--camind-color-warning, var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary))); }
.cdv-body { position:relative; display:flex; flex:1; min-height:0; min-width:0; overflow:hidden; }
.cdv-body-adapted { display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto minmax(0,1fr); }
.cdv-body-adapted > .cdv-canvas { grid-column:1; grid-row:2; }
.cdv-canvas { position:relative; flex:1; min-height:240px; min-width:0; overflow:hidden; }
.cdv-canvas:focus-visible { outline:2px solid var(--camind-color-primary, var(--dsw-alias-state-business-primary)); outline-offset:-2px; }
/* The mirrored DraftPane uses fixed-dark panels; keep a fixed light foreground in both themes. */
.cdv-canvas > div:not(canvas) { color:#f5f5f5; }
`
