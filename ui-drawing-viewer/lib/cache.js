// Six-identity draft pack cache: atomic writes, independent pack SHA, LRU, single-flight,
// corruption rebuild and mandatory authorization on every hit, even for cached bytes.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export function createDraftCache({ home, maxEntries = 32, maxBytes = 256 * 1024 * 1024, check }) {
  const root = path.join(home, 'draft-previews')
  const pending = new Map()
  const sessionDir = sessionId => path.join(root, sessionId)
  const packPath = (sessionId, key) => path.join(sessionDir(sessionId), `${key}.json`)
  const sidecarPath = (sessionId, key) => path.join(sessionDir(sessionId), `${key}.sidecar.json`)

  async function validIdentity(key) {
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('缓存键必须是六项身份哈希')
  }
  async function ensureInside(sessionId, key) {
    const base = await realpath(sessionDir(sessionId))
    const file = await realpath(packPath(sessionId, key))
    if (!inside(base, file)) throw new Error('图纸缓存路径越界')
    return file
  }
  async function put(sessionId, key, { name, packText }) {
    await validIdentity(key)
    const pack = JSON.parse(packText)
    if (check && check(pack, 'writer').length) throw new Error('图纸包 writer 校验未过')
    const bytes = Buffer.from(packText, 'utf8')
    const dir = sessionDir(sessionId)
    await mkdir(dir, { recursive: true })
    const tmpPack = packPath(sessionId, key) + '.tmp'
    const tmpSidecar = sidecarPath(sessionId, key) + '.tmp'
    await writeFile(tmpPack, bytes, { flag: 'wx' })
    await writeFile(tmpSidecar, JSON.stringify({ name, bytes: bytes.length, packSha256: sha(bytes), updatedAt: Date.now() }), { flag: 'wx' })
    await rename(tmpPack, packPath(sessionId, key))
    await rename(tmpSidecar, sidecarPath(sessionId, key))
    const file = await ensureInside(sessionId, key)
    await trim(sessionId)
    return file
  }
  async function trim(sessionId) {
    const dir = sessionDir(sessionId)
    const names = await readdir(dir).catch(() => [])
    const packs = []
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.sidecar.json') || name.endsWith('.tmp')) continue
      const file = path.join(dir, name)
      const info = await stat(file).catch(() => null)
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
    const file = await ensureInside(sessionId, key)
    const [packText, sidecarText] = await Promise.all([
      readFile(file, 'utf8'),
      readFile(sidecarPath(sessionId, key), 'utf8'),
    ])
    const sidecar = JSON.parse(sidecarText)
    const bytes = Buffer.from(packText, 'utf8')
    if (sidecar.bytes !== bytes.length || sidecar.packSha256 !== sha(bytes)) throw new Error('图纸缓存完整性校验失败')
    return { packText, sidecar }
  }
  return {
    put,
    async get(sessionId, key, { name, resolve, build }) {
      await validIdentity(key)
      if (pending.has(`${sessionId}/${key}`)) return pending.get(`${sessionId}/${key}`)
      const task = (async () => {
        try {
          const cached = await readValid(sessionId, key)
          await resolve(sessionId, cached.sidecar.sourceUri ?? name)
          return { ...cached, name }
        } catch (error) {
          if (error.code !== 'ENOENT' && !/完整性|不存在/.test(error.message)) throw error
          const packText = await build()
          await put(sessionId, key, { name, packText })
          const cached = await readValid(sessionId, key)
          await resolve(sessionId, cached.sidecar.sourceUri ?? name)
          return { ...cached, name }
        }
      })()
      pending.set(`${sessionId}/${key}`, task)
      try { return await task } finally { pending.delete(`${sessionId}/${key}`) }
    },
    async deleteSession(sessionId) {
      for (const key of pending.keys()) if (key.startsWith(`${sessionId}/`)) pending.delete(key)
      await rm(sessionDir(sessionId), { recursive: true, force: true })
    },
  }
}
