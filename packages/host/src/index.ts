/**
 * @tauri-playground/host — 宿主后端实现 + 全局 appHost 门面。
 *
 * 全局 appHost 是 getter 门面(runtime.ts),字段访问时校验;各环境 inject
 * 函数只填闭包值。读取端(crawler/core)直接访问 globalThis.appHost.*。
 *
 * 环境:
 *   - node:    injectNodeHost(真实网络 + 内存存储,example/测试)
 *   - browser: injectBrowserHost(浏览器 fetch + localStorage,纯前端调试)
 *   - tauri:   injectTauriHost(桌面生产,Rust http_get + localStorage)
 */
import { initAppHost } from "./runtime.ts"
export { initAppHost, setHostCaps } from "./runtime.ts"
export { mediaReferrerFor } from "./media-referrer.ts"

// 副作用:import 本包即初始化全局 appHost 门面。之后 inject 只填闭包值。
// 应用 / example 都经本包的 inject 函数注入,因此门面在 crawler/core 访问前已就位。
initAppHost()

export { injectNodeHost } from "./node/inject-node.ts"
export { nodeBackend } from "./node/node-backend.ts"
export { nodeJsBackend } from "./node/node-js.ts"
export { memStorage } from "./node/mem-storage.ts"

export { injectBrowserHost } from "./browser/inject-browser.ts"

export { injectTauriHost } from "./tauri/inject-tauri.ts"
export { TauriHttpBackend } from "./tauri/tauri-http-backend.ts"
export { LocalStorageBackend } from "./tauri/local-storage-backend.ts"
export { FunctionJsBackend } from "./tauri/function-js-backend.ts"
