/**
 * 自定义前端运行时读到的设置偏好（外观、繁忙 Enter）。
 * 设置模态写入成功后同步到这里，Composer / 主题立刻生效。
 */
let themePreference = 'system';
let busyEnter = 'queue';
const listeners = new Set();
function notify() {
    for (const listener of listeners)
        listener();
}
export function getThemePreference() {
    return themePreference;
}
export function setThemePreference(next) {
    if (themePreference === next)
        return;
    themePreference = next;
    notify();
}
export function getBusyEnter() {
    return busyEnter;
}
export function setBusyEnter(next) {
    if (busyEnter === next)
        return;
    busyEnter = next;
    notify();
}
export function subscribePrefs(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
