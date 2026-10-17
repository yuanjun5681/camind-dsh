// Local drawingPreview provider: authorized snapshots probe all six-identity cache candidates
// before conversion; cold misses share a cancellable flight and ready reads re-authorize every caller.
import { createHash } from 'node:crypto'
import { createJobQueue } from './jobs.js'
import { createDraftCache } from './cache.js'
import { decodeDxfSnapshot, snapshotDrawingSource } from './source.js'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const notReady = () => Object.assign(new Error('图纸包尚未转换，请先启动转换作业'), { code: 'PACK_NOT_READY' })

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
  if (typeof draftCache.peek !== 'function') throw new Error('drawingPreview 需要只读缓存接口')
  const flights = new Map(), producers = new Set()
  let disposing = false
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
    const pack = decoded.kind === 'dwg'
      ? await draftConverter.convertDwg(snapshot.snapshotPath, options)
      : await draftConverter.convertDxf(decoded.text, options)
    return { kind: decoded.kind, pack }
  }

  async function readCached(sessionId, key, snapshot, requested, includeText, displayName) {
    let cached
    try {
      cached = await draftCache.peek(sessionId, key, {
        name: displayName ?? snapshot.name,
        sourceUri: requested,
        resolve,
      })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'CACHE_CORRUPT') throw notReady()
      throw error
    }
    const descriptor = descriptorFor({
      sessionId,
      source: { uri: requested, sha256: snapshot.sha256, name: displayName ?? snapshot.name },
      key,
      cached,
      packText: cached.packText,
      includeText,
    })
    return { key, descriptor }
  }

  async function convertAndPublish(sessionId, requested, expectedSha, conversionFingerprint, signal) {
    const snapshot = await snapshotSource(sessionId, requested)
    try {
      if (snapshot.sha256 !== expectedSha) throw new Error('源文件变更：转换前快照已不一致')
      const { kind, pack } = await convertSnapshot(snapshot, signal)
      if (snapshot.sha256 !== pack.source_sha256) throw new Error('源件改变：转换包与稳定快照不一致')
      if (kind === 'dwg' && !pack.conversion?.libredwg) throw new Error('转换不完整：缺少实际 LibreDWG 版本')
      const identityOptions = kind === 'dwg'
        ? { libredwgVersion: pack.conversion.libredwg }
        : { conversionFingerprint }
      const { identity: key } = await draftConverter.identity(pack, identityOptions)
      const packText = JSON.stringify(pack)
      await draftCache.get(sessionId, key, {
        name: snapshot.name,
        sourceUri: requested,
        resolve,
        build: async () => packText,
      })
      return key
    } finally {
      await snapshot.cleanup()
    }
  }

  function joinFlight(id, signal, produce) {
    if (disposing || signal?.aborted) throw new Error('图纸转换已取消')
    let flight = flights.get(id)
    if (flight?.controller.signal.aborted) {
      flights.delete(id)
      flight = undefined
    }
    if (!flight) {
      flight = { controller: new AbortController(), consumers: 0, settled: false, promise: null }
      flight.promise = (async () => produce(flight.controller.signal))()
      flights.set(id, flight)
      producers.add(flight)
      const settle = () => {
        flight.settled = true
        producers.delete(flight)
        if (flights.get(id) === flight) flights.delete(id)
      }
      flight.promise.then(settle, settle)
    }
    flight.consumers++
    return new Promise((resolveFlight, rejectFlight) => {
      let localSettled = false
      const finish = (fn, value) => {
        if (localSettled) return
        localSettled = true
        signal?.removeEventListener('abort', onAbort)
        flight.consumers--
        if (!flight.settled && flight.consumers === 0) {
          flight.controller.abort()
          if (flights.get(id) === flight) flights.delete(id)
        }
        fn(value)
      }
      const onAbort = () => finish(rejectFlight, new Error('图纸转换已取消'))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      flight.promise.then(value => finish(resolveFlight, value), error => finish(rejectFlight, error))
    })
  }

  async function build(sessionId, requested, signal) {
    const snapshot = await snapshotSource(sessionId, requested)
    try {
      const candidates = await draftConverter.identities(snapshot.sha256, { signal })
      if (!Array.isArray(candidates) || !candidates.length) throw new Error('转换器未提供六项身份候选')
      const conversionFingerprint = candidates[0]?.fields?.[3]
      if (!/^[0-9a-f]{64}$/i.test(conversionFingerprint ?? '')) throw new Error('转换器未提供有效转换指纹')
      for (const { identity: key } of candidates) {
        try { return await readCached(sessionId, key, snapshot, requested, false) }
        catch (error) { if (error.code !== 'PACK_NOT_READY') throw error }
      }
      const flightId = `${sessionId}/${sha256(JSON.stringify(candidates.map(item => item.identity).sort()))}`
      const key = await joinFlight(flightId, signal,
        flightSignal => convertAndPublish(sessionId, requested, snapshot.sha256, conversionFingerprint, flightSignal))
      return await readCached(sessionId, key, snapshot, requested, false)
    } finally {
      await snapshot.cleanup()
    }
  }

  const jobInfo = job => job ? ({ ...job, jobId: job.id }) : null

  async function read(sessionId, key, requested, displayName) {
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('非法图纸包身份')
    const snapshot = await snapshotSource(sessionId, requested)
    try { return (await readCached(sessionId, key, snapshot, requested, true, displayName)).descriptor }
    finally { await snapshot.cleanup() }
  }

  async function dispose() {
    disposing = true
    for (const flight of producers) flight.controller.abort()
    await queue.dispose()
    for (const flight of producers) flight.controller.abort()
    const pending = [...producers].map(flight => flight.promise.catch(() => {}))
    await Promise.all(pending)
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
    dispose,
  }
}
