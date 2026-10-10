let snapshot = {
    open: true,
    tab: 'input',
    uploads: {},
    pendingUploads: {},
    deliverables: {},
    camRuns: {},
};
const listeners = new Set();
function publish(next) {
    snapshot = next;
    for (const listener of listeners)
        listener();
}
export function getWorkbenchSnapshot() {
    return snapshot;
}
export function subscribeWorkbench(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export const workbenchActions = {
    open(tab = snapshot.tab) {
        publish({ ...snapshot, open: true, tab });
    },
    close() {
        publish({ ...snapshot, open: false });
    },
    toggle() {
        publish({ ...snapshot, open: !snapshot.open });
    },
    select(tab) {
        publish({ ...snapshot, open: true, tab });
    },
    addUploads(sessionId, files) {
        const previous = snapshot.uploads[sessionId] ?? [];
        const byPath = new Map(previous.map((file) => [file.path, file]));
        for (const file of files)
            byPath.set(file.path, file);
        publish({
            ...snapshot,
            uploads: { ...snapshot.uploads, [sessionId]: [...byPath.values()] },
        });
    },
    addPendingUpload(sessionId, batch) {
        const previous = snapshot.pendingUploads[sessionId] ?? [];
        const next = [...previous.filter((item) => item.batchId !== batch.batchId), batch];
        publish({
            ...snapshot,
            pendingUploads: { ...snapshot.pendingUploads, [sessionId]: next },
        });
    },
    setPendingUploads(sessionId, batches) {
        publish({
            ...snapshot,
            pendingUploads: { ...snapshot.pendingUploads, [sessionId]: [...batches] },
        });
    },
    setDeliverables(sessionId, paths) {
        // 无头同步（DeliverablesSync）写回：内容没变就跳过 publish。
        const previous = snapshot.deliverables[sessionId] ?? [];
        if (previous.length === paths.length && previous.every((path, index) => path === paths[index]))
            return;
        publish({
            ...snapshot,
            deliverables: { ...snapshot.deliverables, [sessionId]: [...paths] },
        });
    },
    setCamRuns(sessionId, runs) {
        // 5s 轮询写回：内容没变就跳过 publish，避免工作台无谓重渲染。
        const previous = snapshot.camRuns[sessionId];
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(runs))
            return;
        publish({
            ...snapshot,
            camRuns: { ...snapshot.camRuns, [sessionId]: [...runs] },
        });
    },
};
