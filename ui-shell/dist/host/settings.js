/**
 * 设置相关 REST：把 dsh 的 settings / credentials / llm 配置面 / 插件清单
 * 暴露给自定义前端。服务都是可选的（ctx.get），与官方 apiproxy 同一套。
 */
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { readJson, sendError, sendJson } from './http.js';
function isConflict(error) {
    return Boolean(error && typeof error === 'object' && error.code === 'SETTINGS_CONFLICT');
}
function namespaceView(descriptor) {
    return {
        ns: String(descriptor.ns),
        schema: descriptor.schema,
        value: descriptor.value,
        ...descriptor.base === undefined ? {} : { base: descriptor.base },
        ...descriptor.user === undefined ? {} : { user: descriptor.user },
        applies: descriptor.applies,
        secrets: (descriptor.secrets ?? []).map((secret) => ({ path: [...secret.path], set: secret.set })),
        revision: descriptor.revision,
    };
}
function settingsOf(ctx) {
    return ctx.get?.('settings');
}
function credentialsOf(ctx) {
    return ctx.get?.('credentials');
}
function inventoryOf(ctx) {
    return ctx.get?.('pluginInventory');
}
function isLoopback(req) {
    const host = (req.headers.host ?? '').split(':')[0];
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}
function describeDocument(ctx, req) {
    const settings = settingsOf(ctx);
    if (!settings)
        throw new Error('当前部署没有设置服务');
    return {
        writable: settings.writable,
        ...settings.documentPath ? { documentPath: settings.documentPath } : {},
        canOpen: Boolean(settings.documentPath) && isLoopback(req),
        namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),
    };
}
function describeNamespace(settings, ns) {
    return settings.describe({ redactSecrets: true }).map(namespaceView).find((entry) => entry.ns === ns);
}
function openNative(target, asText) {
    return new Promise((resolve, reject) => {
        const args = process.platform === 'darwin'
            ? asText ? ['-t', target] : [target]
            : [target];
        const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
        const child = spawn(command, args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`无法打开：${target}`));
        });
    });
}
function providerViews(ctx) {
    const llm = ctx.llm;
    if (!llm)
        return [];
    const registered = llm.listProviders();
    const active = new Set(registered.map((provider) => provider.id));
    const directory = llm.listConfigurableProviders?.() ?? [];
    const declared = new Set(directory.map((entry) => entry.provider));
    const views = directory.map((entry) => ({
        provider: entry.provider,
        displayName: entry.displayName,
        settingsNs: entry.settingsNs,
        settingsPath: [...entry.settingsPath],
        active: active.has(entry.provider),
        ...entry.declared === undefined ? {} : { declared: entry.declared },
    }));
    for (const provider of registered) {
        if (declared.has(provider.id))
            continue;
        views.push({
            provider: provider.id,
            displayName: provider.name,
            settingsNs: '',
            settingsPath: [],
            active: true,
        });
    }
    return views;
}
async function rosterOf(ctx) {
    const presets = ctx.agentPresets;
    if (!presets) {
        return { presets: [], defaultId: '', authorable: false, hasDocument: false };
    }
    const defaultId = presets.defaultId;
    return {
        presets: (await presets.list()).map((preset) => ({
            id: preset.id,
            trust: preset.trust,
            isDefault: preset.id === defaultId,
            ...preset.name === undefined ? {} : { name: preset.name },
            ...preset.description === undefined ? {} : { description: preset.description },
            ...preset.broken === undefined ? {} : { broken: preset.broken },
        })),
        defaultId,
        authorable: presets.authorable,
        hasDocument: process.platform === 'darwin' || process.platform === 'linux',
    };
}
/**
 * 处理 /camind/api/settings* 与凭据/提供方/预设写作。匹配到则返回 true。
 */
