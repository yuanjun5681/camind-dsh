// DWG 转换在独立 worker 中运行,避免子进程等待和 DXF 解析阻塞宿主。
// 子进程有自身超时;外层超时同时约束解析阶段,错误保留契约校验码。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { convertDxfText } from './convert.js'
import { dwgToDxfText, libredwgVersion, DWG2DXF_TIMEOUT_MS } from './dwg.js'

export function convertDwgAsync(file, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { file, options } })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('图纸转换超时,请简化图纸后重试'))
    }, (options.timeoutMs ?? DWG2DXF_TIMEOUT_MS) + 15000)
    worker.once('message', result => {
      clearTimeout(timer)
      if (result.error) reject(Object.assign(new Error(result.error.message), { checkErrors: result.error.checkErrors }))
      else resolve(result.pack)
    })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`图纸转换进程异常退出(${code})`)) })
  })
}

if (!isMainThread) {
  try {
    const { file, options } = workerData
    const sourceBytes = readFileSync(file)
    const dxf = dwgToDxfText(file, options)
    const pack = convertDxfText(dxf, { sourceName: basename(file), sourceBytes,
      libredwgVersion: libredwgVersion(options), converterVersion: options.converterVersion })
    parentPort.postMessage({ pack })
  } catch (error) {
    parentPort.postMessage({ error: { message: error.message, checkErrors: error.checkErrors } })
  }
}
