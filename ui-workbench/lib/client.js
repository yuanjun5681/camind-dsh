// camind-ui-workbench browser bundle — hand-written, no build step.
// 一级 conversation.view 工作台：输入 / 交付物 / 加工 + 中央预览与 Agent 面板。
// /camind、官方 /web 与桌面端共享注册，缺失的正式规划能力用明确占位呈现。
// 数据源：ui-preview 的 /camind/api/preview/sessions/:id/files（上传/附件/桌面引用）+ tool-cam 的
// /camind/api/cam/runs（加工时间线）+ 官方 uiConversation 投影（交付物）。
// 预览按钮经 ui-preview 的 filePreview 服务留在工作台画布。
// 样式自含，token 走 --dsw-alias-*（不依赖 ui-shell/foundation）。
window.__ModuleLoader__.load({ id: "camind-ui-workbench", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

const React = require('react')
const { createElement: h, useEffect, useState, useRef } = React
const { Button, MarkdownText, IconGaugeOutlineRegular, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

const VIEW_ID = 'workbench'
const INPUTS_API = '/camind/api/preview/sessions'
const RUNS_API = '/camind/api/cam/runs'

// --- stylesheet ------------------------------------------------------------------

const benchCss = `
.wb-plan-dialog{width:min(1000px,calc(100vw - 48px));max-height:85vh;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);overflow:auto}.wb-plan-dialog::backdrop{background:#0005}.wb-table-scroll{overflow:auto}.wb-operation-table{width:100%;border-collapse:collapse;font-size:13px}.wb-operation-table th,.wb-operation-table td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}.wb-operation-table th{background:var(--dsw-alias-bg-layer-2);white-space:nowrap}.wb-scheme-summary dl{display:grid;grid-template-columns:100px 1fr;gap:8px}.wb-scheme-summary dd{margin:0;overflow-wrap:anywhere}.wb-workflow-actions{padding:12px 0}.wb-workflow-actions button{margin-right:8px}

[data-conversation-scroll]:has(.wb-main) { overflow:hidden; }
[data-slot="conversation.session"] > :has(> [data-slot="conversation.view"] > .wb-main) { flex:1 1 0; min-height:0; overflow:auto; }
.wb-main { display:flex; flex:1; flex-direction:column; height:100%; min-height:0; color:var(--dsw-alias-label-primary); container-type:inline-size; }
.wb-main * { box-sizing:border-box; }
.wb-main-head, .wb-agent header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-main-head > span, .wb-hint { font-size:12px; color:var(--dsw-alias-label-tertiary); }
.wb-scene { display:flex; flex:1; min-height:0; position:relative; }
.wb-left { width:260px; flex:none; border-right:1px solid var(--dsw-alias-border-l2); overflow:auto; }
.wb-inspector { width:240px; flex:none; border-left:1px solid var(--dsw-alias-border-l2); overflow:auto; }
.wb-canvas { display:flex; flex:1; min-width:0; min-height:0; overflow:auto; background:var(--dsw-alias-bg-layer-2); }
.wb-preview-stage { display:flex; flex:1; min-width:0; min-height:0; }
.wb-preview-stage[hidden] { display:none; }
.wb-placeholder { padding:24px; margin:auto; max-width:560px; line-height:1.7; }
.wb-placeholder h3 { margin:0 0 12px; font-size:16px; }
.wb-placeholder small { color:var(--dsw-alias-label-tertiary); }
.wb-agent { position:fixed; z-index:100; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); box-shadow:0 8px 28px #0003; }
.wb-floating-composer { position:fixed!important; z-index:100; padding:0!important; background:transparent!important; }
.wb-floating-composer::before,.wb-floating-composer::after { background:none!important; pointer-events:none; }
body:has(.wb-review) .wb-floating-composer { visibility:hidden; pointer-events:none; }
.wb-floating-composer.wb-composer-muted { visibility:hidden; pointer-events:none; }
.wb-agent .wb-response { padding:10px 12px; max-height:min(24vh,160px); }
.wb-agent .wb-progress { width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-label-primary); flex:none; }
.wb-agent details, .wb-hint { margin:8px 12px; }
.wb-response { max-height:100px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.6; padding:8px 0; }
.wb-agent header span { flex:1; font-size:12px; }
.wb-main .campv-view { min-height:0; }
@container (max-width:800px) { .wb-left { width:210px; } .wb-inspector { position:absolute; right:0; top:0; bottom:0; z-index:5; background:var(--dsw-alias-bg-base); box-shadow:0 2px 8px #0003; } }
@container (max-width:560px) { .wb-left { position:absolute; left:0; top:0; bottom:0; z-index:4; background:var(--dsw-alias-bg-base); } }
.wb-main { font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow:hidden; background:var(--dsw-alias-bg-base); }
.wb-main-head { min-height:48px; flex:none; padding:10px 16px; flex-wrap:nowrap; }
.wb-main-head > strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wb-view-controls { display:flex; gap:4px; flex:none; }
.wb-view-controls button,.wb-context-nav button { font:inherit; color:inherit; border:0; background:transparent; cursor:pointer; border-radius:6px; padding:8px; }
.wb-view-controls button:hover,.wb-context-nav button:hover { background:var(--dsw-alias-interactive-bg-hover); }
.wb-view-controls button[aria-pressed="true"],.wb-context-nav button[aria-pressed="true"] { color:var(--dsw-alias-state-business-primary); background:var(--dsw-alias-interactive-bg-hover); font-weight:600; }
.wb-view-controls button:disabled { opacity:.4; cursor:default; }
.wb-context-nav { order:2; width:48px; flex:none; display:flex; flex-direction:column; gap:6px; padding:8px 4px; border-left:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base); }
.wb-context-nav button { display:flex; align-items:center; justify-content:center; width:40px; height:40px; padding:10px; }
.wb-context-nav svg { width:20px; height:20px; }
.wb-file-heading { display:flex; align-items:center; gap:12px; min-width:0; }
.wb-file-heading strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wb-file-heading a { flex:none; font-size:12px; color:var(--dsw-alias-state-business-primary); text-decoration:none; }
.wb-canvas .cmv { position:relative; }
.wb-canvas .cmv-footer { position:absolute; bottom:0; left:0; right:0; z-index:2; color:#d5d9df; background:#1b1e24dd; border:0; padding:4px 12px; }
.wb-canvas .cmv-footer button { color:#d5d9df!important; }
.wb-phase { margin-left:auto; white-space:nowrap; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; padding:3px 8px; }
.wb-canvas { position:relative; overflow:hidden; }
.wb-context { width:380px; max-width:45%; min-height:0; flex:none; display:flex; flex-direction:column; border-left:1px solid var(--dsw-alias-border-l2); overflow:auto; background:var(--dsw-alias-bg-base); }
.wb-context-head { display:flex; flex:none; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-context-body { padding:16px; min-height:0; overflow:auto; }
.wb-confirmed-scheme { flex:1; overflow-wrap:anywhere; }
.wb-confirmed-scheme > p { margin:0 0 16px; }
.wb-confirmed-scheme dl { display:grid; grid-template-columns:72px minmax(0,1fr); gap:6px 12px; margin:10px 0; font-size:13px; }
.wb-confirmed-scheme dt { color:var(--dsw-alias-label-tertiary); }
.wb-confirmed-scheme dd { margin:0; min-width:0; }
.wb-scheme-station { border-top:1px solid var(--dsw-alias-border-l2); margin-top:20px; padding-top:12px; }
.wb-scheme-station h3 { margin:0 0 10px; }
.wb-scheme-operations { list-style:none; padding:0; margin:16px 0 0; }
.wb-scheme-operations li { border-top:1px solid var(--dsw-alias-border-l2); padding:14px 0; }
.wb-scheme-operation-head { display:flex; align-items:baseline; gap:10px; }
.wb-scheme-operation-head > span { color:var(--dsw-alias-label-tertiary); min-width:16px; }
.wb-scheme-operations summary { cursor:pointer; font-size:12px; color:var(--dsw-alias-label-secondary); }
.wb-workflow-compact { padding:0; flex:none; }
.wb-workflow-compact button { margin:0; }
.wb-context h3 { font-size:14px; }
.wb-context .wb-placeholder { margin:0; padding:12px; }
.wb-context .wb-body { padding:14px; }
.wb-question textarea,.wb-context input:not([type="checkbox"]),.wb-context textarea,.wb-context select,.wb-drawing-annotations input { width:100%; min-height:34px; padding:7px 9px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; font:inherit; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); }
.wb-main textarea { min-height:70px; resize:vertical; }
.wb-main input[type="checkbox"] { width:16px; height:16px; flex:none; accent-color:var(--dsw-alias-state-business-primary); }
.wb-main summary:focus-visible,.wb-main button:focus-visible,.wb-main input:focus-visible,.wb-main textarea:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
.wb-review-scrim { position:absolute; inset:0; z-index:6; display:grid; place-items:center; padding:24px; background:#0005; }
.wb-review { position:relative; width:min(800px,100%); height:min(640px,85%); max-height:100%; display:flex; flex-direction:column; min-height:0; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-base); box-shadow:0 6px 24px #0002; }
.wb-review:focus { outline:none; }
.wb-review-head { display:flex; align-items:center; gap:16px; padding:16px 20px; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-review-head > div { flex:1; }
.wb-review h2 { margin:0; font-size:18px; }
.wb-review-head p { margin:4px 0 0; font-size:12px; color:var(--dsw-alias-label-tertiary); }
.wb-review-body { flex:1; min-height:0; overflow:auto; padding:18px 24px; }
.wb-input-summary { display:flex; gap:24px; padding-bottom:16px; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-input-summary > div { display:flex; flex:1; min-width:0; flex-direction:column; gap:3px; }
.wb-input-summary span { overflow-wrap:anywhere; }
.wb-question { padding:18px 0; margin:0; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-question > strong { display:block; margin-bottom:10px; line-height:1.6; }
.wb-question p { margin:8px 0; }
.wb-check { display:flex; align-items:flex-start; gap:8px; }
.wb-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:10px; }
.wb-muted,.wb-input-summary small { color:var(--dsw-alias-label-tertiary); font-size:12px; }
.wb-evidence { color:var(--dsw-alias-label-secondary); font-size:13px; line-height:1.6; }
.wb-evidence small { color:var(--dsw-alias-state-business-primary); }
.wb-wizard-progress { flex:none; padding:12px 20px; }
.wb-wizard-progress > div { display:flex; justify-content:space-between; font-size:12px; }
.wb-wizard-progress span { color:var(--dsw-alias-label-secondary); }
.wb-wizard-progress progress { display:block; width:100%; height:4px; margin:8px 0 0; accent-color:var(--dsw-alias-state-business-primary); }
.wb-wizard-steps { flex:1; min-width:0; justify-content:center; display:flex; flex-wrap:wrap; gap:6px; max-height:80px; overflow:auto; }
.wb-wizard-steps button { flex:none; min-width:32px; height:30px; padding:0 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:transparent; color:inherit; cursor:pointer; }
.wb-wizard-steps button[aria-current="step"] { color:var(--dsw-alias-state-business-primary); border-color:currentColor; font-weight:600; }
.wb-wizard-question { display:flex; flex-direction:column; height:100%; min-height:0; }
.wb-wizard-question-content { flex:1; min-width:0; min-height:0; overflow:auto; padding:6px 8px 8px 6px; scrollbar-gutter:stable; }
.wb-wizard-recommendation { padding:12px; margin:12px 0; background:var(--dsw-alias-interactive-bg-hover); border-radius:6px; font-size:13px; line-height:1.7; }
.wb-wizard-recommendation p { margin:6px 0 0; }
.wb-wizard-question h3 { margin:16px 0; font-size:15px; line-height:1.7; }
.wb-wizard-question h3:focus,.wb-wizard-summary h3:focus { outline:none; }
.wb-wizard-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); flex:none; gap:8px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l2); }
.wb-wizard-options button,.wb-review-answers { margin-top:20px; }
.wb-review-answers summary { cursor:pointer; }
.wb-review-answers button { display:block; width:100%; text-align:left; padding:10px; margin:8px 0; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.wb-review-answers button strong,.wb-review-answers button span,.wb-review-answers button small { display:block; margin:4px 0; }
.wb-requirement-list section { padding:12px 0; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-requirement-list h4 { margin:0 0 8px; font-size:13px; }
.wb-requirement-list ul { list-style:none; padding:0; margin:0; }
.wb-requirement-list li { margin:8px 0; font-size:13px; line-height:1.7; overflow-wrap:anywhere; }
.wb-requirements-check { margin:18px 0; }
.wb-wizard-summary > button { width:100%; display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:12px 16px; text-align:left; font:inherit; color:inherit; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:transparent; cursor:pointer; }
.wb-wizard-options button:hover:not(:disabled),.wb-wizard-summary > button:hover { border-color:var(--dsw-alias-state-business-primary); background:var(--dsw-alias-interactive-bg-hover); }
.wb-wizard-options span { font-size:13px; line-height:1.7; color:var(--dsw-alias-label-secondary); }
.wb-wizard-options button:disabled { opacity:.5; cursor:default; }
.wb-wizard-custom { min-width:0; margin-top:16px; padding:2px; }
.wb-wizard-custom textarea { width:100%; min-height:90px; padding:10px; font:inherit; color:inherit; background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l2); border-radius:6px; }
.wb-wizard-custom textarea:focus-visible { outline-offset:-2px; border-color:var(--dsw-alias-state-business-primary); }
.wb-wizard-custom button { margin-top:10px; }
.wb-review-answers { margin-top:20px; }
.wb-review-answers summary { cursor:pointer; }
.wb-review-answers button { display:block; width:100%; text-align:left; padding:10px; margin:8px 0; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.wb-review-answers button strong,.wb-review-answers button span,.wb-review-answers button small { display:block; margin:4px 0; }
.wb-requirement-list section { padding:12px 0; border-bottom:1px solid var(--dsw-alias-border-l2); }
.wb-requirement-list h4 { margin:0 0 8px; font-size:13px; }
.wb-requirement-list ul { list-style:none; padding:0; margin:0; }
.wb-requirement-list li { margin:8px 0; font-size:13px; line-height:1.7; overflow-wrap:anywhere; }
.wb-requirements-check { margin:18px 0; }
.wb-wizard-summary > button { margin:10px 0; }
.wb-wizard-summary small { color:var(--dsw-alias-state-business-primary); }
.wb-review-foot { display:flex; justify-content:space-between; align-items:center; flex:none; gap:12px; padding:12px 20px; border-top:1px solid var(--dsw-alias-border-l2); }
.wb-review-foot > button { flex:none; }
.wb-review-foot span { font-size:12px; color:var(--dsw-alias-label-secondary); }
.wb-notice { margin:12px; font-size:13px; color:var(--dsw-alias-state-warn-primary); overflow-wrap:anywhere; }
.wb-drawing { display:flex; flex:1; width:100%; min-width:0; min-height:0; overflow:hidden; }
.wb-drawing-stage { position:relative; display:flex; flex:1; min-width:0; min-height:0; background:#23272e; }
.wb-drawing-controls { position:absolute; z-index:3; top:12px; left:12px; right:12px; display:flex; align-items:flex-start; flex-wrap:wrap; gap:8px; pointer-events:none; }
.wb-drawing-tools { display:flex; align-items:center; gap:2px; padding:4px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); box-shadow:0 2px 8px #0002; pointer-events:auto; }
.wb-drawing-tools button,.wb-drawing-tools summary { display:flex; align-items:center; justify-content:center; width:34px; height:34px; padding:7px; cursor:pointer; border-radius:6px; }
.wb-drawing-tools svg { width:20px; height:20px; }
.wb-drawing-tools button[aria-pressed="true"] { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-state-business-primary); }
.wb-drawing-tools details { position:relative; }
.wb-drawing-tools summary { list-style:none; }
.wb-drawing-tools summary::-webkit-details-marker { display:none; }
.wb-drawing-menu { position:absolute; top:42px; left:0; width:240px; max-width:calc(100vw - 100px); padding:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); box-shadow:0 4px 16px #0003; font-size:12px; }
.wb-drawing-menu label { display:flex; gap:8px; align-items:center; }
.wb-drawing-menu p { margin:10px 0 0; color:var(--dsw-alias-label-secondary); }
.wb-main-head { position:relative; z-index:4; }
.wb-preview-status { position:relative; flex:none; font-size:12px; font-weight:400; }
.wb-preview-status > summary { display:flex; align-items:center; gap:4px; padding:3px 7px; border:1px solid currentColor; border-radius:6px; color:var(--dsw-alias-state-warn-primary); cursor:pointer; list-style:none; white-space:nowrap; }
.wb-preview-status > summary::-webkit-details-marker { display:none; }
.wb-preview-popover { position:absolute; top:calc(100% + 8px); right:0; z-index:20; width:320px; max-width:calc(100vw - 32px); padding:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); box-shadow:0 4px 16px #0003; }
.wb-preview-popover p { margin:0 0 10px; overflow-wrap:anywhere; }
.wb-drawing-tools .wb-conversion-details summary { display:block; width:auto; height:auto; padding:8px 0; }
.wb-conversion-details { margin-top:8px; border-top:1px solid var(--dsw-alias-border-l2); }
.wb-conversion-details textarea { width:100%; min-height:100px; max-height:180px; padding:8px; border:1px solid var(--dsw-alias-border-l2); border-radius:4px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-secondary); font:11px/1.5 monospace; resize:vertical; }
.wb-drawing-menu { max-height:calc(100vh - 260px); overflow:auto; }
.wb-drawing-stage > .wb-notice { position:absolute; left:12px; bottom:80px; z-index:3; background:var(--dsw-alias-bg-base); padding:8px; }
.wb-drawing-svg { position:relative; touch-action:none; user-select:none; -webkit-user-select:none; cursor:grab; flex:1; min-width:0; min-height:0; overflow:hidden; }
.wb-drawing-svg:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:-2px; }
.wb-drawing-svg[data-dragging="true"] { cursor:grabbing; }
.wb-drawing-svg[data-box="true"] { cursor:crosshair; }
.wb-drawing-svg > svg { width:100%; height:100%; display:block; }
.wb-drawing-selection { position:absolute; pointer-events:none; border:1px solid #91bfff; background:#91bfff22; }
.wb-drawing-focus { position:absolute; pointer-events:none; border:1px solid #80d8ff; border-radius:3px; }
.wb-drawing-svg [data-drawing-target] { cursor:pointer; }
.wb-drawing-selected [stroke]:not([stroke="none"]) { stroke:#80d8ff!important; }
.wb-drawing-selected text { fill:#fff!important; }
.wb-current-target { position:fixed; z-index:101; display:flex; align-items:center; gap:8px; padding:6px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font-size:13px; }
.wb-current-target > span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wb-current-target button { flex:none; }
.wb-drawing-context-clear { display:inline-flex!important; width:18px!important; height:18px!important; padding:0!important; margin-left:3px; vertical-align:middle; }
.wb-drawing-annotations { display:flex; flex-direction:column; flex:none; width:300px; max-width:45%; min-height:0; padding:12px; border-left:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base); }
.wb-drawing-annotations header { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:12px; }
.wb-drawing-annotations h3 { font-size:14px; margin:0; }
.wb-drawing-annotations > p { font-size:12px; color:var(--dsw-alias-label-tertiary); margin:8px 0; }
.wb-drawing-annotation-list { overflow:auto; min-height:0; flex:1; }
.wb-drawing-annotation-list > button { display:block; text-align:left; width:100%; padding:10px 8px; margin:2px 0; border:0; border-bottom:1px solid var(--dsw-alias-border-l2); border-radius:4px; background:transparent; color:inherit; font:inherit; font-size:13px; cursor:pointer; overflow-wrap:anywhere; white-space:pre-wrap; }
.wb-drawing-annotation-list > button[aria-pressed="true"] { background:var(--dsw-alias-interactive-bg-hover); box-shadow:inset 3px 0 var(--dsw-alias-state-business-primary); }
.wb-drawing-annotations small { display:block; color:var(--dsw-alias-label-tertiary); font-size:11px; margin-top:4px; }
.wb-drawing-annotation-detail { flex:none; max-height:45%; overflow:auto; padding:12px 0 0; border-top:1px solid var(--dsw-alias-border-l2); font-size:12px; }
.wb-drawing-annotation-detail p { white-space:pre-wrap; overflow-wrap:anywhere; }
@container (max-width:736px) { .wb-drawing-annotations { position:absolute; right:0; top:0; bottom:0; width:300px; max-width:85%; z-index:4; } }
.wb-agent .wb-response { max-height:120px; }
@container (max-width:900px) { .wb-context { position:absolute; inset:0 48px 0 auto; width:340px; max-width:75%; z-index:8; box-shadow:-4px 0 16px #0002; } .wb-review-scrim { padding:16px; } .wb-review-head { padding:12px; flex-wrap:wrap; } .wb-review-body { padding:12px; } }

.wb { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
.wb *, .wb *::before, .wb *::after { box-sizing: border-box; }
.wb-tabs { flex: none; display: flex; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.wb-tab { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 8px; cursor: pointer; }
.wb-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wb-tab.active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); font-weight: 600; }
.wb-body { flex: 1; min-height: 0; overflow-y: auto; }
.wb-section { padding: 10px 12px; }
.wb-empty { padding: 28px 16px; font-size: 13px; line-height: 1.6; text-align: center; color: var(--dsw-alias-label-tertiary); }
.wb-facts { margin: 0 0 10px; display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; font-size: 12px; }
.wb-facts > div { display: contents; }
.wb-facts dt { color: var(--dsw-alias-label-tertiary); }
.wb-facts dd { margin: 0; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.wb-h3 { margin: 12px 0 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); font-weight: 600; }
.wb-file-list { display: flex; flex-direction: column; gap: 2px; }
.wb-file { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: left; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
.wb-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wb-file > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-file small { flex: none; color: var(--dsw-alias-label-tertiary); }
.wb-deliverable { display: flex; flex-direction: column; gap: 1px; min-width: 0; width: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; padding: 6px; border-radius: 6px; cursor: pointer; }
.wb-deliverable:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wb-deliverable-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-deliverable-dir { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.camrun-list { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; }
.camrun-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); padding: 10px 11px; }
.camrun-head { width: 100%; min-width: 0; display: flex; align-items: center; gap: 8px; }
.camrun-badge { flex: none; border-radius: 999px; padding: 2px 9px; font-size: 12px; line-height: 17px; }
.camrun-badge-ok { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.camrun-badge-warn { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
.camrun-badge-err { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.camrun-badge-muted { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }
.camrun-badge-run { color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent); }
.camrun-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.camrun-live { margin: 8px 0 0; color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 1.55; }
.camrun-tl { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
.camrun-tl > li { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 13px; }
.camrun-tl-time { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.camrun-tl-icon { flex: none; width: 13px; text-align: center; }
.camrun-tl > li[data-tone="ok"] .camrun-tl-icon { color: var(--dsw-alias-state-success-primary); }
.camrun-tl > li[data-tone="warn"] .camrun-tl-icon { color: var(--dsw-alias-state-warn-primary); }
.camrun-tl > li[data-tone="err"] .camrun-tl-icon { color: var(--dsw-alias-state-error-primary); }
.camrun-tl > li[data-tone="run"] .camrun-tl-icon { color: var(--dsw-alias-state-business-primary); }
.camrun-tl > li[data-tone="muted"] .camrun-tl-icon { color: var(--dsw-alias-label-tertiary); }
.camrun-tl-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow-wrap: anywhere; }
.camrun-tl-sub { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.camrun-tl-err { color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
.camrun-section-title { margin: 12px 0 6px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.camrun-facts { margin: 8px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; font-size: 12px; }
.camrun-facts > div { display: contents; }
.camrun-facts dt { color: var(--dsw-alias-label-tertiary); }
.camrun-facts dd { margin: 0; overflow-wrap: anywhere; }
.camrun-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.55; }
.camrun-warn { margin: 8px 0 0; color: var(--dsw-alias-state-warn-primary); font-size: 12px; line-height: 1.55; }
.camrun-files { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
.camrun-file { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.camrun-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.camrun-file small { flex: none; color: var(--dsw-alias-label-tertiary); }
.camrun-file-actions { flex: none; display: flex; gap: 8px; }
.camrun-file-actions a, .camrun-file-actions button { border: 0; padding: 0; background: transparent; color: var(--dsw-alias-state-business-primary); font-size: 12px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.camrun-file-actions button:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.camrun-op-list { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.camrun-op-list li { display: flex; align-items: baseline; gap: 7px; min-width: 0; font-size: 13px; }
.camrun-op-dot { width: 8px; height: 8px; flex: none; display: inline-block; border-radius: 50%; background: var(--dsw-alias-label-tertiary); align-self: center; }
.camrun-op-dot[data-status="ok"] { background: var(--dsw-alias-state-success-primary); }
.camrun-op-dot[data-status="generated"], .camrun-op-dot[data-status="empty"] { background: var(--dsw-alias-state-warn-primary); }
.camrun-op-dot[data-status="error"] { background: var(--dsw-alias-state-error-primary); }
.camrun-op-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.camrun-op-status { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.camrun-op-error { flex: none; max-width: 100%; color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
`

// --- shared helpers -----------------------------------------------------------------

let applyCtx = null

function previewService() {
  return applyCtx?.get('filePreview')
}

function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function basenameOf(p) {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return slash >= 0 ? p.slice(slash + 1) : p
}

function dirnameOf(p) {
  const t = String(p).replaceAll('\\', '/')
  const i = t.lastIndexOf('/')
  return i > 0 ? t.slice(0, i) : ''
}

function clockLabel(iso) {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleTimeString('zh-CN', { hour12: false })
}

function timeLabel(iso) {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

function durLabel(startIso, endIso) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

// --- 输入 tab ---------------------------------------------------------------------------

function InputTab({ sessionId }) {
  const sessions = applyCtx?.get('sessions')
  const row = sessions?.list.getSnapshot().byId[sessionId]
  const cwd = row?.cwd
  const running = row?.running === true
  const [state, setState] = useState({ phase: 'loading', files: [] })
  useEffect(() => {
    const controller = new AbortController()
    let timer
    setState({ phase: 'loading', files: [] })
    const refresh = async () => {
      try {
        const res = await fetch(`${INPUTS_API}/${encodeURIComponent(sessionId)}/files`, { headers: { Accept: 'application/json' }, signal: controller.signal })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
        if (!controller.signal.aborted) setState({ phase: 'ready', files: body.files ?? [] })
      } catch (error) {
        if (!controller.signal.aborted) setState({ phase: 'error', files: [], message: error instanceof Error ? error.message : String(error) })
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 3000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId])

  return h('div', { className: 'wb-section' },
    h('dl', { className: 'wb-facts' },
      h('div', null, h('dt', null, '工作目录'), h('dd', { title: cwd }, cwd || '未设置')),
      h('div', null, h('dt', null, '状态'), h('dd', null, running ? '运行中' : '空闲'))),
    h('h3', { className: 'wb-h3' }, '输入文件'),
    state.phase === 'loading' && h('div', { className: 'wb-empty' }, '读取输入文件…'),
    state.phase === 'error' && h('div', { className: 'wb-empty' }, `输入文件读取失败：${state.message}`),
    state.phase === 'ready' && (state.files.length === 0
      ? h('div', { className: 'wb-empty' }, '当前会话尚无上传文件或已发送的本地文件引用。')
      : h('div', { className: 'wb-file-list' }, state.files.map((file) => h('button', {
          type: 'button',
          key: file.path,
          className: 'wb-file',
          title: file.message || file.displayPath || file.path,
          disabled: file.available === false,
          onClick: () => previewService()?.preview(sessionId, file.path),
        }, h('span', null, file.name), h('small', null,
          file.available === false ? file.message : `${file.source === 'reference' ? '本地引用 · ' : ''}${bytesLabel(file.size)}`))))))
}

// --- 交付物 tab --------------------------------------------------------------------------

// DSH 0.2 records produced/presented files in turn data, not legacy tool call cards.
function deliverablesOfChat(chat) {
  const paths = new Set()
  for (const id of chat?.timeline.turnOrder ?? []) {
    const data = chat.timeline.turns.get(id)?.data.get('deliverables')
    for (const file of [...data?.produced ?? [], ...data?.presented ?? []]) {
      if (typeof file.path === 'string') paths.add(file.path)
    }
  }
  return [...paths]
}

function DeliverablesTab({ sessionId }) {
  const [paths, setPaths] = useState([])
  const [cam, setCam] = useState({ files: [], error: '' })
  useEffect(() => {
    let cancelled = false, timer
    const refresh = async () => {
      try {
        const result = await runsApi(sessionId)
        if (!cancelled) setCam({ files: (result.runs ?? []).flatMap(run => run.delivery.map(file => ({ ...file, runId: run.run_id }))), error: '' })
      } catch (error) { if (!cancelled) setCam({ files: [], error: error.message }) }
      finally { if (!cancelled) timer = setTimeout(refresh, 5000) }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionId])
  useEffect(() => {
    let dispose
    try {
      const binding = applyCtx?.get('uiConversation')?.binding(sessionId)
      if (!binding) return
      const source = binding.target('chat')
      const sync = () => setPaths(deliverablesOfChat(source.getSnapshot()))
      dispose = source.subscribe(sync)
      sync()
    } catch { /* 会话绑定未就绪时保持空列表 */ }
    return dispose
  }, [sessionId])

  return h('div', { className: 'wb-section' },
    cam.error && h('p', { role: 'alert' }, `CAM 文件列表读取失败：${cam.error}`),
    cam.files.length > 0 && h(React.Fragment, null, h('h3', { className: 'wb-h3' }, 'CAM 输出文件（不是放行结论）'),
      cam.files.map(file => h(DeliveryFileRow, { key: `${file.runId}/${file.name}`, sessionId, runId: file.runId, file }))),
    paths.length === 0 && cam.files.length === 0
      ? h('div', { className: 'wb-empty' }, '当前已加载的会话轮次还没有产出文件。')
      : h('div', { className: 'wb-file-list' }, paths.filter(p => !cam.files.some(file => p === `delivery/${file.runId}/${file.name}`)).map((p) => h('button', {
          type: 'button',
          key: p,
          className: 'wb-deliverable',
          title: p,
          onClick: () => previewService()?.preview(sessionId, p),
        },
          h('span', { className: 'wb-deliverable-name' }, basenameOf(p)),
          dirnameOf(p) ? h('span', { className: 'wb-deliverable-dir' }, `${dirnameOf(p)}/`) : null))))
}

// --- 加工 tab（自 tool-cam 迁入合并） ---------------------------------------------------------

const OVERALL_VIEW = {
  ok: { label: 'NC 生成完成', modifier: 'ok' },
  incomplete: { label: '含未决项', modifier: 'warn' },
  error: { label: '失败', modifier: 'err' },
  planned: { label: '未执行', modifier: 'muted' },
}
const RUNNING_VIEW = { label: '执行中', modifier: 'run' }
const OP_STATUS_LABELS = { ok: '完成', generated: '缺 NC', empty: '空刀路', error: '失败', skip: '跳过（沿用）', interrupted: '中断' }
const OP_TYPE_LABELS = { copy_postprocess: '模板复制', from_scratch_workpiece_op: '从零建工序' }
const STAGE_TEXT = {
  ensure_ready: '开工检查（CAM 工作站健康门禁）',
  upload: '上传零件到工作台',
  work_copy: '复制工作副本（主模型不被写）',
  prepare: '加工准备（建 CAM setup）',
  check: '收尾自检（NC 对账 + 空刀路）',
  production_check: '生产检查（部分覆盖，不能放行）',
  tool_numbers: '冻结刀号设置与回读',
  finalize: '保存并关闭本批次工作副本',
}
const TERMINAL_STAGES = new Set(['done', 'failed', 'aborted'])

function opStatusLabel(status) {
  return status === null ? '未执行' : OP_STATUS_LABELS[status] ?? status
}

function foldTimeline(history) {
  const rows = []
  const open = new Map()
  history.forEach((entry, i) => {
    const key = `h${i}`
    if (entry.stage === 'op' && typeof entry.index === 'number') {
      const name = entry.name ?? `op ${entry.index}`
      if (entry.status !== undefined) {
        const started = open.get(entry.index)
        if (started !== undefined) {
          started.status = entry.status
          started.endTs = entry.ts
          open.delete(entry.index)
        } else {
          rows.push({ key, kind: 'op', ts: entry.ts, index: entry.index, name, status: entry.status, endTs: entry.ts })
        }
      } else {
        const stale = open.get(entry.index)
        if (stale !== undefined) stale.status = 'interrupted'
        const row = { key, kind: 'op', ts: entry.ts, index: entry.index, name, action: entry.action }
        rows.push(row)
        open.set(entry.index, row)
      }
      return
    }
    rows.push({
      key, kind: 'stage', ts: entry.ts, stage: entry.stage,
      status: entry.status, total: entry.total, skipped: entry.skipped,
      failedStage: entry.failed_stage, msg: entry.msg,
    })
  })
  return rows
}

function stageRowView(row) {
  switch (row.stage) {
    case 'finalize':
      return { icon: row.status === 'ok' ? '✓' : '!', text: row.msg || STAGE_TEXT.finalize, tone: row.status === 'ok' ? 'ok' : 'warn' }
    case 'production_check':
      return { icon: '!', text: STAGE_TEXT.production_check, tone: 'warn' }
    case 'ops':
      return { icon: '✓', text: `开始逐序执行（共 ${row.total ?? '?'} 道）`, tone: 'ok' }
    case 'upload':
      return { icon: '✓', text: row.skipped === true ? '上传零件（proxy 侧已有，跳过）' : STAGE_TEXT.upload, tone: 'ok' }
    case 'done': {
      const view = OVERALL_VIEW[row.status ?? ''] ?? OVERALL_VIEW.planned
      return { icon: row.status === 'ok' ? '✓' : row.status === 'error' ? '✗' : '!', text: `执行完成：${view.label}`, tone: view.modifier }
    }
    case 'failed':
      return { icon: '✗', text: `失败于「${STAGE_TEXT[row.failedStage ?? ''] ?? row.failedStage ?? '?'}」：${row.msg ?? ''}`, tone: 'err' }
    case 'aborted':
      return { icon: '■', text: `已停止：${row.msg ?? ''}`, tone: 'warn' }
    default:
      return { icon: '✓', text: STAGE_TEXT[row.stage] ?? row.stage, tone: 'ok' }
  }
}

function opRowTone(status) {
  if (status === undefined) return 'run'
  if (status === 'ok') return 'ok'
  if (status === 'skip') return 'muted'
  if (status === 'error') return 'err'
  return 'warn'
}

function opRowIcon(status) {
  if (status === undefined) return '●'
  if (status === 'ok') return '✓'
  if (status === 'skip') return '−'
  if (status === 'error') return '✗'
  return '!'
}

async function runsApi(sessionId, runId) {
  const suffix = runId === undefined ? `?session=${encodeURIComponent(sessionId)}` : `/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}`
  const response = await fetch(RUNS_API + suffix, { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
  return body
}

function deliveryFileUrl(sessionId, runId, name) {
  return `${RUNS_API}/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}/delivery/${name.split('/').map(encodeURIComponent).join('/')}`
}

function DeliveryFileRow({ sessionId, runId, file }) {
  const isMarkdown = file.name.toLowerCase().endsWith('.md')
  return h('div', { className: 'camrun-file' },
    h('span', { className: 'camrun-file-name', title: file.name }, file.name),
    h('small', null, bytesLabel(file.bytes)),
    h('span', { className: 'camrun-file-actions' },
      isMarkdown && h('button', {
        type: 'button',
        title: '预览会话工作区镜像（镜像缺失时会报文件不存在，可改用下载）',
        onClick: () => previewService()?.preview(sessionId, `delivery/${runId}/${file.name}`),
      }, '预览'),
      h('a', { href: deliveryFileUrl(sessionId, runId, file.name) }, '下载')))
}

function NcToolpathButton({ sessionId, runId, name }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState()
  return h(React.Fragment, null,
    h('button', {
      type: 'button',
      disabled: busy,
      title: '在工作台画布查看刀路',
      onClick: () => {
        setBusy(true)
        setError(undefined)
        void fetch(deliveryFileUrl(sessionId, runId, `nc/${name}`), { headers: { Accept: 'text/plain' } })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            previewService()?.previewContent(sessionId, name, await response.text())
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false))
      },
    }, '查看刀路'),
    error !== undefined && h('span', { className: 'camrun-op-error' }, `读取失败：${error}`))
}

function Timeline({ rows, runstate, opsTotal, active, now }) {
  const lastKey = rows[rows.length - 1]?.key
  return h('ul', { className: 'camrun-tl' }, rows.map((row) => {
    const isLast = row.key === lastKey
    if (row.kind === 'stage') {
      const view = stageRowView(row)
      const running = active && isLast
      return h('li', { key: row.key, 'data-tone': running ? 'run' : view.tone },
        h('span', { className: 'camrun-tl-time' }, clockLabel(row.ts)),
        h('span', { className: 'camrun-tl-icon' }, running ? '●' : view.icon),
        h('span', { className: 'camrun-tl-body' }, h('span', null, running ? `${view.text}…` : view.text)))
    }
    const op = runstate?.ops?.[row.index]
    const running = row.status === undefined
    const duration = !running && row.endTs !== undefined ? durLabel(row.ts, row.endTs) : null
    const elapsed = running ? durLabel(row.ts, new Date(now).toISOString()) : null
    const timeout = typeof op?.timeout_seconds === 'number' ? `限时约 ${Math.max(1, Math.round(op.timeout_seconds / 60))} 分钟` : null
    return h('li', { key: row.key, 'data-tone': opRowTone(row.status) },
      h('span', { className: 'camrun-tl-time' }, clockLabel(row.ts)),
      h('span', { className: 'camrun-tl-icon' }, opRowIcon(row.status)),
      h('span', { className: 'camrun-tl-body' },
        h('span', null,
          `工序 ${row.index + 1}/${opsTotal} ${row.name}`,
          row.action === 'post' && '（补后处理）',
          row.action === 'full' && op?.type !== undefined && OP_TYPE_LABELS[op.type] !== undefined && `（${OP_TYPE_LABELS[op.type]}）`),
        h('span', { className: 'camrun-tl-sub' },
          running
            ? `计算中…${elapsed !== null ? ` 已运行 ${elapsed}` : ''}${timeout !== null ? ` · ${timeout}` : ''}`
            : `${opStatusLabel(row.status ?? null)}${duration !== null ? ` · ${duration}` : ''}`),
        row.status !== undefined && !['ok', 'skip', 'interrupted'].includes(row.status) && op?.error !== undefined && op.error !== ''
          && h('span', { className: 'camrun-tl-err' }, op.error),
        row.status === 'ok' && op?.nc_files !== undefined && op.nc_files.length > 0
          && h('span', { className: 'camrun-tl-sub' }, `NC：${op.nc_files.map(basenameOf).join('、')}`)))
  }))
}

function CamRunCard({ sessionId, run }) {
  const [detailState, setDetailState] = useState(null)
  useEffect(() => {
    let cancelled = false
    setDetailState((prev) => prev ?? { phase: 'loading' })
    void runsApi(sessionId, run.run_id).then((result) => {
      if (!cancelled) setDetailState({ phase: 'ready', detail: result.run })
    }).catch((error) => {
      if (!cancelled) setDetailState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [run.updated_at, run.run_id, sessionId])

  const detail = detailState?.phase === 'ready' ? detailState.detail : null
  const runstate = detail?.runstate ?? null
  const rows = runstate?.history !== undefined && runstate.history.length > 0 ? foldTimeline(runstate.history) : []
  const lastRow = rows[rows.length - 1]
  const active = rows.length > 0 && !(lastRow?.kind === 'stage' && TERMINAL_STAGES.has(lastRow.stage))
  const now = useNow(active ? 1000 : null)
  let runningOp
  if (active) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]
      if (row.kind === 'op' && row.status === undefined) { runningOp = row; break }
    }
  }

  const machine = run.machine.display_name ?? run.machine.id
  const partialChecks = runstate?.production_checks?.release_ready === false
  const overallView = active ? RUNNING_VIEW : partialChecks && run.overall === 'ok'
    ? { label: 'NC 已生成 · 检查未齐', modifier: 'warn' } : (OVERALL_VIEW[run.overall] ?? OVERALL_VIEW.planned)
  const opsTotal = runstate?.ops?.length ?? run.ops.length
  const runningOpTimeout = runningOp !== undefined ? runstate?.ops?.[runningOp.index]?.timeout_seconds : undefined
  const runningElapsed = runningOp !== undefined ? durLabel(runningOp.ts, new Date(now).toISOString()) : null
  const check = runstate?.check
  const checkWarn = check !== undefined
    && (check.listing_ok === false || (check.missing?.length ?? 0) > 0 || (check.empty_ops?.length ?? 0) > 0)

  return h('section', { className: 'camrun-card' },
    h('div', { className: 'camrun-head' },
      h('span', { className: `camrun-badge camrun-badge-${overallView.modifier}` }, overallView.label),
      h('span', { className: 'camrun-title', title: run.run_id }, run.run_id),
      h(Button, { type: 'button', disabled: !run.preview_available, title: run.preview_available ? '按工序检查模型与NC轨迹' : '此批次缺少源模型版本与完整工位变换，仍可单独查看NC', onClick: () => previewService()?.previewRun(sessionId, run.run_id) }, '加工检查')),
    h('dl', { className: 'camrun-facts' },
      run.part_id !== null && h('div', null, h('dt', null, '件号'), h('dd', null, run.part_id)),
      machine !== null && h('div', null, h('dt', null, '机床'), h('dd', null, machine)),
      detail?.post_name != null && h('div', null, h('dt', null, '后处理器'), h('dd', null, detail.post_name)),
      detail?.out_dir != null && h('div', null, h('dt', null, '输出目录'), h('dd', { title: detail.out_dir }, detail.out_dir)),
      h('div', null, h('dt', null, '更新'), h('dd', null, timeLabel(run.updated_at)))),
    active && h('p', { className: 'camrun-live' },
      runningOp !== undefined
        ? `正在执行工序 ${runningOp.index + 1}/${opsTotal} ${runningOp.name}`
          + (runningElapsed !== null ? ` · 已运行 ${runningElapsed}` : '')
          + (typeof runningOpTimeout === 'number' ? ` · 限时约 ${Math.max(1, Math.round(runningOpTimeout / 60))} 分钟` : '')
        : `正在执行：${lastRow?.kind === 'stage' ? (STAGE_TEXT[lastRow.stage] ?? lastRow.stage) : ''}…`),
    runstate?.cleanup?.status === 'pending' && h('p', { className: 'camrun-warn', role: 'status' }, `工作副本待处理：${runstate.cleanup.reason}。文件：${runstate.cleanup.work_copy}。NC 生成结果已保留。`),
    run.read_error !== undefined && h('p', { className: 'camrun-warn' }, run.read_error),
    !active && partialChecks && h('p', { className: 'camrun-warn', role: 'status' }, '生产检查仅部分覆盖，缺少完整夹具、真实刀柄、残料与工位回读等证据；仅可交付问题包，不能生产放行。'),
    run.overall === 'planned' && h('p', { className: 'camrun-note' }, '尚未执行——在会话中让 Agent 对该 run_id 调用 cam_run 首跑。'),
    !active && (run.overall === 'incomplete' || run.overall === 'error')
      && h('p', { className: 'camrun-note' }, '本 run 未全过——可让 Agent 以 cam_run（resume=true）续跑，run_id 不变。'),
    detailState?.phase === 'loading' && h('p', { className: 'camrun-note' }, '读取 run 详情…'),
    detailState?.phase === 'error' && h('p', { className: 'camrun-warn' }, `详情读取失败：${detailState.message}`),
    rows.length > 0 && h(Timeline, { rows, runstate, opsTotal, active, now }),
    detail !== null && rows.length === 0 && runstate?.ops !== undefined && runstate.ops.length > 0 && h(React.Fragment, null,
      h('p', { className: 'camrun-note' }, '本 run 由旧版本落盘（无过程时间线），仅工序终态：'),
      h('ul', { className: 'camrun-op-list' }, runstate.ops.map((op) => h('li', { key: op.index },
        h('span', { className: 'camrun-op-dot', 'data-status': op.status }),
        h('span', { className: 'camrun-op-name', title: op.type }, op.name),
        h('span', { className: 'camrun-op-status' }, opStatusLabel(op.status)),
        op.error !== undefined && op.error !== '' && h('span', { className: 'camrun-op-error' }, op.error))))),
    check !== undefined && h('p', { className: checkWarn ? 'camrun-warn' : 'camrun-note' },
      `自检：NC 对账 期望 ${check.expected ?? '?'} / 实数 ${check.found ?? '?'}`,
      (check.missing?.length ?? 0) > 0 ? `，缺 ${check.missing?.join('、')}` : '，一致',
      (check.empty_ops?.length ?? 0) > 0 && `；空刀路：${check.empty_ops?.join('、')}`,
      check.listing_ok === false && '（out_dir 列举失败，判不出）'),
    run.delivery.length > 0 && h('div', { className: 'camrun-files' },
      run.delivery.map((file) => h(DeliveryFileRow, { key: file.name, sessionId, runId: run.run_id, file }))),
    detail !== null && detail.nc_error !== undefined && h('p', { className: 'camrun-warn' }, detail.nc_error),
    detail !== null && detail.delivered && detail.nc_files.length > 0 && h(React.Fragment, null,
      h('h4', { className: 'camrun-section-title' }, `NC 程序（${detail.nc_files.length}）`),
      h('div', { className: 'camrun-files' }, detail.nc_files.map((name) => h('div', { key: name, className: 'camrun-file' },
        h('span', { className: 'camrun-file-name', title: name }, name),
        h('span', { className: 'camrun-file-actions' },
          h('a', { href: deliveryFileUrl(sessionId, run.run_id, `nc/${name}`) }, '下载'),
          h(NcToolpathButton, { sessionId, runId: run.run_id, name })))))))
}

function CamRunsTab({ sessionId }) {
  const [state, setState] = useState({ phase: 'loading', runs: [] })
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await runsApi(sessionId)
        if (!cancelled) setState({ phase: 'ready', runs: result.runs ?? [] })
      } catch (error) {
        if (!cancelled) setState({ phase: 'error', runs: [], message: error instanceof Error ? error.message : String(error) })
      }
    }
    setState({ phase: 'loading', runs: [] })
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId])

  if (state.phase === 'loading') return h('div', { className: 'wb-empty' }, '读取 CAM run 列表…')
  if (state.phase === 'error') return h('div', { className: 'wb-empty' }, `CAM run 列表读取失败：${state.message}`)
  if (state.runs.length === 0) {
    return h('div', { className: 'wb-empty' }, '本会话还没有 CAM run——cam_plan 落盘后出现在这里（数据源是 run 目录，与会话事件无关）。')
  }
  return h('div', { className: 'camrun-list' }, state.runs.map((run) => h(CamRunCard, { key: run.run_id, sessionId, run })))
}

// --- tab body + registration -----------------------------------------------------------

// shortcut: use the upstream internal store bridge until DSH exposes public view navigation.
function conversationStore(sessionId) {
  const slots = applyCtx?.slots
  const entry = slots?.entriesOfSlot('conversation.session')[0]
  const binding = applyCtx?.get('sessions')?.binding(sessionId)
  return entry && binding?.ctx ? slots.hostFace().storeOf(entry, { key: sessionId, ctx: binding.ctx }) : undefined
}

function openView(sessionId, view) {
  conversationStore(sessionId)?.actions?.setView(view)
  if (view === VIEW_ID) collapseLegacySidebar()
}

function collapseLegacySidebar() {
  const sidebar = applyCtx?.get('sidebarRight')
  const active = sidebar?.active()
  if (active?.kind === 'cam-workbench') sidebar.close(active.id)
  if (sidebar?.isExpanded()) sidebar.toggleExpanded()
}

function BenchHeaderButton({ sessionId }) {
  useEffect(() => {
    const controller = new AbortController()
    let timer
    const check = async () => {
      try {
        const store = conversationStore(sessionId)
        if (!store || store.getSnapshot().view !== null) return
        const response = await fetch(`${INPUTS_API}/${encodeURIComponent(sessionId)}/files`, { signal: controller.signal })
        if (!response.ok) return
        const body = await response.json()
        const newest = body.files?.filter(file => file.available !== false && /\.prt$/i.test(file.name)).pop()
        if (!controller.signal.aborted && store.getSnapshot().view === null && newest) { openView(sessionId, VIEW_ID); previewService()?.preview(sessionId, newest.path) }
      } catch { /* Keep manual navigation available if input discovery is unavailable. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(check, 3000) }
    }
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId])
  return h(Tooltip, { label: '打开加工工作台', delayMs: 500 },
    h(Button, {
      variant: 'ghost', size: 'sm', icon: h(IconGaugeOutlineRegular, { size: 14 }),
      onClick: () => openView(sessionId, VIEW_ID),
    }, '工作台'))
}

function sessionInput(sessionId) {
  const scope = applyCtx?.get('sessions')?.scope(sessionId)
  return scope?.get('conversation')?.input.for(scope)
}

function selectionClipboard(ref) {
  return `[CAM_SELECTION]\n${ref}\n[/CAM_SELECTION]`
}

async function addSelectionToDraft(sessionId, reference) {
  const input = sessionInput(sessionId)
  if (!input) throw new Error('原生输入框未就绪，请稍后重试')
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain') throw new Error('输入框正在提交或处理命令，请稍后添加引用')
  const ref = JSON.stringify({ session_id: sessionId, kind: reference.kind, path: reference.path,
    source_sha256: reference.source_sha256, geometry_sha256: reference.geometry_sha256, fids: reference.fids })
  if (state.occurrences.some(item => item.source === 'cam-selection' && item.ref === ref)) { input.focus(); return }
  // The native editor counts each chip as one detect character, not its clipboard expansion.
  const end = state.draft.length - state.occurrences.reduce((n, item) => n + item.length - 1, 0)
  const label = `${reference.fids.slice(0, 3).join('、')}${reference.fids.length > 3 ? ` 等 ${reference.fids.length} 面` : ''} · ${reference.source_sha256.slice(0, 8)}`
  if (!input.insertReference({ source: 'cam-selection', ref, label, appearance: 'file', clipboardText: selectionClipboard(ref) }, { start: end, end, draftRev: state.draftRev })) throw new Error('草稿已变更，请重新添加引用')
  input.focus()
}

const DRAWING_REFERENCE_SOURCE = 'cam-drawing-ref'
function drawingReferenceClipboard(ref) {
  return `[CAM_DRAWING_REFERENCE]\n${ref}\n[/CAM_DRAWING_REFERENCE]`
}
async function verifyDrawingReference(sessionId, reference, signal) {
  const response = await fetch(`/camind/api/drawings/sessions/${encodeURIComponent(sessionId)}/refs/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reference), signal,
  })
  const body = await response.json()
  if (!response.ok || !body.reference) throw new Error(body.message || '图纸引用核验失败')
  return body
}
async function addDrawingReferenceToDraft(sessionId, reference) {
  const input = sessionInput(sessionId)
  if (!input) throw new Error('原生输入框未就绪，请稍后重试')
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain') throw new Error('输入框正在提交或处理命令，请稍后添加引用')
  const { reference: verified } = await verifyDrawingReference(sessionId, reference)
  const ref = JSON.stringify(verified)
  if (state.occurrences.some(item => item.source === DRAWING_REFERENCE_SOURCE && item.ref === ref)) { input.focus(); return }
  const end = state.draft.length - state.occurrences.reduce((n, item) => n + item.length - 1, 0)
  const target = verified.target.type === 'dim' ? `尺寸 ${verified.target.id}` : `图元 ${verified.target.id}`
  const label = `${target} · ${verified.source.sha256.slice(0, 8)}`
  if (!input.insertReference({ source: DRAWING_REFERENCE_SOURCE, ref, label, appearance: 'file', clipboardText: drawingReferenceClipboard(ref) }, { start: end, end, draftRev: state.draftRev })) {
    throw new Error('草稿已变更，请重新添加引用')
  }
  input.focus()
}
function addPreviewReferenceToDraft(sessionId, reference) {
  return reference.kind === 'camind-drawing-ref'
    ? addDrawingReferenceToDraft(sessionId, reference)
    : addSelectionToDraft(sessionId, reference)
}

function CapabilityPlaceholder({ title, children }) {
  return h('section', { className: 'wb-placeholder' }, h('h3', null, title), h('p', null, children), h('small', null, '功能待接入 · 不参与加工放行'))
}

function composerViewportRect(canvasRect, stageRect, pending) {
  return !pending && stageRect?.width > 0 && stageRect?.height > 0 ? stageRect : canvasRect
}
function AgentPanel({ sessionId }) {
  const [state, setState] = useState({ running: false, streaming: false, text: '', pending: false })
  const [dock, setDock] = useState(null), [stopping, setStopping] = useState(false), [error, setError] = useState('')
  const panel = React.useRef(null)
  const [question, questionController] = useDrawingQuestion(sessionId)
  const clearTarget = () => { try { questionController.clear(); if (!state.running) sessionInput(sessionId)?.focus() } catch (e) { sessionInput(sessionId)?.notify('error', e.message) } }
  const chipHost = !state.running && question.hasChip ? document.querySelector('.wb-floating-composer [data-composer-chip="cam-drawing"]') : null
  const clearChip = chipHost ? require('react-dom').createPortal(h(Tooltip, { label: '清除当前提问对象', delayMs: 400 },
    h(Button, { className: 'wb-drawing-context-clear', 'aria-label': '清除当前提问对象', onPointerDown: e => e.preventDefault(), onClick: e => { e.preventDefault(); e.stopPropagation(); clearTarget() } }, '×')), chipHost) : null
  const badge = dock && question.active && (state.running || !question.hasChip) && !state.pending ? h('div', { className: 'wb-current-target', style: { ...dock, bottom: dock.bottom + 58 }, role: 'status' },
    h('span', { title: question.active.label }, `${state.running ? '下一次提问' : '针对'}：${question.active.label}`),
    h(Button, { 'aria-label': '清除当前提问对象', onClick: clearTarget }, '×')) : null
  const withBadge = node => require('react-dom').createPortal(h(React.Fragment, null, clearChip, badge, node), document.body)
  useEffect(() => {
    const sessions = applyCtx?.get('sessions')
    const source = applyCtx?.get('uiConversation')?.binding(sessionId).target('chat')
    const sync = () => {
      const chat = source?.getSnapshot()?.legacy
      const nodes = chat?.nodes ?? [], lastUser = nodes.findLastIndex(node => node.kind === 'user')
      const latest = chat?.partial ?? nodes.slice(lastUser + 1).findLast(node => node.kind === 'assistant')
      const submitting = sessionInput(sessionId)?.state.getSnapshot().phase === 'submitting'
      setState({ activity: submitting ? '' : applyCtx?.get('compactComposer')?.latestActivity(chat), submitting, running: sessions?.list.getSnapshot().byId[sessionId]?.running === true || submitting, streaming: Boolean(chat?.partial),
        pending: Boolean(applyCtx?.get('uiSession')?.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction),
        text: (submitting ? [] : latest?.blocks ?? []).filter(block => block.kind === 'text').map(block => block.text).join('\n') })
    }
    const disposeConversation = source?.subscribe(sync)
    sync()
    const disposeSessions = sessions?.list.subscribe(sync)
    const disposeInput = sessionInput(sessionId)?.state.subscribe(sync)
    const disposeStatus = applyCtx?.get('uiSession')?.sessionStatus.subscribe(sync)
    return () => { disposeConversation?.(); disposeSessions?.(); disposeInput?.(); disposeStatus?.() }
  }, [sessionId])
  useEffect(() => {
    if (!state.running) { setStopping(false); setError('') }
    const main = document.querySelector('.wb-main')
    const content = main?.closest('[data-conversation-content]')
    const seat = content?.querySelector('[data-composer-seat]')
    if (!main || !content || !seat) return
    const previous = seat.getAttribute('style')
    seat.classList.add('wb-floating-composer')
    seat.classList.toggle('wb-composer-muted', state.running && !state.pending)
    seat.classList.toggle('wb-composer-confirmation', state.pending)
    const measure = () => {
      const canvas = main.querySelector('.wb-canvas')
      const stage = canvas?.querySelector('.wb-preview-stage:not([hidden]) .cmv-stage, .wb-preview-stage:not([hidden]) .wb-drawing-stage')
      const rect = composerViewportRect((canvas || content).getBoundingClientRect(), stage?.getBoundingClientRect(), state.pending)
      const side = main.querySelector('.wb-context')?.getBoundingClientRect()
      const right = side && side.left > rect.left && side.left < rect.right ? side.left : rect.right
      const available = right - rect.left, width = Math.max(0, Math.min(760, available - 32))
      const next = { left: rect.left + (available - width) / 2, width, bottom: Math.max(16, window.innerHeight - rect.bottom + 16) }
      seat.style.setProperty('--wb-composer-center', `${rect.left + available / 2}px`)
      seat.style.setProperty('--wb-composer-width', `${width}px`)
      Object.assign(seat.style, { left: `${next.left}px`, width: `${next.width}px`, bottom: `${next.bottom}px` })
      setDock(old => old && old.left === next.left && old.width === next.width && old.bottom === next.bottom ? old : next)

    }
    const observer = new ResizeObserver(measure)
    observer.observe(content); observer.observe(main);
    const canvas = main.querySelector('.wb-canvas')
    const observeViewport = () => {
      observer.disconnect(); observer.observe(content); observer.observe(main)
      if (canvas) observer.observe(canvas)
      const stage = canvas?.querySelector('.cmv-stage'); if (stage) observer.observe(stage)
      measure()
    }
    const mutation = new MutationObserver(observeViewport)
    if (canvas) mutation.observe(canvas, { childList: true, subtree: true })
    observeViewport()
    window.addEventListener('resize', measure); measure()
    return () => { observer.disconnect(); mutation.disconnect(); window.removeEventListener('resize', measure); seat.classList.remove('wb-floating-composer', 'wb-composer-muted', 'wb-composer-confirmation'); previous === null ? seat.removeAttribute('style') : seat.setAttribute('style', previous) }
  }, [sessionId, state.running, state.pending])
  if (!state.running || !dock || state.pending) return badge || clearChip ? withBadge(null) : null // Keep official confirmation cards visible.
  const compact = applyCtx?.get('compactComposer')
  if (compact) return withBadge(compact.renderResponse({ state, dock }))
  return withBadge(h('section', { ref: panel, className: 'wb-agent', style: dock, 'aria-label': 'Agent 当前响应' },
    h('header', null, h('i', { className: 'wb-progress', 'aria-hidden': true }), h('strong', null, 'Agent'),
      h('span', { role: 'status' }, stopping ? '正在请求停止' : state.streaming ? '公开回复生成中' : '处理中'),
      h(Button, { disabled: stopping, title: '停止 Agent 当前响应；后台 NX 加工需另行停止', onClick: async () => {
        setStopping(true); setError('')
        try { await applyCtx.get('sessions').scope(sessionId).get('conversation').cancel() }
        catch (e) { setStopping(false); setError(e.message || '停止失败，请重试') }
      } }, '停止')),
    h('div', { className: 'wb-response', 'aria-live': 'polite', 'aria-atomic': false }, state.text ? h(MarkdownText, { text: state.text }) : '正在等待公开输出…'),
    error && h('p', { className: 'wb-hint', role: 'alert' }, error)))
}

const TASK_API = '/camind/api/cam/tasks'
async function taskApi(sessionId, action = '', args) {
  const response = await fetch(`${TASK_API}/${encodeURIComponent(sessionId)}${action ? `/${action}` : ''}`, args ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) } : {})
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`)
  return body.data
}
function useFormalTask(sessionId) {
  const [task, setTask] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    setTask(null); setError('')
    const refresh = async () => { try { const next = await taskApi(sessionId); if (!next.review) throw new Error('请完整退出桌面应用并重新启动，以加载新版接件服务'); if (!cancelled) { setTask(old => old?.version >= next.version ? old : next); setError('') } } catch (e) { if (!cancelled) setError(e.message) } }
    void refresh(); const timer = setInterval(refresh, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId])
  const act = async (action, args) => {
    setBusy(true); setError('')
    try { const next = await taskApi(sessionId, action, { version: task?.version, ...args }); setTask(next); return next }
    catch (e) { setError(e.message); throw e }
    finally { setBusy(false) }
  }
  return { task, error, busy, act }
}
function WizardQuestion({ record, question, draft, setDraft, next }) {
  const pair = question.id === 'input_pair', answer = record.task.answers[question.id]
  const [custom, setCustom] = useState(false), saving = useRef(false)
  const recommendation = pair ? '我已核对两个文件的版本与加工范围对应' : typeof question.recommendation === 'string' ? question.recommendation : question.recommendation ? JSON.stringify(question.recommendation) : ''
  const save = async (value, resolved) => {
    if (record.busy || saving.current) return
    saving.current = true
    try { await record.act('answer', { id: question.id, value, resolved }); next() }
    catch { /* Keep this question and custom draft; shared error is rendered below. */ }
    finally { saving.current = false }
  }
  return h('section', { className: 'wb-wizard-question' },
    h('div', { className: 'wb-wizard-question-content' },
    pair && h('div', { className: 'wb-input-summary' }, ['prt', 'dwg'].map(role => h('div', { key: role }, h('strong', null, role.toUpperCase()), h('span', null, record.task.inputs[role]?.name || '尚未归档'), h('small', null, record.task.inputs[role]?.sha256.slice(0, 12))))), h('h3', { tabIndex: -1, 'data-wizard-title': true }, question.prompt),
    question.reason && h('p', { className: 'wb-evidence' }, question.reason),
    answer && h('p', { className: 'wb-muted' }, answer.resolved ? `已确认：${pair ? recommendation : answer.value}` : `已暂存：${answer.value}`),
    recommendation && h('div', { className: 'wb-wizard-recommendation' }, h('strong', null, '建议'), h('p', null, recommendation)),
    custom && h('form', { className: 'wb-wizard-custom', onSubmit: event => {
      event.preventDefault()
      if (draft.trim() && draft.trim() !== '暂不确定') void save(draft.trim(), !pair)
    } },
      pair && h('p', { className: 'wb-muted' }, '文件对应关系的补充意见会保留为未决；核对完成后请选择“已核对，对应”。'),
      h('textarea', { autoFocus: true, 'aria-label': '其他建议或补充', placeholder: '填写你的意见或补充信息', value: draft, onChange: event => setDraft(event.target.value) }),
      h(Button, { type: 'submit', variant: 'primary', disabled: record.busy || !draft.trim() || draft.trim() === '暂不确定' }, '保存并继续'))),
    h('div', { className: 'wb-wizard-options' },
      h('button', { type: 'button', disabled: record.busy || !recommendation, onClick: () => save(pair ? 'confirm' : recommendation, true) },
        h('strong', null, pair ? '已核对，对应' : '使用建议'), h('span', null, recommendation ? '保存并进入下一题' : '暂无建议，请补充回答')),
      h('button', { type: 'button', disabled: record.busy, onClick: () => save('暂不确定', false) }, h('strong', null, '暂不确定'), h('span', null, '保存为未决项，继续下一题')),
      h('button', { type: 'button', disabled: record.busy, 'aria-expanded': custom, onClick: () => setCustom(true) }, h('strong', null, '其他建议或补充'), h('span', null, '填写自己的意见'))))
}

function TaskWizard({ sessionId, record, close, complete }) {
  const dialog = useRef(null), dismiss = useRef(close)
  dismiss.current = close
  const task = record.task
  const questions = [{ id: 'input_pair', prompt: '模型与图纸是否对应本次加工范围？' }, ...(task?.questions ?? []).filter(q => !q.scope || q.scope === 'review')]
  const [selected, setSelected] = useState(() => questions.find(q => !task?.answers[q.id]?.resolved)?.id || '__summary')
  const [drafts, setDrafts] = useState({})
  const [requirementIds, setRequirementIds] = useState(null), [requirementsChecked, setRequirementsChecked] = useState(false)
  const requirementItems = task?.requirement_summary?.draft ?? []
  const selectedRequirements = requirementIds ?? requirementItems.map(item => item.id)
  useEffect(() => { setRequirementIds(null); setRequirementsChecked(false) }, [task?.requirement_summary?.fingerprint])
  const index = questions.findIndex(q => q.id === selected), summary = index < 0
  const question = questions[index], answered = questions.filter(q => task?.answers[q.id]).length, confirmed = questions.filter(q => task?.answers[q.id]?.resolved).length
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [sessionId])
  useEffect(() => {
    const body = dialog.current?.querySelector('.wb-review-body')
    if (body) body.scrollTop = 0
    dialog.current?.querySelector('[data-wizard-title]')?.focus()
  }, [selected])
  if (!task) return null
  const go = id => { if (!record.busy) setSelected(id) }
  const next = () => setSelected(questions[index + 1]?.id || '__summary')
  const extraBlockers = task.review.blockers.filter(text => !questions.some(q => q.prompt === text) && !text.includes('版本和加工范围'))
  return h('section', { ref: dialog, className: 'wb-review', role: 'dialog', 'aria-modal': true, tabIndex: -1, 'aria-label': '接件审图确认', onKeyDown: event => {
      if (event.key === 'Escape' && !record.busy) { event.stopPropagation(); dismiss.current(); return }
      if (event.key !== 'Tab') return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')].filter(el => el.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
    } },
    h('header', { className: 'wb-review-head' }, h('div', null, h('h2', null, '核对本次审图结果'), h('p', null, '逐项确认后回到模型工作区。后续编程方案单独审核。')),
      h(Button, { disabled: record.busy, onClick: close }, '保存并稍后继续')),
    h('div', { className: 'wb-wizard-progress' },
      h('div', { role: 'status' }, summary ? '核对确认结果' : `第 ${index + 1} / ${questions.length} 题`, h('span', null, `已处理 ${answered}/${questions.length} · 已确认 ${confirmed}`)),
      h('progress', { max: questions.length, value: answered, 'aria-label': '问题处理进度' })),
    h('div', { className: 'wb-review-body' },
      summary ? h('section', { className: 'wb-wizard-summary' }, task.review_changes?.length > 0 && h('section', { className: 'wb-notice' }, h('strong', null, '与上次确认相比发生变化'), h('ul', null, task.review_changes.map(change => h('li', { key: change.id }, `原内容：${change.before || '无'}；本次：${change.after || '已移除'}`)))), h('h3', { tabIndex: -1, 'data-wizard-title': true }, '核对本次加工要求'),
        h('p', { className: 'wb-muted' }, '取消不应纳入的条目。确认后，右侧仅显示勾选内容；补充约定中的待提供资料不代表已核实事实。'),
        h(RequirementList, { items: requirementItems, selected: selectedRequirements, disabled: record.busy, onSelect: (id, checked) => { setRequirementIds(old => { const ids = old ?? requirementItems.map(item => item.id); return checked ? [...ids, id] : ids.filter(value => value !== id) }); setRequirementsChecked(false) } }),
        !requirementItems.length && h('p', { className: 'wb-notice' }, '尚无可确认的要求；请先整理加工要求，若服务未更新请重启桌面。'),
        h('label', { className: 'wb-check wb-requirements-check' }, h('input', { type: 'checkbox', disabled: record.busy || !selectedRequirements.length, checked: requirementsChecked, onChange: event => setRequirementsChecked(event.target.checked) }), '我已核对以上勾选的加工要求和补充约定'),
        h('details', { className: 'wb-review-answers' }, h('summary', null, '查看确认回答'),
        questions.map((q, i) => h('button', { key: q.id, disabled: record.busy, onClick: () => go(q.id) },
          h('strong', null, `${i + 1}. ${q.prompt}`),
          h('span', { className: 'wb-muted' }, task.answers[q.id]?.resolved ? `已确认：${q.id === 'input_pair' ? '模型与图纸版本及加工范围对应' : task.answers[q.id].value}` : task.answers[q.id] ? `待确认：${task.answers[q.id].value}` : '尚未回答'), h('small', null, '查看 / 修改')))),
        extraBlockers.length > 0 && h('div', { className: 'wb-notice' }, h('strong', null, '其他未决事项'), h('ul', null, extraBlockers.map(text => h('li', { key: text }, text)))))
      : h(WizardQuestion, { key: `${task.revision}/${question.id}/${JSON.stringify(question)}`, record, question,
          draft: drafts[question.id] ?? (task.answers[question.id]?.value !== 'confirm' && task.answers[question.id]?.value !== '暂不确定' ? task.answers[question.id]?.value : '') ?? '',
          setDraft: value => setDrafts(old => ({ ...old, [question.id]: value })), next }),
      record.error && h('p', { role: 'alert', className: 'wb-notice' }, record.error)),
    h('footer', { className: 'wb-review-foot' },
      h(Button, { disabled: record.busy || (!summary && index === 0), onClick: () => go(questions[summary ? questions.length - 1 : index - 1].id) }, '上一题'),
      h('nav', { className: 'wb-wizard-steps', 'aria-label': '确认步骤' }, questions.map((q, i) => h('button', { key: q.id, disabled: record.busy, 'aria-current': selected === q.id ? 'step' : undefined, title: q.prompt, 'aria-label': `第 ${i + 1} 题：${task.answers[q.id]?.resolved ? '已确认' : task.answers[q.id] ? '待确认' : '未回答'}`, onClick: () => go(q.id) }, `${i + 1}${task.answers[q.id]?.resolved ? ' ✓' : task.answers[q.id] ? ' ?' : ''}`)),
        h('button', { disabled: record.busy, 'aria-current': summary ? 'step' : undefined, onClick: () => go('__summary') }, '汇总')),
      summary ? h(Button, { variant: 'primary', disabled: record.busy || Boolean(task.review.blockers.length) || !requirementsChecked || !selectedRequirements.length, onClick: async () => {
        try { await record.act('finish-review', { fingerprint: task.review.fingerprint, requirement_ids: selectedRequirements }); complete() } catch { /* Keep summary open with the error. */ }
      } }, '完成确认') : h(Button, { disabled: record.busy, onClick: () => go(questions[index + 1]?.id || '__summary') }, index === questions.length - 1 ? '查看汇总' : '下一题')))
}
function sanitizeDwgSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('SVG 转换结果不合法')
  const tags = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect', 'text', 'tspan', 'title', 'desc'])
  const attrs = new Set(['id', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'fill-rule', 'font-size', 'font-family', 'text-anchor', 'dominant-baseline', 'preserveAspectRatio'])
  let count = 0
  function clean(node) {
    if (++count > 20000) throw new Error('图纸预览节点超过 20000，暂不显示')
    const style = node.getAttribute('style')
    if (style) for (const declaration of style.split(';')) {
      const colon = declaration.indexOf(':'); if (colon < 0) continue
      const key = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim()
      if (attrs.has(key) && !/url\s*\(|javascript:|data:|\\\\/i.test(value)) node.setAttribute(key, value)
    }
    for (const child of [...node.children]) { if (!tags.has(child.localName) || child.namespaceURI !== 'http://www.w3.org/2000/svg') child.remove(); else clean(child) }
    for (const attr of [...node.attributes]) {
      if ((attr.localName === 'href') && /^#[A-Za-z0-9_-]+$/.test(attr.value) && node.localName === 'use') continue
      if (!attrs.has(attr.name) || /url\s*\(|javascript:|data:|\\\\/i.test(attr.value)) node.removeAttributeNode(attr)
    }
  }
  clean(doc.documentElement)
  doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(doc.documentElement)
}
// Brighten only unreadable colors; raw attributes remain available for original-color mode.
function drawingDisplayColor(value) {
  const rgb = value.match(/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/)?.slice(1).map(Number)
  if (!rgb) return value
  const luminance = values => values.map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
  const background = luminance([35, 39, 46])
  let result = rgb
  for (let step = 0; step <= 20; step++) {
    result = rgb.map(v => Math.round(v + (255 - v) * step / 20))
    if ((luminance(result) + .05) / (background + .05) >= 4.5) break
  }
  return `rgb(${result.join(', ')})`
}
function drawingAnnotationLabel(entity) {
  if (entity.kind === 'text' || entity.kind === 'dimension') return entity.text?.trim() || '图纸文字'
  // shortcut: strip known inline display codes only; full MTEXT layout remains in the converter.
  const text = String(entity.text || '').replace(/\\[ACFHQTWacfhqtw][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '')
  return text.replace(/[{}]/g, '').trim() || `图纸标称 ${entity.nominal ?? '未读取'}`
}
function DrawingIcon({ name }) {
  const paths = { minus: 'M5 12h14', plus: 'M5 12h14M12 5v14', fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M7 7h10v10H7z', box: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 12h8M12 8v8', annotations: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', more: 'M5 12h.01M12 12h.01M19 12h.01' }
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] }))
}
function DrawingTool({ name, label, ...props }) {
  return h(Tooltip, { label, delayMs: 400 }, h(Button, { ...props, 'aria-label': label }, h(DrawingIcon, { name })))
}
// ViewBox always matches the viewport aspect ratio: screen/world transforms stay exact.
function mountDrawingViewport(host, onBoxMode, onError, onPick, onClear, targets = []) {
  const svg = host.querySelector('svg'), selection = document.createElement('div'), frame = document.createElement('div')
  selection.className = 'wb-drawing-selection'; selection.hidden = true; host.append(selection)
  frame.className = 'wb-drawing-focus'; frame.hidden = true; host.append(frame)
  for (const target of targets) for (const id of target.entity_ids) {
    if (Number.isSafeInteger(id)) { const node = svg.querySelector(`[id="dwg-e-${id}"]`); if (node) node.dataset.drawingTarget = target.id }
  }
  const oldBackground = svg.querySelector(':scope > rect[fill="#23272e"]')
  if (oldBackground && oldBackground.getAttribute('x') === svg.getAttribute('viewBox')?.split(/\s+/)[0]) oldBackground.remove()
  for (const node of svg.querySelectorAll('[stroke-width]')) {
    const width = Number(node.getAttribute('stroke-width'))
    if (Number.isFinite(width) && width > 0) node.style.strokeWidth = `max(${width}px, var(--wb-min-stroke, 0px))`
  }
  const colors = [...svg.querySelectorAll('[fill],[stroke]')].flatMap(node => ['fill', 'stroke'].filter(attr => node.hasAttribute(attr) && node.getAttribute(attr) !== 'none').map(attr => ({ node, attr, raw: node.getAttribute(attr), readable: drawingDisplayColor(getComputedStyle(node)[attr]) })))
  let bounds, drag, boxMode = false, fitted = false, size, selectedTarget, selectedBox
  const paintFrame = () => {
    if (!selectedBox || !host.clientWidth || !host.clientHeight) { frame.hidden = true; return }
    const matrix = svg.getScreenCTM(), r = host.getBoundingClientRect()
    const a = new DOMPoint(selectedBox.x, selectedBox.y).matrixTransform(matrix), b = new DOMPoint(selectedBox.x + selectedBox.width, selectedBox.y + selectedBox.height).matrixTransform(matrix)
    Object.assign(frame.style, { left: `${a.x - r.left - 6}px`, top: `${a.y - r.top - 6}px`, width: `${b.x - a.x + 12}px`, height: `${b.y - a.y + 12}px` }); frame.hidden = false
  }
  const view = () => { const b = svg.viewBox.baseVal; return { x: b.x, y: b.y, width: b.width, height: b.height } }
  const set = b => {
    if (!Object.values(b).every(Number.isFinite) || b.width <= 0 || b.height <= 0) return
    svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`)
    // Keep fine lines legible without converting world-space dash lengths into screen pixels.
    const matrix = svg.getScreenCTM(), scale = Math.hypot(matrix.a, matrix.b)
    if (scale > 0) svg.style.setProperty('--wb-min-stroke', `${.85 / scale}px`)
    paintFrame()
  }
  const screenPoint = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(svg.getScreenCTM().inverse()) }
  const setBox = value => { boxMode = value; host.dataset.box = String(value); onBoxMode(value) }
  const finish = () => { const pointer = drag?.pointerId; drag = null; selection.hidden = true; host.dataset.dragging = 'false'; if (pointer !== undefined && host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer) }
  const fitBox = (b, safe = true, minScale = 0) => {
    const r = host.getBoundingClientRect(); if (!r.width || !r.height) return
    const toolbar = host.parentElement.querySelector('.wb-drawing-controls')?.getBoundingClientRect()
    const top = safe ? Math.min(toolbar ? toolbar.bottom - r.top + 16 : 64, r.height / 3) : 16
    const composer = host.closest('.wb-main')?.querySelector('.wb-floating-composer')?.getBoundingClientRect()
    const bottom = safe ? Math.min(r.height / 3, Math.max(72, composer?.height + 32 || 0)) : 16
    const scale = Math.max(minScale, Math.max(b.width, .001) / Math.max(1, r.width - 32), Math.max(b.height, .001) / Math.max(1, r.height - top - bottom)) * 1.04
    const width = r.width * scale, height = r.height * scale
    set({ x: b.x + b.width / 2 - width / 2, y: b.y + b.height / 2 - (top + (r.height - top - bottom) / 2) * scale, width, height })
    fitted = true; size = { width: r.width, height: r.height }
  }
  const fit = () => {
    try {
      // SVG text metrics can round differently at different zoom levels; fit uses one stable extent.
      bounds ||= svg.getBBox()
      if (!(bounds.width > 0 || bounds.height > 0)) throw new Error('图纸没有可显示的内容')
      fitBox(bounds); onError('')
    } catch (error) { onError(error.message) }
  }
  const zoom = (factor, clientX, clientY) => {
    if (!fitted) return
    const r = host.getBoundingClientRect(), b = view()
    const p = screenPoint(clientX ?? r.left + r.width / 2, clientY ?? r.top + r.height / 2)
    const min = Math.max(bounds.width, bounds.height, 1) / 10000, max = Math.max(bounds.width, bounds.height, 1) * 100
    factor = Math.max(min / b.width, Math.min(max / b.width, factor))
    set({ x: p.x - (p.x - b.x) * factor, y: p.y - (p.y - b.y) * factor, width: b.width * factor, height: b.height * factor })
  }
  const highlight = (target, reveal = false) => {
    selectedTarget = target; selectedBox = null; frame.hidden = true
    for (const node of svg.querySelectorAll('.wb-drawing-selected')) node.classList.remove('wb-drawing-selected')
    const r = host.getBoundingClientRect()
    if (!target || !r.width || !r.height) return
    if (!fitted) fit()
    const nodes = target.entity_ids.map(id => Number.isSafeInteger(id) && svg.querySelector(`[id="dwg-e-${id}"]`)).filter(Boolean)
    if (nodes.length !== target.entity_ids.length || !nodes.length) return
    const inverse = svg.getCTM().inverse(), points = []
    for (const node of nodes) {
      const b = node.getBBox(), m = inverse.multiply(node.getCTM())
      for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) points.push(new DOMPoint(x, y).matrixTransform(m))
      node.classList.add('wb-drawing-selected')
    }
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
    selectedBox = { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y }
    paintFrame()
    if (reveal) {
      const f = frame.getBoundingClientRect()
      if (f.left < r.left + 16 || f.right > r.right - 16 || f.top < r.top + 68 || f.bottom > r.bottom - 100 || f.width < 80 || f.height < 24) {
        const fontHeight = Math.max(0, ...nodes.flatMap(node => [...node.querySelectorAll('text')].map(text => Number(text.getAttribute('font-size')) || 0)))
        // A tiny dimension label should become readable, not fill the whole screen.
        fitBox(selectedBox, true, Math.max(fontHeight / 22, Math.max(bounds.width, bounds.height) / 3000))
      }
    }
  }
  const down = e => {
    if (![0, 1].includes(e.button) || drag || !fitted) return
    e.preventDefault(); host.focus({ preventScroll: true })
    drag = { pointerId: e.pointerId, button: e.button, target: e.target.closest('[data-drawing-target]')?.dataset.drawingTarget, x: e.clientX, y: e.clientY, point: screenPoint(e.clientX, e.clientY), b: view(), box: boxMode && e.button === 0 }
    host.dataset.dragging = String(!drag.box); host.setPointerCapture(e.pointerId)
  }
  const move = e => {
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    const r = host.getBoundingClientRect()
    if (drag.box) {
      Object.assign(selection.style, { left: `${Math.min(e.clientX, drag.x) - r.left}px`, top: `${Math.min(e.clientY, drag.y) - r.top}px`, width: `${Math.abs(e.clientX - drag.x)}px`, height: `${Math.abs(e.clientY - drag.y)}px` }); selection.hidden = false
    } else {
      const scale = drag.b.width / r.width
      set({ ...drag.b, x: drag.b.x - (e.clientX - drag.x) * scale, y: drag.b.y - (e.clientY - drag.y) * scale })
    }
  }
  const up = e => {
    if (!drag || drag.pointerId !== e.pointerId) return
    if (drag.box) {
      if (Math.abs(e.clientX - drag.x) > 6 && Math.abs(e.clientY - drag.y) > 6) {
        const p = screenPoint(e.clientX, e.clientY)
        fitBox({ x: Math.min(p.x, drag.point.x), y: Math.min(p.y, drag.point.y), width: Math.abs(p.x - drag.point.x), height: Math.abs(p.y - drag.point.y) }, false)
      }
      setBox(false)
    } else if (drag.button === 0 && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4 && drag.target) onPick?.(drag.target)
    finish()
  }
  const cancel = () => { finish(); setBox(false) }
  const wheel = e => { e.preventDefault(); if (drag) return; const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1); zoom(Math.exp(Math.max(-.5, Math.min(.5, delta * (e.ctrlKey ? .01 : .002)))), e.clientX, e.clientY) }
  const key = e => {
    if (e.target !== host) return
    if (e.key === 'Escape') { e.preventDefault(); const wasBox = boxMode; cancel(); if (!wasBox) onClear?.() }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (['f', 'F', '+', '=', '-'].includes(e.key)) { e.preventDefault(); if (e.key.toLowerCase() === 'f') fit(); else zoom(e.key === '-' ? 1.3 : 1 / 1.3) }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && fitted) {
        e.preventDefault(); const b = view(), step = b.width / host.clientWidth * (e.shiftKey ? 120 : 40)
        set({ ...b, x: b.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y: b.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) })
      }
    }
  }
  let lastMiddle = 0
  const middle = e => { if (e.button !== 1) return; e.preventDefault(); const now = Date.now(); if (now - lastMiddle < 350) { cancel(); fit(); lastMiddle = 0 } else lastMiddle = now }
  const events = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, wheel, keydown: key, auxclick: middle }
  for (const [name, handler] of Object.entries(events)) host.addEventListener(name, handler, { passive: false })
  const observer = new ResizeObserver(() => {
    const r = host.getBoundingClientRect(); if (!r.width || !r.height) return
    if (!fitted) { fit(); highlight(selectedTarget); return }
    if (size && (size.width !== r.width || size.height !== r.height)) {
      const b = view(), scale = b.width / size.width, width = r.width * scale, height = r.height * scale
      set({ x: b.x + (b.width - width) / 2, y: b.y + (b.height - height) / 2, width, height }); size = { width: r.width, height: r.height }
    }
    highlight(selectedTarget)
  })
  observer.observe(host)
  return { fit, zoom, highlight, box: () => { finish(); setBox(!boxMode); host.focus() },
    colors: original => colors.forEach(({ node, attr, raw, readable }) => node.setAttribute(attr, original ? raw : readable)),
    dispose: () => { finish(); observer.disconnect(); selection.remove(); frame.remove(); for (const [name, handler] of Object.entries(events)) host.removeEventListener(name, handler) } }
}
function DrawingPreviewStatus({ info, showDetails }) {
  if (info.status === 'ready') return null
  return h('details', { className: 'wb-preview-status', onToggle: e => {
    if (!e.currentTarget.open) return
    const panel = e.currentTarget.querySelector('.wb-preview-popover'), anchor = e.currentTarget.getBoundingClientRect(), main = e.currentTarget.closest('.wb-main').getBoundingClientRect()
    const width = Math.min(320, main.width - 24)
    panel.style.width = `${width}px`; panel.style.right = 'auto'
    panel.style.left = `${Math.max(main.left + 12, Math.min(anchor.left, main.right - width - 12)) - anchor.left}px`
  }, onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.open = false; e.currentTarget.querySelector('summary').focus() } } },
    h('summary', null, h('span', { 'aria-hidden': true }, '⚠'), info.status === 'fallback' ? '已使用兼容预览' : '预览有缺失'),
    h('div', { className: 'wb-preview-popover' }, info.messages.map((text, i) => h('p', { key: i }, text)),
      h(Button, { onClick: e => { e.currentTarget.closest('details').open = false; showDetails() } }, '查看转换详情')))
}
function DrawingConversionDetails({ info, detailsRef }) {
  return h('details', { ref: detailsRef, className: 'wb-conversion-details' }, h('summary', null, '转换详情'),
    info.status === 'ready' && !info.omissions.length && h('p', null, '已完成图纸预览转换。'),
    [...info.messages, ...info.omissions].map((text, i) => h('p', { key: i }, text)),
    info.diagnostics && h('details', null, h('summary', null, '诊断信息'), h('textarea', { readOnly: true, 'aria-label': '转换诊断信息，可复制', value: info.diagnostics })))
}
function DwgPane({ sessionId, record, statusTarget }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [query, setQuery] = useState(''), [limit, setLimit] = useState(100)
  const [question, questionController] = useDrawingQuestion(sessionId)
  const [annotationsOpen, setAnnotationsOpen] = useState(false), [boxMode, setBoxMode] = useState(false), [originalColors, setOriginalColors] = useState(false)
  const drawingHost = useRef(null), viewport = useRef(null), annotationsButton = useRef(null), drawingMenu = useRef(null), conversionDetails = useRef(null)
  useEffect(() => {
    if (!data || !drawingHost.current) return
    const controls = mountDrawingViewport(drawingHost.current, setBoxMode, setError, id => void selectTarget(id), () => { try { questionController.clear() } catch (e) { setError(e.message) } }, data.targets || [])
    viewport.current = controls
    return () => { controls.dispose(); viewport.current = null }
  }, [data])
  useEffect(() => { viewport.current?.colors(originalColors) }, [data, originalColors])
  useEffect(() => {
    if (!data) return
    questionController.setVersion(data.source_sha256, data.preview_sha256)
    const ref = question.active?.reference
    viewport.current?.highlight(ref?.kind === 'drawing-target' && ref.preview_sha256 === data.preview_sha256 ? data.targets?.find(target => target.id === ref.ids[0]) : null)
  }, [data, question.active?.ref])
  useEffect(() => {
    let alive = true; setData(null); setError(''); setQuery(''); setLimit(100); setBoxMode(false)
    void taskApi(sessionId, 'drawing').then(next => { if (alive) setData({ ...next, safeSvg: sanitizeDwgSvg(next.svg) }) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [sessionId, record.task?.inputs.dwg?.sha256])
  if (!data) return h('div', { className: 'wb-empty', role: 'status' }, error || '正在读取图纸…')
  const items = data.preview_sha256 ? data.targets || [] : data.annotations
  const filtered = query.trim() ? items.filter(entity => `${drawingAnnotationLabel(entity)} ${entity.layer || ''}`.toLowerCase().includes(query.trim().toLowerCase())) : []
  const selected = question.active?.reference.entities?.[0]
  const selectTarget = async id => {
    const target = items.find(item => item.id === id)
    if (!target) return
    const reference = { kind: data.preview_sha256 ? 'drawing-target' : 'drawing', source_sha256: data.source_sha256, ids: [id], ...(data.preview_sha256 ? { preview_sha256: data.preview_sha256 } : {}) }
    const focusOrigin = document.activeElement
    let preserveFocus
    try {
      if (await questionController.select(reference, () => {
        if (document.activeElement !== focusOrigin) preserveFocus = document.activeElement
        return !preserveFocus
      })) {
        preserveFocus?.focus({ preventScroll: true })
        setError(''); viewport.current?.highlight(data.preview_sha256 ? target : null, true)
      }
    } catch (e) { setError(e.message) }
  }
  const closeAnnotations = () => { setAnnotationsOpen(false); annotationsButton.current?.querySelector('button')?.focus() }
  const info = data.preview_info || { status: data.preview_partial ? 'partial' : 'ready',
    messages: data.preview_partial ? ['部分图纸内容可能未显示，请打开原图核对。'] : [], omissions: [], diagnostics: data.preview_details || '' }
  const showDetails = () => { drawingMenu.current.open = true; conversionDetails.current.open = true; conversionDetails.current.querySelector('summary').focus() }
  return h('div', { className: 'wb-drawing' },
    statusTarget && require('react-dom').createPortal(h(DrawingPreviewStatus, { info, showDetails }), statusTarget),
    h('div', { className: 'wb-drawing-stage' },
      h('div', { className: 'wb-drawing-controls' },
        h('div', { className: 'wb-drawing-tools', role: 'group', 'aria-label': '图纸视图工具' },
          h(DrawingTool, { name: 'minus', label: '缩小图纸', onClick: () => viewport.current?.zoom(1.3) }),
          h(DrawingTool, { name: 'plus', label: '放大图纸', onClick: () => viewport.current?.zoom(1 / 1.3) }),
          h(DrawingTool, { name: 'fit', label: '适配全图 (F)', onClick: () => viewport.current?.fit() }),
          h(DrawingTool, { name: 'box', label: '框选放大', 'aria-pressed': boxMode, onClick: () => viewport.current?.box() }),
          h('span', { ref: annotationsButton, tabIndex: -1 }, h(DrawingTool, { name: 'annotations', label: '查找图纸文字', 'aria-pressed': annotationsOpen, onClick: () => setAnnotationsOpen(old => !old) })),
          h('details', { ref: drawingMenu, onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.open = false; e.currentTarget.querySelector('summary').focus() } } },
            h('summary', { 'aria-label': '更多图纸选项', title: '更多图纸选项' }, h(DrawingIcon, { name: 'more' })),
            h('div', { className: 'wb-drawing-menu' }, h('label', null, h('input', { type: 'checkbox', checked: originalColors, onChange: e => setOriginalColors(e.target.checked) }), '原始配色'),
              h('p', null, '默认提亮低对比度颜色，不改变原文件。'), h('p', null, '拖动或方向键平移 · 滚轮或 +/− 缩放 · F 适配全图 · Esc 取消框选'), h('p', null, '图纸为转换预览，不提供精确量测。'),
              h(DrawingConversionDetails, { info, detailsRef: conversionDetails }))))),
      h('div', { ref: drawingHost, className: 'wb-drawing-svg', tabIndex: 0, role: 'region', 'aria-label': '二维图纸画布，拖动平移，滚轮缩放，F 适配全图', dangerouslySetInnerHTML: { __html: data.safeSvg } }),
      error && h('p', { className: 'wb-notice', role: 'alert' }, error)),
    annotationsOpen && h('aside', { className: 'wb-drawing-annotations', 'aria-label': '查找图纸文字', onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); closeAnnotations() } } },
      h('header', null, h('h3', null, '查找图纸文字'), h(Button, { 'aria-label': '收起图纸文字搜索', onClick: closeAnnotations }, '收起')),
      h('input', { 'aria-label': '搜索图纸文字', placeholder: '搜索文字、尺寸或技术要求', value: query, onChange: e => { setQuery(e.target.value); setLimit(100) } }),
      h('p', { role: 'status' }, query.trim() ? `找到 ${filtered.length} 项` : '输入文字、尺寸或技术要求查找'),
      h('div', { className: 'wb-drawing-annotation-list', onKeyDown: e => {
        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
        const buttons = [...e.currentTarget.querySelectorAll('button')], index = buttons.indexOf(document.activeElement)
        e.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      } }, filtered.slice(0, limit).map(entity => h('button', { key: entity.id, 'data-drawing-result': entity.id, 'aria-pressed': selected?.id === entity.id, onClick: () => void selectTarget(entity.id) }, drawingAnnotationLabel(entity), h('small', null, data.preview_sha256 ? entity.kind === 'dimension' ? '尺寸标注' : '图纸文字' : '仅引用文字，暂不支持定位'))),
        query.trim() && !filtered.length && h('p', null, '没有匹配的内容'), filtered.length > limit && h(Button, { onClick: () => setLimit(limit + 100) }, '显示更多结果')),
      selected && h('section', { className: 'wb-drawing-annotation-detail' }, h('strong', null, drawingAnnotationLabel(selected)),
        h('details', null, h('summary', null, '查看标注原文'), h('p', null, selected.text || `图纸标称 ${selected.nominal ?? '未读取'}`), h('small', null, `来源 ${selected.source_id || selected.id} · ${selected.kind || selected.type}`)),
        h('p', null, '已设为当前提问对象，可直接输入问题。'))))
}
const drawingQuestions = new Map()
const DRAWING_QUESTION_SOURCE = 'cam-drawing'
function drawingQuestionSpan(state, occurrence) {
  const before = state.occurrences.filter(item => item.offset < occurrence.offset)
  const start = occurrence.offset - before.reduce((sum, item) => sum + item.length - 1, 0)
  return { start, end: start + 1, draftRev: state.draftRev }
}
// One owned native chip is the send snapshot; retained selection never rewrites a submitted request.
function createDrawingQuestionController({ input, consume, validate, isCurrent, admitted }) {
  let snapshot = { active: null, hasChip: false }, sequence = 0, editing = false, handoff = false, disposed = false, version = null, invalidNotice = false
  const listeners = new Set()
  const publish = next => { snapshot = next; for (const listener of listeners) listener() }
  const owned = state => state.occurrences.filter(item => item.source === DRAWING_QUESTION_SOURCE)
  const stale = ref => version && (ref.source_sha256 !== version.source || (ref.kind === 'drawing-target' && version.preview && ref.preview_sha256 !== version.preview))
  const invalidate = () => { handoff = false; publish({ active: null, hasChip: false }); invalidNotice = true; input.notify?.('info', '图纸或预览已更新，请重新选择提问对象') }
  const insert = active => {
    const state = input.state.getSnapshot(), chips = owned(state)
    if (state.phase !== 'plain' || chips.length > 1) return false
    const span = chips[0] ? drawingQuestionSpan(state, chips[0]) : { start: 0, end: 0, draftRev: state.draftRev }
    editing = true
    try { return input.insertReference({ source: DRAWING_QUESTION_SOURCE, ref: active.ref, label: `针对：${active.label}`, appearance: 'file', clipboardText: `[CAM_OBJECT]\n${active.ref}\n[/CAM_OBJECT]` }, span) }
    finally { editing = false }
  }
  const fromChip = chip => { try { const reference = JSON.parse(chip.ref); return { ref: chip.ref, reference, label: reference.entities?.[0]?.text || chip.label.replace(/^针对：/, '') } } catch { return null } }
  const sync = () => {
    if (editing || disposed) return
    const state = input.state.getSnapshot(), chip = owned(state)[0]
    if (chip) {
      if (!snapshot.hasChip) handoff = false
      const active = fromChip(chip)
      if (active && stale(active.reference)) {
        if (state.phase === 'plain') {
          editing = true
          try { if (consume(drawingQuestionSpan(state, chip))) invalidate() }
          finally { editing = false }
        }
        return
      }
      if (snapshot.active?.ref !== active?.ref || !snapshot.hasChip) publish({ active, hasChip: true })
    } else if (snapshot.hasChip) {
      if (!handoff) { sequence++; publish({ active: null, hasChip: false }) }
      else publish({ active: snapshot.active, hasChip: false })
    }
    if (!chip && snapshot.active && stale(snapshot.active.reference)) { invalidate(); return }
    // A new draft can start before admission settles. Only attach once it contains new user work.
    if (handoff && snapshot.active && !snapshot.hasChip && state.phase === 'plain' && (state.draft.trim() || state.attachmentIds?.length)) {
      if (insert(snapshot.active)) { handoff = false; sync() }
    }
  }
  const unsubscribe = input.state.subscribe(sync)
  let lastTurn = admitted?.getSnapshot()?.legacy?.nodes?.findLast(node => node.kind === 'user')?.turn
  const unsubscribeAdmitted = admitted?.subscribe(() => {
    if (!isCurrent()) return
    let turn
    try { turn = admitted.getSnapshot()?.legacy?.nodes?.findLast(node => node.kind === 'user')?.turn }
    catch { return } // The upstream session reference can be released during navigation.
    if (turn === undefined || turn === lastTurn) return
    lastTurn = turn
    if (handoff && snapshot.active && !snapshot.hasChip && insert(snapshot.active)) { handoff = false; sync() }
  })
  sync()
  return {
    input, admitted,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }, getSnapshot: () => snapshot,
    async select(reference, shouldFocus = () => true) {
      const ticket = ++sequence, checked = await validate(reference)
      if (disposed || ticket !== sequence || !isCurrent()) return false
      if (stale(checked)) throw new Error('图纸或预览已更新，请重新选择提问对象')
      const active = { reference: checked, ref: JSON.stringify(checked), label: checked.entities?.[0]?.text || '图纸文字' }
      if (snapshot.active?.ref === active.ref && snapshot.hasChip) { if (shouldFocus()) input.focus(); return true }
      const focus = shouldFocus()
      if (!insert(active)) throw new Error('输入框正在提交或引用无法替换，请稍后重选')
      handoff = false; publish({ active, hasChip: true })
      if (invalidNotice) { input.notify?.('info', ''); invalidNotice = false }
      if (focus) input.focus(); return true
    },
    clear() {
      sequence++
      const state = input.state.getSnapshot(), chips = owned(state)
      if (chips.length > 1 || (chips[0] && (state.phase !== 'plain' || !consume(drawingQuestionSpan(state, chips[0]))))) throw new Error('当前引用暂时无法清除，请稍后重试')
      handoff = false; publish({ active: null, hasChip: false })
    },
    beginSend(ref) { if (snapshot.active?.ref === ref) handoff = true },
    setVersion(source, preview) {
      if (version?.source !== source || version?.preview !== preview) { sequence++; version = { source, preview }; sync() }
      if (!snapshot.hasChip && snapshot.active && stale(snapshot.active.reference)) invalidate()
    },
    dispose() { disposed = true; sequence++; unsubscribe(); unsubscribeAdmitted?.(); listeners.clear() },
  }
}
function drawingQuestion(sessionId) {
  const scope = applyCtx.get('sessions').scope(sessionId), input = sessionInput(sessionId), admitted = applyCtx.get('uiConversation').binding(sessionId).target('chat')
  const previous = drawingQuestions.get(sessionId)
  if (previous && (previous.input !== input || previous.admitted !== admitted)) { previous.dispose(); drawingQuestions.delete(sessionId) }
  if (!drawingQuestions.has(sessionId)) {
    drawingQuestions.set(sessionId, createDrawingQuestionController({ input,
      consume: span => scope.bail('slash/input-consume-token', { guard: { kind: 'span', span } }) === true,
      validate: reference => taskApi(sessionId, 'reference', { reference: { ...reference, session_id: sessionId } }),
      isCurrent: () => applyCtx.get('sidebarRight').mounted.getSnapshot() === sessionId,
      admitted,
    }))
  }
  return drawingQuestions.get(sessionId)
}
function useDrawingQuestion(sessionId) {
  const controller = drawingQuestion(sessionId)
  return [React.useSyncExternalStore(controller.subscribe, controller.getSnapshot), controller]
}
function OperationTable({ task }) {
  const headers = ['顺序 / 工序', '工位', '刀具 / 刀位', '转速 rpm', '进给 mm/min', '前置工序']
  return h('div', { className: 'wb-table-scroll' }, h('table', { className: 'wb-operation-table' },
    h('thead', null, h('tr', null, headers.map(label => h('th', { key: label }, label)))),
    h('tbody', null, task.operations.map((op, i) => h('tr', { key: op.id },
      h('td', null, `${i + 1}. ${op.operation || OP_TYPE_LABELS[op.type] || op.id}`), h('td', null, op.station),
      h('td', null, `${op.tool_assembly_id || op.tool || '待确认'} / ${task.machine_view?.tools?.[op.tool_assembly_id] || '刀位待核对'}`),
      h('td', null, op.spindle ?? (op.type === 'copy_postprocess' ? '沿用模板' : '材料规则（待回读）')), h('td', null, op.feed ?? (op.type === 'copy_postprocess' ? '沿用模板' : '材料规则（待回读）')), h('td', null, op.depends_on.join('、') || '无'))))))
}
function SchemeSummary({ task }) {
  return h('section', { className: 'wb-scheme-summary' },
    h('dl', null, h('dt', null, '目标机床'), h('dd', null, task.machine_view?.name || task.machine_id),
      h('dt', null, '后处理器'), h('dd', null, task.post_name),
      ['prt', 'dwg'].map(role => h(React.Fragment, { key: role }, h('dt', null, role === 'prt' ? '三维模型' : '二维图纸'), h('dd', null, `${task.inputs[role]?.name || '缺少输入'} · 版本 ${task.inputs[role]?.sha256.slice(0, 8) || '未核验'}`)))),
    Object.entries({ material: '材料与状态', stock: '毛坯', datum: '定位基准', fixture: '装夹' }).map(([id, label]) => h('p', { key: id }, h('strong', null, `${label}：`), task.setup?.[id]?.value || '未确认')),
    h(OperationTable, { task }),
    h('h4', null, '检验与未决项'), h('ul', null, task.operations.flatMap(op => op.inspection).filter((v, i, all) => all.indexOf(v) === i).map(text => h('li', { key: text }, text))))
}
function submitWorkbenchRequest(sessionId, message) {
  const input = sessionInput(sessionId), state = input?.state.getSnapshot()
  if (!state || state.phase !== 'plain' || applyCtx.get('sessions').list.getSnapshot().byId[sessionId]?.running) throw new Error('Agent 正在处理请求，请等待当前操作结束')
  if (state.draft.trim() || state.occurrences.length) throw new Error('输入框有未发送内容，请先发送或保留草稿后清空，再点击此操作')
  input.setDraft(message); input.submit(undefined, 'click')
}
function WorkbenchActions({ sessionId, record, compact = false }) {
  const [error, setError] = useState('')
  const task = record.task, latest = task.runs.filter(run => run.revision === task.revision).at(-1)
  const act = message => { setError(''); try { submitWorkbenchRequest(sessionId, message) } catch (e) { setError(e.message) } }
  return h('section', { className: compact ? 'wb-workflow-actions wb-workflow-compact' : 'wb-workflow-actions' },
    task.authorization && !task.active_run && h(Button, { variant: 'primary', disabled: record.busy, onClick: () => act(`工作台请求生成NC：读取cam_task核对当前冻结授权 ${task.authorization.fingerprint}；保持所有冻结operations字段原样，用cam_plan绑定task-input://${task.revision}/prt，再cam_run并等待job_output终态。不更改要求/方案，不交付，不生产放行。只使用相关CAM、机床和job工具。`) }, '生成 NC'),
    !compact && latest?.result && !task.active_run && !task.deliveries.some(d => d.run_id === latest.id) && h(Button, { disabled: record.busy, onClick: () => act(`工作台请求打包问题包：只对批次 ${latest.id} 调用cam_deliver，等待问题包打包确认卡批准；保留全部缺口，禁止生产放行。不改方案、不重复执行。`) }, '打包问题包'),
    !compact && h('p', { className: 'wb-muted' }, '确认、审核与打包审批都在工作台完成。生成和打包由当前 Agent 执行，状态以加工记录为准。'),
    error && h('p', { role: 'alert' }, error))
}
function PlanReview({ snapshot, record, close }) {
  const [bounds, setBounds] = useState({}), [accepted, setAccepted] = useState(false), [error, setError] = useState('')
  const dialog = useRef(null)
  useEffect(() => { const el = dialog.current; const previous = document.activeElement; el.showModal(); return () => { el.close(); if (previous?.isConnected) previous.focus() } }, [])
  return h('dialog', { ref: dialog, className: 'wb-plan-dialog', 'aria-label': '方案审核', onCancel: e => { e.preventDefault(); if (!record.busy) close() } }, h('section', { className: 'wb-body', style: { overflow: 'auto' }, 'aria-label': '方案审核' },
    h('h3', null, `确认方案 R${snapshot.revision} · ${snapshot.fingerprint.slice(0, 12)}`),
    h('p', null, '确认冻结输入版本、机床、工序及下面的调整范围。缺失事实不因签字变成已验证；生产放行另需检查证据。确认后可在冻结范围内编程；交付缺少检查证据时仅生成问题包。'),
    h(SchemeSummary, { task: snapshot }),
    h('h4', null, '本次修改'), snapshot.scheme_changes?.length ? h('ul', null, snapshot.scheme_changes.map((change, i) => h('li', { key: i }, `${change.label}：${Array.isArray(change.before) ? change.before.join('、') : change.before} → ${Array.isArray(change.after) ? change.after.join('、') : change.after}`))) : h('p', null, snapshot.authorization ? '当前方案与已冻结版本一致。' : '首次审核当前方案，请核对上面的工序与参数。'),
    h('h4', null, '允许自动调整的范围（默认不允许）'),
    snapshot.operations.filter(op => op.type === 'from_scratch_workpiece_op').map(op => h('section', { key: op.id }, h('strong', null, op.id),
      ['spindle', 'feed'].filter(field => Number.isFinite(op[field])).map(field => h('div', { key: field },
        h('label', null, h('input', { type: 'checkbox', checked: Boolean(bounds[op.id]?.[field]), onChange: e => setBounds(old => {
          const next = { ...old, [op.id]: { ...old[op.id] } }; if (e.target.checked) next[op.id][field] = [op[field], op[field]]; else { delete next[op.id][field]; if (!Object.keys(next[op.id]).length) delete next[op.id] } return next
        }) }), field === 'spindle' ? '转速 rpm' : '进给 mm/min'),
        bounds[op.id]?.[field] && [0, 1].map(index => h('input', { key: index, type: 'number', min: 0, step: 'any', 'aria-label': `${op.id} ${field} ${index === 0 ? '下限' : '上限'}`, value: bounds[op.id][field][index],
          onChange: e => setBounds(old => { const range = [...old[op.id][field]]; range[index] = e.target.value === '' ? '' : Number(e.target.value); return { ...old, [op.id]: { ...old[op.id], [field]: range } } }) })))))),
    h('p', null, '模板复制暂不支持自动调整转速/进给。更换刀具、对象、工位、方法或依赖需重新确认。'),
    h('label', null, h('input', { type: 'checkbox', checked: accepted, onChange: e => setAccepted(e.target.checked) }), '我已核对当前冻结版本和上述范围'),
    h('div', null, h('button', { disabled: !accepted || record.busy, onClick: async () => {
      setError(''); try { await record.act('authorize', { version: snapshot.version, fingerprint: snapshot.fingerprint, bounds }); close() } catch (e) { setError(e.message) }
    } }, '确认方案'), h('button', { disabled: record.busy, onClick: close }, '返回草案')),
    error && h('p', { role: 'alert' }, error)))
}
// Planning answers stay in the operation panel, independently of review completion.
function TaskAnswer({ record, question }) {
  const answer = record.task.answers[question.id]
  const recommendation = typeof question.recommendation === 'string' ? question.recommendation : ''
  const [draft, setDraft] = useState(answer?.value || question.value || recommendation)
  const [error, setError] = useState('')
  const saving = useRef(false), editingVersion = useRef(null)
  const disabled = record.busy || Boolean(record.task.active_run)
  useEffect(() => { if (editingVersion.current === null) setDraft(answer?.value || question.value || recommendation) }, [answer?.value, question.value, recommendation])
  const save = async (value, resolved) => {
    if (disabled || saving.current) return
    saving.current = true; setError('')
    try { await record.act('answer', { version: editingVersion.current ?? record.task.version, id: question.id, value, resolved }); editingVersion.current = null }
    catch (e) { setError(e.message) }
    finally { saving.current = false }
  }
  return h('form', { className: 'wb-placeholder', onSubmit: event => {
    event.preventDefault()
    if (draft.trim() && draft.trim() !== '暂不确定') void save(draft.trim(), true)
  } }, h('h4', null, question.prompt),
    question.reason && h('p', { className: 'wb-evidence' }, question.reason),
    question.questions?.map(q => h('p', { key: q.id, className: q.conflict ? 'wb-notice' : 'wb-evidence' }, q.prompt)),
    recommendation && h('p', { className: 'wb-evidence' }, `建议：${recommendation}`),
    answer && h('p', { className: 'wb-muted' }, answer.resolved ? `已确认：${answer.value}` : `未决：${answer.value}`),
    h('textarea', { 'aria-label': question.prompt, value: draft, disabled, onChange: e => { if (editingVersion.current === null) editingVersion.current = record.task.version; setDraft(e.target.value) } }),
    h(Button, { type: 'submit', disabled: disabled || !draft.trim() || draft.trim() === '暂不确定' }, '保存确认'),
    recommendation && h(Button, { type: 'button', disabled, onClick: () => save(recommendation, true) }, '使用建议'),
    h(Button, { type: 'button', disabled, onClick: () => save('暂不确定', false) }, '暂不确定'),
    error && h('p', { role: 'alert' }, error))
}
// The inspector reads only user-authorized snapshots, never the mutable draft.
function confirmedScheme(task) {
  const snapshots = [task.authorization, task.last_authorization, ...(task.revisions ?? []).map(item => item.authorization)].filter(Boolean)
  return snapshots.sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0) || String(b.at ?? '').localeCompare(String(a.at ?? '')))[0] ?? null
}
function TaskOperations({ record }) {
  const task = record.task
  if (!task) return h('div', { className: 'wb-context-body wb-empty', role: 'status' }, record.error || '读取工序单…')
  const scheme = confirmedScheme(task)
  if (!scheme) return h('div', { className: 'wb-context-body wb-empty', role: 'status' }, '工序方案确认后将在这里显示')
  const current = scheme === task.authorization && scheme.fingerprint === task.fingerprint
  const field = (label, value) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value ?? '未记录'))
  const groups = []
  for (const op of scheme.operations) {
    if (groups.at(-1)?.station !== op.station) groups.push({ station: op.station, operations: [] })
    groups.at(-1).operations.push(op)
  }
  return h('div', { className: 'wb-context-body wb-confirmed-scheme' },
    h('p', { className: current ? 'wb-muted' : 'wb-notice', role: 'status' }, current ? `已确认 · R${scheme.revision}` : `上次确认版本 R${scheme.revision}，当前待重新确认`),
    h('dl', null, field('机床', scheme.machine_view?.name || scheme.machine_id), field('材料', scheme.setup?.material?.value), field('毛坯', scheme.setup?.stock?.value), field('定位基准', scheme.setup?.datum?.value), field('装夹', scheme.setup?.fixture?.value)),
    groups.map(({ station, operations }, index) => h('section', { key: `${station}/${index}`, className: 'wb-scheme-station' },
      h('h3', null, `工位 ${station}`),
      h('ol', { className: 'wb-scheme-operations' }, operations.map(op => h('li', { key: op.id },
        h('div', { className: 'wb-scheme-operation-head' }, h('span', null, op.sequence), h('strong', null, op.operation || '加工名称未记录')),
        op.execution === 'external' && h('small', null, '外协 / 非 NC 环节'),
        h('dl', null, field('加工对象', op.geometry || '未记录'), field('刀具', [scheme.machine_view?.tools?.[op.tool_assembly_id], scheme.machine_view?.tool_names?.[op.tool_assembly_id] || op.tool_assembly_id || op.tool].filter(Boolean).join(' · ') || '未记录')),
        h('details', null, h('summary', null, '切削参数与备注'),
          h('dl', null, field('转速', op.spindle != null ? `${op.spindle} rpm` : '未记录显式值'), field('进给', op.feed != null ? `${op.feed} mm/min` : '未记录显式值'),
            op.depth_per_cut != null && field('每刀深度', `${op.depth_per_cut} mm`), op.stepover != null && field('步距', op.stepover)),
          op.note && h('p', null, op.note))))))))
}
// Planning and authorization remain a temporary workflow, outside the read-only inspector.
function SchemeWorkflow({ sessionId, record }) {
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState(null)
  const task = record.task, dialog = useRef(null)
  useEffect(() => {
    if (!open) return
    const el = dialog.current, previous = document.activeElement
    if (!el) return
    el.showModal()
    return () => { el.close(); if (previous?.isConnected) previous.focus() }
  }, [open])
  if (!task || task.active_run || !task.operations.length || task.review?.status !== 'complete' || task.requirement_summary?.status !== 'confirmed') return null
  if (snapshot) return h(PlanReview, { snapshot, record, close: () => setSnapshot(null) })
  if (task.authorization) {
    const latest = task.runs.filter(run => run.revision === task.revision && run.authorization === task.authorization.fingerprint).at(-1)
    return !latest?.result ? h(WorkbenchActions, { sessionId, record, compact: true }) : null
  }
  const fields = (task.planning?.fields ?? []).filter(field => !field.resolved)
  const extra = (task.planning?.extra ?? []).filter(q => !task.answers[q.id]?.resolved)
  return h(React.Fragment, null,
    h(Button, { variant: 'primary', disabled: record.busy, onClick: () => task.blockers.length ? setOpen(true) : setSnapshot(JSON.parse(JSON.stringify(task))) }, task.blockers.length ? '补全方案' : '审核并确认方案'),
    open && h('dialog', { ref: dialog, className: 'wb-plan-dialog', 'aria-label': '补全方案', onCancel: e => { e.preventDefault(); setOpen(false) } },
      h('h3', null, '补全方案'),
      task.blockers.length > 0 && h('ul', null, task.blockers.map(text => h('li', { key: text }, text))),
      [...fields, ...extra].map(question => h(TaskAnswer, { key: `${task.revision}/${question.id}`, record, question })),
      h(Button, { onClick: () => setOpen(false) }, '稍后继续'),
      task.blockers.length === 0 && h(Button, { variant: 'primary', onClick: () => { setOpen(false); setSnapshot(JSON.parse(JSON.stringify(task))) } }, '审核并确认方案')))
}

