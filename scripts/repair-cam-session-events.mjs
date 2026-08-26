#!/usr/bin/env node
// 修复含 cam/* 事件的会话日志：把 cam/* 事件标记为 ignorable:true，使
// dsh-session-persistence 的 assertEventsSupported 放行（0.1.1-rc.2 起
// cam/* 会话事件已停发——本脚本只为历史日志兜底）。
//
// 背景：tool-cam 曾向会话 append cam/stage、cam/check-report、cam/delivered
// 观测事件；这些类型不在上游 KNOWN_SESSION_EVENT_TYPES 且 append() 无法打
// ignorable 标记，导致含它们的会话在进程重启后整体拒绝重载
// （SessionFormatUnsupportedError）。ignorable:true 是合法信封键，标记后
// 加载门放行、事件流完整保留（会话历史不丢）。
//
// 用法（请在 dsh 停止时运行——live 会话 flush 会覆盖修复）：
//   node scripts/repair-cam-session-events.mjs [DSH_HOME]
// 默认 DSH_HOME = 环境变量或项目根 .dsh。幂等；每个被改文件先留 .bak 备份。
//
// 磁盘格式（dsh-session-persistence-jsonl）：session.jsonl.zstd 是**多个独立
// zstd 帧拼接**（每次 flush 追加一帧、带 checksum），node 的 zstdDecompressSync
// 只解首帧——必须按帧头结构扫出全部帧边界逐帧解压（下方 scanZstdFrames 与
// 上游同名函数同逻辑）。写回必须保持格式不变量：首帧解压后恰好一行 header
// （上游 assertZstdHeaderFrame），故重打包为 header 帧 + 内容帧两帧。

import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ZSTD_MAGIC = 4247762216
const CAM_TYPE_PREFIX = 'cam/'
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

// 与上游 scanZstdFrames 同逻辑：逐帧头 + 块走，不解压，产出完整帧边界。
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) throw new Error(`字节 ${start}：截断的帧头`)
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`字节 ${start}：帧 magic 非法（文件损坏？）`)
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`字节 ${offset - 1}：帧头保留位非零`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (buffer.length - offset < 3) throw new Error(`字节 ${offset}：截断的块头`)
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`字节 ${offset - 3}：保留块类型`)
      offset += blockType === 1 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return frames
}

function decompressAll(raw) {
  return scanZstdFrames(raw)
    .map((f) => zstdDecompressSync(raw.subarray(f.start, f.end)).toString('utf8'))
    .join('')
}

// 修复一个文本形态日志（.jsonl 与 .jsonl.zstd 共用）。返回标记条数。
function markCamEvents(text) {
  const lines = text.split('\n')
  let marked = 0
  const out = lines.map((line) => {
    if (line.trim() === '') return line
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return line // 非事件行（不应出现；原样保留，不帮倒忙）
    }
    if (typeof event?.type === 'string' && event.type.startsWith(CAM_TYPE_PREFIX) && event.ignorable !== true) {
      event.ignorable = true
      marked += 1
      return JSON.stringify(event)
    }
    return line
  })
  return { text: out.join('\n'), marked }
}

// 格式不变量（上游 assertZstdHeaderFrame）：首帧解压后必须恰好一行 header
// （唯一 \n 在末尾）。检查当前文件是否满足。
function framingIsValid(raw) {
  const frames = scanZstdFrames(raw)
  if (frames.length === 0) return false
  const first = zstdDecompressSync(raw.subarray(frames[0].start, frames[0].end)).toString('utf8')
  return first.length > 0 && first.indexOf('\n') === first.length - 1
}

// 重打包：帧 1 = header 行（含 \n），帧 2 = 其余全部行（可空则不写）。
function packLog(text) {
  const firstBreak = text.indexOf('\n')
  if (firstBreak < 0) throw new Error('日志没有 header 行')
  const header = text.slice(0, firstBreak + 1)
  const body = text.slice(firstBreak + 1)
  const headFrame = zstdCompressSync(Buffer.from(header, 'utf8'), CHECKSUM_OPTIONS)
  if (body.trim() === '') return headFrame
  return Buffer.concat([headFrame, zstdCompressSync(Buffer.from(body, 'utf8'), CHECKSUM_OPTIONS)])
}

function repairFile(file) {
  if (file.endsWith('.jsonl.zstd')) {
    const raw = readFileSync(file)
    const { text, marked } = markCamEvents(decompressAll(raw))
    // 已标记过的文件也要修帧结构（本脚本旧版曾误打成单帧）。
    if (marked === 0 && framingIsValid(raw)) return { written: false, marked: 0 }
    if (!existsSync(`${file}.bak`)) copyFileSync(file, `${file}.bak`)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, packLog(text))
    renameSync(tmp, file)
    return { written: true, marked }
  }
  if (file.endsWith('.jsonl')) {
    const { text, marked } = markCamEvents(readFileSync(file, 'utf8'))
    if (marked === 0) return { written: false, marked: 0 }
    if (!existsSync(`${file}.bak`)) copyFileSync(file, `${file}.bak`)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, file)
    return { written: true, marked }
  }
  return { written: false, marked: 0 }
}

const dshHome = process.argv[2] ?? process.env.DSH_HOME ?? path.resolve(import.meta.dirname, '..', '.dsh')
const sessionsRoot = path.join(dshHome, 'sessions')
if (!existsSync(sessionsRoot)) {
  console.error(`sessions 目录不存在：${sessionsRoot}`)
  process.exit(1)
}

let files = 0
let touched = 0
let totalMarked = 0
for (const projectDir of readdirSync(sessionsRoot)) {
  const projectPath = path.join(sessionsRoot, projectDir)
  if (!statSync(projectPath).isDirectory()) continue
  for (const sessionDir of readdirSync(projectPath)) {
    const sessionPath = path.join(projectPath, sessionDir)
    if (!statSync(sessionPath).isDirectory()) continue
    for (const name of readdirSync(sessionPath)) {
      if (!name.endsWith('.jsonl') && !name.endsWith('.jsonl.zstd')) continue
      files += 1
      const file = path.join(sessionPath, name)
      try {
        const { written, marked } = repairFile(file)
        if (written) {
          touched += 1
          totalMarked += marked
          console.log(`已修复 ${sessionDir}/${name}：${marked > 0 ? `标记 ${marked} 条 cam/* 事件` : '帧结构重打包'}（备份 ${name}.bak）`)
        }
      } catch (error) {
        console.error(`跳过 ${file}：${error.message}`)
      }
    }
  }
}
console.log(`完成：扫描 ${files} 个日志，修复 ${touched} 个，共标记 ${totalMarked} 条。${touched === 0 ? '（无需修复）' : ''}`)
