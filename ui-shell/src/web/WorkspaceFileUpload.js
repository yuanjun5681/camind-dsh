import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 官方 Composer 的文件上传扩展：按钮占 input.left，input.dock 只作为附件 rail 的生命周期锚点。
 * rail 通过 portal 进入官方 Composer 卡片、位于 textarea 上方；上传元数据保存在 Host pending
 * 标记中，并在 pre-step 作为独立上下文进入模型，Composer draft 始终只保存用户实际输入。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
// 0.1.1 起包根变成 Host 存根、不再导出原子组件；直接引 vendor 源码（保留 CSS 类名）。
import { DropOverlay } from '../../vendor/dsh-client-ui-attachment/src/DropOverlay';
import { api } from './api';
import { previewFile } from './previewClient';
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore';
const MAX_UPLOAD_FILES = 32;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BATCH_BYTES = 64 * 1024 * 1024;
const OFFICIAL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
function useComposerAttachmentHost(active, sessionId) {
    const [host, setHost] = useState(null);
    useLayoutEffect(() => {
        setHost(null);
        if (!active)
            return;
        let mountedHost = null;
        let observer;
        const mount = () => {
            const card = document.querySelector('[data-composer-card]');
            const inputScroll = card?.querySelector('[data-input-scroll]');
            if (!card || !inputScroll)
                return false;
            const nextHost = document.createElement('div');
            nextHost.className = 'workspace-upload-attachment-host';
            nextHost.dataset.workspaceUploadAttachmentHost = sessionId;
            card.insertBefore(nextHost, inputScroll);
            mountedHost = nextHost;
            setHost(nextHost);
            observer?.disconnect();
            return true;
        };
        if (!mount()) {
            observer = new MutationObserver(mount);
            observer.observe(document.body, { childList: true, subtree: true });
        }
        return () => {
            observer?.disconnect();
            mountedHost?.remove();
        };
    }, [active, sessionId]);
    return host;
}
function hasDraggedFiles(event) {
    return event.dataTransfer?.types.includes('Files') ?? false;
}
function takesGeneralFileDrop(dataTransfer) {
    const items = [...dataTransfer.items].filter((item) => item.kind === 'file');
    if (items.length === 0)
        return true;
    return items.some((item) => !OFFICIAL_IMAGE_TYPES.has(item.type));
}
function containsDirectory(dataTransfer) {
    return [...dataTransfer.items].some((item) => {
        if (item.kind !== 'file')
            return false;
        const entry = item
            .webkitGetAsEntry?.();
        return entry?.isDirectory === true;
    });
}
export function WorkspaceUploadDock({ sessionId, input, useProjection, addDroppedImages, }) {
    const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot);
    const [removingPath, setRemovingPath] = useState();
    const [removeError, setRemoveError] = useState();
    const [dragActive, setDragActive] = useState(false);
    const [dragCount, setDragCount] = useState(0);
    const [dropBusy, setDropBusy] = useState(false);
    const [dropError, setDropError] = useState();
    const previousInput = useRef({ draft: input.draft, attachmentCount: input.attachmentIds?.length ?? 0, phase: input.phase });
    const refreshSeq = useRef(0);
    const dragDepth = useRef(0);
    const dragTakeover = useRef(false);
    const imageLimits = useProjection('imageLimits');
    const refresh = useCallback(() => {
        const seq = ++refreshSeq.current;
        void api.pendingWorkspaceUploads(sessionId).then((result) => {
            if (seq !== refreshSeq.current)
                return;
            workbenchActions.setPendingUploads(sessionId, result.batches);
        }).catch(() => {
            // 短暂的 Host/网络失败保留当前 chips；下一次提交或重新挂载会重试。
        });
    }, [sessionId]);
    useEffect(() => {
        // 新会话提交会切换到详情路由并重新挂载 Dock。首次请求可能早于 Host
        // pre-step 消费 pending 标记，因此做一组有界重查；右侧工作台的上传历史不受影响。
        refresh();
        const retries = [250, 1000, 2500, 5000].map((delay) => window.setTimeout(refresh, delay));
        return () => {
            for (const retry of retries)
                window.clearTimeout(retry);
            refreshSeq.current += 1;
        };
    }, [refresh]);
    useEffect(() => {
        const current = { draft: input.draft, attachmentCount: input.attachmentIds?.length ?? 0, phase: input.phase };
        const previous = previousInput.current;
        const contentCleared = (previous.draft.trim() !== '' || previous.attachmentCount > 0)
            && current.draft.trim() === ''
            && current.attachmentCount === 0;
        const submitSettled = previous.phase === 'submitting' && current.phase !== 'submitting';
        const submitted = contentCleared || submitSettled;
        previousInput.current = current;
        if (!submitted)
            return;
        const early = window.setTimeout(refresh, 250);
        const settled = window.setTimeout(refresh, 1000);
        return () => {
            window.clearTimeout(early);
            window.clearTimeout(settled);
        };
    }, [input.draft, input.attachmentIds, input.phase, refresh]);
    const handleDroppedFiles = useCallback(async (dropped) => {
        if (input.phase !== 'plain' || dropBusy)
            return;
        const images = dropped.filter((file) => OFFICIAL_IMAGE_TYPES.has(file.type));
        const files = dropped.filter((file) => !OFFICIAL_IMAGE_TYPES.has(file.type));
        const invalid = validateWorkspaceFiles(files);
        if (invalid) {
            setDropError(invalid);
            return;
        }
        setDropError(undefined);
        if (images.length > 0) {
            const imageError = addDroppedImages?.(images, input.attachmentIds ?? [], imageLimits) ?? '当前 Composer 无法接收拖入的图片';
            if (imageError) {
                setDropError(imageError);
                return;
            }
        }
        if (files.length === 0)
            return;
        setDropBusy(true);
        try {
            await uploadWorkspaceFiles(sessionId, files);
        }
        catch (error) {
            setDropError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setDropBusy(false);
        }
    }, [addDroppedImages, dropBusy, imageLimits, input.attachmentIds, input.phase, sessionId]);
    useEffect(() => {
        const reset = () => {
            dragDepth.current = 0;
            dragTakeover.current = false;
            setDragActive(false);
            setDragCount(0);
        };
        const claim = (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        const onDragEnter = (event) => {
            if (!hasDraggedFiles(event) || !event.dataTransfer)
                return;
            const takeover = dragTakeover.current || takesGeneralFileDrop(event.dataTransfer);
            if (!takeover)
                return;
            claim(event);
            dragTakeover.current = true;
            dragDepth.current += 1;
            setDragCount([...event.dataTransfer.items].filter((item) => item.kind === 'file').length);
            setDragActive(true);
        };
        const onDragOver = (event) => {
            if (!hasDraggedFiles(event) || !event.dataTransfer)
                return;
            if (!dragTakeover.current && !takesGeneralFileDrop(event.dataTransfer))
                return;
            claim(event);
            dragTakeover.current = true;
            event.dataTransfer.dropEffect = input.phase === 'plain' && !dropBusy ? 'copy' : 'none';
        };
        const onDragLeave = (event) => {
            if (!dragTakeover.current)
                return;
            claim(event);
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0)
                reset();
            const leavingViewport = event.clientX <= 0 || event.clientY <= 0
                || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
            if ((event.target === document.documentElement || event.target === document.body) && leavingViewport)
                reset();
        };
        const onDrop = (event) => {
            if (!hasDraggedFiles(event) || !event.dataTransfer)
                return;
            const files = [...event.dataTransfer.files];
            const takeover = dragTakeover.current || files.some((file) => !OFFICIAL_IMAGE_TYPES.has(file.type));
            if (!takeover)
                return;
            claim(event);
            const directory = containsDirectory(event.dataTransfer);
            reset();
            if (directory) {
                setDropError('暂不支持拖入文件夹，请先压缩为 ZIP');
                return;
            }
            if (input.phase !== 'plain' || dropBusy) {
                setDropError('当前输入状态不能上传文件');
                return;
            }
            void handleDroppedFiles(files);
        };
        const onDragEnd = () => reset();
        document.addEventListener('dragenter', onDragEnter, true);
        document.addEventListener('dragover', onDragOver, true);
        document.addEventListener('dragleave', onDragLeave, true);
        document.addEventListener('drop', onDrop, true);
        window.addEventListener('dragend', onDragEnd);
        return () => {
            document.removeEventListener('dragenter', onDragEnter, true);
            document.removeEventListener('dragover', onDragOver, true);
            document.removeEventListener('dragleave', onDragLeave, true);
            document.removeEventListener('drop', onDrop, true);
            window.removeEventListener('dragend', onDragEnd);
        };
    }, [dropBusy, handleDroppedFiles, input.phase]);
    useEffect(() => {
        if (!dropError)
            return;
        const timeout = window.setTimeout(() => setDropError(undefined), 5000);
        return () => window.clearTimeout(timeout);
    }, [dropError]);
    const batches = snapshot.pendingUploads[sessionId] ?? [];
    const files = batches.flatMap((batch) => batch.files.map((file) => ({ ...file, batchId: batch.batchId })));
    const host = useComposerAttachmentHost(files.length > 0, sessionId);
    async function remove(batchId, path) {
        setRemovingPath(path);
        setRemoveError(undefined);
        try {
            const result = await api.removePendingWorkspaceUpload(sessionId, { batchId, path });
            workbenchActions.setPendingUploads(sessionId, result.batches);
        }
        catch (error) {
            setRemoveError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setRemovingPath(undefined);
        }
    }
    return (_jsxs(_Fragment, { children: [dragActive && (_jsx(DropOverlay, { disabled: input.phase !== 'plain' || dropBusy, labels: input.phase !== 'plain' || dropBusy
                    ? { title: '当前不能上传文件' }
                    : {
                        title: '松开以上传文件',
                        desc: dragCount > 0
                            ? `${dragCount} 个项目；图片显示预览，其他文件附加到当前消息`
                            : '图片显示预览，其他文件附加到当前消息',
                    } })), (dropBusy || dropError) && createPortal(_jsx("div", { className: "workspace-upload-drop-status", role: "status", children: dropBusy ? '正在上传拖入的文件…' : dropError }), document.body), files.length > 0 && host && createPortal(_jsx("div", { className: "workspace-upload-attachment-rail", role: "group", "aria-label": "\u5F85\u53D1\u9001\u6587\u4EF6", title: removeError, children: files.map((file) => (_jsxs("div", { className: "workspace-upload-attachment", children: [_jsxs("button", { type: "button", className: "workspace-upload-attachment-preview", title: `预览 ${file.name}`, onClick: () => previewFile(sessionId, file.path), children: [_jsx("span", { className: "workspace-upload-attachment-icon", "aria-hidden": "true", children: "\u25A4" }), _jsx("span", { className: "workspace-upload-attachment-name", children: file.name })] }), _jsx("button", { type: "button", className: "workspace-upload-attachment-remove", "aria-label": `移除 ${file.name}`, title: removeError && removingPath === file.path ? removeError : `从本轮发送中移除 ${file.name}`, disabled: removingPath === file.path, onClick: () => void remove(file.batchId, file.path), children: "\u00D7" })] }, file.path))) }), host)] }));
}
