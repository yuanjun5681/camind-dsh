// camind-ui-workbench — Host 配置：新 DrawingPreview 为默认；旧 DwgPane 只经
// volatile 条目配置临时回滚。开关日志只含事件名、状态与来源，不含会话或文件信息。
import z from '@deepseek-ai/schemastery'

export const name = 'ui-workbench'
export const Config = z.object({
  useLegacyDwgPane: z.boolean().default(false).volatile(),
})

const cellValue = value => value && typeof value.get === 'function' ? value.get() : value

export function apply(ctx, config) {
  const enabled = () => cellValue(config?.useLegacyDwgPane) === true
  let previous = enabled()
  const record = (state, origin) => ctx.logger.info(`[ui-workbench] event=drawing-renderer-rollback state=${state} origin=${origin}`)
  if (previous) record('enabled', 'startup')
  ctx.on('loader/volatile-update', paths => {
    if (!paths.some(path => path.length === 1 && path[0] === 'useLegacyDwgPane')) return
    const next = enabled()
    if (next === previous) return
    previous = next
    record(next ? 'enabled' : 'disabled', 'config')
  })
}
