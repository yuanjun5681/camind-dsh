// Memory-bank JSON API backing the /camind/pages/memory plugin page (design §7.2).
// All domain operations go through the injected memoryBank Cordis service; this
// file only does HTTP routing, payload validation, and metadata-backfill
// scheduling. GET stays read-only (the service never git-inits on reads).

import { createMetadataBackfill } from './metadata.js'

const API_PREFIX = '/camind/api/memory'
const BODY_LIMIT = 8 * 1024 * 1024
const ENTRY_TYPES = new Set(['knowledge', 'experience'])

// --- http helpers --------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大（上限 8MB）。'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('请求体不是有效 JSON。'))
      }
    })
    req.on('error', reject)
  })
}

// --- endpoint handlers -----------------------------------------------------------

function listEntries(ctx, res, url, schedule) {
  const entries = ctx.memoryBank.listEntries({
    type: url.searchParams.get('type') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    tag: url.searchParams.get('tag') ?? undefined,
    circuit_type: url.searchParams.get('circuit_type') ?? undefined,
    limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 500,
  })
  // 自愈调度：任何 pending 条目（含 tool-memory extract_memory 范本模式落盘的经验）
  // 随下一次列表请求进入补全；inFlight 去重，ready/failed 后不再触发
  for (const entry of entries) {
    if (entry.metadata_status === 'pending') schedule(entry.type, entry.name)
  }
  sendJson(res, 200, { memory_root: ctx.memoryBank.root(), entries })
}

function readEntry(ctx, res, type, name) {
  const entry = ctx.memoryBank.readEntry(type, name)
  if (!entry) return sendJson(res, 404, { error: `条目不存在：${type}/${name}` })
  sendJson(res, 200, entry)
}

async function uploadKnowledge(ctx, res, req, schedule) {
  const body = await readBody(req)
  const files = Array.isArray(body?.files) ? body.files : null
  if (!files || files.length === 0) return sendJson(res, 400, { error: 'files 不能为空。' })
  if (files.length > 50) return sendJson(res, 400, { error: '单次最多上传 50 个文件。' })
  const imported = []
  const errors = []
  for (const file of files) {
    try {
      const result = await ctx.memoryBank.importKnowledge(undefined, { filename: file?.filename, content: file?.content })
      if (result.metadata_status === 'pending') schedule('knowledge', result.name)
      imported.push({ filename: file?.filename, ...result })
    } catch (error) {
      errors.push({ filename: file?.filename, error: error.message })
    }
  }
  sendJson(res, errors.length === 0 ? 201 : 207, { imported, errors })
}

async function updateEntry(ctx, res, type, name, req, schedule) {
  const body = await readBody(req)
  const bank = ctx.memoryBank
  const patch = {
    title: body?.title,
    description: body?.description,
    category: body?.category,
    circuit_types: body?.circuit_types,
    tags: body?.tags,
    trigger: body?.trigger,
    situation: body?.situation,
    lesson: body?.lesson,
    action: body?.action,
    body: body?.body,
  }
  if (type === 'knowledge') {
    // 元数据齐全即 ready；有留空则落 pending 并触发自动补全（§7.3 编辑约定）
    const current = bank.readEntry(type, name)
    if (!current) return sendJson(res, 404, { error: `条目不存在：${type}/${name}` })
    const title = patch.title !== undefined ? String(patch.title).trim() : String(current.frontmatter.title ?? '').trim()
    const description = patch.description !== undefined ? String(patch.description).trim() : String(current.frontmatter.description ?? '').trim()
    patch.metadata_status = title && description ? 'ready' : 'pending'
  }
  const result = await bank.updateEntry(undefined, type, name, patch)
  if (type === 'knowledge' && patch.metadata_status === 'pending') schedule('knowledge', name)
  sendJson(res, 200, result)
}

async function deleteEntry(ctx, res, type, name) {
  const deleted = await ctx.memoryBank.deleteEntry(undefined, type, name)
  if (!deleted) return sendJson(res, 404, { error: `条目不存在：${type}/${name}` })
  sendJson(res, 200, { ok: true, name })
}

async function setExperienceStatus(ctx, res, name, target) {
  const result = await ctx.memoryBank.setExperienceStatus(undefined, name, target)
  sendJson(res, 200, result)
}

// --- router ----------------------------------------------------------------------

export async function handleMemoryApi(ctx, req, res) {
  const schedule = handleMemoryApi.schedule ??= createMetadataBackfill(ctx, ctx.memoryBank)
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    const rest = url.pathname.slice(API_PREFIX.length)
    const segments = rest.split('/').filter(Boolean).map(decodeURIComponent)

    if (segments[0] !== 'entries') return sendJson(res, 404, { error: '未知接口。' })

    if (req.method === 'GET' && segments.length === 1) return listEntries(ctx, res, url, schedule)
    if (req.method === 'POST' && segments.length === 3 && segments[1] === 'knowledge' && segments[2] === 'upload') {
      return await uploadKnowledge(ctx, res, req, schedule)
    }
    if (segments.length >= 3 && ENTRY_TYPES.has(segments[1])) {
      const [, type, name, action] = segments
      if (req.method === 'GET' && segments.length === 3) return readEntry(ctx, res, type, name)
      if (req.method === 'PUT' && segments.length === 3) return await updateEntry(ctx, res, type, name, req, schedule)
      if (req.method === 'DELETE' && segments.length === 3) return await deleteEntry(ctx, res, type, name)
      if (req.method === 'POST' && segments.length === 4 && type === 'experience' && action === 'promote') {
        return await setExperienceStatus(ctx, res, name, 'stable')
      }
      if (req.method === 'POST' && segments.length === 4 && type === 'experience' && action === 'deprecate') {
        return await setExperienceStatus(ctx, res, name, 'deprecated')
      }
      return sendJson(res, 405, { error: '方法不允许。' })
    }
    sendJson(res, 404, { error: '未知接口。' })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}
