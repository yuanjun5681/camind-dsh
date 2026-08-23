// machineRegistry Cordis 服务：$DSH_HOME/machines/*.yaml 机床档案的读取、校验与任务快照。
// 设计见 docs/cam-machining-design.md §5.1。只读服务，不提供任何写方法——
// v1 的档案写操作 = 人工编辑 YAML（种子基线在仓库 machines/，init 拷入，绝不覆盖）。
// DSH_HOME 定位惯例照 tool-memory：process.env.DSH_HOME，未设置则服务不可用（响亮报错）。
// 每次调用重新读盘（v1 无缓存）：档案小、读取低频，且快照语义要求看到的是当下磁盘内容。

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import YAML from 'yaml'

function fail(message) {
  throw new Error(message)
}

// 档案必填项（基本校验；缺失 → 该机床标记 invalid，list 里带错误、get/snapshot 直接抛）。
function validateProfile(id, profile) {
  const errors = []
  const p = profile && typeof profile === 'object' ? profile : null
  if (!p) return ['档案不是 YAML 对象']
  if (typeof p.schema_version !== 'number') errors.push('schema_version 缺失或不是数字')
  if (typeof p.machine_id !== 'string' || !p.machine_id.trim()) {
    errors.push('machine_id 缺失或为空')
  } else if (p.machine_id !== id) {
    errors.push(`machine_id（${p.machine_id}）与文件名（${id}.yaml）不一致`)
  }
  if (typeof p.display_name !== 'string' || !p.display_name.trim()) errors.push('display_name 缺失或为空')
  if (!Number.isInteger(p.version) || p.version < 1) errors.push('version 缺失或不是正整数')
  if (!['draft', 'active', 'deprecated'].includes(p.approval)) {
    errors.push(`approval 缺失或非法（需 draft | active | deprecated，实际 ${JSON.stringify(p.approval)}）`)
  }
  if (typeof p.identity?.machine_type !== 'string' || !p.identity.machine_type.trim()) {
    errors.push('identity.machine_type 缺失或为空')
  }
  if (typeof p.spindle?.rpm_max !== 'number' || p.spindle.rpm_max <= 0) {
    errors.push('spindle.rpm_max 缺失或不是正数')
  }
  if (typeof p.kinematics?.max_cut_feed_mm_min !== 'number' || p.kinematics.max_cut_feed_mm_min <= 0) {
    errors.push('kinematics.max_cut_feed_mm_min 缺失或不是正数')
  }
  if (!p.magazine || typeof p.magazine !== 'object' || !Array.isArray(p.magazine.pockets)) {
    errors.push('magazine.pockets 缺失或不是数组（刀库清单）')
  }
  return errors
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

export function createMachineRegistry({ machinesRoot } = {}) {
  const root = machinesRoot ?? (process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'machines') : null)

  function requireRoot() {
    if (!root) fail('DSH_HOME 未设置，机床档案服务不可用。')
    if (!existsSync(root)) fail(`机床档案目录不存在：${root}（请先运行 npm run init 同步种子基线）`)
    return root
  }

  // 读全部档案文件：{ id, file, profile|null, errors[] }
  function scan() {
    const dir = requireRoot()
    const out = []
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.yaml')) continue
      const id = file.slice(0, -5)
      const absolute = path.join(dir, file)
      let profile = null
      let errors = []
      try {
        profile = YAML.parse(readFileSync(absolute, 'utf8'))
        errors = validateProfile(id, profile)
      } catch (error) {
        errors = [`YAML 解析失败：${error.message}`]
      }
      out.push({ id, file: absolute, profile, errors })
    }
    return out
  }

  function list() {
    return scan().map(({ id, profile, errors }) => ({
      machine_id: id,
      display_name: typeof profile?.display_name === 'string' ? profile.display_name : null,
      identity: profile?.identity ?? null,
      approval: profile?.approval ?? null,
      version: typeof profile?.version === 'number' ? profile.version : null,
      valid: errors.length === 0,
      errors,
    }))
  }

  function get(id) {
    const wanted = String(id ?? '').trim()
    if (!wanted) fail('缺少机床 id。')
    const all = scan()
    const found = all.find((row) => row.id === wanted)
    if (!found) {
      fail(`机床档案不存在：${wanted}（可用：${all.map((row) => row.id).join('、') || '无'}）`)
    }
    if (found.errors.length > 0) {
      fail(`机床档案 ${wanted} 校验不通过，禁止使用：\n${found.errors.map((e) => `  · ${e}`).join('\n')}`)
    }
    return found.profile
  }

  // 任务开跑冻结快照：深拷贝 + 递归 Object.freeze；调用方负责写进 run 目录
  //（旧 Camind JobConstraintSnapshot 语义：之后改机床参数不影响在跑任务）。
  function snapshot(id) {
    return deepFreeze(structuredClone(get(id)))
  }

  return Object.freeze({
    root: () => root,
    list,
    get,
    snapshot,
  })
}
