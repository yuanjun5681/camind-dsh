import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ui-shell 的路由感知 frame（顶替官方 AppFrame 的 root occupant）。
 * 0.2.0 布局：sidebar 列 + 中央 keyed `main`（conversation 或全局面板）
 * + Workbench 列 + rightbar 列（官方右侧栏，0.1.1 的 details 已并入）。
 * 全局 Shell 只拥有 sidebar / page / overlay；会话详情三列属于子布局。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getLayoutSnapshot, layoutActions, subscribeLayout } from './officialLayout';
import { getOfficialClient } from './officialClient';
import { Workbench } from './Workbench';
import { DeliverablesSync } from './DeliverablesSync';
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore';
const SIDEBAR_DEFAULT = 280;
const SIDEBAR_COLLAPSED = 56;
const SIDEBAR_AUTO_COLLAPSE = 1024;
const WORKBENCH_DEFAULT = 360;
const WORKBENCH_MIN = 300;
const WORKBENCH_MAX = 560;
const RIGHTBAR_WIDTH = 380;
/** 0.2.0 的「当前会话」：mainView 保留计数 > 0 的列表行（ui-workspace 导航写入）。 */
export function selectMainSession(state) {
    for (const row of Object.values(state.byId)) {
        if (row && (row.retainedBy?.mainView ?? 0) > 0)
            return row;
    }
    return undefined;
}
function sessionIdFromPath(pathname) {
    if (!pathname.startsWith('/s/'))
        return undefined;
    try {
        return decodeURIComponent(pathname.slice(3));
    }
    catch {
        return undefined;
    }
}
function isPluginPagePath(pathname) {
    return pathname === '/pages' || pathname.startsWith('/pages/');
}
function SessionDetailLayout({ current, rightbarOpen, renderSlot, viewport }) {
    const workbench = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
    const [workbenchWidth, setWorkbenchWidth] = useState(WORKBENCH_DEFAULT);
    const resize = useRef();
    const rightbarWidth = current && rightbarOpen ? RIGHTBAR_WIDTH : 0;
    const workbenchVisible = Boolean(current) && workbench.open && !rightbarOpen;
    const workbenchOverlay = viewport < 1100;
    const resolvedWorkbenchWidth = workbenchVisible && !workbenchOverlay
        ? Math.min(workbenchWidth, Math.max(WORKBENCH_MIN, viewport * 0.4))
        : 0;
    function beginWorkbenchResize(event) {
        if (!workbenchVisible)
            return;
        resize.current = { x: event.clientX, width: workbenchWidth };
        const move = (next) => {
            const start = resize.current;
            if (!start)
                return;
            setWorkbenchWidth(Math.min(WORKBENCH_MAX, Math.max(WORKBENCH_MIN, start.width + start.x - next.clientX)));
        };
        const stop = () => {
            resize.current = undefined;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        event.preventDefault();
    }
    return (_jsxs("section", { className: "official-session-page", style: { gridTemplateColumns: `minmax(0, 1fr) ${resolvedWorkbenchWidth}px ${rightbarWidth}px` }, "data-workbench-collapsed": !workbenchVisible || undefined, "data-workbench-overlay": workbenchOverlay || undefined, "data-details-collapsed": !rightbarOpen || undefined, children: [_jsx("main", { className: "official-conversation", children: renderSlot('main', {}, { entryKey: 'conversation' }) }), current && _jsx(DeliverablesSync, { sessionId: current.id }), _jsx("div", { className: "official-workbench-column", children: workbenchVisible && (_jsxs(_Fragment, { children: [_jsx("div", { className: "workbench-resizer", role: "separator", "aria-orientation": "vertical", onPointerDown: beginWorkbenchResize }), _jsx(Workbench, { session: current })] })) }), _jsx("div", { className: "official-details-column", children: renderSlot('rightbar', {
                    width: rightbarWidth,
                    viewportWidth: viewport,
                    canShow: rightbarOpen,
                }) }), current && !workbenchVisible && !rightbarOpen && (_jsx("button", { type: "button", className: "workbench-open", onClick: () => workbenchActions.open(), children: "\u5DE5\u4F5C\u53F0" }))] }));
}
export function OfficialSlotRoot({ renderSlot, renderSlotChain, useSessions }) {
    const location = useLocation();
    const navigate = useNavigate();
    const panels = useSyncExternalStore(subscribeLayout, getLayoutSnapshot);
    const [viewport, setViewport] = useState(() => window.innerWidth);
    const current = useSessions(selectMainSession);
    useEffect(() => {
        const onResize = () => setViewport(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
    useEffect(() => {
        layoutActions.setNarrow(narrow);
    }, [narrow]);
    const collapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0;
    const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : (panels.sidebar || SIDEBAR_DEFAULT);
    const routeOwner = {
        pathname: location.pathname,
        navigate: (path) => { navigate(path); },
    };
    const pluginPage = renderSlotChain('shell.content', routeOwner, { fallback: null });
    // 新会话首页扩展（camind-ui-home）：只在 / 分支渲染；无 entry 时为 null，
    // display:contents 锚点不影响布局，官方 conversation 行为完全不变。
    const homePage = renderSlotChain('shell.home', routeOwner, { fallback: null });
    const pluginPageRoute = isPluginPagePath(location.pathname);
    const routeSessionId = sessionIdFromPath(location.pathname);
    const routeSession = routeSessionId && current?.id === routeSessionId ? current : undefined;
    const activePanel = panels.activePanel;
    const rightbar = panels.rightbar;
    // 插件页与全局面板互斥：进入插件页路由时清掉面板选中；面板选中（侧栏行
    // 点击）在渲染上压过插件页，形成双向可切换。
    useEffect(() => {
        if (pluginPageRoute && activePanel !== null) {
            const layout = getOfficialClient()?.get('layout');
            layout?.selectPanel(null);
        }
    }, [pluginPageRoute, activePanel]);
    return (_jsxs("div", { className: "official-frame", style: { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }, "data-sidebar-collapsed": collapsed || undefined, children: [_jsx("div", { className: "official-sidebar", style: { width: sidebarWidth }, children: renderSlot('sidebar', {
                    collapsed,
                    width: sidebarWidth,
                    ...routeOwner,
                }) }), _jsx("div", { className: "official-page", children: activePanel !== null ? (_jsx("main", { className: "official-main-panel", children: renderSlot('main', {}, { entryKey: activePanel }) })) : pluginPageRoute ? (_jsx("main", { className: "official-page-content", children: pluginPage })) : routeSessionId ? (_jsx(SessionDetailLayout, { current: routeSession, rightbarOpen: rightbar.open, renderSlot: renderSlot, viewport: viewport })) : (_jsxs("main", { className: "official-conversation official-home", children: [homePage, _jsx("div", { className: "official-home-conversation", children: renderSlot('main', {}, { entryKey: 'conversation' }) })] })) }), _jsx("div", { className: "official-overlay", "data-shell-overlay": true, children: renderSlot('shell.overlay', {}) })] }));
}
