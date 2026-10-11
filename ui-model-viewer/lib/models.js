// Session-scoped PRT package cache and NX five-step exporter. Never overwrite source PRTs.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, stat, rename, rm, realpath } from 'node:fs/promises'
import path from 'node:path'
import { Package, parseManifest, readZipEntry } from './host-core.js'

export const FILES = ['manifest.json', 'faces.json', 'mesh_coarse.bin', 'mesh_fine.bin', 'edges.bin']
export const MAX_FILE = 32 * 1024 * 1024
const MAX_EXPANDED = 128 * 1024 * 1024
export function checked(result) {
  if (result?.status !== 'ok') throw new Error(result?.msg || 'NX 调用失败')
  return result.data
}
export async function validatePackage(dir, sha) {
  for (const name of FILES) {
    const info = await stat(path.join(dir, name))
    if (!info.isFile() || info.size > MAX_FILE) throw new Error(`${name} 缺失或超过 32 MiB`)
    const actual = await realpath(path.join(dir, name))
    if (path.dirname(actual) !== await realpath(dir)) throw new Error('几何包文件越界')
  }
  const raw = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
  const manifest = parseManifest(JSON.stringify(raw))
  if (manifest.partSha256 !== sha) throw new Error('几何包与 PRT 源文件版本不符')
  // The stamped PRT stays on NX; only the four display files are recovered.
  const displayFiles = manifest.files.filter(f => f.role !== 'stamped')
  if (displayFiles.length !== 4 || displayFiles.some(f => !FILES.includes(f.name) || f.name === 'manifest.json')) throw new Error('几何包文件列表非法')
  if (new Set(displayFiles.map(f => f.name)).size !== 4) throw new Error('几何包文件名重复')
  const pkg = Package.open(dir, { maxGzipOutputBytes: MAX_EXPANDED })
  const coarse = pkg.loadMesh(0), mesh = pkg.loadMesh(1), edges = pkg.loadEdges()
  if (!mesh.vertexCount() || mesh.indexCount() / 3 > 2_000_000 || coarse.indexCount() / 3 > 2_000_000) throw new Error('网格为空或超过 200 万三角片')
  for (let i = 0; i < mesh.faceCount(); i++) if (!mesh.faceRange(i).indexCount) throw new Error('部分面没有网格，拒绝显示不完整模型')
  return { state: 'ready', sha, manifest: raw, faces: pkg.faces, triangles: mesh.indexCount() / 3, vertices: mesh.vertexCount(), edges: edges.edgeCount() }
}

export function createModelService({ home, resolve, pipeline }) {
  const running = new Map()
  let busy = false
  async function target(session, requested) {
    if (!/^[A-Za-z0-9_-]+$/.test(session)) throw new Error('非法会话 ID')
    const resolved = await resolve(session, requested)
    if (path.extname(resolved.file).toLowerCase() !== '.prt') throw new Error('仅支持 NX PRT')
    if ((await stat(resolved.file)).size > 128 * 1024 * 1024) throw new Error('PRT 超过 128 MiB')
    const sha = createHash('sha256').update(await readFile(resolved.file)).digest('hex')
    return { file: resolved.file, sha, dir: path.join(home, 'model-previews', session, sha), key: `${session}/${sha}` }
  }
  async function status(t) {
    if (running.has(t.key)) return running.get(t.key)
    try { return await validatePackage(t.dir, t.sha) } catch (error) {
      if (error.code === 'ENOENT') return { state: 'missing', sha: t.sha }
      throw error // A corrupt committed cache is an error, not a request to rewrite the NX model.
    }
  }
  async function exportPart(t, progress) {
    if (busy) throw new Error('另一个模型正在导出，请稍后重试')
    busy = true
    const temp = `${t.dir}.${randomUUID()}.tmp`
    try {
      const health = checked(await pipeline.ensureReady())
      if (health.queue_pending !== 0 || health.queue_processing !== 0) throw new Error('NX 正在处理其他任务，暂不切换模型')
      const session = checked(await pipeline.run('/ele_session_state', {}))
      if (!Array.isArray(session.modified_parts) || session.modified_parts.length || session.modified_unreadable !== 0) throw new Error('NX 有未保存模型或无法确认修改状态，请先处理后再导出')
      const id = `preview_${randomUUID().replaceAll('-', '')}`
      const prt = `input/${id}.prt`, out = `work/${id}_geom`
      progress.stage = '上传独立预览副本'
      checked(await pipeline.uploadFile(t.file, prt))
      progress.stage = '生成面表'
      const opened = checked(await pipeline.run('/cam_geompack_open', { prt, out_dir: out, part_sha256: t.sha }))
      const stampedName = opened?.stamped?.name
      if (typeof stampedName !== 'string' || !/^[A-Za-z0-9._-]+\.prt$/i.test(stampedName)) throw new Error('标记副本文件名非法')
      const stamped = `${out}/${stampedName}`
      for (const lod of ['coarse', 'fine']) {
        progress.stage = lod === 'coarse' ? '生成粗档网格' : '生成细档网格'
        checked(await pipeline.run('/cam_geompack_facet', { prt: stamped, out_dir: out, lod }))
      }
      progress.stage = '导出边线'
      checked(await pipeline.run('/cam_geompack_edges', { prt: stamped, out_dir: out }))
      progress.stage = '提交几何包'
      checked(await pipeline.run('/cam_geompack_manifest', { prt: stamped, out_dir: out, part_sha256: t.sha, part_filename: path.basename(t.file) }))
      progress.stage = '回收并校验'
      const zip = checked(await pipeline.zipDir(out, FILES)).bytes
      if (!zip || zip.length > MAX_EXPANDED) throw new Error('几何包传输超限')
      await mkdir(temp, { recursive: true })
      for (const name of FILES) {
        const bytes = readZipEntry(zip, name)
        if (!bytes || bytes.length > MAX_FILE) throw new Error(`${name} 缺失或超限`)
        await writeFile(path.join(temp, name), bytes)
      }
      const result = await validatePackage(temp, t.sha)
      if (createHash('sha256').update(await readFile(t.file)).digest('hex') !== t.sha) throw new Error('导出期间源文件发生变化')
      await writeFile(path.join(temp, 'provenance.json'), JSON.stringify({ source_sha256: t.sha, remote_out: out, stamped, created_at: new Date().toISOString() }))
      await mkdir(path.dirname(t.dir), { recursive: true })
      await rename(temp, t.dir)
      return result
    } finally {
      busy = false
      await rm(temp, { recursive: true, force: true })
    }
  }
  return {
    target, status,
    async prepare(t) {
      const current = await status(t)
      if (current.state !== 'missing') return current
      const progress = { state: 'running', sha: t.sha, stage: '检查 NX 状态' }
      running.set(t.key, progress)
      void exportPart(t, progress).then(() => running.delete(t.key), error => running.set(t.key, { state: 'error', sha: t.sha, message: error.message }))
      return progress
    },
  }
}
