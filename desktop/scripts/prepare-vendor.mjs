// 准备打包所需的运行时材料，输出到 desktop/vendor/：
//   vendor/dsh/       @deepseek-ai/dsh 及其全部生产依赖（npm 安装）
//   vendor/dsh-home/  种子 DSH_HOME：web profile + 实体化插件与 skills
// 用法：npm run prepare-vendor
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(desktopDir, '..')
const vendorDir = path.join(desktopDir, 'vendor')
const { version: DSH_VERSION } = JSON.parse(
  fs.readFileSync(path.join(workspaceRoot, 'dsh-version.json'), 'utf8'),
)

// 在删除旧 vendor 前先确认 Host 运行时与前端协议包处于同一版本。
execFileSync(
  process.execPath,
  [path.join(workspaceRoot, 'scripts', 'sync-dsh-version.mjs'), '--check'],
  { cwd: workspaceRoot, stdio: 'inherit' },
)

// 1. 重置 vendor
fs.rmSync(vendorDir, { recursive: true, force: true })

// 2. 安装 dsh 本体（含全部生产依赖）
const dshDir = path.join(vendorDir, 'dsh')
fs.mkdirSync(dshDir, { recursive: true })
fs.writeFileSync(path.join(dshDir, 'package.json'), JSON.stringify({
  name: 'dsh-vendor',
  private: true,
  dependencies: { '@deepseek-ai/dsh': DSH_VERSION },
}, null, 2) + '\n')
console.log(`[vendor] installing @deepseek-ai/dsh@${DSH_VERSION} ...`)
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dshDir, stdio: 'inherit' })

// 3. 种子 DSH_HOME：基于工作区 web profile，把 link: 依赖实体化为普通目录
const srcProfile = JSON.parse(
  fs.readFileSync(path.join(workspaceRoot, '.dsh', 'profiles', 'web', 'package.json'), 'utf8'),
)
if (!srcProfile.dependencies?.['camind-service-git-repository']?.startsWith('link:')) {
  throw new Error('web profile 缺少 camind-service-git-repository link 依赖；先在工作区根运行 npm run init')
}
const profileDir = path.join(vendorDir, 'dsh-home', 'profiles', 'web')
fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true })
const runtimeDependencies = Object.fromEntries(
  Object.entries(srcProfile.dependencies ?? {}).filter(([, spec]) => !spec.startsWith('link:')),
)
for (const spec of Object.values(srcProfile.dependencies ?? {})) {
  if (!spec.startsWith('link:')) continue
  const pluginPackage = JSON.parse(fs.readFileSync(path.join(spec.slice('link:'.length), 'package.json'), 'utf8'))
  Object.assign(runtimeDependencies, pluginPackage.dependencies ?? {})
}
fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
  name: srcProfile.name,
  private: true,
  dependencies: runtimeDependencies,
  dsh: srcProfile.dsh,
}, null, 2) + '\n')
if (Object.keys(runtimeDependencies).length > 0) {
  console.log('[vendor] installing profile/plugin runtime dependencies ...')
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: profileDir, stdio: 'inherit' })
}

// skills 是 DSH_HOME 级发现的会话能力包；桌面种子必须实体化，不能保留工作区 symlink。
fs.cpSync(
  path.join(workspaceRoot, 'skills'),
  path.join(vendorDir, 'dsh-home', 'skills'),
  { recursive: true },
)

// machines 种子基线同理实体化：运行时活动档案在 DSH_HOME/machines/，
// 现场改动由该目录自己的 git 历史承载（见 docs/cam-machining-design.md §5.1）。
fs.cpSync(
  path.join(workspaceRoot, 'machines'),
  path.join(vendorDir, 'dsh-home', 'machines'),
  { recursive: true },
)

const uiShellDir = path.join(workspaceRoot, 'ui-shell')
if (fs.existsSync(path.join(uiShellDir, 'package.json'))) {
  console.log('[vendor] building ui-shell ...')
  execFileSync('npm', ['install'], { cwd: uiShellDir, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiShellDir, stdio: 'inherit' })
}

for (const [name, spec] of Object.entries(srcProfile.dependencies ?? {})) {
  if (!spec.startsWith('link:')) {
    continue
  }
  const src = spec.slice('link:'.length)
  const dest = path.join(profileDir, 'node_modules', name)
  fs.cpSync(src, dest, { recursive: true, filter: (s) => !s.includes(`${path.sep}node_modules`) })
  console.log(`[vendor] materialized ${name} <- ${src}`)
}

console.log('[vendor] done')
