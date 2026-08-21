import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * 官方 `./client` 产物是 `window.__ModuleLoader__.load({ factory })`，
 * 给 Vite 当 ESM 入口会在求值时炸掉。解开 factory，导出它 return 的模块。
 */
function unwrapDshClientLoader(): Plugin {
  return {
    name: 'unwrap-dsh-client-loader',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes(`${path.sep}node_modules${path.sep}`) || !code.includes('window.__ModuleLoader__.load(')) {
        return null
      }
      const factory = /factory:\s*\(\s*require\s*\)\s*=>\s*\{/.exec(code)
      if (!factory || factory.index === undefined) return null
      const bodyStart = factory.index + factory[0].length
      const loadClose = code.lastIndexOf('});')
      if (loadClose < bodyStart) return null
      const factoryClose = code.lastIndexOf('}', loadClose - 1)
      if (factoryClose < bodyStart) return null
      const body = code.slice(bodyStart, factoryClose)
      return {
        code: [
          'const require = (spec) => { throw new Error("dsh client factory require: " + spec) }',
          `const __dshExports = ((require) => {${body}})(require)`,
          'export default __dshExports',
          'export const ClientModuleSystem = __dshExports.ClientModuleSystem',
          'export const parseBootManifest = __dshExports.parseBootManifest',
          'export const apply = __dshExports.apply',
          'export const inject = __dshExports.inject',
          'export const name = __dshExports.name',
        ].join('\n'),
        map: null,
      }
    },
  }
}

export default defineConfig({
  root: path.join(root, 'src/web'),
  base: '/camind/',
  plugins: [unwrapDshClientLoader(), react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'process.execArgv': JSON.stringify([]),
    'process.versions': JSON.stringify({ node: '22.22.1' }),
  },
  resolve: {
    alias: [
      { find: '@shared', replacement: path.join(root, 'src/shared') },
      // rc.7 的 npm lib 产物将 CSS Modules 替换成空对象；官方 Web 壳则从
      // 同版本源码构建。这里固定到随项目保存的上游源码，保证平台模块向
      // 所有官方 UI 插件提供完整的组件和样式映射。
      {
        find: /^@deepseek-ai\/dsh-client-ui-attachment$/,
        replacement: path.join(root, 'vendor/dsh-client-ui-attachment/src/index.ts'),
      },
      {
        find: /^@deepseek-ai\/dsh-client-ui-primitives$/,
        replacement: path.join(root, 'vendor/dsh-client-ui-primitives/src/index.ts'),
      },
      { find: 'node:module', replacement: path.join(root, 'src/web/shims/node-module.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/cordis-plugin-loader',
      '@deepseek-ai/dsh-client-web',
      '@deepseek-ai/dsh-client-web-react',
    ],
    exclude: ['@deepseek-ai/dsh-client-modules'],
  },
  server: {
    port: 5173,
    proxy: {
      '/camind/api': {
        target: 'http://127.0.0.1:3080',
        changeOrigin: true,
      },
      '/plugins': {
        target: 'http://127.0.0.1:3080',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.join(root, 'dist/web'),
    emptyOutDir: true,
  },
})
