// 固定版本的 dsh 启动器：避免开发命令随 npm latest 漂移。
// DSH_HOME 未设置时默认指向 Camind 项目根的 .dsh/；它与 session 选择的 workspace cwd 无关。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readDshVersion } from './dsh-version.mjs'

const version = readDshVersion()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
env.DSH_HOME ??= path.join(root, '.dsh')
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(
  executable,
  ['-y', `@deepseek-ai/dsh@${version}`, ...process.argv.slice(2)],
  { env, stdio: 'inherit' },
)

child.on('error', (error) => {
  console.error(`[dsh] 启动 @deepseek-ai/dsh@${version} 失败：${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
