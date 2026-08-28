// 一键初始化：新检出/新机器上跑一次，重建被 gitignore 的运行环境。
// 幂等，可重复运行：只补齐缺失或内容过期的部分，不覆盖已有数据。
// 日常运行不需要本脚本（node scripts/dsh.mjs web 即可）；dsh 版本升级也不走
// 本脚本，按 docs/dsh-upgrade.md 的 SOP 执行。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readDshVersion } from './dsh-version.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = path.join(root, '.dsh')
const warnings = []

function step(message) {
  console.log(`[init] ${message}`)
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

// 1. 运行时版本检查（对齐 AGENTS.md：Node ^22.19 或 >=24；profile 安装依赖 pnpm）
function checkPrerequisites() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!(major >= 24 || (major === 22 && minor >= 19))) {
    throw new Error(`需要 Node ^22.19 或 >=24，当前 ${process.versions.node}`)
  }
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'pipe' })
  } catch {
    throw new Error('需要 pnpm（profile 的依赖安装由它完成）：corepack enable pnpm 或 brew install pnpm')
  }
  step(`Node ${process.versions.node} / pnpm 就绪，dsh 版本源 ${readDshVersion()}`)
}

// 2. skills：仓库 skills/ 是唯一事实源，.dsh/skills 是指向它的相对 symlink
// （dsh 按 DSH_HOME 级发现，任何工作区的会话都能加载；相对链接保证检出目录可移动）
function ensureSkillsLink() {
  const link = path.join(dshHome, 'skills')
  const target = '../skills'
  if (fs.existsSync(link)) {
    const stat = fs.lstatSync(link)
    if (stat.isSymbolicLink() && fs.readlinkSync(link) === target) {
      step('skills symlink 已就位')
      return
    }
    throw new Error(`${link} 已存在且不是指向 ${target} 的 symlink；请手动处理后重试（避免误删数据）`)
  }
  fs.mkdirSync(dshHome, { recursive: true })
  fs.symlinkSync(target, link)
  step('skills symlink 已创建：.dsh/skills -> ../skills')
}

// 3. machines：仓库 machines/ 是种子基线（版本化、走评审）；运行时活动档案在
// $DSH_HOME/machines/。「目标不存在才拷」——绝不覆盖现场已改过的档案；现场改动要
// 升级为基线时人工拷回仓库（见 docs/cam-machining-design.md §5.1）。注意不能像
// skills 那样用 symlink：机床档案是可写数据，运行时写操作（gitRepository 自动 commit）
// 必须落在 DSH_HOME 级，不能写进源码仓库当前分支。
function ensureMachinesSeed() {
  const src = path.join(root, 'machines')
  if (!fs.existsSync(src)) return
  const dest = path.join(dshHome, 'machines')
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src).sort()) {
    if (!entry.endsWith('.yaml')) continue
    const target = path.join(dest, entry)
    if (fs.existsSync(target)) {
      step(`machines 种子 ${entry} 已在运行时档案中（保留现场版本，不覆盖）`)
      continue
    }
    fs.copyFileSync(path.join(src, entry), target)
    step(`machines 种子 ${entry} 已拷入 .dsh/machines/`)
  }
}

// profile 模板：机器相关的只有 link: 绝对路径，运行时计算即可，因此整体可模板化重建；
// package.json 内容完全由模板推导，过期（如检出目录移动过）直接重写。
const PROFILE_TEMPLATES = {
  headless: {
    dependencies: {
      'camind-service-git-repository': 'link:service-git-repository',
      'camind-service-machine': 'link:service-machine',
      'camind-tool-cam': 'link:tool-cam',
      'camind-tool-memory': 'link:tool-memory',
      'camind-tool-upload': 'link:tool-upload',
    },
    bundles: [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-headless',
      'camind-tool-upload',
      'camind-service-git-repository',
      'camind-service-machine',
      'camind-tool-memory',
      'camind-tool-cam',
    ],
  },
  web: {
    dependencies: {
      'dsh-markdown-preview': '^0.3.0',
      'camind-page-memory': 'link:page-memory',
      'camind-service-git-repository': 'link:service-git-repository',
      'camind-service-machine': 'link:service-machine',
      'camind-tool-cam': 'link:tool-cam',
      'camind-tool-memory': 'link:tool-memory',
      'camind-tool-upload': 'link:tool-upload',
      'camind-ui-brand': 'link:ui-brand',
      'camind-ui-foundation': 'link:ui-foundation',
      'camind-ui-home': 'link:ui-home',
      'camind-ui-shell': 'link:ui-shell',
      'camind-ui-preview': 'link:ui-preview',
      'camind-ui-toolpath-viewer': 'link:ui-toolpath-viewer',
    },
    bundles: [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'camind-tool-upload',
      'camind-service-git-repository',
      'camind-service-machine',
      'camind-tool-memory',
      'camind-tool-cam',
      'camind-ui-shell',
      'camind-ui-foundation',
      'camind-ui-preview',
      'camind-ui-brand',
      'camind-ui-home',
      'camind-ui-toolpath-viewer',
      'dsh-markdown-preview',
      'camind-page-memory',
    ],
  },
}

