// Exclusive lockfile for one repository. Used for init and publish so two
// sessions cannot git-init or merge main at the same time.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { fail } from './errors.js'

const STALE_MS = 15 * 60 * 1000
const RETRY_MS = 200
const DEFAULT_WAIT_MS = 30_000
const held = new Map()

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    return null
  }
}

function removeStale(lockPath) {
  const body = readLock(lockPath)
  if (!body) {
    try { unlinkSync(lockPath) } catch { /* occupied or gone */ }
    return
  }
  const age = Date.now() - Date.parse(body.at ?? '')
  if (!pidAlive(body.pid) || (Number.isFinite(age) && age > STALE_MS)) {
    try { unlinkSync(lockPath) } catch { /* raced */ }
  }
}

export async function withLock(lockDir, fn, { waitMs = DEFAULT_WAIT_MS } = {}) {
  mkdirSync(lockDir, { recursive: true })
  const lockPath = path.join(lockDir, '.camind-git-repository.lock')
  const depth = held.get(lockPath) ?? 0
  if (depth > 0) {
    held.set(lockPath, depth + 1)
    try {
      return await fn()
    } finally {
      const next = (held.get(lockPath) ?? 1) - 1
      if (next <= 0) held.delete(lockPath)
      else held.set(lockPath, next)
    }
  }
  const deadline = Date.now() + waitMs
  let fd
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx')
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      removeStale(lockPath)
      if (Date.now() >= deadline) fail('lock_busy', '仓库正被其他操作占用，请稍后重试。')
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
    }
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    closeSync(fd)
    fd = null
    held.set(lockPath, 1)
    return await fn()
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* already closed */ }
    }
    const next = (held.get(lockPath) ?? 1) - 1
    if (next <= 0) {
      held.delete(lockPath)
      try { unlinkSync(lockPath) } catch { /* already removed */ }
    } else {
      held.set(lockPath, next)
    }
  }
}
