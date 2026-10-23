/**
 * @amoeba/host — 宿主后端实现 + 全局 appHost 门面。
 *
 * 全局 appHost 是 getter 门面(runtime.ts),字段访问时校验;各环境 inject
 * 函数只填闭包值。读取端(crawler/core)直接访问 globalThis.appHost.*。
 *
 * 环境:
 *   - node:    injectNodeHost(真实网络 + 内存存储,example/测试)
 *   - browser: injectBrowserHost(浏览器 fetch + localStorage,纯前端调试)
 *   - tauri:   injectTauriHost(桌面生产,Rust http_get + SqliteStorageBackend)
 */
export { initAppHost, setHostCaps } from "./runtime.ts"
export {
  configureNetwork,
  reportRisk,
  browserGate,
  governorStats,
  levelFor,
  DEFAULT_NET_POLICY,
} from "./net/governor.ts"

// ⚠️ 本包**不再在 import 时初始化门面**(2026-10-23):`setHostCaps` / `inject*Host`
// 自己调 `initAppHost()`。这样只取工具函数(governor/后端单件)的模块不会隐式建全局门面。
// 新代码优先用子路径(`@amoeba/host/node|tauri|browser|runtime|governor`),避免把三套
// 后端全部拉进模块图;根入口保留为兼容聚合。

export { injectNodeHost } from "./node/inject-node.ts"
export { nodeBackend } from "./node/node-backend.ts"
export { nodeWsBackend } from "./node/node-ws.ts"
export { nodeJsBackend } from "./node/node-js.ts"
export { memStorage } from "./node/mem-storage.ts"

export { injectBrowserHost } from "./browser/inject-browser.ts"

export { injectTauriHost } from "./tauri/inject-tauri.ts"
export { TauriHttpBackend } from "./tauri/tauri-http-backend.ts"
export { SqliteStorageBackend } from "./tauri/sqlite-storage-backend.ts"
export { TauriWsBackend } from "./tauri/tauri-ws-backend.ts"
export { LocalStorageBackend } from "./tauri/local-storage-backend.ts"
export { FunctionJsBackend } from "./tauri/function-js-backend.ts"
export { TauriUpdaterBackend } from "./tauri/updater-backend.ts"
