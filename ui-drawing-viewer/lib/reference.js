// DrawingReference v1 server-side verification. Trusted source/cache adapters provide authorization
// and real bytes; this module recomputes pack SHA, binds all identities and always cleans snapshots.
import { createHash } from 'node:crypto'

const SHA256 = /^[0-9a-f]{64}$/i
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = value => typeof value === 'string' && value.trim().length > 0
const digest = value => createHash('sha256').update(value).digest('hex')

function normalizeHash(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${field} 必须是 64 位十六进制哈希`)
  return value.toLowerCase()
}

function normalizeTarget(target) {
  if (!isRecord(target) || !['dim', 'entity'].includes(target.type)) {
    throw new Error('图纸引用 target.type 仅支持 dim 或 entity')
  }
  if (target.type === 'dim') {
    if (typeof target.id !== 'string') throw new Error('dim 目标 id 必须是字符串')
    return { type: 'dim', id: target.id }
  }
  if (!Number.isInteger(target.id) || target.id < 0) throw new Error('entity 目标 id 必须是非负整数')
  return { type: 'entity', id: target.id === 0 ? 0 : target.id }
}

function boundedValue(value, depth = 0) {
  if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 1000)
  if (Array.isArray(value) && depth < 2) {
    return value.slice(0, 32).map(item => boundedValue(item, depth + 1)).filter(item => item !== undefined)
  }
  if (isRecord(value) && depth < 2) {
    return Object.fromEntries(Object.entries(value).slice(0, 16)
      .map(([key, item]) => [key, boundedValue(item, depth + 1)])
      .filter(([, item]) => item !== undefined))
  }
  return undefined
}

function defined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function verifiedTargetContent(pack, target) {
  if (target.type === 'dim') {
    const dim = pack.dims.find(candidate => candidate.id === target.id)
    return defined({
      type: 'dim', id: dim.id,
      displayText: boundedValue(dim.display_text),
      measured: boundedValue(dim.measured),
      tolerance: boundedValue(dim.tolerance),
      dimlfac: boundedValue(dim.dimlfac),
      inferred: boundedValue(dim.inferred),
      ruleVersion: boundedValue(dim.rule_version),
      entityIds: boundedValue(dim.entity_ids),
    })
  }
  const entity = pack.entities.find(candidate => candidate.id === target.id)
  const geometry = defined(Object.fromEntries([
    'start', 'end', 'center', 'position', 'radius', 'start_angle', 'end_angle',
    'rotation', 'height', 'closed', 'points', 'vertices',
  ].map(key => [key, boundedValue(entity[key])]).filter(([, value]) => value !== undefined)))
  return defined({
    type: 'entity', id: entity.id,
    entityType: boundedValue(entity.type),
    layer: boundedValue(entity.layer),
    handle: boundedValue(entity.handle),
    dimId: boundedValue(entity.dim_id),
    text: boundedValue(entity.text),
    nominal: boundedValue(entity.nominal),
    geometry,
  })
}

function normalizeInput(sessionId, input) {
  if (!isText(sessionId)) throw new Error('当前会话标识不得为空')
  if (!isRecord(input)) throw new Error('图纸引用必须是对象')
  if (input.kind !== 'camind-drawing-ref') throw new Error('图纸引用 kind 非法')
  if (input.version !== 1) throw new Error('图纸引用 version 仅支持 1')
  if (!isText(input.session)) throw new Error('图纸引用 session 不得为空')
  if (input.session !== sessionId) throw new Error('图纸引用会话与当前会话不符')
  if (!isRecord(input.source) || !isText(input.source.uri) || !isText(input.source.name)) {
    throw new Error('缺少可信图纸来源，内容模式只允许查看，不能签发引用')
  }
  const source = {
    uri: input.source.uri,
    sha256: normalizeHash(input.source.sha256, '图纸源 SHA'),
    name: input.source.name,
  }
  if (!isRecord(input.pack)) throw new Error('缺少图纸包身份，不能签发引用')
  const pack = {
    sha256: normalizeHash(input.pack.sha256, '图纸包 SHA'),
    identity: normalizeHash(input.pack.identity, '图纸包转换 identity'),
  }
  return { session: input.session, source, pack, target: normalizeTarget(input.target) }
}

export function createDrawingReferenceVerifier({ snapshotSource, readPack } = {}) {
  if (typeof snapshotSource !== 'function' || typeof readPack !== 'function') {
    throw new Error('图纸引用核验需要 snapshotSource 与 readPack')
  }

  async function verify(sessionId, input) {
    const claim = normalizeInput(sessionId, input)
    const snapshot = await snapshotSource(sessionId, claim.source.uri)
    if (!isRecord(snapshot) || typeof snapshot.cleanup !== 'function') {
      throw new Error('图纸源快照结果缺少清理函数')
    }
    try {
      const sourceSha256 = normalizeHash(snapshot.sha256, '真实图纸源 SHA')
      if (sourceSha256 !== claim.source.sha256) throw new Error('图纸源 SHA 与引用声明不符')
      if (!isText(snapshot.name)) throw new Error('图纸源快照缺少有效显示名')

      const cached = await readPack(sessionId, claim.pack.identity, {
        sourceUri: claim.source.uri,
        name: snapshot.name,
      })
      if (!isRecord(cached)) throw new Error('图纸包读取结果非法')
      const identity = normalizeHash(cached.identity, '真实图纸包转换 identity')
      if (identity !== claim.pack.identity) throw new Error('图纸包转换 identity 与真实六项身份不符')
      if (typeof cached.packText !== 'string') throw new Error('图纸包读取结果缺少 packText')

      const packSha256 = digest(Buffer.from(cached.packText, 'utf8'))
      if (packSha256 !== claim.pack.sha256) throw new Error('图纸包 SHA 与实际 packText 字节不符')

      let pack
      try {
        pack = JSON.parse(cached.packText)
      } catch {
        throw new Error('图纸包 packText 不是合法 JSON')
      }
      if (!isRecord(pack)) throw new Error('图纸包 packText 必须是 JSON 对象')
      const packSourceSha256 = normalizeHash(pack.source_sha256, '图纸包源 SHA')
      if (packSourceSha256 !== sourceSha256) throw new Error('图纸包源 SHA 与当前授权图纸不符')
      const candidates = claim.target.type === 'dim' ? pack.dims : pack.entities
      const exists = Array.isArray(candidates) && candidates.some(candidate => (
        isRecord(candidate) && candidate.id === claim.target.id
      ))
      if (!exists) throw new Error(`图纸包中不存在指定的 ${claim.target.type} 目标`)

      const source = { uri: claim.source.uri, sha256: sourceSha256, name: snapshot.name }
      const packIdentity = { sha256: packSha256, identity }
      const reference = {
        kind: 'camind-drawing-ref',
        version: 1,
        session: claim.session,
        source: { ...source },
        pack: { ...packIdentity },
        target: { ...claim.target },
      }
      const metadata = cached.descriptor === undefined ? {} : cached.descriptor
      if (!isRecord(metadata)) throw new Error('图纸包 descriptor 非法')
      const descriptor = {
        name: snapshot.name,
        session: claim.session,
        source,
        pack: packIdentity,
      }
      for (const key of ['conversion', 'degraded', 'missing']) {
        if (Object.hasOwn(metadata, key)) descriptor[key] = metadata[key]
      }
      const targetContent = verifiedTargetContent(pack, claim.target)
      return { reference, descriptor, targetContent }
    } finally {
      await snapshot.cleanup()
    }
  }

  return { verify }
}
