// Agent-facing formal drafts and bounded DWG reading; human answers/authorizations stay on the authenticated UI path.
const json = value => JSON.stringify(value, null, 2)
export function registerCamTask(ctx, tasks) {
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  ctx.tools.register({
    name: 'cam_task', description: '读取和更新当前会话正式加工任务：归档 PRT/DWG 输入、保存来源明确的要求/问题/工序草案，返回任务版本与待补条件。每次写入使用读到的 version；任务跨回合保存，工序依赖按顺序核验。',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['read', 'collect', 'update'] }, version: { type: 'integer' }, inputs: { type: 'object', properties: { prt: { type: 'string' }, dwg: { type: 'string' } } }, patch: { type: 'object', description: '草案字段：goal/setup/machine_id/post_name/prepare/requirements/questions/operations。goal 保持用户当前请求范围。questions 含 id/prompt/critical/scope，scope=review 接件审图、planning 后续编程、system 系统任务；同一事项仅一个问题；planning 的材料/毛坯/基准/装夹问题必须带 field=material/stock/datum/fixture，冲突带 conflict=true，界面归并到对应字段。setup 中已有会话信息保存为 recommendation 建议供用户核对，不代签。规划时只修改 setup/questions/operations/prepare，不重写已审图图纸要求；来源或范围实质变化才更新 requirements。系统状态不要让用户自由文本确认。来源 kind=drawing 需 sha256/entity_id/quote；建议为 recommendation。工序含稳定 id、station、depends_on（字符串数组）、execution=nc/external、inspection（非空字符串数组，如 ["NC对账","装夹未核验，仅问题包"]）。' } }, required: ['action'] }, output,
    async execute(args, exec) {
      try {
        const sid = exec.agent?.id
        if (!sid) throw new Error('没有当前会话')
        let data
        if (args.action === 'read') data = await tasks.read(sid)
        else { if (!Number.isInteger(args.version)) throw new Error('写入必须提交当前 version'); data = args.action === 'collect' ? await tasks.collect(sid, args.version, args.inputs, exec) : await tasks.update(sid, args.version, args.patch) }
        return json({ status: 'ok', task: data })
      } catch (error) { return json({ status: 'error', error_type: error.code ?? 'TaskInvalid', msg: error.message }) }
    },
  })
  ctx.tools.register({
    name: 'read_drawing', description: '读取正式 DWG 快照的标注原文、稳定实体句柄、原始尺寸属性与图层。返回图纸 SHA 与转换限制；支持分页、文本搜索或单实体详细属性。数值是图纸属性，不是 NX 实测结果。',
    parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, query: { type: 'string' }, entity_id: { type: 'string' } } }, output,
    async execute(args, exec) {
      try {
        const data = await tasks.drawing(exec.agent?.id)
        let entities = data.annotations
        if (args.entity_id) entities = entities.filter(entity => entity.id === args.entity_id)
        if (args.query) entities = entities.filter(entity => entity.text.toLowerCase().includes(args.query.toLowerCase()))
        const offset = Number.isInteger(args.offset) && args.offset >= 0 ? args.offset : 0, limit = Math.min(100, Math.max(1, args.limit ?? 50))
        return json({ status: 'ok', source_sha256: data.source_sha256, readable: data.readable, units: data.units, note: data.note, total: entities.length, offset, next_offset: offset + limit < entities.length ? offset + limit : null,
          annotations: entities.slice(offset, offset + limit).map(entity => args.entity_id ? entity : { id: entity.id, type: entity.type, layer: entity.layer, text: entity.text, nominal: entity.nominal }) })
      } catch (error) { return json({ status: 'error', msg: error.message }) }
    },
  })
}
