// Thin git subprocess helper. Callers pass already-authorized cwd paths; this
// module never interpolates a free-form git command string.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 60_000
const MAX_BUFFER = 8 * 1024 * 1024

export async function git(args, { cwd, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    })
    return { code: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  } catch (error) {
    if (error.code === 'ENOENT') {
      error.message = '未找到 git 可执行文件；版本管理需要系统 Git。'
      throw error
    }
    if (error.killed) {
      return {
        code: 1,
        stdout: error.stdout ?? '',
        stderr: `git 超过 ${timeoutMs / 1000}s 被杀`,
        killed: true,
      }
    }
    return {
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? '',
    }
  }
}

export async function gitOk(args, options = {}) {
  const result = await git(args, options)
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim() || `exit ${result.code}`
    const error = new Error(`git ${args[0]} 失败：${detail}`)
    error.git = result
    throw error
  }
  return result.stdout
}
