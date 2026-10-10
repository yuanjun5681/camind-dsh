import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 项目专属右侧工作台：展示会话输入上下文、交付物列表与 CAM run（「加工」页签）。
 * 它是 custom root 的兄弟列，不占用官方 details（工具调用详情）slot。
 * 文件内容预览走全局 overlay，不在本列内渲染。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { CamRuns } from './CamRuns';
import { bytesLabel, fileDirFromPath, fileNameFromPath } from './format';
import { previewFile } from './previewClient';
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions, } from './workbenchStore';
const TABS = [
    { id: 'input', label: '输入' },
    { id: 'deliverables', label: '交付物' },
    { id: 'cam', label: '加工' },
];
function Empty({ children }) {
    return _jsx("div", { className: "workbench-empty", children: children });
}
export function Workbench({ session }) {
    const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
    const sessionId = session?.id;
    const uploads = sessionId ? snapshot.uploads[sessionId] ?? [] : [];
    const deliverables = sessionId ? snapshot.deliverables[sessionId] ?? [] : [];
    useEffect(() => {
        if (!sessionId)
            return;
        let cancelled = false;
        void api.sessionUploads(sessionId).then((result) => {
            if (!cancelled)
                workbenchActions.addUploads(sessionId, result.files);
        }).catch(() => {
            // 磁盘批次读失败时保持空列表；上传成功后仍会写入 store。
        });
        return () => { cancelled = true; };
    }, [sessionId]);
    return (_jsxs("aside", { className: "workbench", "aria-label": "\u9879\u76EE\u5DE5\u4F5C\u53F0", children: [_jsxs("div", { className: "workbench-head", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u5DE5\u4F5C\u53F0" }), session && _jsx("span", { title: session.cwd, children: session.displayTitle || session.title || session.id })] }), _jsx("button", { type: "button", onClick: () => workbenchActions.close(), "aria-label": "\u5173\u95ED\u5DE5\u4F5C\u53F0", children: "\u00D7" })] }), _jsx("div", { className: "workbench-tabs", role: "tablist", children: TABS.map((tab) => (_jsx("button", { type: "button", role: "tab", "aria-selected": snapshot.tab === tab.id, className: snapshot.tab === tab.id ? 'active' : undefined, onClick: () => workbenchActions.select(tab.id), children: tab.label }, tab.id))) }), _jsxs("div", { className: "workbench-body", children: [!sessionId && _jsx(Empty, { children: "\u9009\u62E9\u6216\u65B0\u5EFA\u4F1A\u8BDD\u540E\u663E\u793A\u5DE5\u4F5C\u533A\u4FE1\u606F\u3002" }), sessionId && snapshot.tab === 'input' && (_jsxs("div", { className: "workbench-section", children: [_jsxs("dl", { className: "workbench-facts", children: [_jsxs("div", { children: [_jsx("dt", { children: "\u5DE5\u4F5C\u76EE\u5F55" }), _jsx("dd", { title: session.cwd, children: session.cwd || '未设置' })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u72B6\u6001" }), _jsx("dd", { children: session.running ? '运行中' : '空闲' })] })] }), _jsx("h3", { children: "\u672C\u6B21\u4E0A\u4F20" }), uploads.length === 0 ? _jsx(Empty, { children: "\u5C1A\u672A\u901A\u8FC7 Composer \u4E0A\u4F20\u6587\u4EF6\u3002" }) : (_jsx("div", { className: "workbench-file-list", children: uploads.map((file) => (_jsxs("button", { type: "button", onClick: () => previewFile(sessionId, file.path), children: [_jsx("span", { children: file.name }), _jsx("small", { children: bytesLabel(file.size) })] }, file.path))) }))] })), sessionId && snapshot.tab === 'cam' && _jsx(CamRuns, { sessionId: sessionId }), sessionId && snapshot.tab === 'deliverables' && (_jsx("div", { className: "workbench-section", children: deliverables.length === 0 ? _jsx(Empty, { children: "\u5F53\u524D\u5DF2\u52A0\u8F7D\u7684\u4F1A\u8BDD\u8F6E\u6B21\u8FD8\u6CA1\u6709\u4EA7\u51FA\u6587\u4EF6\u3002" }) : (_jsx("div", { className: "workbench-deliverable-list", children: deliverables.map((path) => {
                                const name = fileNameFromPath(path);
                                const dir = fileDirFromPath(path);
                                return (_jsxs("button", { type: "button", className: "workbench-deliverable", title: path, onClick: () => previewFile(sessionId, path), children: [_jsx("span", { className: "workbench-deliverable-name", children: name }), dir ? _jsxs("span", { className: "workbench-deliverable-dir", children: [dir, "/"] }) : null] }, path));
                            }) })) }))] })] }));
}
