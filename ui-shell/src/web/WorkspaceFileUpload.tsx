/**
 * 官方 Composer 的文件上传扩展：按钮占 input.left，input.dock 只作为附件 rail 的生命周期锚点。
 * rail 通过 portal 进入官方 Composer 卡片、位于 textarea 上方；上传元数据保存在 Host pending
 * 标记中，并在 pre-step 作为独立上下文进入模型，Composer draft 始终只保存用户实际输入。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
// 0.1.1 起包根变成 Host 存根、不再导出原子组件；直接引 vendor 源码（保留 CSS 类名）。
import { DropOverlay } from '../../vendor/dsh-client-ui-attachment/src/DropOverlay'
import type { UploadedFile } from '@shared/protocol'
import { api } from './api'
import { getWorkbenchSnapshot, subscribeWorkbench, workbenchActions } from './workbenchStore'

const MAX_UPLOAD_FILES = 32
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_UPLOAD_BATCH_BYTES = 64 * 1024 * 1024
const OFFICIAL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

type InputState = { draft: string; imageIds?: readonly string[]; phase: string }
type InputActions = {
  setDraft(text: string): void
  addImages(ids: readonly string[]): boolean
  submit(): void
}
type ImageLimits = {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  mediaTypes: readonly string[]
}

export type DroppedImageIntake = (
  files: readonly File[],
  currentImageIds: readonly string[],
  limits: ImageLimits | undefined,
  addImageIds: (ids: readonly string[]) => boolean,
) => string | null

export type InputZoneProps = {
  sessionId: string
  input: InputState
  inputActions: InputActions
  useProjection(key: string): unknown
  addDroppedImages?: DroppedImageIntake
}

function asBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取 ${file.name}`))
    reader.onload = () => resolve(String(reader.result ?? '').split(',').at(-1) ?? '')
    reader.readAsDataURL(file)
  })
}

function fileSizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${Math.ceil(bytes / 1024 / 1024)} MiB`
}

function validateWorkspaceFiles(files: readonly File[]): string | undefined {
  if (files.length > MAX_UPLOAD_FILES) return `单次最多上传 ${MAX_UPLOAD_FILES} 个文件`
  const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES)
  if (oversized) return `文件过大：${oversized.name}（单文件上限 ${fileSizeText(MAX_UPLOAD_BYTES)}）`
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total > MAX_UPLOAD_BATCH_BYTES) return `本批文件总量超过 ${fileSizeText(MAX_UPLOAD_BATCH_BYTES)}`
}

async function uploadWorkspaceFiles(sessionId: string, files: readonly File[]) {
  if (files.length === 0) return
  const invalid = validateWorkspaceFiles(files)
  if (invalid) throw new Error(invalid)
  const payload: UploadedFile[] = await Promise.all(files.map(async (file) => ({
    name: file.name,
    data: await asBase64(file),
  })))
  const result = await api.uploadWorkspaceFiles(sessionId, payload)
  workbenchActions.addUploads(sessionId, result.files)
  if (result.batchId) {
    workbenchActions.addPendingUpload(sessionId, {
      batchId: result.batchId,
      files: result.files.filter((file) => file.source === 'upload'),
    })
  }
}

export function WorkspaceFileUploadButton({ sessionId, input }: InputZoneProps) {
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(undefined)
    try {
      await uploadWorkspaceFiles(sessionId, [...files])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      if (picker.current) picker.current.value = ''
    }
  }

  return (
    <span className="workspace-upload-control">
      <input
        ref={picker}
        className="workspace-upload-input"
        type="file"
        multiple
        onChange={(event) => void upload(event.currentTarget.files)}
      />
      <button
        type="button"
        className="workspace-upload-button"
        disabled={busy || input.phase !== 'plain'}
        title={error ?? '上传文件到当前会话'}
        onClick={() => picker.current?.click()}
      >
        <span aria-hidden="true">＋</span>
        {busy ? '上传中' : '文件'}
      </button>
    </span>
  )
}

function useComposerAttachmentHost(active: boolean, sessionId: string) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setHost(null)
    if (!active) return

    let mountedHost: HTMLElement | null = null
    let observer: MutationObserver | undefined
    const mount = () => {
      const card = document.querySelector<HTMLElement>('[data-composer-card]')
      const inputScroll = card?.querySelector<HTMLElement>('[data-input-scroll]')
      if (!card || !inputScroll) return false

      const nextHost = document.createElement('div')
      nextHost.className = 'workspace-upload-attachment-host'
      nextHost.dataset.workspaceUploadAttachmentHost = sessionId
      card.insertBefore(nextHost, inputScroll)
      mountedHost = nextHost
      setHost(nextHost)
      observer?.disconnect()
      return true
    }

    if (!mount()) {
      observer = new MutationObserver(mount)
      observer.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      observer?.disconnect()
      mountedHost?.remove()
    }
  }, [active, sessionId])

  return host
}

function hasDraggedFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function takesGeneralFileDrop(dataTransfer: DataTransfer): boolean {
  const items = [...dataTransfer.items].filter((item) => item.kind === 'file')
  if (items.length === 0) return true
  return items.some((item) => !OFFICIAL_IMAGE_TYPES.has(item.type))
}

function containsDirectory(dataTransfer: DataTransfer): boolean {
  return [...dataTransfer.items].some((item) => {
    if (item.kind !== 'file') return false
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null })
      .webkitGetAsEntry?.()
    return entry?.isDirectory === true
  })
}

export function WorkspaceUploadDock({
  sessionId,
  input,
  inputActions,
  useProjection,
  addDroppedImages,
}: InputZoneProps) {
  const snapshot = useSyncExternalStore(subscribeWorkbench, getWorkbenchSnapshot)
  const [removingPath, setRemovingPath] = useState<string>()
  const [removeError, setRemoveError] = useState<string>()
  const [dragActive, setDragActive] = useState(false)
  const [dragCount, setDragCount] = useState(0)
  const [dropBusy, setDropBusy] = useState(false)
  const [dropError, setDropError] = useState<string>()
  const previousInput = useRef({ draft: input.draft, imageCount: input.imageIds?.length ?? 0, phase: input.phase })
  const refreshSeq = useRef(0)
  const dragDepth = useRef(0)
  const dragTakeover = useRef(false)
  const imageLimits = useProjection('imageLimits') as ImageLimits | undefined
  const refresh = useCallback(() => {
    const seq = ++refreshSeq.current
    void api.pendingWorkspaceUploads(sessionId).then((result) => {
      if (seq !== refreshSeq.current) return
      workbenchActions.setPendingUploads(sessionId, result.batches)
    }).catch(() => {
      // 短暂的 Host/网络失败保留当前 chips；下一次提交或重新挂载会重试。
    })
  }, [sessionId])

  useEffect(() => {
    // 新会话提交会切换到详情路由并重新挂载 Dock。首次请求可能早于 Host
    // pre-step 消费 pending 标记，因此做一组有界重查；右侧工作台的上传历史不受影响。
    refresh()
    const retries = [250, 1000, 2500, 5000].map((delay) => window.setTimeout(refresh, delay))
    return () => {
      for (const retry of retries) window.clearTimeout(retry)
      refreshSeq.current += 1
    }
  }, [refresh])

  useEffect(() => {
    const current = { draft: input.draft, imageCount: input.imageIds?.length ?? 0, phase: input.phase }
    const previous = previousInput.current
    const contentCleared = (previous.draft.trim() !== '' || previous.imageCount > 0)
      && current.draft.trim() === ''
      && current.imageCount === 0
    const submitSettled = previous.phase === 'submitting' && current.phase !== 'submitting'
    const submitted = contentCleared || submitSettled
    previousInput.current = current
    if (!submitted) return
    const early = window.setTimeout(refresh, 250)
    const settled = window.setTimeout(refresh, 1000)
    return () => {
      window.clearTimeout(early)
      window.clearTimeout(settled)
    }
  }, [input.draft, input.imageIds, input.phase, refresh])

  const handleDroppedFiles = useCallback(async (dropped: readonly File[]) => {
    if (input.phase !== 'plain' || dropBusy) return
    const images = dropped.filter((file) => OFFICIAL_IMAGE_TYPES.has(file.type))
    const files = dropped.filter((file) => !OFFICIAL_IMAGE_TYPES.has(file.type))
    const invalid = validateWorkspaceFiles(files)
    if (invalid) {
      setDropError(invalid)
      return
    }

    setDropError(undefined)
    if (images.length > 0) {
      const imageError = addDroppedImages?.(
        images,
        input.imageIds ?? [],
        imageLimits,
        (ids) => inputActions.addImages(ids),
      ) ?? '当前 Composer 无法接收拖入的图片'
      if (imageError) {
        setDropError(imageError)
        return
      }
    }
    if (files.length === 0) return

    setDropBusy(true)
    try {
      await uploadWorkspaceFiles(sessionId, files)
    } catch (error) {
      setDropError(error instanceof Error ? error.message : String(error))
    } finally {
      setDropBusy(false)
    }
  }, [addDroppedImages, dropBusy, imageLimits, input.imageIds, input.phase, inputActions, sessionId])

  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0
      dragTakeover.current = false
      setDragActive(false)
      setDragCount(0)
    }
    const claim = (event: DragEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event) || !event.dataTransfer) return
      const takeover = dragTakeover.current || takesGeneralFileDrop(event.dataTransfer)
      if (!takeover) return
      claim(event)
      dragTakeover.current = true
      dragDepth.current += 1
      setDragCount([...event.dataTransfer.items].filter((item) => item.kind === 'file').length)
      setDragActive(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event) || !event.dataTransfer) return
      if (!dragTakeover.current && !takesGeneralFileDrop(event.dataTransfer)) return
      claim(event)
      dragTakeover.current = true
      event.dataTransfer.dropEffect = input.phase === 'plain' && !dropBusy ? 'copy' : 'none'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!dragTakeover.current) return
      claim(event)
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) reset()
      const leavingViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leavingViewport) reset()
    }
    const onDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event) || !event.dataTransfer) return
      const files = [...event.dataTransfer.files]
      const takeover = dragTakeover.current || files.some((file) => !OFFICIAL_IMAGE_TYPES.has(file.type))
      if (!takeover) return
      claim(event)
      const directory = containsDirectory(event.dataTransfer)
      reset()
      if (directory) {
        setDropError('暂不支持拖入文件夹，请先压缩为 ZIP')
        return
      }
      if (input.phase !== 'plain' || dropBusy) {
        setDropError('当前输入状态不能上传文件')
        return
      }
      void handleDroppedFiles(files)
    }
    const onDragEnd = () => reset()

    document.addEventListener('dragenter', onDragEnter, true)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('dragleave', onDragLeave, true)
    document.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('dragleave', onDragLeave, true)
      document.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [dropBusy, handleDroppedFiles, input.phase])

  useEffect(() => {
    if (!dropError) return
    const timeout = window.setTimeout(() => setDropError(undefined), 5000)
    return () => window.clearTimeout(timeout)
  }, [dropError])

  const batches = snapshot.pendingUploads[sessionId] ?? []
  const files = batches.flatMap((batch) => batch.files.map((file) => ({ ...file, batchId: batch.batchId })))
  const host = useComposerAttachmentHost(files.length > 0, sessionId)
  async function remove(batchId: string, path: string) {
    setRemovingPath(path)
    setRemoveError(undefined)
    try {
      const result = await api.removePendingWorkspaceUpload(sessionId, { batchId, path })
      workbenchActions.setPendingUploads(sessionId, result.batches)
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error))
    } finally {
      setRemovingPath(undefined)
    }
  }

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={input.phase !== 'plain' || dropBusy}
          labels={input.phase !== 'plain' || dropBusy
            ? { title: '当前不能上传文件' }
            : {
                title: '松开以上传文件',
                desc: dragCount > 0
                  ? `${dragCount} 个项目；图片显示预览，其他文件附加到当前消息`
                  : '图片显示预览，其他文件附加到当前消息',
              }}
        />
      )}
      {(dropBusy || dropError) && createPortal(
        <div className="workspace-upload-drop-status" role="status">
          {dropBusy ? '正在上传拖入的文件…' : dropError}
        </div>,
        document.body,
      )}
      {files.length > 0 && host && createPortal(
        <div
          className="workspace-upload-attachment-rail"
          role="group"
          aria-label="待发送文件"
          title={removeError}
        >
          {files.map((file) => (
            <div className="workspace-upload-attachment" key={file.path}>
              <button
                type="button"
                className="workspace-upload-attachment-preview"
                title={`预览 ${file.name}`}
                onClick={() => workbenchActions.preview(sessionId, file.path)}
              >
                <span className="workspace-upload-attachment-icon" aria-hidden="true">▤</span>
                <span className="workspace-upload-attachment-name">{file.name}</span>
              </button>
              <button
                type="button"
                className="workspace-upload-attachment-remove"
                aria-label={`移除 ${file.name}`}
                title={removeError && removingPath === file.path ? removeError : `从本轮发送中移除 ${file.name}`}
                disabled={removingPath === file.path}
                onClick={() => void remove(file.batchId, file.path)}
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        host,
      )}
    </>
  )
}
