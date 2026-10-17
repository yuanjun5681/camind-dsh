// Build the migrated TS Draft core for the dsh module-loader browser runtime.
import { build } from '../ui-shell/node_modules/esbuild/lib/main.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(fileURLToPath(import.meta.url))
await build({
  entryPoints: [path.join(root, 'src/client.ts')],
  outfile: path.join(root, 'lib/client.js'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  banner: { js: "// Generated from ui-drawing-viewer/src; run node ui-drawing-viewer/build.mjs.\nwindow.__ModuleLoader__.load({ id: 'camind-ui-drawing-viewer', factory: (require) => { var module = { exports: {} }; var exports = module.exports;" },
  footer: { js: 'return module.exports; } });' },
})
