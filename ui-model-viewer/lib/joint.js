// Joint preview reads a sealed run sidecar; missing coordinate evidence never means identity.
import { readFile, realpath, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readZipEntry } from './host-core.js'
const ID = /^[A-Za-z0-9_-]+$/
const NC = /^[A-Za-z0-9._-]+\.nc$/i
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function validateJoint(doc) {
  if (doc?.version !== 1 || doc.units !== 'mm' || doc.frame !== 'package_to_nc') throw new Error('联合预览版本、单位或坐标口径不支持')
  if (!/^[a-f0-9]{64}$/.test(doc.source_sha256) || !/^[a-f0-9]{64}$/.test(doc.geometry_sha256) || typeof doc.model_path !== 'string' || !doc.model_path || doc.model_path.length > 4096) throw new Error('联合预览缺少源模型/几何版本')
  if (!Array.isArray(doc.stations) || !doc.stations.length || doc.stations.length > 32) throw new Error('缺少工位变换')
  const names = new Set()
  for (const s of doc.stations) {
    if (typeof s.name !== 'string' || !s.name || names.has(s.name)) throw new Error('工位名称非法或重复')
    names.add(s.name)
    const { r, t } = s.part_to_nc ?? {}
    if (!Array.isArray(t) || t.length !== 3 || !t.every(Number.isFinite) || !Array.isArray(r) || r.length !== 3 || !r.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))) throw new Error('工位矩阵无效')
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.abs(r[i].reduce((sum, v, k) => sum + v * r[j][k], 0) - Number(i === j)) > 1e-5) throw new Error('工位旋转不是正交矩阵')
    const determinant = r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0])
    if (Math.abs(determinant - 1) > 1e-5) throw new Error('工位不是右手坐标系')
  }
  if (!Array.isArray(doc.operations) || !doc.operations.length || doc.operations.length > 128) throw new Error('工序列表为空或超过128道')
  const files = new Set()
  for (const op of doc.operations) {
    if (typeof op.name !== 'string' || !op.name || !NC.test(op.file) || files.has(op.file) || !names.has(op.station) || !/^[a-f0-9]{64}$/.test(op.sha256)) throw new Error('工序文件或工位关联非法')
    files.add(op.file)
    if (op.fid !== undefined && !/^F\d{6}$/.test(op.fid)) throw new Error('工序面编号非法')
  }
  return doc
}
// Only a producer with actual NX result + recovered NC bytes may create this evidence.
export function createJointManifest({ modelPath, sourceSha, manifestBytes, result, programs }) {
  if (result?._diag?.mcs_orientation_err || result?.diag?.mcs_orientation_err) throw new Error('NX 未能回读工位方向')
  const stations = result.stations ?? []
  return validateJoint({ version: 1, units: 'mm', frame: 'package_to_nc', model_path: modelPath, source_sha256: sourceSha, geometry_sha256: digest(manifestBytes), stations,
    operations: (result.operations ?? []).map(op => {
      const file = op.nc_file
      if (!programs[file]) throw new Error(`NX工序缺少NC：${file}`)
      return { name: op.name, file, station: op.station ?? (stations.length === 1 ? stations[0].name : undefined), sha256: digest(programs[file]), ...(op.fid ? { fid: op.fid } : {}) }
    }),
  })
}
export function createJointService({ home, models }) {
  const root = path.join(home, 'cam-runs')
  async function inside(file, limit) {
    const actual = await realpath(file), base = await realpath(root)
    if (!actual.startsWith(base + path.sep)) throw new Error('联合预览文件越界')
    // Every run/session directory must remain in its lexical location, not another session's symlink.
    if (actual !== path.join(base, path.relative(root, file))) throw new Error('联合预览拒绝符号链接')
    const info = await stat(actual)
    if (!info.isFile() || info.size > limit) throw new Error('联合预览文件超限')
    return readFile(actual)
  }
  async function detail(session, runId) {
    if (!ID.test(session) || !ID.test(runId)) throw new Error('非法会话或加工批次')
    const dir = path.join(root, session, runId)
    let doc
    try { doc = validateJoint(JSON.parse(await inside(path.join(dir, 'preview.json'), 128 * 1024))) }
    catch (error) { if (error.code === 'ENOENT') return { run_id: runId, state: 'unavailable', message: '此批次缺少源模型版本与完整工位变换，不能可靠联合显示。可单独查看 NC。' }; throw error }
    const t = await models.target(session, doc.model_path)
    if (t.sha !== doc.source_sha256) throw new Error('加工批次与源模型版本不匹配')
    const model = await models.status(t)
    if (model.state !== 'ready') throw new Error('批次对应的几何包尚未就绪')
    if (digest(await readFile(path.join(t.dir, 'manifest.json'))) !== doc.geometry_sha256) throw new Error('加工批次与预览几何版本不匹配')
    const zip = await inside(path.join(dir, 'delivery', 'nc_batch.zip'), 64 * 1024 * 1024)
    let total = 0
    const operations = doc.operations.map((op, index) => {
      const bytes = readZipEntry(zip, op.file)
      if (!bytes || digest(bytes) !== op.sha256) throw new Error(`NC 缺失或版本不匹配：${op.file}`)
      total += bytes.length
      if (bytes.length > 4 * 1024 * 1024 || total > 8 * 1024 * 1024) throw new Error('NC 预览内容超过限额')
      if (op.fid && !model.faces.some(face => face.fid === op.fid)) throw new Error('工序关联面不在当前几何包')
      return { ...op, id: String(index), content: bytes.toString('utf8') }
    })
    return { run_id: runId, state: 'ready', model_path: doc.model_path, source_sha256: t.sha, stations: doc.stations, operations }
  }
  async function list(session, requested) {
    const t = await models.target(session, requested)
    let entries
    try { entries = await readdir(path.join(root, session), { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    const result = []
    for (const entry of entries.slice(0, 512)) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue
      const dir = path.join(root, session, entry.name)
      try {
        const doc = JSON.parse(await inside(path.join(dir, 'preview.json'), 128 * 1024))
        if (doc.source_sha256 === t.sha) result.push({ run_id: entry.name, available: true })
      } catch (e) {
        if (e.code !== 'ENOENT') { result.push({ run_id: entry.name, available: false, message: e.message }); continue }
        try {
          const job = JSON.parse(await inside(path.join(dir, 'job.json'), 256 * 1024))
          if (job.prt_local && await realpath(job.prt_local) === t.file) result.push({ run_id: entry.name, available: false, message: '缺少工位变换' })
        } catch { /* Old or deleted run sources cannot be associated by name alone. */ }
      }
    }
    return result.reverse()
  }
  return { detail, list }
}
