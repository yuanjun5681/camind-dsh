// DWG/DXF preview Host: local conversion jobs, six-identity cache and authenticated pack routes.
import os from 'node:os'
import path from 'node:path'
import { createDrawingPreviewService } from './lib/service.js'
import { createDrawingRouteHandler, DRAWING_ROUTE_PREFIX } from './lib/routes.js'

export const inject = ['webServer', 'previewFiles', 'draftConverter', 'connection']

export function apply(ctx) {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const service = createDrawingPreviewService({
    home,
    resolve: (...args) => ctx.previewFiles.resolve(...args),
    draftConverter: ctx.draftConverter,
  })
  ctx.provide('drawingPreview', service)
  ctx.effect(() => () => service.dispose())
  ctx.webServer.register({
    kind: 'prefix',
    path: DRAWING_ROUTE_PREFIX,
    handler: createDrawingRouteHandler({ service, connection: ctx.connection }),
  })
}
