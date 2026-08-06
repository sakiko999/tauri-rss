/**
 * runtime — 全局 appHost 门面(闭包持注入值,getter 校验)。
 *
 * `globalThis.appHost` 是只读门面,字段访问时校验:
 *   - http / js / storage: 未注入抛清晰错误
 *   - log / now: 未注入用兜底(console / Date.now)
 *
 * 注入(injectNodeHost / injectTauriHost / injectBrowserHost)只设闭包变量,
 * 不替换门面本身。crawler/core 直接访问 `globalThis.appHost.http` 等,无需
 * 各自的 getter 包装。
 */

let _http: HttpBackend | undefined
let _js: JsBackend | undefined
let _storage: StorageBackend | undefined
let _log: Logger | undefined
let _now: (() => number) | undefined

const consoleLogger: Logger = {
  log(level, msg, ctx) {
    const fn =
      level === "error" ? console.error
      : level === "warn" ? console.warn
      : level === "debug" ? console.debug
      : console.info
    if (ctx !== undefined) fn(msg, ctx)
    else fn(msg)
  },
}

/** 初始化全局门面(模块加载时一次)。之后注入只改闭包。 */
export function initAppHost(): void {
  if (globalThis.appHost) return
  globalThis.appHost = {
    get http(): HttpBackend {
      if (!_http) throw new Error("appHost.http not set — 请在应用启动时注入宿主,或 example 用 injectNodeHost/injectBrowserHost")
      return _http
    },
    get js(): JsBackend {
      if (!_js) throw new Error("appHost.js not set — 请在应用启动时注入宿主,或 example 用 injectNodeHost/injectBrowserHost")
      return _js
    },
    get storage(): StorageBackend {
      if (!_storage) throw new Error("appHost.storage not set — 请在应用启动时注入宿主,或 example 用 injectNodeHost/injectBrowserHost")
      return _storage
    },
    get log(): Logger {
      return _log ?? consoleLogger
    },
    get now(): () => number {
      return _now ?? Date.now
    },
  }
}

/** 注入实现值(由各环境 inject 函数调用)。 */
export function setHostCaps(caps: {
  http: HttpBackend
  js: JsBackend
  storage: StorageBackend
  log?: Logger
  now?: () => number
}): void {
  _http = caps.http
  _js = caps.js
  _storage = caps.storage
  _log = caps.log
  _now = caps.now
}
