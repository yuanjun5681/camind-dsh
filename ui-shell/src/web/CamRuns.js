import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 工作台「加工」页签：按 session 展示 CAM run 的完整加工过程时间线（无折叠）。
 * 数据源 = run 目录磁盘落盘（tool-cam 只读路由 GET /camind/api/cam/runs）：
 * runstate.history（cam_run 每阶段带 ts 落盘，resume 续跑往后追加）渲染竖向
 * 时间线；op 记录的起止时间算耗时，执行中的序显示「已运行 X / 限时约 Y 分钟」；
 * runstate.check 渲染收尾自检结论。旧版本落盘的 runstate 无 history，回退工序
 * 终态列表。不读会话事件投影——免疫 cam/* 事件会话重启拒绝重载的上游限制
 * （设计稿 §4.4），也能展示中断后可 resume 续跑的 run。
 * 组件只在页签激活时挂载：列表 5s 轮询；详情随 updated_at 前移重拉；执行中的
 * 卡片 1s 走表刷新「已运行」。
 *
 * 「查看刀路」已迁入 camind-ui-preview（2026-08-26）：按钮经 delivery 路由取
 * NC 文本后调 previewClient.previewContent，「预览」标签页渲染刀路（NC 查看器
 * 席位 cam.nc.preview 与该插件声明，camind-ui-toolpath-viewer 注册）；本组件
 * 不再内嵌查看器。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { bytesLabel } from './format';
import { previewContent, previewFile } from './previewClient';
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore';
const OVERALL_VIEW = {
    ok: { label: '通过', modifier: 'ok' },
    incomplete: { label: '含未决项', modifier: 'warn' },
    error: { label: '失败', modifier: 'err' },
    planned: { label: '未执行', modifier: 'muted' },
};
const RUNNING_VIEW = { label: '执行中', modifier: 'run' };
const OP_STATUS_LABELS = {
    ok: '完成',
    generated: '缺 NC',
    empty: '空刀路',
    error: '失败',
    skip: '跳过（沿用）',
    interrupted: '中断',
};
const OP_TYPE_LABELS = {
    copy_postprocess: '模板复制',
    from_scratch_workpiece_op: '从零建工序',
};
const STAGE_TEXT = {
    ensure_ready: '开工检查（CAM 工作站健康门禁）',
    upload: '上传零件到工作台',
    work_copy: '复制工作副本（主模型不被写）',
    prepare: '加工准备（建 CAM setup）',
    check: '收尾自检（NC 对账 + 空刀路）',
};
const TERMINAL_STAGES = new Set(['done', 'failed', 'aborted']);
function opStatusLabel(status) {
    return status === null ? '未执行' : OP_STATUS_LABELS[status] ?? status;
}
function timeLabel(iso) {
    const time = new Date(iso);
    return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false });
}
/** HH:MM:SS（时间线行首用）。 */
function clockLabel(iso) {
    const time = new Date(iso);
    return Number.isNaN(time.getTime()) ? iso : time.toLocaleTimeString('zh-CN', { hour12: false });
}
/** 两个 ISO 时间差 → 紧凑时长（27s / 11m45s / 1h02m）；判不出返回 null。 */
function durLabel(startIso, endIso) {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if (!Number.isFinite(ms) || ms < 0)
        return null;
    const s = Math.round(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
/** 执行中的卡片走表（刷新「已运行」）；null 时静止。 */
function useNow(intervalMs) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (intervalMs === null)
            return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return now;
}
/** runstate.history → 时间线行：op 的起（action）/止（status）两条折成一行。 */
function foldTimeline(history) {
    const rows = [];
    const open = new Map();
    history.forEach((entry, i) => {
        const key = `h${i}`;
        if (entry.stage === 'op' && typeof entry.index === 'number') {
            const name = entry.name ?? `op ${entry.index}`;
            if (entry.status !== undefined) {
                const started = open.get(entry.index);
                if (started !== undefined) {
                    started.status = entry.status;
                    started.endTs = entry.ts;
                    open.delete(entry.index);
                }
                else {
                    rows.push({ key, kind: 'op', ts: entry.ts, index: entry.index, name, status: entry.status, endTs: entry.ts });
                }
            }
            else {
                // 同一 index 已有未闭合的起始行 = 上次跑到一半进程死了（崩潰/中断）；
                // 旧行标「中断」，新行接续（resume 重跑的正常形态）。
                const stale = open.get(entry.index);
                if (stale !== undefined)
                    stale.status = 'interrupted';
                const row = { key, kind: 'op', ts: entry.ts, index: entry.index, name, action: entry.action };
                rows.push(row);
                open.set(entry.index, row);
            }
            return;
        }
        rows.push({
            key, kind: 'stage', ts: entry.ts, stage: entry.stage,
            status: entry.status, total: entry.total, skipped: entry.skipped,
            failedStage: entry.failed_stage, msg: entry.msg,
        });
    });
    return rows;
}
function stageRowView(row) {
    switch (row.stage) {
        case 'ops':
            return { icon: '✓', text: `开始逐序执行（共 ${row.total ?? '?'} 道）`, tone: 'ok' };
        case 'upload':
            return { icon: '✓', text: row.skipped === true ? '上传零件（proxy 侧已有，跳过）' : STAGE_TEXT.upload, tone: 'ok' };
        case 'done': {
            const view = OVERALL_VIEW[(row.status ?? '')] ?? OVERALL_VIEW.planned;
            return { icon: row.status === 'ok' ? '✓' : row.status === 'error' ? '✗' : '!', text: `执行完成：${view.label}`, tone: view.modifier };
        }
        case 'failed':
            return { icon: '✗', text: `失败于「${STAGE_TEXT[row.failedStage ?? ''] ?? row.failedStage ?? '?'}」：${row.msg ?? ''}`, tone: 'err' };
        case 'aborted':
            return { icon: '■', text: `已停止：${row.msg ?? ''}`, tone: 'warn' };
        default:
            return { icon: '✓', text: STAGE_TEXT[row.stage] ?? row.stage, tone: 'ok' };
    }
}
function opRowTone(status) {
    if (status === undefined)
        return 'run';
    if (status === 'ok')
        return 'ok';
    if (status === 'skip')
        return 'muted';
    if (status === 'error')
        return 'err';
    return 'warn'; // generated / empty
}
function opRowIcon(status) {
    if (status === undefined)
        return '●';
    if (status === 'ok')
        return '✓';
    if (status === 'skip')
        return '−';
    if (status === 'error')
        return '✗';
    return '!';
}
function basenameOf(p) {
    const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return slash >= 0 ? p.slice(slash + 1) : p;
}
function DeliveryFileRow({ sessionId, runId, file }) {
    const isMarkdown = file.name.toLowerCase().endsWith('.md');
    return (_jsxs("div", { className: "camrun-file", children: [_jsx("span", { className: "camrun-file-name", title: file.name, children: file.name }), _jsx("small", { children: bytesLabel(file.bytes) }), _jsxs("span", { className: "camrun-file-actions", children: [isMarkdown && (_jsx("button", { type: "button", title: "\u9884\u89C8\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u955C\u50CF\uFF08\u955C\u50CF\u7F3A\u5931\u65F6\u4F1A\u62A5\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u53EF\u6539\u7528\u4E0B\u8F7D\uFF09", onClick: () => previewFile(sessionId, `delivery/${runId}/${file.name}`), children: "\u9884\u89C8" })), _jsx("a", { href: api.camDeliveryFileUrl(sessionId, runId, file.name), children: "\u4E0B\u8F7D" })] })] }));
}
/** 「查看刀路」按钮：取 NC 文本 → 预览 tab（camind-ui-preview）渲染刀路。 */
function NcToolpathButton({ sessionId, runId, name }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState();
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", disabled: busy, title: "\u5728\u300C\u9884\u89C8\u300D\u6807\u7B7E\u9875\u67E5\u770B\u5200\u8DEF", onClick: () => {
                    setBusy(true);
                    setError(undefined);
                    void fetch(api.camDeliveryFileUrl(sessionId, runId, `nc/${name}`), { headers: { Accept: 'text/plain' } })
                        .then(async (response) => {
                        if (!response.ok)
                            throw new Error(`HTTP ${response.status}`);
                        previewContent(sessionId, name, await response.text());
                    })
                        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                        .finally(() => setBusy(false));
                }, children: "\u67E5\u770B\u5200\u8DEF" }), error !== undefined && _jsxs("span", { className: "camrun-op-error", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] })] }));
}
function Timeline({ rows, runstate, opsTotal, active, now }) {
    const lastKey = rows[rows.length - 1]?.key;
    return (_jsx("ul", { className: "camrun-tl", children: rows.map((row) => {
            const isLast = row.key === lastKey;
            if (row.kind === 'stage') {
                const view = stageRowView(row);
                const running = active && isLast;
                return (_jsxs("li", { "data-tone": running ? 'run' : view.tone, children: [_jsx("span", { className: "camrun-tl-time", children: clockLabel(row.ts) }), _jsx("span", { className: "camrun-tl-icon", children: running ? '●' : view.icon }), _jsx("span", { className: "camrun-tl-body", children: _jsx("span", { children: running ? `${view.text}…` : view.text }) })] }, row.key));
            }
            const op = runstate?.ops?.[row.index];
            const running = row.status === undefined;
            const duration = !running && row.endTs !== undefined ? durLabel(row.ts, row.endTs) : null;
            const elapsed = running ? durLabel(row.ts, new Date(now).toISOString()) : null;
            const timeout = typeof op?.timeout_seconds === 'number' ? `限时约 ${Math.max(1, Math.round(op.timeout_seconds / 60))} 分钟` : null;
            return (_jsxs("li", { "data-tone": opRowTone(row.status), children: [_jsx("span", { className: "camrun-tl-time", children: clockLabel(row.ts) }), _jsx("span", { className: "camrun-tl-icon", children: opRowIcon(row.status) }), _jsxs("span", { className: "camrun-tl-body", children: [_jsxs("span", { children: ["\u5DE5\u5E8F ", row.index + 1, "/", opsTotal, " ", row.name, row.action === 'post' && '（补后处理）', row.action === 'full' && op?.type !== undefined && OP_TYPE_LABELS[op.type] !== undefined && `（${OP_TYPE_LABELS[op.type]}）`] }), _jsx("span", { className: "camrun-tl-sub", children: running
                                    ? `计算中…${elapsed !== null ? ` 已运行 ${elapsed}` : ''}${timeout !== null ? ` · ${timeout}` : ''}`
                                    : `${opStatusLabel(row.status ?? null)}${duration !== null ? ` · ${duration}` : ''}` }), row.status !== undefined && !['ok', 'skip', 'interrupted'].includes(row.status) && op?.error !== undefined && op.error !== '' && (_jsx("span", { className: "camrun-tl-err", children: op.error })), row.status === 'ok' && op?.nc_files !== undefined && op.nc_files.length > 0 && (_jsxs("span", { className: "camrun-tl-sub", children: ["NC\uFF1A", op.nc_files.map(basenameOf).join('、')] }))] })] }, row.key));
        }) }));
}
function CamRunCard({ sessionId, run, viewerComponent, }) {
    const [detailState, setDetailState] = useState(null);
    // 无折叠：挂载即拉详情；列表轮询发现 updated_at 前移（cam_run 落盘）自动重拉。
    useEffect(() => {
        let cancelled = false;
        setDetailState((prev) => prev ?? { phase: 'loading' });
        void api.camRunDetail(sessionId, run.run_id).then((result) => {
            if (!cancelled)
                setDetailState({ phase: 'ready', detail: result.run });
        }).catch((error) => {
            if (!cancelled)
                setDetailState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        });
        return () => { cancelled = true; };
    }, [run.updated_at, run.run_id, sessionId]);
    const detail = detailState?.phase === 'ready' ? detailState.detail : null;
    const runstate = detail?.runstate ?? null;
    const rows = runstate?.history !== undefined && runstate.history.length > 0 ? foldTimeline(runstate.history) : [];
    const lastRow = rows[rows.length - 1];
    const active = rows.length > 0 && !(lastRow?.kind === 'stage' && TERMINAL_STAGES.has(lastRow.stage));
    const now = useNow(active ? 1000 : null);
    // 执行中且未闭合的最后一道序（lib ES2022 无 findLast，倒序扫）。
    let runningOp;
    if (active) {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
            const row = rows[i];
            if (row.kind === 'op' && row.status === undefined) {
                runningOp = row;
                break;
            }
        }
    }
    const machine = run.machine.display_name ?? run.machine.id;
    const overallView = active ? RUNNING_VIEW : (OVERALL_VIEW[run.overall] ?? OVERALL_VIEW.planned);
    const opsTotal = runstate?.ops?.length ?? run.ops.length;
    const runningOpTimeout = runningOp !== undefined
        ? runstate?.ops?.[runningOp.index]?.timeout_seconds
        : undefined;
    const runningElapsed = runningOp !== undefined
        ? durLabel(runningOp.ts, new Date(now).toISOString())
        : null;
    const check = runstate?.check;
    const checkWarn = check !== undefined
        && (check.listing_ok === false || (check.missing?.length ?? 0) > 0 || (check.empty_ops?.length ?? 0) > 0);
    return (_jsxs("section", { className: "camrun-card", children: [_jsxs("div", { className: "camrun-head", children: [_jsx("span", { className: `camrun-badge camrun-badge-${overallView.modifier}`, children: overallView.label }), _jsx("span", { className: "camrun-title", title: run.run_id, children: run.run_id })] }), _jsxs("dl", { className: "camrun-facts", children: [run.part_id !== null && _jsxs("div", { children: [_jsx("dt", { children: "\u4EF6\u53F7" }), _jsx("dd", { children: run.part_id })] }), machine !== null && _jsxs("div", { children: [_jsx("dt", { children: "\u673A\u5E8A" }), _jsx("dd", { children: machine })] }), detail?.post_name != null && _jsxs("div", { children: [_jsx("dt", { children: "\u540E\u5904\u7406\u5668" }), _jsx("dd", { children: detail.post_name })] }), detail?.out_dir != null && _jsxs("div", { children: [_jsx("dt", { children: "\u8F93\u51FA\u76EE\u5F55" }), _jsx("dd", { title: detail.out_dir, children: detail.out_dir })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u66F4\u65B0" }), _jsx("dd", { children: timeLabel(run.updated_at) })] })] }), active && (_jsx("p", { className: "camrun-live", children: runningOp !== undefined
                    ? `正在执行工序 ${runningOp.index + 1}/${opsTotal} ${runningOp.name}`
                        + (runningElapsed !== null ? ` · 已运行 ${runningElapsed}` : '')
                        + (typeof runningOpTimeout === 'number' ? ` · 限时约 ${Math.max(1, Math.round(runningOpTimeout / 60))} 分钟` : '')
                    : `正在执行：${lastRow?.kind === 'stage' ? (STAGE_TEXT[lastRow.stage] ?? lastRow.stage) : ''}…` })), run.read_error !== undefined && _jsx("p", { className: "camrun-warn", children: run.read_error }), run.overall === 'planned' && (_jsx("p", { className: "camrun-note", children: "\u5C1A\u672A\u6267\u884C\u2014\u2014\u5728\u4F1A\u8BDD\u4E2D\u8BA9 Agent \u5BF9\u8BE5 run_id \u8C03\u7528 cam_run \u9996\u8DD1\u3002" })), !active && (run.overall === 'incomplete' || run.overall === 'error') && (_jsx("p", { className: "camrun-note", children: "\u672C run \u672A\u5168\u8FC7\u2014\u2014\u53EF\u8BA9 Agent \u4EE5 cam_run\uFF08resume=true\uFF09\u7EED\u8DD1\uFF0Crun_id \u4E0D\u53D8\u3002" })), detailState?.phase === 'loading' && _jsx("p", { className: "camrun-note", children: "\u8BFB\u53D6 run \u8BE6\u60C5\u2026" }), detailState?.phase === 'error' && _jsxs("p", { className: "camrun-warn", children: ["\u8BE6\u60C5\u8BFB\u53D6\u5931\u8D25\uFF1A", detailState.message] }), rows.length > 0 && _jsx(Timeline, { rows: rows, runstate: runstate, opsTotal: opsTotal, active: active, now: now }), detail !== null && rows.length === 0 && runstate?.ops !== undefined && runstate.ops.length > 0 && (_jsxs(_Fragment, { children: [_jsx("p", { className: "camrun-note", children: "\u672C run \u7531\u65E7\u7248\u672C\u843D\u76D8\uFF08\u65E0\u8FC7\u7A0B\u65F6\u95F4\u7EBF\uFF09\uFF0C\u4EC5\u5DE5\u5E8F\u7EC8\u6001\uFF1A" }), _jsx("ul", { className: "camrun-op-list", children: runstate.ops.map((op) => (_jsxs("li", { children: [_jsx("span", { className: "camrun-op-dot", "data-status": op.status }), _jsx("span", { className: "camrun-op-name", title: op.type, children: op.name }), _jsx("span", { className: "camrun-op-status", children: opStatusLabel(op.status) }), op.error !== undefined && op.error !== '' && _jsx("span", { className: "camrun-op-error", children: op.error })] }, op.index))) })] })), check !== undefined && (_jsxs("p", { className: checkWarn ? 'camrun-warn' : 'camrun-note', children: ["\u81EA\u68C0\uFF1ANC \u5BF9\u8D26 \u671F\u671B ", check.expected ?? '?', " / \u5B9E\u6570 ", check.found ?? '?', (check.missing?.length ?? 0) > 0 ? `，缺 ${check.missing?.join('、')}` : '，一致', (check.empty_ops?.length ?? 0) > 0 && `；空刀路：${check.empty_ops?.join('、')}`, check.listing_ok === false && '（out_dir 列举失败，判不出）'] })), run.delivery.length > 0 && (_jsx("div", { className: "camrun-files", children: run.delivery.map((file) => (_jsx(DeliveryFileRow, { sessionId: sessionId, runId: run.run_id, file: file }, file.name))) })), detail !== null && detail.nc_error !== undefined && _jsx("p", { className: "camrun-warn", children: detail.nc_error }), detail !== null && detail.delivered && detail.nc_files.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("h4", { className: "camrun-section-title", children: ["NC \u7A0B\u5E8F\uFF08", detail.nc_files.length, "\uFF09"] }), _jsx("div", { className: "camrun-files", children: detail.nc_files.map((name) => (_jsxs("div", { className: "camrun-file", children: [_jsx("span", { className: "camrun-file-name", title: name, children: name }), _jsxs("span", { className: "camrun-file-actions", children: [_jsx("a", { href: api.camDeliveryFileUrl(sessionId, run.run_id, `nc/${name}`), children: "\u4E0B\u8F7D" }), _jsx(NcToolpathButton, { sessionId: sessionId, runId: run.run_id, name: name })] })] }, name))) })] }))] }));
}
export function CamRuns({ sessionId }) {
    const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
    const runs = snapshot.camRuns[sessionId] ?? [];
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState();
    // 页签激活（本组件挂载）期间：立即拉一次 + 5s 轮询；内容没变 store 不 publish。
    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            try {
                const result = await api.camRuns(sessionId);
                if (cancelled)
                    return;
                workbenchActions.setCamRuns(sessionId, result.runs);
                setError(undefined);
                setLoaded(true);
            }
            catch (err) {
                if (cancelled)
                    return;
                setError(err instanceof Error ? err.message : String(err));
                setLoaded(true);
            }
        };
        setLoaded(false);
        void refresh();
        const timer = setInterval(() => void refresh(), 5000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [sessionId]);
    if (!loaded)
        return _jsx("div", { className: "workbench-empty", children: "\u8BFB\u53D6 CAM run \u5217\u8868\u2026" });
    if (error !== undefined)
        return _jsxs("div", { className: "workbench-empty", children: ["CAM run \u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF1A", error] });
    if (runs.length === 0) {
        return _jsx("div", { className: "workbench-empty", children: "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709 CAM run\u2014\u2014cam_plan \u843D\u76D8\u540E\u51FA\u73B0\u5728\u8FD9\u91CC\uFF08\u6570\u636E\u6E90\u662F run \u76EE\u5F55\uFF0C\u4E0E\u4F1A\u8BDD\u4E8B\u4EF6\u65E0\u5173\uFF09\u3002" });
    }
    return (_jsx("div", { className: "workbench-section camrun-list", children: runs.map((run) => (_jsx(CamRunCard, { sessionId: sessionId, run: run }, run.run_id))) }));
}
