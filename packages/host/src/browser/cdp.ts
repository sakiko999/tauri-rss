/**
 * CDP 浏览器载具的公共入口 —— 桌面（Tauri WebView2）与 CLI（外部 Chromium）共用。
 *
 * 用法：实现一个 BrowserDriver（怎么拉起/整理进程与窗口）+ 一个 CdpConnector
 * （文本帧怎么走），交给 CdpBrowserBackend。lane/超时/cookie/资源拦截等语义
 * 全部在 backend 里，只有一份。
 */
export { BLOCKED_URL_PATTERNS, CdpBrowserBackend, MAX_TABS } from "./backend.ts"
export type { BrowserDriver, CdpBackendOptions, CdpTargetInfo } from "./backend.ts"
export { CDP_CMD_TIMEOUT_MS, CdpChannel } from "./channel.ts"
export type { CdpActivity, CdpEventListener } from "./channel.ts"
export type { CdpConnector, CdpTransport, CdpTransportHandlers } from "./transport.ts"