function TaskInspector({ record, sessionId }) {
  const [feedback, setFeedback] = useState(''), [error, setError] = useState('')
  const task = record.task
  return task ? h('div', { className: 'wb-body', style: { overflow: 'auto' } }, h('h3', null, `加工任务 R${task.revision}`), h('p', null, task.phase),
    h('p', null, `机床：${task.machine_id || '未绑定'} · 后处理：${task.post_name}`),
    h(WorkbenchActions, { sessionId, record }),
    h('h4', null, '交付与反馈修订'),
    task.deliveries.map(item => h('section', { key: item.run_id, className: 'wb-placeholder' },
      h('strong', null, `R${item.revision} · ${item.run_id} · ${item.status === 'released' ? '已放行' : '问题包（未放行）'}`),
      h('ul', null, item.blockers.map(reason => h('li', { key: reason }, reason))),
      h('button', { disabled: record.busy || Boolean(task.active_run) || item.revision !== task.revision, onClick: () => void record.act('release', { run_id: item.run_id }).catch(e => setError(e.message)) }, '核验放行条件'))),
    h('label', null, '反馈及实测证据', h('textarea', { 'aria-label': '反馈及实测证据', value: feedback, onChange: e => setFeedback(e.target.value) })),
    h('button', { disabled: record.busy || Boolean(task.active_run) || !feedback.trim(), onClick: async () => {
      if (!window.confirm('在同一任务建立下一修订？旧输入与交付包保留，当前方案授权撤销。')) return
      try { await record.act('revise', { feedback }); setFeedback(''); setError('') } catch (e) { setError(e.message) }
    } }, '建立同任务修订'),
    error && h('p', { role: 'alert' }, error),
    h('h4', null, '修订历史'), task.revisions.map(rev => h('p', { key: rev.revision }, `R${rev.revision}：${rev.feedback}`))) : h('p', null, record.error || '读取正式任务…')
}
function readBenchPreference(sessionId) {
  try { return JSON.parse(localStorage.getItem(`camind-workbench/${sessionId}`)) || {} } catch { return {} }
}
function TaskPanelIcon({ name }) {
  const paths = {
    requirements: ['M9 5h6M9 3h6v4H9z', 'M7 5H5v16h14V5h-2M8 12h8M8 16h6'],
    inputs: ['M3 7h7l2 2h9v11H3z', 'M3 7V4h7l2 3'],
    operations: ['M4 5h3v3H4zM4 11h3v3H4zM4 17h3v3H4z', 'M11 6.5h9M11 12.5h9M11 18.5h9'],
    runs: ['M3 11a9 9 0 1 1 2.5 7', 'M3 4v7h7M12 7v5l3 2'],
    delivery: ['M4 7l8-4 8 4v10l-8 4-8-4z', 'M4 7l8 4 8-4M12 11v10M8 5l8 4']
  }
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, paths[name].map((d, i) => h('path', { key: i, d })))
}
function WorkbenchView({ sessionId }) {
  useEffect(() => { collapseLegacySidebar() }, [sessionId])
  const [mode, setMode] = useState(() => readBenchPreference(sessionId).mode || 'model')
  const [panel, setPanel] = useState(() => readBenchPreference(sessionId).panel || '')
  const [wizard, setWizard] = useState(false)
  const [heading, setHeading] = useState(null)
  const preference = useRef(readBenchPreference(sessionId)), loaded = useRef('')
  const record = useFormalTask(sessionId), task = record.task
  const [, questionController] = useDrawingQuestion(sessionId)
  useEffect(() => { if (task) questionController.setVersion(task.inputs.dwg?.sha256) }, [task?.inputs.dwg?.sha256])
  const Preview = previewService()?.View
  const running = React.useSyncExternalStore(listener => applyCtx.get('sessions').list.subscribe(listener), () => applyCtx.get('sessions').list.getSnapshot().byId[sessionId]?.running === true)
  useEffect(() => { preference.current = readBenchPreference(sessionId); loaded.current = ''; setMode(preference.current.mode || 'model'); setPanel(preference.current.panel || ''); setWizard(false) }, [sessionId])
  const reviewKey = task ? JSON.stringify({ revision: task.revision, inputs: task.inputs, questions: task.questions.filter(q => !q.scope || q.scope === 'review'), requirements: task.requirements }) : ''
  useEffect(() => {
    if (!task?.inputs.prt || loaded.current === task.inputs.prt.sha256) return
    loaded.current = task.inputs.prt.sha256
    // Restore the formal model after remount/restart without generating geometry.
    previewService()?.preview(sessionId, task.inputs.prt.uri)
  }, [sessionId, task?.inputs.prt?.sha256])
  useEffect(() => previewService()?.subscribe(sessionId, () => setMode('model')), [sessionId])
  // Auto-open the newest available PRT in the canvas: first detection switches,
  // each newly appearing PRT switches again; re-polls of the same file do not.
  const autoPrt = useRef('')
  useEffect(() => {
    const controller = new AbortController()
    let timer
    const tick = async () => {
      try {
        const res = await fetch(`${INPUTS_API}/${encodeURIComponent(sessionId)}/files`, { headers: { Accept: 'application/json' }, signal: controller.signal })
        const body = await res.json().catch(() => ({}))
        const newest = (body.files ?? []).filter(file => file.available !== false && /\.prt$/i.test(file.name ?? '')).pop()
        if (!controller.signal.aborted && newest?.path && newest.path !== autoPrt.current) {
          autoPrt.current = newest.path
          setMode('model')
          previewService()?.preview(sessionId, newest.path)
        }
      } catch { /* Input discovery unavailable; manual file picking stays. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(tick, 3000) }
    }
    void tick()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId])
  useEffect(() => {
    if (task?.review?.status === 'complete') { if (task?.requirement_summary?.status === 'confirmed') setWizard(false); return }
    if (!running && task?.inputs.prt && task?.inputs.dwg && (task.requirements.length || task.questions.length) && preference.current.pausedReview !== reviewKey) setWizard(true)
  }, [running, reviewKey, task?.review?.status, task?.requirement_summary?.status])
  useEffect(() => {
    try { localStorage.setItem(`camind-workbench/${sessionId}`, JSON.stringify({ ...preference.current, mode, panel })) } catch { /* Private browser storage may be unavailable. */ }
  }, [sessionId, mode, panel, wizard])
  const later = () => { preference.current.pausedReview = reviewKey; setWizard(false) }
  const complete = () => { setWizard(false); setPanel(''); setMode('model'); previewService()?.preview(sessionId, task.inputs.prt.uri) }
  const togglePanel = name => setPanel(old => old === name ? '' : name)
  return h('div', { className: 'wb-main' },
    h('header', { className: 'wb-main-head' }, h('div', { className: 'wb-file-heading', ref: setHeading }, mode === 'drawing' ? h('strong', { title: task?.inputs.dwg?.name }, task?.inputs.dwg?.name || 'CAD 图纸') : !heading || !Preview ? h('strong', null, task?.inputs.prt?.name || '加工工作台') : null),
      h('nav', { className: 'wb-view-controls', 'aria-label': '零件视图' }, ['prt', 'dwg'].map(role => h('button', { key: role, disabled: !task?.inputs[role], 'aria-pressed': mode === (role === 'prt' ? 'model' : 'drawing'), title: task?.inputs[role]?.name, onClick: () => {
        if (role === 'prt') { setMode('model'); previewService()?.preview(sessionId, task.inputs.prt.uri) } else setMode('drawing')
      } }, role === 'prt' ? '3D 模型' : 'CAD 图纸')),
        h('button', { disabled: !task, 'aria-pressed': panel === 'operations', title: '查看已确认工序单', onClick: () => setPanel('operations') }, '工序方案')),
      h('span', { className: 'wb-phase', role: 'status' }, task ? `R${task.revision} · ${task.phase}` : '读取任务'),
      !wizard && !running && (task?.review?.status === 'pending' || task?.review?.status === 'complete' && task?.requirement_summary?.status !== 'confirmed') && h(Button, { variant: 'primary', onClick: () => setWizard(true) }, task?.review?.status === 'complete' ? '确认加工要求' : '继续处理'),
      !wizard && !running && h(SchemeWorkflow, { key: sessionId, sessionId, record })),
    h('div', { className: 'wb-scene' },
      h('main', { className: 'wb-canvas' },
        h('div', { className: 'wb-preview-stage', hidden: mode !== 'model' }, Preview ? h(Preview, { sessionId, embedded: true, renderHeader: info => heading && mode === 'model' ? require('react-dom').createPortal(h(React.Fragment, null, h('strong', { title: info.meta }, info.title), info.openUrl && h('a', { href: info.openUrl, target: '_blank', rel: 'noreferrer' }, '新窗口打开')), heading) : null, onReference: reference => addPreviewReferenceToDraft(sessionId, reference) }) : h(CapabilityPlaceholder, { title: '文件预览未加载' }, '请启用内容预览插件。')),
        task?.inputs.dwg && h('div', { className: 'wb-preview-stage', hidden: mode !== 'drawing' }, h(DwgPane, { sessionId, record, statusTarget: mode === 'drawing' ? heading : null })),
        wizard && h('div', { className: 'wb-review-scrim' }, h(TaskWizard, { sessionId, record, close: later, complete }))),
      h('nav', { className: 'wb-context-nav', 'aria-label': '任务资料入口' }, [['requirements', '加工要求'], ['inputs', '输入文件'], ['operations', '工序方案'], ['runs', '加工记录'], ['delivery', '交付文件']].map(([id, label]) => h('button', { key: id, 'aria-label': label, title: label, 'aria-pressed': panel === id, onClick: () => togglePanel(id) }, h(TaskPanelIcon, { name: id })))),
      panel && h('aside', { className: 'wb-context', 'aria-label': '任务资料' },
        h('div', { className: 'wb-context-head' }, h('strong', null, { requirements: '加工要求', inputs: '输入文件', operations: '工序方案', runs: '加工记录', delivery: '交付文件' }[panel]), h(Button, { onClick: () => setPanel('') }, '收起')),
        panel === 'requirements' && h(TaskRequirements, { record }),
        panel === 'inputs' && h(InputTab, { sessionId }),
        panel === 'operations' && h(TaskOperations, { sessionId, record }),
        panel === 'runs' && h(CamRunsTab, { sessionId }),
        panel === 'delivery' && h('div', null, h(DeliverablesTab, { sessionId }), h(TaskInspector, { record, sessionId }))),
      record.error && !wizard && h('p', { className: 'wb-notice', role: 'alert' }, record.error)),
    h(AgentPanel, { sessionId }))
}
function RequirementList({ items, selected, onSelect, disabled }) {
  const groups = [['material', '材料与状态'], ['scope', '加工范围'], ['precision', '关键尺寸与公差'], ['special', '工艺与其他要求'], ['agreements', '补充约定']]
  return h('div', { className: 'wb-requirement-list' }, groups.map(([id, title]) => {
    const rows = items.filter(item => item.group === id)
    if (!rows.length) return null
    return h('section', { key: id }, h('h4', null, title), h('ul', null, rows.map(item => h('li', { key: item.id }, onSelect
      ? h('label', { className: 'wb-check' }, h('input', { type: 'checkbox', disabled, checked: selected.includes(item.id), onChange: event => onSelect(item.id, event.target.checked) }), h('span', null, item.text))
      : item.text))))
  }))
}
function TaskRequirements({ record }) {
  const task = record.task
  if (!task) return h('p', null, '读取加工要求…')
  const summary = task.requirement_summary
  if (summary?.status !== 'confirmed' || !summary.confirmed) return h('div', { className: 'wb-context-body' }, h('p', { role: 'status', className: 'wb-muted' }, summary?.status === 'stale' ? '要求已变更，待重新确认' : '加工要求尚未确认'))
  return h('div', { className: 'wb-context-body' },
    h('p', { className: 'wb-muted' }, `已确认 · R${task.review_confirmation.revision}`),
    h(RequirementList, { items: summary.confirmed.items }))
}

// The upstream slot boundary renders an empty node on errors. Keep failures actionable.
class WorkbenchBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return h('div', { className: 'wb-main' }, h('section', { className: 'wb-placeholder', role: 'alert' },
      h('h3', null, '工作台显示失败'), h('p', null, '任务记录仍已保存。请重试，或切到“对话”查看执行结果。'),
      h(Button, { onClick: () => this.setState({ failed: false }) }, '重新加载工作台')))
  }
}
function WorkbenchEntry({ sessionId }) {
  return h(WorkbenchBoundary, { key: sessionId }, h(WorkbenchView, { sessionId }))
}
function apply(ctx) {
  applyCtx = ctx
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-camind-ui-workbench', '')
    style.textContent = benchCss
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-workbench: stylesheet')

  ctx.effect(() => ctx.get('inputTriggers').registerSource({
    trigger: '@', name: 'cam-selection', candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: selectionClipboard,
      async serialize(ref, signal) {
        const reference = JSON.parse(ref)
        const checkSession = () => { if (ctx.get('sidebarRight').mounted.getSnapshot() !== reference.session_id) throw new Error('选面引用不属于当前会话，请重新选面') }
        checkSession()
        const query = new URLSearchParams({ path: reference.path, sha: reference.source_sha256, geometry: reference.geometry_sha256, fids: reference.fids.join(',') })
        const response = await fetch(`/camind/api/models/sessions/${encodeURIComponent(reference.session_id)}/selection?${query}`, { signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.message || `引用核对失败：HTTP ${response.status}`)
        checkSession()
        return `${selectionClipboard(JSON.stringify({ ...body, session_id: reference.session_id }))}\n请用 read_model_selection 核对引用，再结合问题回答；精确量测需 NX。`
      },
    },
    openReference({ sessionId }, { ref }) {
      const reference = JSON.parse(ref)
      if (reference.session_id !== sessionId) return false
      previewService()?.preview(sessionId, reference.path)
      return true
    },
  }), 'ui-workbench: native selection references')

  ctx.effect(() => ctx.get('inputTriggers').registerSource({
    trigger: '@', name: DRAWING_REFERENCE_SOURCE, candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: drawingReferenceClipboard,
      async serialize(ref, signal) {
        const reference = JSON.parse(ref)
        const checkSession = () => { if (ctx.get('sidebarRight').mounted.getSnapshot() !== reference.session) throw new Error('图纸引用不属于当前会话，请重新选择') }
        checkSession()
        const { reference: verified } = await verifyDrawingReference(reference.session, reference, signal)
        checkSession()
        return `${drawingReferenceClipboard(JSON.stringify(verified))}\n请结合已核验的图纸引用与问题回答；尺寸和图元以当前 pack 为准。`
      },
    },
    openReference({ sessionId }, { ref }) {
      const reference = JSON.parse(ref)
      if (reference.session !== sessionId) return false
      previewService()?.preview(sessionId, reference.source.uri)
      return true
    },
  }), 'ui-workbench: native drawing references')

  for (const source of ['cam-object', DRAWING_QUESTION_SOURCE]) ctx.effect(() => ctx.get('inputTriggers').registerSource({
    trigger: '@', name: source, candidates: async () => [], onPick: () => undefined,
    codec: {
      clipboardText: ref => `[CAM_OBJECT]\n${ref}\n[/CAM_OBJECT]`,
      async serialize(ref, signal) {
        const reference = JSON.parse(ref)
        const check = () => { if (ctx.get('sidebarRight').mounted.getSnapshot() !== reference.session_id) throw new Error('加工对象引用不属于当前会话') }
        check()
        if (source === DRAWING_QUESTION_SOURCE) drawingQuestion(reference.session_id).beginSend(ref)
        const response = await fetch(`${TASK_API}/${encodeURIComponent(reference.session_id)}/reference`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference }), signal })
        const body = await response.json()
        if (!response.ok || !body.ok) throw new Error(body.message || '加工对象引用核验失败')
        check()
        return `[CAM_OBJECT]\n${JSON.stringify(body.data)}\n[/CAM_OBJECT]`
      },
    },
    openReference({ sessionId }, { ref }) { if (JSON.parse(ref).session_id !== sessionId) return false; openView(sessionId, VIEW_ID); return true },
  }), 'ui-workbench: native task references')
  ctx.effect(() => () => { for (const controller of drawingQuestions.values()) controller.dispose(); drawingQuestions.clear() }, 'ui-workbench: drawing questions')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: VIEW_ID, order: -10, label: () => '工作台',
    inject: sessionId => ({ sessionId }),
  }, WorkbenchEntry))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench',
    order: 29,
    inject: sessionId => ({ sessionId }),
  }, BenchHeaderButton))
}

exports.name = 'ui-workbench-client'
exports.inject = ['slots', 'sessions', 'uiConversation', 'filePreview', 'sidebarRight', 'conversation', 'inputTriggers']
exports.apply = apply

return module.exports; } });
