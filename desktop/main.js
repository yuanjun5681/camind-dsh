import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(__dirname, '..')
const isPackaged = app.isPackaged

// dsh 数据目录（DSH_HOME）：显式环境变量优先；开发时复用工作区自带的 .dsh/
// （示例插件已装好）；打包后落到应用数据目录，首次运行从随包种子复制。
const workspaceDshHome = path.join(workspaceRoot, '.dsh')
const useWorkspaceHome = !isPackaged && !process.env.DSH_HOME && fs.existsSync(workspaceDshHome)
const dshHome = process.env.DSH_HOME
  ?? (useWorkspaceHome ? workspaceDshHome : path.join(app.getPath('userData'), 'dsh-home'))
// 子进程工作目录：开发时设在仓库根目录，让根目录 .env 里的 DEEPSEEK_API_KEY 生效
const dshCwd = useWorkspaceHome ? workspaceRoot : app.getPath('userData')

const HOST = '127.0.0.1'

let dshChild = null
let mainWindow = null

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, HOST, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

// 打包模式首次运行：把随包的种子 DSH_HOME（web profile + 示例插件）拷进应用数据目录
function ensureSeedDshHome() {
  if (!isPackaged || process.env.DSH_HOME || fs.existsSync(dshHome)) return
  fs.cpSync(path.join(process.resourcesPath, 'dsh-home'), dshHome, { recursive: true })
  console.log(`[desktop] seeded DSH_HOME at ${dshHome}`)
}

function startDsh(port) {
  const webArgs = ['web', '--host', HOST, '--port', String(port)]
  const env = { ...process.env, DSH_HOME: dshHome }
  let child
  if (isPackaged) {
    // 用 Electron 内嵌的 Node 运行随包的 dsh；--expose-internals 是 dsh 插件
    // 加载器按 profile 目录解析裸包名的前提（见 cordis-plugin-loader）
    const bin = path.join(process.resourcesPath, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    child = spawn(process.execPath, ['--expose-internals', bin, ...webArgs], {
      cwd: dshCwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } else {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const versionFile = path.join(workspaceRoot, 'dsh-version.json')
    const { version } = JSON.parse(fs.readFileSync(versionFile, 'utf8'))
    child = spawn(npx, ['-y', `@deepseek-ai/dsh@${version}`, ...webArgs], {
      cwd: dshCwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  child.stdout.on('data', (d) => process.stdout.write(`[dsh] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[dsh] ${d}`))
  return child
}

// 轮询直到 dsh Web UI 可响应；子进程提前退出或超时则抛错
async function waitForServer(url, child) {
  const deadline = Date.now() + 90_000
  let exitCode = null
  child.once('exit', (code) => { exitCode = code })
  while (Date.now() < deadline) {
    if (exitCode !== null) throw new Error(`dsh 进程提前退出（exit code ${exitCode}）`)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.status < 500) return
    } catch { /* 还没起来，继续等 */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('等待 dsh Web UI 就绪超时（90s）')
}

function pageHtml(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
  <body style="margin:0;height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;background:#1e1e1e;color:#ccc">
  <h2 style="margin:0">${title}</h2><p style="margin:0;color:#888">${body}</p></body>`
}

async function boot() {
  const port = await getFreePort()
  const url = `http://${HOST}:${port}`
  console.log(`[desktop] packaged=${isPackaged} DSH_HOME=${dshHome}`)
  console.log(`[desktop] starting dsh web on ${url}`)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Camind',
    autoHideMenuBar: true,
  })
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHtml('正在启动 dsh…', '首次启动可能需要几十秒'))}`)

  ensureSeedDshHome()
  dshChild = startDsh(port)
  try {
    await waitForServer(url, dshChild)
  } catch (err) {
    console.error(`[desktop] ${err.message}`)
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHtml('dsh 启动失败', err.message))}`)
    return
  }
  const uiUrl = `${url}/camind/`
  console.log(`[desktop] dsh ready, loading ${uiUrl}`)
  await mainWindow.loadURL(uiUrl)
}

function killDsh() {
  if (dshChild && dshChild.exitCode === null) dshChild.kill('SIGTERM')
}

app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
app.on('will-quit', killDsh)
process.on('exit', killDsh)
