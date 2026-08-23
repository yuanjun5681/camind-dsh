// CAM 交付包只读下载路由 —— GET /camind/api/cam/runs/<session>/<runId>/delivery/<file>。
//
// 交付卡（lib/client.js）的「下载」入口与刀路查看器挂点（cam.nc.preview）的
// NC 内容都从这里拿：交付物留档在 $DSH_HOME/cam-runs/<session>/<runId>/delivery/，
// 不依赖会话工作区镜像是否成功、也不依赖 ui-shell 的会话文件路由（官方壳同样可用）。
//
// 路径纪律（严格防越界）：
//   - session 只认 safeSessionId 产出的字符集 [A-Za-z0-9_-]；
//   - runId 只认 cam_plan 分配的字符集（gate.js RUN_ID_PATTERN）；
//   - <file> 只允许平铺文件名（不含分隔符），realpath 后必须仍在 delivery/ 内；
//   - 特例 nc/<name>：从 nc_batch.zip 开包抽取该条目（按文件名逐字匹配，
//     中央目录取压缩方式/长度，本地头取数据偏移；deflate 经 zlib 解压，
//     解压上限 32 MiB 防 zip-bomb）。NC 实体只在 zip 里，不落零散文件。
//
// 路由是本地只读面：与既有 /camind/api/cam/ping 同一信任模型（本机浏览器
// 即可读本机任何会话的留档）；只注册 GET，其余方法 405。

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'

import { RUN_ID_PATTERN } from './gate.js'

const ROUTE_PREFIX = '/camind/api/cam/runs'
const SESSION_PATTERN = /^[A-Za-z0-9_-]+$/
const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const NC_NAME_PATTERN = /^[A-Za-z0-9._-]+\.nc$/i
const MAX_NC_ENTRY_BYTES = 32 * 1024 * 1024

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function sendBytes(res, status, bytes, headers) {
  res.writeHead(status, { 'content-length': bytes.length, ...headers })
  res.end(bytes)
}

function contentTypeOf(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (lower.endsWith('.nc')) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function basenameOf(p) {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return slash >= 0 ? p.slice(slash + 1) : p
}

// 最小 ZIP 读取（中央目录 + 本地头）：与 deliver.js 的 zipEntryNames 同源纪律——
// X-CAM-Files 头不可信、条目实数以包内结构为准。只支持 method 0（stored）与
// 8（deflate）；ZIP64/加密包不支持（NC 包量级到不了，遇到按 500 报错，不静默）。
function readZipEntry(bytes, wantName) {
  const EOCD_SIG = 0x06054b50
  const CDIR_SIG = 0x02014b50
  const LOCAL_SIG = 0x04034b50
  const min = Math.max(0, bytes.length - 22 - 65536)
  let eocd = -1
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 ZIP 中央目录结尾记录（不是有效 zip）')
  const count = bytes.readUInt16LE(eocd + 10)
  let offset = bytes.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CDIR_SIG) {
      throw new Error('ZIP 中央目录损坏')
    }
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const nameLen = bytes.readUInt16LE(offset + 28)
    const extraLen = bytes.readUInt16LE(offset + 30)
    const commentLen = bytes.readUInt16LE(offset + 32)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    offset += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || basenameOf(name) !== wantName) continue
    if (method !== 0 && method !== 8) throw new Error(`不支持的 ZIP 压缩方式（method ${method}）`)
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error('ZIP 本地文件头损坏')
    }
    const localNameLen = bytes.readUInt16LE(localOffset + 26)
    const localExtraLen = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (dataStart + compressedSize > bytes.length) throw new Error('ZIP 条目数据越界')
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)
    const content = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_NC_ENTRY_BYTES })
    if (content.length > MAX_NC_ENTRY_BYTES) throw new Error('NC 条目超过 32 MiB 上限')
    return content
  }
  return null
}

