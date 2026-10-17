// DWG/DXF conversion runs in a bounded worker: parsing never blocks the host loop.
// AbortSignal and timeout both terminate the real worker, not just discard its result.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { convertDxfText } from './convert.js'
import { dwgToDxfText, libredwgVersion, DWG2DXF_TIMEOUT_MS } from './dwg.js'

let activeWorkers = 0

export function activeConversionWorkers() {
  return activeWorkers
}

function runConversion(kind, payload, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { kind, payload, options },
      resourceLimits: {
        maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 512,
        maxYoungGenerationSizeMb: options.maxYoungGenerationSizeMb ?? 128,
      },
    })
    activeWorkers++
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const timer = setTimeout(() => {
      void worker.terminate()
      finish(reject, new Error('图纸转换超时,请简化图纸后重试'))
    }, options.timeoutMs ?? (kind === 'dxf' ? 30000 : DWG2DXF_TIMEOUT_MS + 15000))
    const onAbort = () => {
      void worker.terminate()
      finish(reject, new Error('图纸转换已取消'))
    }
    worker.once('message', result => {
      if (result.error) finish(reject, Object.assign(new Error(result.error.message), { checkErrors: result.error.checkErrors }))
      else finish(resolve, result.pack)
    })
    worker.once('error', error => finish(reject, error))
    worker.once('exit', code => {
      activeWorkers = Math.max(0, activeWorkers - 1)
      if (code !== 0) finish(reject, new Error(`图纸转换进程异常退出(${code})`))
    })
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function convertDwgAsync(file, options = {}) {
  return runConversion('dwg', file, options)
}

export function convertDxfAsync(text, options = {}) {
  return runConversion('dxf', text, options)
}

if (!isMainThread) {
  try {
    const { kind, payload, options } = workerData
    if (kind === 'dxf') {
      parentPort.postMessage({ pack: convertDxfText(payload, options) })
    } else {
      const sourceBytes = readFileSync(payload)
      const dxf = dwgToDxfText(payload, options)
      const pack = convertDxfText(dxf, { sourceName: basename(payload), sourceBytes,
        libredwgVersion: libredwgVersion(options), converterVersion: options.converterVersion })
      parentPort.postMessage({ pack })
    }
  } catch (error) {
    parentPort.postMessage({ error: { message: error.message, checkErrors: error.checkErrors } })
  }
}
