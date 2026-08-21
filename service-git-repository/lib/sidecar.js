// Worktree sidecar envelope. Git service validates structure and paths;
// domain payload is opaque.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { fail } from './errors.js'

const STATUSES = new Set(['active', 'conflict'])

export function sidecarPath(worktreesRoot, ownerId) {
  return path.join(worktreesRoot, `${ownerId}.json`)
}

export function readSidecar(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail('sidecar_invalid', `worktree 状态文件无法解析：${file}：${error.message}`)
  }
}

export function writeSidecar(file, envelope) {
  if (!envelope || envelope.schema_version !== 1) fail('sidecar_invalid', 'sidecar schema_version 必须为 1。')
  if (!envelope.repository || !envelope.worktree || !envelope.branch || !envelope.owner?.id) {
    fail('sidecar_invalid', 'sidecar 缺少 repository、worktree、branch 或 owner.id。')
  }
  if (!STATUSES.has(envelope.status)) fail('sidecar_invalid', `sidecar status 非法：${envelope.status}。`)
  mkdirSync(path.dirname(file), { recursive: true })
  const body = {
    ...envelope,
    schema_version: 1,
    payload: envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {},
    updated_at: new Date().toISOString(),
    created_at: envelope.created_at ?? new Date().toISOString(),
  }
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`)
  return body
}

export function removeSidecar(file) {
  rmSync(file, { force: true })
}
