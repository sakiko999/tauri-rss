/**
 * host —— 宿主能力的 UI 侧统一包装(目前只有「打开外链」)。
 *
 * ⚠️ 桌面打开外链**必须**走 `appHost.openExternal`(Tauri opener 插件)——WebView 会
 * 拦掉裸 `window.open`,表现为「点了没反应」。
 *
 * 但 opener 也会失败(URL 非法 / 系统无对应默认程序 / 宿主未注入),旧代码直接
 * `void appHost.openExternal(url)` 把这些变成静默的 unhandled rejection:点了没反应
 * 且没有任何提示。这里统一兜住并给用户可见的失败反馈。
 */
import { useDesktop } from "../store/index.ts"

export function openExternalSafely(url: string | undefined | null): void {
  if (!url) return
  try {
    void Promise.resolve(globalThis.appHost.openExternal(url)).catch((e) => {
      useDesktop
        .getState()
        .toast("error", "打开外链失败", e instanceof Error ? e.message : String(e))
    })
  } catch (e) {
    // 宿主未注入时访问门面会同步抛错。
    useDesktop
      .getState()
      .toast("error", "打开外链失败", e instanceof Error ? e.message : String(e))
  }
}
