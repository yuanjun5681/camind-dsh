// camind-service-git-repository — generic Cordis gitRepository service.
// Domain plugins inject this service; it does not register model tools.

import { createGitRepositoryService } from './lib/service.js'

export const name = 'service-git-repository'

export function apply(ctx) {
  ctx.provide('gitRepository', createGitRepositoryService())
  console.log('[service-git-repository] provided gitRepository')
}
