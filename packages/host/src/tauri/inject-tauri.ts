/**
 * injectTauriHost — 注入 Tauri 桌面宿主能力。
 *   - http:    TauriHttpBackend(Rust reqwest,CORS-free)
 *   - storage: SqliteStorageBackend(tauri-plugin-sql;schema 由 core 在 createDataLayer 时注入)
 *   - js:      FunctionJsBackend(跑 douyu/douyin 签名 blob;csp:null 允许 new Function)
 *   （注：不注入 browser —— 抓取浏览器只在服务进程，经 browser-sidecar 启动）
 *   - ws:      TauriWsBackend(Rust ws_connect 隧道,握手可带 header,弹幕)
 *   - openExternal: tauri-plugin-opener(WebView 会拦 window.open)
 *   - updater: TauriUpdaterBackend(自动更新;仅桌面,移动端不注册插件)
 *   - now:     Date.now
 */

import { openUrl } from "@tauri-apps/plugin-opener"

import { initAppHost, setHostCaps } from "../runtime.ts"
import { FunctionJsBackend } from "./function-js-backend.ts"
import { SqliteStorageBackend } from "./sqlite-storage-backend.ts"
import { TauriHttpBackend } from "./tauri-http-backend.ts"
import { TauriWsBackend } from "./tauri-ws-backend.ts"
import { TauriUpdaterBackend } from "./updater-backend.ts"

/**
 * @param opts.updater 传 `false` 不注入 updater —— 移动端 Rust 侧没有注册该插件,
 *   但 injectTauriHost 是双端共用的,必须由移动端显式关掉,否则能力探测会误判。
 * @param opts.browser @deprecated 进程内抓取浏览器（Tauri WebView2 + CDP 9334）分支已移除
 *   （2026-11-01）：抓取浏览器统一走 `apps/browser-sidecar` 的 amoeba-browser。保留参数
 *   只为兼容既有调用点（desktop/mobile 传 false），传 true 也不再注入。
 * @param opts.storage 传 `false` 注入「拒绝一切读写」的后端：数据服务模式下 desktop
 *   不再是 SQLite 写者，任何残留直连都会立刻失败（而不是静默双写）。
 */
export function injectTauriHost(
  opts: {
    updater?: boolean
    browser?: boolean
    storage?: boolean
  } = {},
): void {
  initAppHost()
  setHostCaps({
    http: new TauriHttpBackend(),
    storage:
      opts.storage === false
        ? {
            async get() {
              throw new Error("数据服务模式：桌面不得直连 SQLite（请走 DataLayer/RPC）")
            },
            async set() {
              throw new Error("数据服务模式：桌面不得直连 SQLite（请走 DataLayer/RPC）")
            },
            async delete() {
              throw new Error("数据服务模式：桌面不得直连 SQLite（请走 DataLayer/RPC）")
            },
            async keys() {
              throw new Error("数据服务模式：桌面不得直连 SQLite（请走 DataLayer/RPC）")
            },
          }
        : new SqliteStorageBackend(),
    js: new FunctionJsBackend(),
    ws: new TauriWsBackend(),
    ...(opts.updater === false ? {} : { updater: new TauriUpdaterBackend() }),
    // ⚠️ 不要退回 window.open:Tauri WebView 会拦掉(「打开原文」无反应)。
    openExternal: async (url) => {
      await openUrl(url)
    },
  })
}
