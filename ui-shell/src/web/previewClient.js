let ctxRef = null;
/** customShell.apply 启动时绑定一次（root ctx，ctx.get 为运行时活查）。 */
export function bindPreviewClient(ctx) {
    ctxRef = ctx;
}
function service() {
    return ctxRef?.get('filePreview');
}
export function previewFile(sessionId, path) {
    service()?.preview(sessionId, path);
}
/** 内容模式预览：调用方已持有文本（如 delivery 路由开包取出的 NC），「预览」标签页直接渲染。 */
export function previewContent(sessionId, name, content) {
    service()?.previewContent(sessionId, name, content);
}
