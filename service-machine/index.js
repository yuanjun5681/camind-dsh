// camind-service-machine — 机床档案注册表（设计稿 docs/cam-machining-design.md §5.1）。
// 提供 Cordis machineRegistry 服务（list/get/snapshot，只读；cam_plan 经 inject 直读
// 机床精确参数，不经模型转手），并注册 2 个只读问答工具 list_machines / read_machine。
// 档案写操作 v1 = 人工编辑 $DSH_HOME/machines/*.yaml；种子基线同步见 scripts/init.mjs。

import { createMachineRegistry } from './lib/registry.js'
import { registerListMachines, registerReadMachine } from './tools/machine-tools.js'

export const name = 'service-machine'
export const inject = ['tools']

export function apply(ctx) {
  const machineRegistry = createMachineRegistry()
  ctx.provide('machineRegistry', machineRegistry)

  registerListMachines(ctx, machineRegistry)
  registerReadMachine(ctx, machineRegistry)

  console.log(
    `[service-machine] loaded (root=${machineRegistry.root() ?? 'DSH_HOME 未设置，服务不可用'})；` +
    'registered: machineRegistry 服务（list/get/snapshot）、工具 list_machines, read_machine',
  )
}
