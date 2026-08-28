/**
 * injectTauriHost — 注入 Tauri 桌面宿主能力。
 *   - http:    TauriHttpBackend(Rust reqwest,CORS-free)
 *   - storage: SqliteStorageBackend(tauri-plugin-sql;首次访问自动从 localStorage 搬迁)
 *   - js:      FunctionJsBackend(跑 douyu/douyin 签名 blob;csp:null 允许 new Function)
 *   - ws:      TauriWsBackend(Rust ws_connect 隧道,握手可带 header,弹幕)
 *   - log:     console
 *   - now:     Date.now
 */
import { initAppHost, setHostCaps } from "../runtime.ts"
import { TauriHttpBackend } from "./tauri-http-backend.ts"
import { TauriWsBackend } from "./tauri-ws-backend.ts"
import { SqliteStorageBackend } from "./sqlite-storage-backend.ts"
import { FunctionJsBackend } from "./function-js-backend.ts"
import { TauriBrowserBackend } from "./browser-backend.ts"

export function injectTauriHost(): void {
  initAppHost()
  setHostCaps({
    http: new TauriHttpBackend(),
    storage: new SqliteStorageBackend(),
    js: new FunctionJsBackend(),
    ws: new TauriWsBackend(),
    browser: new TauriBrowserBackend(),
  })
}