// req.url 路径形态：<prefix>/<session>/<runId>/delivery/<file>（含 nc/<name> 特例）。
// prefix 注册后该前缀下所有请求都由本 handler 应答（形态不符也在这里回 400）。
export function createDeliveryRouteHandler() {
  return (req, res) => {
    let pathname = ''
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '', 'http://localhost').pathname)
    } catch {
      sendJson(res, 400, { ok: false, message: 'URL 无法解析。' })
      return
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, message: '仅支持 GET。' })
      return
    }
    const segments = pathname.slice(ROUTE_PREFIX.length + 1).split('/')
    const [session, runId, marker, ...rest] = segments
    if (!session || !runId || marker !== 'delivery' || rest.length !== 1 && rest.length !== 2) {
      sendJson(res, 400, { ok: false, message: '路径形态应为 /camind/api/cam/runs/<session>/<runId>/delivery/<file>。' })
      return
    }
    if (!SESSION_PATTERN.test(session)) {
      sendJson(res, 400, { ok: false, message: 'session 标识不合法。' })
      return
    }
    if (!RUN_ID_PATTERN.test(runId)) {
      sendJson(res, 400, { ok: false, message: 'runId 不合法。' })
      return
    }
    const dshHome = process.env.DSH_HOME
    if (!dshHome) {
      sendJson(res, 500, { ok: false, message: 'DSH_HOME 未设置，无法定位 run 目录。' })
      return
    }
    const deliveryDir = path.join(dshHome, 'cam-runs', session, runId, 'delivery')

    // 特例：nc/<name> —— 从 nc_batch.zip 开包抽取（NC 实体只在 zip 里）。
    if (rest[0] === 'nc') {
      const name = rest[1] ?? ''
      if (rest.length !== 2 || !NC_NAME_PATTERN.test(name)) {
        sendJson(res, 400, { ok: false, message: 'NC 条目不合法（应为 nc/<文件名>.nc）。' })
        return
      }
      const zipPath = path.join(deliveryDir, 'nc_batch.zip')
      if (!existsSync(zipPath)) {
        sendJson(res, 404, { ok: false, message: '交付包不存在（nc_batch.zip 不在盘上）。' })
        return
      }
      try {
        const content = readZipEntry(readFileSync(zipPath), name)
        if (content === null) {
          sendJson(res, 404, { ok: false, message: `交付包里没有 NC 条目「${name}」。` })
          return
        }
        sendBytes(res, 200, content, {
          'content-type': contentTypeOf(name),
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        })
        return
      } catch (error) {
        sendJson(res, 500, { ok: false, message: `NC 条目读取失败：${error.message}` })
        return
      }
    }

    // 常规：delivery/ 下的平铺文件（realpath 双重防越界，防 symlink 逃逸）。
    const name = rest[0]
    if (rest.length !== 1 || !FILE_NAME_PATTERN.test(name) || name.startsWith('.')) {
      sendJson(res, 400, { ok: false, message: '文件名不合法（只允许平铺的字母/数字/._- 文件名）。' })
      return
    }
    if (!existsSync(deliveryDir)) {
      sendJson(res, 404, { ok: false, message: '交付目录不存在（该 run 尚未交付）。' })
      return
    }
    let file
    let root
    try {
      root = realpathSync(deliveryDir)
      file = realpathSync(path.join(deliveryDir, name))
    } catch {
      sendJson(res, 404, { ok: false, message: `文件不存在：${name}。` })
      return
    }
    if (!file.startsWith(root + path.sep)) {
      sendJson(res, 403, { ok: false, message: '路径越界，已拒绝。' })
      return
    }
    try {
      if (!statSync(file).isFile()) {
        sendJson(res, 400, { ok: false, message: '目标不是文件。' })
        return
      }
      sendBytes(res, 200, readFileSync(file), {
        'content-type': contentTypeOf(name),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      })
      return
    } catch (error) {
      sendJson(res, 500, { ok: false, message: `文件读取失败：${error.message}` })
      return
    }
  }
}
