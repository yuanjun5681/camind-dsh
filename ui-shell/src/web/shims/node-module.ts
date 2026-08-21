/**
 * Vite 把 cordis-plugin-loader 打进浏览器时，替掉 Node 的 `node:module`。
 * Loader 在浏览器里不会走 Node internals，真正的 import 走 ClientModuleSystem。
 */
export function createRequire(): (id: string) => unknown {
  return (id: string) => {
    throw new Error(`浏览器里没有 Node require：${id}`)
  }
}
