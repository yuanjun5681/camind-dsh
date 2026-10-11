// Build the migrated TS core for Node and the dsh module-loader browser runtime.
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(fileURLToPath(import.meta.url))
await build({ entryPoints: [path.join(root, 'src/host-core.ts')], outfile: path.join(root, 'lib/host-core.js'), bundle: true, platform: 'node', format: 'esm' })
await build({ entryPoints: [path.join(root, 'src/client.ts')], outfile: path.join(root, 'lib/client.js'), bundle: true, platform: 'browser', format: 'cjs', alias: { '@camind/core': path.join(root, 'src/core/index.ts') }, external: ['react', '@deepseek-ai/dsh-client-ui-primitives'], banner: { js: "// Generated from ui-model-viewer/src; run node ui-model-viewer/build.mjs.\nwindow.__ModuleLoader__.load({ id: 'camind-ui-model-viewer', factory: (require) => { var module = { exports: {} }; var exports = module.exports;" }, footer: { js: 'return module.exports; } });' } })
