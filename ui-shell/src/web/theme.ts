/**
 * 外观：读 ui-theme.preference（light / dark / system），用 prefers-color-scheme
 * 解析 system。与官方一致：写 html color-scheme 和 data-ds-dark-theme。
 */
import { api } from './api'
import { getThemePreference, setBusyEnter, setThemePreference, subscribePrefs, type ThemePreference } from './settings/runtime'

function applyResolved(dark: boolean) {
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark)
  document.body?.toggleAttribute('data-ds-dark-theme', dark)
}

function resolveDark(preference: ThemePreference, systemDark: boolean): boolean {
  if (preference === 'dark') return true
  if (preference === 'light') return false
  return systemDark
}

export function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const paint = () => applyResolved(resolveDark(getThemePreference(), media.matches))
  paint()
  media.addEventListener('change', paint)
  subscribePrefs(paint)
  void api.settings().then((doc) => {
    const ns = doc.namespaces.find((entry) => entry.ns === 'ui-theme')
    const preference = (ns?.value as { preference?: string } | undefined)?.preference
    if (preference === 'light' || preference === 'dark' || preference === 'system') {
      setThemePreference(preference)
    }
    const conversation = doc.namespaces.find((entry) => entry.ns === 'ui-conversation')
    const busy = (conversation?.value as { busyEnter?: string } | undefined)?.busyEnter
    if (busy === 'queue' || busy === 'steer') setBusyEnter(busy)
  }).catch(() => undefined)
}