const PATCH_YML = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

const CORDIS_YML = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

const PNPM_WORKSPACE_YML = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

// 模板依赖值的约定：'link:<目录>' 转为相对工作区根的绝对 link: 路径，其余原样保留（npm 版本范围）
function profilePackageJson(name, template) {
  const dependencies = {}
  for (const [pkg, spec] of Object.entries(template.dependencies)) {
    dependencies[pkg] = spec.startsWith('link:') ? `link:${path.join(root, spec.slice(5))}` : spec
  }
  return `${JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies,
    dsh: { profile: { bundles: template.bundles } },
  }, null, 2)}\n`
}

function writeIfDifferent(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false
  fs.writeFileSync(file, content)
  return true
}

// 4. AgentPreset：仓库 agent-presets/ 是版本化事实源；初始化时把受管文件复制到
// DSH_HOME/.agent-presets/，让 dsh 的用户级发现器加载（参考 AnaSageHarness 同款机制）。
// 与 machines 的「不存在才拷」不同：preset 是纯配置（无运行时改写），受管文件以仓库为准
// 覆盖更新；用户自建的其他 preset 不删除、不覆盖。
const MANAGED_PRESETS = ['cam-machining']
const PRESET_FILES = ['preset.yml', 'agent.cordis.yml']

function ensureAgentPresets() {
  for (const presetId of MANAGED_PRESETS) {
    const sourceDir = path.join(root, 'agent-presets', presetId)
    const targetDir = path.join(dshHome, '.agent-presets', presetId)
    if (fs.existsSync(targetDir) && !fs.lstatSync(targetDir).isDirectory()) {
      throw new Error(`${targetDir} 已存在且不是目录；请手动处理后重试`)
    }
    fs.mkdirSync(targetDir, { recursive: true })
    let changed = false
    for (const filename of PRESET_FILES) {
      changed = writeIfDifferent(
        path.join(targetDir, filename),
        fs.readFileSync(path.join(sourceDir, filename), 'utf8'),
      ) || changed
    }
    step(`AgentPreset ${presetId} ${changed ? '已同步' : '已就位'}`)
  }
}

// 5. profiles：通用上传工具、记忆库、机床档案与 gitRepository 服务在所有 profile 全局加载。
function ensureProfiles() {
  for (const [name, template] of Object.entries(PROFILE_TEMPLATES)) {
    const dir = path.join(dshHome, 'profiles', name)
    fs.mkdirSync(dir, { recursive: true })
    const changed = writeIfDifferent(path.join(dir, 'package.json'), profilePackageJson(name, template))
    writeIfDifferent(path.join(dir, 'cordis.patch.yml'), PATCH_YML)
    writeIfDifferent(path.join(dir, 'cordis.yml'), CORDIS_YML)
    writeIfDifferent(path.join(dir, 'pnpm-workspace.yaml'), PNPM_WORKSPACE_YML)
    if (changed || !fs.existsSync(path.join(dir, 'node_modules'))) {
      step(`profile ${name}：安装依赖（pnpm install）`)
      run('pnpm', ['install'], dir)
    } else {
      step(`profile ${name} 已就位`)
    }
  }
}

// 6. 模型调用前提：只检查、不生成（见 README/AGENTS 的安全约定）
function checkManualInputs() {
  if (!process.env.DEEPSEEK_API_KEY && !fs.existsSync(path.join(root, '.env'))) {
    warnings.push('未检测到 DEEPSEEK_API_KEY 或根目录 .env（模型调用前提；也可在 Web UI 的 Settings → Models 里配）')
  }
}

// 7. ui-shell：Host 直接服务 dist/，未构建时 /ui 返回 503
function buildUiShell() {
  step('ui-shell：npm install && npm run build')
  run('npm', ['install'], path.join(root, 'ui-shell'))
  run('npm', ['run', 'build'], path.join(root, 'ui-shell'))
}

checkPrerequisites()
ensureSkillsLink()
ensureMachinesSeed()
ensureAgentPresets()
ensureProfiles()
checkManualInputs()
buildUiShell()
run(process.execPath, [path.join(root, 'scripts', 'sync-dsh-version.mjs'), '--check'], root)

for (const warning of warnings) console.warn(`[init] 警告：${warning}`)
console.log('[init] 完成。日常运行：node scripts/dsh.mjs web（桌面打包见 README「打包桌面客户端」）')
