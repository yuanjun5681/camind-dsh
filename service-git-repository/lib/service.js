// Generic local Git repository operations. Callers supply authorized absolute
// repo/worktree roots; this service never parses domain or session data files.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { fail, GitRepositoryError } from './errors.js'
import { git, gitOk } from './git.js'
import { withLock } from './lock.js'
import { readSidecar, removeSidecar, sidecarPath, writeSidecar } from './sidecar.js'

const DEFAULT_IDENTITY = {
  name: 'Camind',
  email: 'camind@local',
}

const DEFAULT_GITIGNORE = `__pycache__/
*.pyc
.DS_Store
`

function topLevelPy(root) {
  if (!existsSync(root)) return []
  return readdirSync(root).filter((name) => name.endsWith('.py') && statSync(path.join(root, name)).isFile())
}

function parseWorktrees(text) {
  const items = []
  let current = {}
  for (const line of `${text}\n`.split('\n')) {
    if (line === '') {
      if (current.worktree) items.push(current)
      current = {}
      continue
    }
    if (line.startsWith('worktree ')) current.worktree = line.slice('worktree '.length)
    if (line.startsWith('branch ')) current.branch = line.slice('branch '.length)
  }
  return items
}

function samePath(left, right) {
  try {
    if (existsSync(left) && existsSync(right)) return realpathSync(left) === realpathSync(right)
  } catch {
    return false
  }
  return path.resolve(left) === path.resolve(right)
}

function lockDirFor(repoRoot) {
  mkdirSync(repoRoot, { recursive: true })
  const gitDir = path.join(repoRoot, '.git')
  return existsSync(gitDir) && statSync(gitDir).isDirectory() ? gitDir : repoRoot
}

function realDir(value, label) {
  if (typeof value !== 'string' || value === '') fail('path_invalid', `${label} 必须是绝对路径。`)
  const resolved = path.resolve(value)
  if (!path.isAbsolute(resolved)) fail('path_invalid', `${label} 必须是绝对路径。`)
  return resolved
}

function assertTopLevelFile(file) {
  if (typeof file !== 'string' || file === '' || file.includes('/') || file.includes('\\') || file.includes('..')) {
    fail('path_invalid', 'file 必须是仓库顶层文件名。')
  }
}

const REF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function assertRefName(ref, label = 'ref') {
  if (typeof ref !== 'string' || !REF_NAME_RE.test(ref) || ref.includes('..') || ref.endsWith('/')) {
    fail('ref_invalid', `${label} 非法。`)
  }
}

async function commitWithGlobs(cwd, message, addGlobs) {
  await gitOk(['add', '-A', '--', ...addGlobs], { cwd })
  const gitDir = (await gitOk(['rev-parse', '--git-dir'], { cwd })).trim()
  const merging = existsSync(path.join(gitDir, 'MERGE_HEAD'))
  const staged = await gitOk(['diff', '--cached', '--name-only'], { cwd })
  if (staged.trim() === '' && !merging) return { committed: false, sha: await revParse(cwd, 'HEAD') }
  await gitOk(['commit', '-m', message], { cwd })
  return { committed: true, sha: await revParse(cwd, 'HEAD') }
}

