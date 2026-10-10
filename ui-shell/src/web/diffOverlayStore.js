let snapshot = {
    open: null,
    loading: false,
};
const listeners = new Set();
let loadSeq = 0;
function publish(next) {
    snapshot = next;
    for (const listener of listeners)
        listener();
}
export function getDiffOverlaySnapshot() {
    return snapshot;
}
export function subscribeDiffOverlay(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
async function loadActive(open, path) {
    const seq = ++loadSeq;
    const file = open.files.find((item) => item.path === path);
    if (!file) {
        publish({ open, loading: false, error: `没有文件：${path}` });
        return;
    }
    publish({ open, loading: true, error: undefined, document: undefined });
    try {
        const loaded = await file.load();
        if (seq !== loadSeq)
            return;
        publish({
            open,
            loading: false,
            document: {
                path: file.path,
                leftLabel: open.leftLabel,
                rightLabel: open.rightLabel,
                left: loaded.left,
                right: loaded.right,
                kind: loaded.kind ?? file.kind,
                additions: file.additions,
                deletions: file.deletions,
                truncated: loaded.truncated,
            },
        });
    }
    catch (err) {
        if (seq !== loadSeq)
            return;
        publish({
            open,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
export const diffOverlayActions = {
    open(next) {
        const activePath = next.files.some((file) => file.path === next.activePath)
            ? next.activePath
            : next.files[0]?.path;
        if (!activePath)
            return;
        const open = { ...next, activePath };
        void loadActive(open, activePath);
    },
    select(path) {
        if (!snapshot.open)
            return;
        if (snapshot.open.activePath === path && snapshot.document)
            return;
        const open = { ...snapshot.open, activePath: path };
        void loadActive(open, path);
    },
    close() {
        loadSeq += 1;
        if (!snapshot.open)
            return;
        publish({ open: null, loading: false });
    },
};
if (typeof window !== 'undefined') {
    window.__camindDiff__ = diffOverlayActions;
}
