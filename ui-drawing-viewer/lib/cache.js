// Six-identity draft pack cache: atomic writes, independent pack SHA, LRU, single-flight,
// corruption rebuild and mandatory authorization on every hit, even for cached bytes.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}
const corruption = () => Object.assign(new Error('图纸缓存完整性校验失败'), { code: 'CACHE_CORRUPT' })
const sessionDeleted = () => Object.assign(new Error('会话图纸缓存已清理'), { code: 'CACHE_SESSION_DELETED' })

export function createDraftCache({ home, maxEntries = 32, maxBytes = 256 * 1024 * 1024, check }) {
  const root = path.join(home, 'draft-previews')
  const pending = new Map(), publications = new Map(), cleanups = new Map(), versions = new Map()
  const sessionDir = sessionId => {
    if (typeof sessionId !== 'string' || !sessionId || sessionId === '.' || sessionId === '..'
      || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('\0')) {
      throw new Error('非法会话缓存标识')
    }
    return path.join(root, sessionId)
  }
  const packPath = (sessionId, key) => path.join(sessionDir(sessionId), `${key}.json`)
  const sidecarPath = (sessionId, key) => path.join(sessionDir(sessionId), `${key}.sidecar.json`)

  function validIdentity(key) {
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('缓存键必须是六项身份哈希')
  }
  function assertVersion(sessionId, version) {
    if (version !== undefined && version !== (versions.get(sessionId) ?? 0)) throw sessionDeleted()
  }
  async function ensureSessionDir(sessionId) {
    await mkdir(root, { recursive: true })
    const [base, dir] = await Promise.all([realpath(root), realpath(sessionDir(sessionId))])
    if (!inside(base, dir)) throw new Error('图纸缓存路径越界')
    return dir
  }
  async function ensureInside(sessionId, key) {
    const base = await ensureSessionDir(sessionId)
    const [file, sidecarFile] = await Promise.all([
      realpath(packPath(sessionId, key)),
      realpath(sidecarPath(sessionId, key)),
    ])
    if (!inside(base, file) || !inside(base, sidecarFile)) throw new Error('图纸缓存路径越界')
    return { file, sidecarFile }
  }
  async function write(sessionId, key, { name, packText }, expectedVersion) {
    validIdentity(key)
    assertVersion(sessionId, expectedVersion)
    const pack = JSON.parse(packText)
    if (check && check(pack, 'writer').length) throw new Error('图纸包 writer 校验未过')
    const bytes = Buffer.from(packText, 'utf8')
    if (bytes.length > maxBytes) throw new Error('图纸包超过缓存容量上限')
    const dir = sessionDir(sessionId)
    await mkdir(dir, { recursive: true })
    await ensureSessionDir(sessionId)
    assertVersion(sessionId, expectedVersion)
    const suffix = `.${randomUUID()}.tmp`
    const tmpPack = packPath(sessionId, key) + suffix
    const tmpSidecar = sidecarPath(sessionId, key) + suffix
    try {
      await writeFile(tmpPack, bytes, { flag: 'wx' })
      await writeFile(tmpSidecar, JSON.stringify({ name, bytes: bytes.length, packSha256: sha(bytes), updatedAt: Date.now() }), { flag: 'wx' })
      assertVersion(sessionId, expectedVersion)
      await rename(tmpPack, packPath(sessionId, key))
      await rename(tmpSidecar, sidecarPath(sessionId, key))
      const { file } = await ensureInside(sessionId, key)
      await trim(sessionId)
      return file
    } finally {
      await Promise.all([rm(tmpPack, { force: true }), rm(tmpSidecar, { force: true })])
    }
  }
  async function put(sessionId, key, options, expectedVersion) {
    validIdentity(key)
    sessionDir(sessionId)
    if (expectedVersion === undefined) {
      const cleanup = cleanups.get(sessionId)
      if (cleanup) await cleanup
    }
    const version = expectedVersion ?? (versions.get(sessionId) ?? 0)
    const publicationKey = `${sessionId}/${key}`
    const previous = publications.get(publicationKey) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(() => write(sessionId, key, options, version))
    publications.set(publicationKey, task)
    try { return await task } finally { if (publications.get(publicationKey) === task) publications.delete(publicationKey) }
  }
  async function trim(sessionId) {
    const dir = sessionDir(sessionId)
    const names = await readdir(dir).catch(() => [])
    const packs = []
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.sidecar.json') || name.endsWith('.tmp')) continue
      const file = path.join(dir, name)
      const info = await lstat(file).catch(() => null)
      if (info?.isFile()) packs.push({ file, bytes: info.size, mtime: info.mtimeMs })
    }
    packs.sort((a, b) => b.mtime - a.mtime)
    let total = packs.reduce((sum, item) => sum + item.bytes, 0)
    for (let i = packs.length - 1; i >= 0 && (packs.length > maxEntries || total > maxBytes); --i) {
      const victim = packs[i]
      await rm(victim.file, { force: true })
      await rm(victim.file.replace(/\.json$/, '.sidecar.json'), { force: true })
      total -= victim.bytes
      packs.pop()
    }
  }
  async function readValid(sessionId, key) {
    const { file, sidecarFile } = await ensureInside(sessionId, key)
    const [packText, sidecarText] = await Promise.all([
      readFile(file, 'utf8'),
      readFile(sidecarFile, 'utf8'),
    ])
    let sidecar
    try { sidecar = JSON.parse(sidecarText) } catch { throw corruption() }
    if (!sidecar || !Number.isInteger(sidecar.bytes) || sidecar.bytes < 0 || typeof sidecar.packSha256 !== 'string') {
      throw corruption()
    }
    const bytes = Buffer.from(packText, 'utf8')
    if (sidecar.bytes !== bytes.length || sidecar.packSha256 !== sha(bytes)) throw corruption()
    const now = new Date()
    await utimes(file, now, now)
    return { packText, sidecar }
  }
  return {
    put,
    async peek(sessionId, key, { name, sourceUri = name, resolve }) {
      validIdentity(key)
      sessionDir(sessionId)
      const cleanup = cleanups.get(sessionId)
      if (cleanup) await cleanup
      const version = versions.get(sessionId) ?? 0
      await resolve(sessionId, sourceUri)
      assertVersion(sessionId, version)
      const cached = await readValid(sessionId, key)
      assertVersion(sessionId, version)
      return { ...cached, name }
    },
    async get(sessionId, key, { name, sourceUri = name, resolve, build }) {
      validIdentity(key)
      sessionDir(sessionId)
      const cleanup = cleanups.get(sessionId)
      if (cleanup) await cleanup
      const version = versions.get(sessionId) ?? 0
      await resolve(sessionId, sourceUri)
      assertVersion(sessionId, version)
      const pendingKey = `${sessionId}/${key}`
      let task = pending.get(pendingKey)
      if (!task) {
        task = (async () => {
          try {
            return await readValid(sessionId, key)
          } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'CACHE_CORRUPT') throw error
            assertVersion(sessionId, version)
            const packText = await build()
            assertVersion(sessionId, version)
            await put(sessionId, key, { name, packText }, version)
            assertVersion(sessionId, version)
            return readValid(sessionId, key)
          }
        })()
        pending.set(pendingKey, task)
        const clear = () => { if (pending.get(pendingKey) === task) pending.delete(pendingKey) }
        task.then(clear, clear)
      }
      const cached = await task
      assertVersion(sessionId, version)
      return { ...cached, name }
    },
    async deleteSession(sessionId) {
      sessionDir(sessionId)
      const existing = cleanups.get(sessionId)
      if (existing) return existing
      const cleanup = (async () => {
        versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1)
        const tasks = []
        for (const operations of [pending, publications]) {
          for (const [key, task] of operations) {
            if (key.startsWith(`${sessionId}/`)) tasks.push(task.catch(() => {}))
          }
        }
        await Promise.all(tasks)
        await rm(sessionDir(sessionId), { recursive: true, force: true })
      })()
      cleanups.set(sessionId, cleanup)
      try { await cleanup } finally { if (cleanups.get(sessionId) === cleanup) cleanups.delete(sessionId) }
    },
  }
}
