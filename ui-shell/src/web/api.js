async function request(path, init) {
    const res = await fetch(`/camind/api${path}`, {
        ...init,
        headers: {
            Accept: 'application/json',
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
        },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
        throw new Error(data.error || data.message || res.statusText);
    }
    return data;
}
export const api = {
    state: () => request('/state'),
    listFs: (dir) => request(`/fs?path=${encodeURIComponent(dir)}`),
    createWorkspace: (path, title) => request('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ path, title }),
    }),
    pickDirectory: () => request('/pick-directory', { method: 'POST' }),
    renameWorkspace: (id, title) => request(`/workspaces/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify({ title }),
    }),
    deleteWorkspace: (id) => request(`/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    renameSession: (id, title) => request(`/sessions/${encodeURIComponent(id)}/rename`, {
        method: 'POST',
        body: JSON.stringify({ title }),
    }),
    forkSession: (id) => request(`/sessions/${encodeURIComponent(id)}/fork`, { method: 'POST' }),
    archiveSession: (id) => request(`/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
    models: () => request('/models'),
    permissions: () => request('/permissions'),
    presets: () => request('/presets'),
    setPermission: (id, preset) => request(`/sessions/${encodeURIComponent(id)}/permission`, {
        method: 'POST',
        body: JSON.stringify({ preset }),
    }),
    selectPreset: (id, agentPreset) => request(`/sessions/${encodeURIComponent(id)}/preset`, {
        method: 'POST',
        body: JSON.stringify({ agentPreset }),
    }),
    createSession: (body) => request('/sessions', { method: 'POST', body: JSON.stringify(body) }),
    resume: (id, body) => request(`/sessions/${encodeURIComponent(id)}/resume`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
    }),
    prompt: (id, body) => request(`/sessions/${encodeURIComponent(id)}/prompt`, {
        method: 'POST',
        body: JSON.stringify(body),
    }),
    cancel: (id) => request(`/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    snapshot: (id) => request(`/sessions/${encodeURIComponent(id)}/events`),
    listCommands: (id) => request(`/sessions/${encodeURIComponent(id)}/commands`),
    executeCommand: (id, line) => request(`/sessions/${encodeURIComponent(id)}/command`, {
        method: 'POST',
        body: JSON.stringify({ line }),
    }),
    uploadWorkspaceFiles: (id, files) => request(`/sessions/${encodeURIComponent(id)}/files`, {
        method: 'POST',
        body: JSON.stringify({ files }),
    }),
    pendingWorkspaceUploads: (id) => request(`/sessions/${encodeURIComponent(id)}/files`),
    sessionUploads: (id) => request(`/sessions/${encodeURIComponent(id)}/uploads`),
    // CAM run 只读查询（tool-cam Host 路由；数据源 = run 目录落盘）。
    camRuns: (sessionId) => request(`/cam/runs?session=${encodeURIComponent(sessionId)}`),
    camRunDetail: (sessionId, runId) => request(`/cam/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}`),
    /** 交付文件/NC 条目的原始下载 URL（不经 request 封装，直接给 <a href> 或 fetch 文本）。 */
    camDeliveryFileUrl: (sessionId, runId, file) => `/camind/api/cam/runs/${encodeURIComponent(sessionId)}/${encodeURIComponent(runId)}/delivery/${file.split('/').map(encodeURIComponent).join('/')}`,
    removePendingWorkspaceUpload: (id, body) => request(`/sessions/${encodeURIComponent(id)}/files`, {
        method: 'DELETE',
        body: JSON.stringify(body),
    }),
    gitStatus: (id) => request(`/sessions/${encodeURIComponent(id)}/git`),
    clientPlugins: () => request('/client-plugins'),
    settings: () => request('/settings'),
    mutateSettings: (body) => request('/settings/mutate', { method: 'POST', body: JSON.stringify(body) }),
    openSettingsDocument: () => request('/settings/open', { method: 'POST' }),
    llmProviders: () => request('/settings/providers'),
    discoverModels: (body) => request('/settings/providers/discover', {
        method: 'POST',
        body: JSON.stringify(body),
    }),
    describeCredentials: (refs) => request('/credentials/describe', {
        method: 'POST',
        body: JSON.stringify({ refs }),
    }),
    setCredential: (ref, value) => request('/credentials/set', {
        method: 'POST',
        body: JSON.stringify({ ref, value }),
    }),
    unsetCredential: (ref) => request('/credentials/unset', {
        method: 'POST',
        body: JSON.stringify({ ref }),
    }),
    pluginInventory: () => request('/settings/plugins'),
    settingsPresets: () => request('/settings/presets'),
    presetDocument: (id) => request(`/settings/presets/${encodeURIComponent(id)}/document`),
    copyPreset: (from, id, name) => request('/settings/presets/copy', {
        method: 'POST',
        body: JSON.stringify({ from, id, name }),
    }),
    removePreset: (id) => request('/settings/presets/remove', {
        method: 'POST',
        body: JSON.stringify({ id }),
    }),
    openPresetLocation: (id) => request('/settings/presets/open', {
        method: 'POST',
        body: JSON.stringify({ id }),
    }),
};
/** 对齐官方 session-log-export：HEAD 预检后再把 GET URL 交给浏览器下载管理器。 */
export async function downloadSessionExport(sessionId) {
    const filename = `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.zip`;
    const url = `/api/session.export?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=true`;
    const probe = await fetch(url, { method: 'HEAD' });
    if (!probe.ok && probe.status !== 405) {
        const detail = await probe.text().catch(() => '');
        throw new Error(`导出失败：HTTP ${probe.status}${detail ? ` ${detail}` : ''}`);
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}
export function openSessionStream(id, onMessage) {
    const source = new EventSource(`/camind/api/sessions/${encodeURIComponent(id)}/stream`);
    source.onmessage = (ev) => {
        try {
            onMessage(JSON.parse(ev.data));
        }
        catch {
            onMessage({ type: 'error', error: '无法解析事件流' });
        }
    };
    source.onerror = () => {
        onMessage({ type: 'error', error: '事件流中断，正在重连…' });
    };
    return () => source.close();
}
