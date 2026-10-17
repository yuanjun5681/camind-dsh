// Local drawingPreview provider: stable source snapshots feed bounded conversion jobs;
// ready packs are served only through the six-identity cache with fresh authorization.
import { createHash } from 'node:crypto'
import { createJobQueue } from './jobs.js'
import { createDraftCache } from './cache.js'
import { decodeDxfSnapshot, snapshotDrawingSource } from './source.js'

const sha256 = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')

function missingEntries(pack) {
  return Object.entries(pack.missing ?? {}).flatMap(([kind, values]) =>
    Array.isArray(values) ? values.map(value => `${kind}:${String(value)}`) : [])
}

function descriptorFor({ sessionId, source, key, cached, packText, includeText }) {
  const pack = JSON.parse(packText)
  if (pack.source_sha256 !== source.sha256) {
    throw Object.assign(new Error('源件已改变，请重新接件'), { code: 'SOURCE_CHANGED' })
  }
  return {
    name: source.name,
    session: sessionId,
    source: { uri: source.uri, sha256: source.sha256, name: source.name },
    pack: { sha256: cached.sidecar.packSha256 ?? sha256(packText), identity: key },
    conversion: { ...pack.conversion },
    degraded: {
      geometryDecimated: false,
      textTruncated: false,
      skippedTypes: Object.keys(pack.self_check?.dropped?.by_type ?? {}),
    },
    missing: missingEntries(pack),
    ...(includeText ? { packText } : {}),
  }
}

export function createDrawingPreviewService({
  home,
  resolve,
  draftConverter,
  queue = createJobQueue(),
  cache,
}) {
  if (typeof resolve !== 'function') throw new Error('drawingPreview 需要 previewFiles.resolve')
  if (!draftConverter) throw new Error('drawingPreview 需要 draftConverter')
  const draftCache = cache ?? createDraftCache({
    home,
    check: (pack, profile) => draftConverter.check(pack, profile),
  })
  const snapshotSource = (sessionId, uri) => snapshotDrawingSource({ sessionId, requested: uri, resolve })

  async function convertSnapshot(snapshot, signal) {
    const decoded = decodeDxfSnapshot(snapshot)
    const options = {
      sourceName: snapshot.name,
      sourceBytes: snapshot.bytes,
      signal,
      maxOldGenerationSizeMb: 384,
      maxYoungGenerationSizeMb: 64,
    }
    return decoded.kind === 'dwg'
      ? draftConverter.convertDwg(snapshot.snapshotPath, options)
      : draftConverter.convertDxf(decoded.text, options)
  }

  async function build(sessionId, requested, signal) {
    const snapshot = await snapshotSource(sessionId, requested)
    try {
      const pack = await convertSnapshot(snapshot, signal)
      if (snapshot.sha256 !== pack.source_sha256) throw new Error('源件改变：转换包与稳定快照不一致')
      const { identity: key } = draftConverter.identity(pack)
      const packText = JSON.stringify(pack)
      const cached = await draftCache.get(sessionId, key, {
        name: snapshot.name,
        sourceUri: requested,
        resolve,
        build: async () => packText,
      })
      return {
        key,
        descriptor: descriptorFor({
          sessionId,
          source: { uri: requested, sha256: snapshot.sha256, name: snapshot.name },
          key,
          cached,
          packText: cached.packText,
          includeText: false,
        }),
      }
    } finally {
      await snapshot.cleanup()
    }
  }

  const jobInfo = job => job ? ({ ...job, jobId: job.id }) : null

  async function read(sessionId, key, requested, displayName) {
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('非法图纸包身份')
    const snapshot = await snapshotSource(sessionId, requested)
    try {
      const cached = await draftCache.get(sessionId, key, {
        name: displayName ?? snapshot.name,
        sourceUri: requested,
        resolve,
        build: async () => {
          throw Object.assign(new Error('图纸包尚未转换，请先启动转换作业'), { code: 'PACK_NOT_READY' })
        },
      })
      return descriptorFor({
        sessionId,
        source: { uri: requested, sha256: snapshot.sha256, name: displayName ?? snapshot.name },
        key,
        cached,
        packText: cached.packText,
        includeText: true,
      })
    } finally {
      await snapshot.cleanup()
    }
  }

  return {
    prepare(sessionId, requested) {
      if (!sessionId || typeof requested !== 'string' || !requested) throw new Error('需要会话与图纸引用')
      return jobInfo(queue.submit({
        sessionId,
        estimatedMemoryMb: 512,
        run: ({ signal }) => build(sessionId, requested, signal),
      }))
    },
    status(sessionId, jobId) { return jobInfo(queue.status(jobId, sessionId)) },
    cancel(sessionId, jobId) { return jobInfo(queue.cancel(jobId, sessionId)) },
    retry(sessionId, jobId) { return jobInfo(queue.retry(jobId, sessionId)) },
    read,
    async readPack(sessionId, identity, { sourceUri, name }) {
      const descriptor = await read(sessionId, identity, sourceUri, name)
      return { packText: descriptor.packText, identity, descriptor }
    },
    snapshotSource,
    deleteSession(sessionId) {
      queue.deleteSession(sessionId)
      return draftCache.deleteSession(sessionId)
    },
  }
}
