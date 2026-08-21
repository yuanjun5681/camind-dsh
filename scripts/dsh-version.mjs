// 仓库级 dsh 版本读取器：所有开发、构建和客户端依赖校验都以
// 根目录 dsh-version.json 为唯一版本源。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const clientPackages = [
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-web',
  '@deepseek-ai/dsh-client-web-react',
]

export function readDshVersion() {
  const file = path.join(workspaceRoot, 'dsh-version.json')
  const document = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (typeof document.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(document.version)) {
    throw new Error(`dsh-version.json 中的 version 无效：${JSON.stringify(document.version)}`)
  }
  return document.version
}
