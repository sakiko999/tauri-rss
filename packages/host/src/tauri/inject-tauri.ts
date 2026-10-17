/**
 * injectTauriHost — 注入 Tauri 桌面宿主能力。
 *   - http:    TauriHttpBackend(Rust reqwest,CORS-free)
 *   - storage: SqliteStorageBackend(tauri-plugin-sql;首次访问自动从 localStorage 搬迁)
 *   - js:      FunctionJsBackend(跑 douyu/douyin 签名 blob;csp:null 允许 new Function)
 *   - ws:      TauriWsBackend(Rust ws_connect 隧道,握手可带 header,弹幕)
 *   - openExternal: tauri-plugin-opener(WebView 会拦 window.open)
 *   - updater: TauriUpdaterBackend(自动更新;仅桌面,移动端不注册插件)
 *   - log:     console
 *   - now:     Date.now
 */
import { openUrl } from "@tauri-apps/plugin-opener"
import { initAppHost, setHostCaps } from "../runtime.ts"
import { TauriHttpBackend } from "./tauri-http-backend.ts"
import { TauriWsBackend } from "./tauri-ws-backend.ts"
import { SqliteStorageBackend } from "./sqlite-storage-backend.ts"
import { FunctionJsBackend } from "./function-js-backend.ts"
import { TauriBrowserBackend } from "./browser-backend.ts"
import { TauriUpdaterBackend } from "./updater-backend.ts"

/**
 * @param opts.updater 传 `false` 不注入 updater —— 移动端 Rust 侧没有注册该插件,
 *   但 injectTauriHost 是双端共用的,必须由移动端显式关掉,否则能力探测会误判。
 */
export function injectTauriHost(opts: { updater?: boolean } = {}): void {
  initAppHost()
  setHostCaps({
    http: new TauriHttpBackend(),
    storage: new SqliteStorageBackend(),
    js: new FunctionJsBackend(),
    ws: new TauriWsBackend(),
    browser: new TauriBrowserBackend(),
    ...(opts.updater === false ? {} : { updater: new TauriUpdaterBackend() }),
    // ⚠️ 不要退回 window.open:Tauri WebView 会拦掉(「打开原文」无反应)。
    openExternal: async (url) => {
      await openUrl(url)
    },
  })
}
