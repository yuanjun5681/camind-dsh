// list_machines / read_machine 模型工具（只读问答用：车间有哪些机床、这活能不能干）。
// 机床参数不经模型转手——排工艺取精确数值由 cam_plan 经 inject machineRegistry 直读，
// 这两个工具只服务于对话问答（设计稿 §3 关键决策 3）。

function json(payload) {
  return JSON.stringify(payload, null, 2)
}

export function registerListMachines(ctx, machineRegistry) {
  ctx.tools.register({
    name: 'list_machines',
    description:
      '列出车间全部机床的摘要：machine_id、名称、机型、审批状态（draft/active/deprecated）、档案版本与有效性。'
      + '用于回答「车间有哪些机床、哪台能用」。某台机床档案校验不通过时会带 errors 字段，'
      + '该机床禁止用于排产，先把错误如实告知用户。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      try {
        const machines = machineRegistry.list()
        return json({ status: 'ok', machines })
      } catch (error) {
        return json({ status: 'error', msg: error.message })
      }
    },
  })
}

export function registerReadMachine(ctx, machineRegistry) {
  ctx.tools.register({
    name: 'read_machine',
    description:
      '读取指定机床的完整档案（入参 machine_id，先 list_machines 获取）：行程/主轴/工作台/控制器/'
      + '刀库 T 位与刀具清单/夹具/材料切削参数规则等全部字段。用于回答「这活这台机床能不能干」。'
      + '注意：档案里 measured 为空、post 为 DRAFT 等「未就绪」标记要如实转述，不得当作已验证数据。',
    parameters: {
      type: 'object',
      properties: {
        machine_id: { type: 'string', description: '机床 id（即档案文件名去掉 .yaml，如 VMC-HJ-01）' },
      },
      required: ['machine_id'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      try {
        return json({ status: 'ok', machine: machineRegistry.get(args?.machine_id) })
      } catch (error) {
        return json({ status: 'error', msg: error.message })
      }
    },
  })
}
