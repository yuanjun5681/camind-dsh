import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Global code-diff overlay on shell.overlay. Any surface can open it via
 * diffOverlayActions / window.__camindDiff__. Not owned by Workbench.
 */
import { useState, useSyncExternalStore } from 'react';
import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { DiffView } from './DiffView';
import { diffOverlayActions, getDiffOverlaySnapshot, subscribeDiffOverlay, } from './diffOverlayStore';
const KIND_LABEL = {
    added: '新增',
    deleted: '删除',
};
export function DiffOverlay() {
    const snapshot = useSyncExternalStore(subscribeDiffOverlay, getDiffOverlaySnapshot);
    const [mode, setMode] = useState('split');
    const open = snapshot.open;
    if (!open)
        return null;
    const doc = snapshot.document;
    const title = doc?.path || open.activePath;
    const kindLabel = doc?.kind ? KIND_LABEL[doc.kind] : undefined;
    const add = typeof doc?.additions === 'number' && doc.additions > 0;
    const del = typeof doc?.deletions === 'number' && doc.deletions > 0;
    return (_jsx(Modal, { open: true, onClose: () => diffOverlayActions.close(), title: title, closeLabel: "\u5173\u95ED\u5BF9\u6BD4", headless: true, className: "file-preview-dialog", children: _jsxs("div", { className: "file-preview-chrome diff-overlay", children: [_jsxs("header", { className: "file-preview-head", children: [_jsxs("div", { className: "file-preview-head-text", children: [_jsx("strong", { title: title, children: title }), _jsxs("span", { children: [doc ? `${doc.leftLabel} → ${doc.rightLabel}` : '正在读取…', kindLabel ? ` · ${kindLabel}` : ''] })] }), _jsxs("div", { className: "file-preview-head-actions", children: [add ? _jsxs("span", { className: "workbench-repo-add", children: ["+", doc?.additions] }) : null, del ? _jsxs("span", { className: "workbench-repo-del", children: ["\u2212", doc?.deletions] }) : null, _jsxs("div", { className: "diff-mode-toggle", role: "group", "aria-label": "\u5BF9\u6BD4\u65B9\u5F0F", children: [_jsx("button", { type: "button", className: mode === 'split' ? 'active' : undefined, onClick: () => setMode('split'), children: "\u5206\u680F" }), _jsx("button", { type: "button", className: mode === 'unified' ? 'active' : undefined, onClick: () => setMode('unified'), children: "\u7EDF\u4E00" })] }), _jsx("button", { type: "button", "aria-label": "\u5173\u95ED\u5BF9\u6BD4", onClick: () => diffOverlayActions.close(), children: _jsx(IconCloseOutlineRegular, { size: 14 }) })] })] }), open.files.length > 1 && (_jsx("nav", { className: "diff-file-tabs", "aria-label": "\u53D8\u66F4\u6587\u4EF6", children: open.files.map((file) => (_jsx("button", { type: "button", className: file.path === open.activePath ? 'active' : undefined, onClick: () => diffOverlayActions.select(file.path), children: file.path }, file.path))) })), _jsxs("div", { className: "file-preview-stage", children: [snapshot.error && _jsx("div", { className: "preview-error", children: snapshot.error }), snapshot.loading && !snapshot.error && _jsx("div", { className: "preview-empty", children: "\u6B63\u5728\u8BFB\u53D6\u5BF9\u6BD4\u2026" }), !snapshot.loading && !snapshot.error && doc && (_jsxs(_Fragment, { children: [_jsx(DiffView, { left: doc.left, right: doc.right, leftLabel: doc.leftLabel, rightLabel: doc.rightLabel, mode: mode }), doc.truncated ? _jsx("div", { className: "preview-truncated", children: "\u6587\u4EF6\u8F83\u5927\uFF0C\u4EC5\u5BF9\u6BD4\u524D 512 KB\u3002" }) : null] }))] })] }) }));
}
