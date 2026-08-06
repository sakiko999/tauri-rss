/**
 * injectTauriHost — 注入 Tauri 桌面宿主能力。
 *   - http:    TauriHttpBackend(Rust reqwest,CORS-free)
 *   - storage: localStorage-backed(persist across launches)
 *   - js:      FunctionJsBackend(跑 douyu/douyin 签名 blob;csp:null 允许 new Function)
 *   - log:     console
 *   - now:     Date.now
 */
import { initAppHost, setHostCaps } from "../runtime.ts"
import { TauriHttpBackend } from "./tauri-http-backend.ts"
import { LocalStorageBackend } from "./local-storage-backend.ts"
import { FunctionJsBackend } from "./function-js-backend.ts"

export function injectTauriHost(): void {
  initAppHost()
  setHostCaps({
    http: new TauriHttpBackend(),
    storage: new LocalStorageBackend("tauri-rss:"),
    js: new FunctionJsBackend(),
  })
}