function assertInside(root, target, label) {
  const realRoot = existsSync(root) ? realpathSync(root) : path.resolve(root)
  const realTarget = existsSync(target) ? realpathSync(target) : path.resolve(target)
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`
  if (realTarget !== realRoot && !realTarget.startsWith(prefix)) {
    fail('path_escape', `${label} 必须位于 ${realRoot} 内。`)
  }
}

async function repoGitDir(repoRoot) {
  const result = await git(['rev-parse', '--show-toplevel'], { cwd: repoRoot })
  if (result.code !== 0) return null
  return result.stdout.trim()
}

async function ensureIdentity(repoRoot, identity = DEFAULT_IDENTITY) {
  await gitOk(['config', 'user.name', identity.name], { cwd: repoRoot })
  await gitOk(['config', 'user.email', identity.email], { cwd: repoRoot })
  await gitOk(['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })
}

async function revParse(repoRoot, ref) {
  const result = await git(['rev-parse', '--verify', ref], { cwd: repoRoot })
  if (result.code !== 0) return null
  return result.stdout.trim()
}

export function createGitRepositoryService() {
  return Object.freeze({
    GitRepositoryError,
    sidecarPath,
    readSidecar,
    writeSidecar,
    removeSidecar,
    withRepoLock(repoRoot, fn, options) {
      return withLock(lockDirFor(realDir(repoRoot, 'repoRoot')), fn, options)
    },

    async status({ repoRoot, worktreePath }) {
      const cwd = worktreePath ? realDir(worktreePath, 'worktreePath') : realDir(repoRoot, 'repoRoot')
      const porcelain = await gitOk(['status', '--porcelain'], { cwd })
      const head = await revParse(cwd, 'HEAD')
      const branch = (await gitOk(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })).trim()
      return {
        cwd,
        head,
        branch,
        clean: porcelain === '',
        porcelain,
      }
    },

    async diff({ worktreePath, against = 'main' }) {
      const cwd = realDir(worktreePath, 'worktreePath')
      const stat = await gitOk(['diff', '--stat', against], { cwd })
      const nameStatus = await gitOk(['diff', '--name-status', against], { cwd })
      const numstat = await gitOk(['diff', '--numstat', against], { cwd })
      const patch = await gitOk(['diff', against], { cwd })
      const untracked = await gitOk(['ls-files', '--others', '--exclude-standard'], { cwd })
      return {
        stat: stat.trim(),
        nameStatus: nameStatus.trim(),
        numstat: numstat.trim(),
        patch,
        untracked: untracked.trim(),
      }
    },

    async blob({ worktreePath, ref, file }) {
      const cwd = realDir(worktreePath, 'worktreePath')
      if (typeof file !== 'string' || file === '' || file.includes('/') || file.includes('\\') || file.includes('..')) {
        fail('path_invalid', 'file 必须是仓库顶层文件名。')
      }
      if (!ref) {
        const full = path.join(cwd, file)
        assertInside(cwd, full, 'file')
        if (!existsSync(full) || !statSync(full).isFile()) return null
        return readFileSync(full, 'utf8')
      }
      const shown = await git(['show', `${ref}:${file}`], { cwd })
      if (shown.code !== 0) return null
      return shown.stdout
    },

    async initRepository({ repoRoot, gitignore = DEFAULT_GITIGNORE, identity = DEFAULT_IDENTITY, bootstrapGlobs = ['*.py'] }) {
      const root = realDir(repoRoot, 'repoRoot')
      mkdirSync(root, { recursive: true })
      return withLock(lockDirFor(root), async () => {
        const existing = existsSync(path.join(root, '.git'))
        if (existing) {
          const toplevel = await repoGitDir(root)
          if (toplevel && realpathSync(toplevel) !== realpathSync(root)) {
            fail('repo_mismatch', `已有 Git 仓库根是 ${toplevel}，不是 ${root}。`)
          }
          const main = await revParse(root, 'refs/heads/main')
          if (!main) fail('main_missing', `${root} 没有 main 分支。`)
          await ensureIdentity(root, identity)
          return { repoRoot: realpathSync(root), created: false, head: main }
        }
        const init = await git(['init', '-b', 'main'], { cwd: root })
        if (init.code !== 0) fail('git_init_failed', `无法初始化仓库：${(init.stderr || init.stdout).trim()}`)
        writeFileSync(path.join(root, '.gitignore'), gitignore.endsWith('\n') ? gitignore : `${gitignore}\n`)
        await ensureIdentity(root, identity)
        const toAdd = ['.gitignore', ...topLevelPy(root)]
        await gitOk(['add', '--', ...toAdd], { cwd: root })
        const committed = await git(['commit', '--allow-empty', '-m', 'chore: bootstrap repository'], { cwd: root })
        if (committed.code !== 0) fail('git_init_failed', `无法创建 bootstrap commit：${(committed.stderr || committed.stdout).trim()}`)
        const head = await revParse(root, 'HEAD')
        return { repoRoot: realpathSync(root), created: true, head }
      })
    },

    async ensureWorktree({
      repoRoot,
      worktreesRoot,
      ownerId,
      ownerKind = 'dsh-session',
      branchPrefix = 'session',
      mainRef = 'main',
    }) {
      const root = realDir(repoRoot, 'repoRoot')
      const trees = realDir(worktreesRoot, 'worktreesRoot')
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(ownerId)) fail('owner_invalid', 'worktree ownerId 非法。')
      const branch = `${branchPrefix}/${ownerId}`
      const worktree = path.join(trees, ownerId)
      const sidecar = sidecarPath(trees, ownerId)

      return withLock(lockDirFor(root), async () => {
        const toplevel = await repoGitDir(root)
        if (!toplevel || realpathSync(toplevel) !== realpathSync(root)) {
          fail('repo_mismatch', `${root} 不是独立 Git 仓库根。`)
        }
        const mainSha = await revParse(root, `refs/heads/${mainRef}`)
        if (!mainSha) fail('main_missing', `${root} 没有 ${mainRef} 分支。`)
        const mainStatus = await gitOk(['status', '--porcelain'], { cwd: root })
        mkdirSync(trees, { recursive: true })

        const existingSidecar = readSidecar(sidecar)
        if (existingSidecar && existingSidecar.owner?.id && existingSidecar.owner.id !== ownerId) {
          fail('worktree_busy', `worktree ${worktree} 已属于其他 owner。`)
        }

        const listed = parseWorktrees(await gitOk(['worktree', 'list', '--porcelain'], { cwd: root }))
        const already = listed.some((item) => samePath(item.worktree, worktree))
        if (!already) {
          if (mainStatus !== '') fail('main_dirty', `${root} 的 ${mainRef} 工作树不干净，无法创建 session worktree。`)
          if (existsSync(worktree) && readdirSync(worktree).length > 0) {
            fail('worktree_busy', `worktree 路径已存在且不属于本仓库：${worktree}`)
          }
          const branchExists = await revParse(root, `refs/heads/${branch}`)
          const add = branchExists
            ? await git(['worktree', 'add', worktree, branch], { cwd: root })
            : await git(['worktree', 'add', '-b', branch, worktree, mainRef], { cwd: root })
          if (add.code !== 0) fail('worktree_add_failed', `无法创建 worktree：${(add.stderr || add.stdout).trim()}`)
        }

        assertInside(trees, worktree, 'worktree')
        const head = await revParse(worktree, 'HEAD')
        const envelope = writeSidecar(sidecar, {
          schema_version: 1,
          repository: realpathSync(root),
          worktree: realpathSync(worktree),
          owner: { kind: ownerKind, id: ownerId },
          main_ref: mainRef,
          branch,
          base_sha: existingSidecar?.base_sha ?? mainSha,
          status: existingSidecar?.status === 'conflict' ? 'conflict' : 'active',
          payload: existingSidecar?.payload ?? {},
          created_at: existingSidecar?.created_at,
        })
        return { ...envelope, head }
      })
    },

    async commit({ worktreePath, message, addGlobs = ['*.py'] }) {
      const cwd = realDir(worktreePath, 'worktreePath')
      if (typeof message !== 'string' || message.trim() === '') fail('commit_invalid', 'commit message 不能为空。')
      return commitWithGlobs(cwd, message, addGlobs)
    },

    async logFile({ repoRoot, file, limit = 100 }) {
      const root = realDir(repoRoot, 'repoRoot')
      assertTopLevelFile(file)
      const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100
      const result = await git(
        ['log', '--format=%H%x1f%an%x1f%cI%x1f%s', `--max-count=${max}`, '--name-status', '--', file],
        { cwd: root },
      )
      if (result.code !== 0) return []
      const commits = []
      let current = null
      for (const line of result.stdout.split('\n')) {
        if (line.includes('\x1f')) {
          const [sha, author, date, subject] = line.split('\x1f')
          current = { sha, author, date, subject, status: null }
          commits.push(current)
          continue
        }
        if (current && current.status == null && line.trim() !== '') {
          const [code] = line.split('\t')
          if (code?.startsWith('A')) current.status = 'added'
          else if (code?.startsWith('D')) current.status = 'deleted'
          else if (code) current.status = 'modified'
        }
      }
      return commits
    },

    async diffRefs({ repoRoot, fromRef, toRef = null, file }) {
      const root = realDir(repoRoot, 'repoRoot')
      assertTopLevelFile(file)
      assertRefName(fromRef, 'fromRef')
      const args = ['diff', fromRef]
      if (toRef) {
        assertRefName(toRef, 'toRef')
        args.push(toRef)
      }
      args.push('--', file)
      const patch = await gitOk(args, { cwd: root })
      return { patch }
    },

    async restoreFileTo({ repoRoot, file, ref, message }) {
      const root = realDir(repoRoot, 'repoRoot')
      assertTopLevelFile(file)
      assertRefName(ref)
      const text = typeof message === 'string' && message.trim() !== '' ? message : `restore ${file} from ${ref}`
      await gitOk(['checkout', ref, '--', file], { cwd: root })
      return commitWithGlobs(root, text, [file])
    },

    async merge({ worktreePath, fromRef, noCommit = false, noFf = false }) {
      const cwd = realDir(worktreePath, 'worktreePath')
      const args = ['merge']
      if (noCommit) args.push('--no-commit')
      if (noFf) args.push('--no-ff')
      args.push(fromRef)
      const result = await git(args, { cwd })
      if (result.code !== 0) {
        const text = `${result.stdout}\n${result.stderr}`
        if (text.includes('CONFLICT') || text.includes('fix conflicts')) {
          return { ok: false, conflict: true, stdout: result.stdout, stderr: result.stderr }
        }
        fail('merge_failed', `git merge 失败：${(result.stderr || result.stdout).trim()}`)
      }
      return { ok: true, conflict: false, stdout: result.stdout, stderr: result.stderr }
    },

    async abortMerge({ worktreePath }) {
      const cwd = realDir(worktreePath, 'worktreePath')
      await git(['merge', '--abort'], { cwd })
    },

    async isAncestor({ repoRoot, ancestor, descendant = 'HEAD' }) {
      const root = realDir(repoRoot, 'repoRoot')
      const result = await git(['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root })
      return result.code === 0
    },

    async publishFastForward({ repoRoot, fromRef }) {
      const root = realDir(repoRoot, 'repoRoot')
      await gitOk(['merge', '--ff-only', fromRef], { cwd: root })
      return { sha: await revParse(root, 'HEAD') }
    },

    async publishMerge({ repoRoot, fromRef, message }) {
      const root = realDir(repoRoot, 'repoRoot')
      if (typeof message !== 'string' || message.trim() === '') fail('commit_invalid', 'merge message 不能为空。')
      await gitOk(['merge', '--no-ff', '-m', message, fromRef], { cwd: root })
      return { sha: await revParse(root, 'HEAD') }
    },

    async removeWorktree({ repoRoot, worktreesRoot, ownerId, force = false }) {
      const root = realDir(repoRoot, 'repoRoot')
      const trees = realDir(worktreesRoot, 'worktreesRoot')
      const worktree = path.join(trees, ownerId)
      const sidecar = sidecarPath(trees, ownerId)
      const envelope = readSidecar(sidecar)
      const args = ['worktree', 'remove']
      if (force) args.push('--force')
      args.push(worktree)
      await git(args, { cwd: root })
      if (envelope?.branch) await git(['branch', '-D', envelope.branch], { cwd: root })
      removeSidecar(sidecar)
      return { removed: true }
    },

    async revParse(repoRoot, ref) {
      return revParse(realDir(repoRoot, 'repoRoot'), ref)
    },

    listWorktreeSidecars(worktreesRoot) {
      const trees = realDir(worktreesRoot, 'worktreesRoot')
      if (!existsSync(trees) || !statSync(trees).isDirectory()) return []
      return readdirSync(trees)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readSidecar(path.join(trees, name)))
        .filter(Boolean)
    },
  })
}
