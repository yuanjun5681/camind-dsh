/**
 * 自定义前端运行时读到的设置偏好（外观、繁忙 Enter）。
 * 设置模态写入成功后同步到这里，Composer / 主题立刻生效。
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type BusyEnter = 'queue' | 'steer'

let themePreference: ThemePreference = 'system'
let busyEnter: BusyEnter = 'queue'
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function getThemePreference(): ThemePreference {
  return themePreference
}

export function setThemePreference(next: ThemePreference) {
  if (themePreference === next) return
  themePreference = next
  notify()
}

export function getBusyEnter(): BusyEnter {
  return busyEnter
}

export function setBusyEnter(next: BusyEnter) {
  if (busyEnter === next) return
  busyEnter = next
  notify()
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
