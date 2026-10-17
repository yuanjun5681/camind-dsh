// Bounded drawing-conversion jobs: global/session concurrency, memory budget, real cancellation,
// retry classification and request isolation. Remote providers are never enabled implicitly.
import { randomUUID } from 'node:crypto'

export function classifyConversionError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/取消/.test(message)) return { code: 'cancelled', message: '图纸转换已取消', retryable: false }
  if (/超时/.test(message)) return { code: 'timeout', message: '图纸转换超时，请重试', retryable: true }
  if (/未找到|安装 LibreDWG/.test(message)) return { code: 'tool_missing', message: '未找到 dwg2dxf，请先安装并配置后再试', retryable: false }
  if (/超过|超限|内存预算/.test(message)) return { code: 'limit', message: '图纸转换超过当前资源上限', retryable: false }
  if (/源文件变更|源件改变/.test(message)) return { code: 'source_changed', message: '源件已改变，请重新接件', retryable: true }
  if (/校验未过|REJECT|DRAFT_E_/.test(message)) return { code: 'bad_pack', message: '图纸包校验未通过', retryable: false }
  if (/不完整|异常退出/.test(message)) return { code: 'incomplete', message: '图纸转换不完整，请核实后重试', retryable: true }
  return { code: 'unknown', message, retryable: false }
}

export function createJobQueue({ maxGlobal = 2, maxPerSession = 1, maxMemoryMb = 1024 } = {}) {
  const jobs = new Map(), pending = []
  const activeSessions = new Map()
  let activeMemory = 0, pumping = false

  const info = job => ({
    id: job.id, state: job.state, stage: job.stage,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    retryable: job.retryable,
    ...(job.retryOf ? { retryOf: job.retryOf } : {}),
  })
  const canStart = job => {
    const sessionActive = activeSessions.get(job.sessionId)?.count ?? 0
    return activeSessions.size < maxGlobal
      && sessionActive < maxPerSession
      && activeMemory + job.estimatedMemoryMb <= maxMemoryMb
  }
  async function runJob(job) {
    try {
      job.result = await job.run({ signal: job.controller.signal })
      job.state = 'ready'; job.stage = 'ready'; job.retryable = false
    } catch (error) {
      job.state = 'error'; job.stage = 'error'
      job.error = job.cancelled ? classifyConversionError(new Error('取消')) : classifyConversionError(error)
      job.retryable = job.error.retryable
    } finally {
      const session = activeSessions.get(job.sessionId)
      if (session) {
        session.count--
        activeMemory -= job.estimatedMemoryMb
        if (session.count === 0) activeSessions.delete(job.sessionId)
      }
      void pump()
    }
  }
  function pump() {
    if (pumping) return
    pumping = true
    try {
      while (pending.length && canStart(pending[0])) {
        const job = pending.shift()
        activeSessions.set(job.sessionId, { count: (activeSessions.get(job.sessionId)?.count ?? 0) + 1 })
        activeMemory += job.estimatedMemoryMb
        job.state = 'running'; job.stage = 'converting'
        void runJob(job)
      }
    } finally {
      pumping = false
    }
  }
  function submit({ sessionId, estimatedMemoryMb = 256, run, retryOf }) {
    if (typeof run !== 'function') throw new Error('转换任务缺少执行函数')
    if (estimatedMemoryMb > maxMemoryMb) throw new Error('图纸转换超出内存预算')
    const job = {
      id: randomUUID(), sessionId, estimatedMemoryMb, run, retryOf,
      state: 'queued', stage: 'queued', retryable: false,
      controller: new AbortController(), cancelled: false,
    }
    jobs.set(job.id, job)
    pending.push(job)
    pump()
    return info(job)
  }
  function owned(id, sessionId) {
    const job = jobs.get(id)
    return job && job.sessionId === sessionId ? job : null
  }
  return {
    submit,
    status(id, sessionId) {
      const job = owned(id, sessionId)
      return job ? info(job) : null
    },
    cancel(id, sessionId) {
      const job = owned(id, sessionId)
      if (!job || ['ready', 'error'].includes(job.state)) return null
      job.cancelled = true
      job.controller.abort()
      if (job.state === 'queued') pending.splice(pending.indexOf(job), 1)
      job.state = 'error'; job.stage = 'error'; job.error = classifyConversionError(new Error('取消'))
      return info(job)
    },
    retry(id, sessionId) {
      const job = owned(id, sessionId)
      if (!job || job.state !== 'error' || !job.retryable) throw new Error('该转换任务不可重试')
      return submit({ sessionId, estimatedMemoryMb: job.estimatedMemoryMb, run: job.run, retryOf: id })
    },
    deleteSession(sessionId) {
      for (const job of jobs.values()) {
        if (job.sessionId !== sessionId) continue
        if (!['ready', 'error'].includes(job.state)) {
          job.cancelled = true
          job.controller.abort()
        }
        jobs.delete(job.id)
        const index = pending.indexOf(job)
        if (index >= 0) pending.splice(index, 1)
      }
    },
    get activeMemoryMb() { return activeMemory },
    get pendingCount() { return pending.length },
  }
}