export async function handleSettingsApi(ctx, req, res, url) {
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    const method = req.method ?? 'GET';
    if (method === 'GET' && pathname === '/camind/api/settings') {
        try {
            sendJson(res, 200, describeDocument(ctx, req));
        }
        catch (err) {
            sendError(res, 404, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/settings/mutate') {
        const settings = settingsOf(ctx);
        if (!settings) {
            sendError(res, 404, '当前部署没有设置服务');
            return true;
        }
        const body = await readJson(req);
        if (!body?.ns || typeof body.ns !== 'string' || !Array.isArray(body.ops)) {
            sendError(res, 400, '需要 ns 与 ops');
            return true;
        }
        try {
            await settings.mutate(body.ns, body.ops, body.expectedRevision);
        }
        catch (err) {
            if (isConflict(err)) {
                sendError(res, 409, '设置已被其他地方改动，请关闭后重新打开再编辑。');
                return true;
            }
            sendError(res, 400, err instanceof Error ? err.message : String(err));
            return true;
        }
        const view = describeNamespace(settings, body.ns);
        if (!view) {
            sendError(res, 500, `写入后找不到命名空间 ${body.ns}`);
            return true;
        }
        sendJson(res, 200, view);
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/settings/open') {
        const settings = settingsOf(ctx);
        if (!settings) {
            sendError(res, 404, '当前部署没有设置服务');
            return true;
        }
        if (!isLoopback(req)) {
            sendError(res, 403, '仅本机可打开配置文件');
            return true;
        }
        try {
            const path = await settings.prepareDocument();
            if (!path) {
                sendError(res, 404, '当前部署没有可打开的本地配置文件');
                return true;
            }
            await openNative(path, true);
            sendJson(res, 200, { ok: true, path });
        }
        catch (err) {
            sendError(res, 500, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'GET' && pathname === '/camind/api/settings/providers') {
        sendJson(res, 200, { providers: providerViews(ctx) });
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/settings/providers/discover') {
        const llm = ctx.llm;
        if (!llm?.discoverModels) {
            sendError(res, 404, '当前部署没有模型发现接口');
            return true;
        }
        const body = await readJson(req);
        if (!body?.settingsNs || typeof body.settingsNs !== 'string') {
            sendError(res, 400, '需要 settingsNs');
            return true;
        }
        try {
            const models = await llm.discoverModels(body.settingsNs, {
                ...typeof body.provider === 'string' ? { provider: body.provider } : {},
                ...typeof body.baseURL === 'string' ? { baseURL: body.baseURL } : {},
                ...typeof body.api === 'string' ? { api: body.api } : {},
                ...typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {},
            });
            sendJson(res, 200, { models: models });
        }
        catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/credentials/describe') {
        const credentials = credentialsOf(ctx);
        if (!credentials) {
            sendError(res, 404, '当前部署没有凭据服务');
            return true;
        }
        const body = await readJson(req);
        const refs = Array.isArray(body?.refs) ? body.refs.filter((ref) => typeof ref === 'string') : [];
        const entries = await Promise.all(refs.map(async (ref) => {
            const info = await credentials.describe(ref);
            const view = {
                configured: info.configured,
                writable: info.writable,
                ...info.source === undefined ? {} : { source: info.source },
            };
            return [ref, view];
        }));
        sendJson(res, 200, { credentials: Object.fromEntries(entries) });
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/credentials/set') {
        const credentials = credentialsOf(ctx);
        if (!credentials) {
            sendError(res, 404, '当前部署没有凭据服务');
            return true;
        }
        const body = await readJson(req);
        if (!body?.ref || typeof body.ref !== 'string' || typeof body.value !== 'string') {
            sendError(res, 400, '需要 ref 与 value');
            return true;
        }
        try {
            await credentials.set(body.ref, body.value);
            sendJson(res, 200, { ok: true });
        }
        catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/credentials/unset') {
        const credentials = credentialsOf(ctx);
        if (!credentials) {
            sendError(res, 404, '当前部署没有凭据服务');
            return true;
        }
        const body = await readJson(req);
        if (!body?.ref || typeof body.ref !== 'string') {
            sendError(res, 400, '需要 ref');
            return true;
        }
        try {
            await credentials.unset(body.ref);
            sendJson(res, 200, { ok: true });
        }
        catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'GET' && pathname === '/camind/api/settings/plugins') {
        const inventory = inventoryOf(ctx);
        if (!inventory) {
            sendError(res, 404, '当前部署没有插件清单');
            return true;
        }
        try {
            sendJson(res, 200, await inventory.list());
        }
        catch (err) {
            sendError(res, 500, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'GET' && pathname === '/camind/api/settings/presets') {
        sendJson(res, 200, await rosterOf(ctx));
        return true;
    }
    const presetRead = pathname.match(/^\/camind\/api\/settings\/presets\/([^/]+)\/document$/);
    if (method === 'GET' && presetRead) {
        const id = decodeURIComponent(presetRead[1]);
        const presets = ctx.agentPresets;
        if (!presets) {
            sendError(res, 404, '当前环境没有 Agent 预设');
            return true;
        }
        try {
            const preset = await presets.resolve(id);
            const body = {
                id: preset.id,
                trust: preset.trust,
                content: await presets.read(preset.id),
                ...preset.name === undefined ? {} : { name: preset.name },
                ...preset.description === undefined ? {} : { description: preset.description },
            };
            sendJson(res, 200, body);
        }
        catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/settings/presets/copy') {
        const presets = ctx.agentPresets;
        if (!presets) {
            sendError(res, 404, '当前环境没有 Agent 预设');
            return true;
        }
        const body = await readJson(req);
        if (!body?.from || !body?.id) {
            sendError(res, 400, '需要 from 与 id');
            return true;
        }
        try {
            await presets.copy(body.from, body.id, typeof body.name === 'string' ? body.name : undefined);
            sendJson(res, 200, await rosterOf(ctx));
        }
        catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/settings/presets/remove') {
        const presets = ctx.agentPresets;
        if (!presets) {
            sendError(res, 404, '当前环境没有 Agent 预设');
            return true;
        }
        const body = await readJson(req);
        if (!body?.id) {
            sendError(res, 400, '需要 id');
            return true;
        }
        try {
            await presets.remove(body.id);
            sendJson(res, 200, await rosterOf(ctx));
        }
        catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    if (method === 'POST' && pathname === '/camind/api/settings/presets/open') {
        const presets = ctx.agentPresets;
        if (!presets) {
            sendError(res, 404, '当前环境没有 Agent 预设');
            return true;
        }
        const body = await readJson(req);
        if (!body?.id) {
            sendError(res, 400, '需要 id');
            return true;
        }
        try {
            const preset = await presets.resolve(body.id);
            if (preset.trust !== 'user') {
                sendError(res, 400, `预设「${preset.id}」随部署附带，不能在此打开编辑`);
                return true;
            }
            const directory = dirname(preset.path);
            if (process.platform === 'darwin' || process.platform === 'linux') {
                await openNative(directory, false);
                sendJson(res, 200, { opened: true, path: directory });
            }
            else {
                sendJson(res, 200, { opened: false, path: directory });
            }
        }
        catch (err) {
            sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    return false;
}
//# sourceMappingURL=settings.js.map