// 同步/校验 ui-shell 的 dsh 客户端包版本。package.json 和锁文件是生成侧，
// 根目录 dsh-version.json 是唯一需要人工修改的版本源。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { clientPackages, readDshVersion, workspaceRoot } from './dsh-version.mjs'

const checkOnly = process.argv.includes('--check')
const version = readDshVersion()
const uiShellDir = path.join(workspaceRoot, 'ui-shell')
const packagePath = path.join(uiShellDir, 'package.json')
const lockPath = path.join(uiShellDir, 'package-lock.json')
const vendoredClientSources = [
  'dsh-client-ui-attachment',
  'dsh-client-ui-primitives',
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function mismatches() {
  const packageJson = readJson(packagePath)
  const packageLock = readJson(lockPath)
  const rootLock = packageLock.packages?.['']?.devDependencies ?? {}
  const errors = []
  for (const name of clientPackages) {
    if (packageJson.devDependencies?.[name] !== version) {
      errors.push(`ui-shell/package.json: ${name}=${packageJson.devDependencies?.[name] ?? '(缺失)'}`)
    }
    if (rootLock[name] !== version) {
      errors.push(`ui-shell/package-lock.json 根依赖: ${name}=${rootLock[name] ?? '(缺失)'}`)
    }
    const installed = packageLock.packages?.[`node_modules/${name}`]?.version
    if (installed !== version) {
      errors.push(`ui-shell/package-lock.json 包版本: ${name}=${installed ?? '(缺失)'}`)
    }
  }
  for (const name of vendoredClientSources) {
    const source = readJson(path.join(uiShellDir, 'vendor', name, 'package.json'))
    if (source.version !== version) {
      errors.push(`ui-shell/vendor/${name} 源码版本=${source.version ?? '(缺失)'}`)
    }
  }
  const sidebar = readJson(path.join(workspaceRoot, 'ui-sidebar', 'package.json'))
  if (sidebar.dshUpstream?.version !== version) {
    errors.push(`ui-sidebar 上游源码版本=${sidebar.dshUpstream?.version ?? '(缺失)'}`)
  }
  return errors
}

if (checkOnly) {
  const errors = mismatches()
  if (errors.length > 0) {
    console.error(`dsh 版本不一致；期望 ${version}：\n- ${errors.join('\n- ')}`)
    console.error('运行 npm run sync:dsh-version，并按 vendor README 更新 UI 源码快照。')
    process.exitCode = 1
  } else {
    console.log(`[dsh-version] dsh 与客户端包均为 ${version}`)
  }
} else {
  const packageJson = readJson(packagePath)
  packageJson.devDependencies ??= {}
  for (const name of clientPackages) packageJson.devDependencies[name] = version
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: uiShellDir, stdio: 'inherit' },
  )
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--check'], { stdio: 'inherit' })
}
