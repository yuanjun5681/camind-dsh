import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Shared line-diff surface. Callers pass two texts and labels; this view
 * does not fetch, and does not know Workbench or Git.
 */
import { useMemo } from 'react';
import { diffOps, diffStats, splitRows } from './diffLines';
export function DiffView({ left, right, leftLabel = '之前', rightLabel = '之后', mode = 'split', }) {
    const ops = useMemo(() => diffOps(left, right), [left, right]);
    const rows = useMemo(() => splitRows(ops), [ops]);
    const stats = useMemo(() => diffStats(ops), [ops]);
    if (ops.length === 0) {
        return _jsx("div", { className: "diff-view-empty", children: "\u6CA1\u6709\u53EF\u5BF9\u6BD4\u7684\u5185\u5BB9\u3002" });
    }
    if (mode === 'unified') {
        return (_jsxs("div", { className: "diff-view unified", "data-diff-view": "unified", children: [_jsxs("div", { className: "diff-view-unified-head", children: [_jsxs("span", { children: [leftLabel, " \u2192 ", rightLabel] }), _jsxs("span", { className: "diff-view-stats", children: [stats.additions > 0 ? _jsxs("span", { className: "workbench-repo-add", children: ["+", stats.additions] }) : null, stats.deletions > 0 ? _jsxs("span", { className: "workbench-repo-del", children: ["\u2212", stats.deletions] }) : null] })] }), _jsx("pre", { className: "diff-view-body", children: ops.map((op, index) => {
                        const mark = op.kind === 'insert' ? '+' : op.kind === 'delete' ? '−' : ' ';
                        return (_jsxs("span", { className: `diff-line ${op.kind}`, children: [_jsx("span", { className: "diff-gutter", children: mark }), _jsx("span", { className: "diff-code", children: op.text })] }, index));
                    }) })] }));
    }
    return (_jsxs("div", { className: "diff-view split", "data-diff-view": "split", children: [_jsxs("div", { className: "diff-split-head", children: [_jsx("div", { children: leftLabel }), _jsx("div", { children: rightLabel })] }), _jsx("div", { className: "diff-split-body", children: rows.map((row, index) => (_jsxs("div", { className: `diff-split-row ${row.kind}`, children: [_jsxs("div", { className: `diff-cell left ${row.left == null ? 'empty' : row.kind}`, children: [_jsx("span", { className: "diff-gutter", children: row.leftNumber ?? '' }), _jsx("span", { className: "diff-code", children: row.left ?? '' })] }), _jsxs("div", { className: `diff-cell right ${row.right == null ? 'empty' : row.kind}`, children: [_jsx("span", { className: "diff-gutter", children: row.rightNumber ?? '' }), _jsx("span", { className: "diff-code", children: row.right ?? '' })] })] }, index))) })] }));
}
