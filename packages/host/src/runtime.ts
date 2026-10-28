/**
 * runtime — 全局 appHost 门面(闭包持注入值,getter 校验)。
 *
 * `globalThis.appHost` 是只读门面,字段访问时校验:
 *   - http / js / storage: 未注入抛清晰错误
 *   - now: 未注入用 Date.now 兜底
 * 日志不走门面:所有包统一用 `@amoeba/log`(服务进程用 setLogSink 接管 stderr)。
 *
 * 注入(injectNodeHost / injectTauriHost / injectBrowserHost)只设闭包变量,
 * 不替换门面本身。crawler/core 直接访问 `globalThis.appHost.http` 等,无需
 * 各自的 getter 包装。
 */

import { browserGate, configureNetwork, governedHttp, governorStats, reportRisk } from "./net/governor.ts"

let _http: HttpBackend | undefined
let _js: JsBackend | undefined
let _storage: StorageBackend | undefined
let _now: (() => number) | undefined
let _ws: WsBackend | undefined
let _browser: BrowserBackend | undefined
/** 打开外部链接(系统浏览器)。Tauri 注入 opener 插件;其余环境兜底 window.open。 */
let _openExternal: ((url: string) => Promise<void>) | undefined
/** 自动更新(仅 Tauri 桌面注入;缺失 = 当前环境不支持)。 */
let _updater: UpdaterBackend | undefined

/**
 * `openExternal` 允许的协议 —— **安全边界,不是配置项**。
 *
 * 只放行 web 链接与邮件;其余(`file:` / `javascript:` / `data:` / 各系统自定义
 * scheme)一律拒绝。见门面里 openExternal 的注释。
 */
const OPENABLE_SCHEMES = new Set(["http", "https", "mailto"])

/** 网络治理门面(风控等级/冷却/统计)—— 与 http 是否注入无关,始终可用。 */
const netBackend: NetBackend = {
  configure: configureNetwork,
  reportRisk,
  browserGate,
  governorStats,
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
    get now(): () => number {
      return _now ?? Date.now
    },
    // ws 是可选能力:未注入返回 undefined,crawler createWsStream 据此兜底原生 WS
    // (http/js/storage 必须注入所以抛错,ws 浏览器端天然不支持自定义 header)。
    get ws(): WsBackend | undefined {
      return _ws
    },
    // browser 同 ws:可选(Tauri spawn 真实 Edge + CDP),未注入返回 undefined →
    // weibo/xhs user channel 降级现有路径(explore SSR 保留)。
    get browser(): BrowserBackend | undefined {
      return _browser
    },
    // updater 同 ws/browser:可选(仅 Tauri 桌面)。浏览器/CLI/移动端不注入,
    // 设置页据此隐藏「检查更新」并降级为只读版本号。
    get updater(): UpdaterBackend | undefined {
      return _updater
    },
    // 网络治理:等级配置 / 风控信号上报 / 自检统计。governor 是 host 内建能力,
    // 不依赖某个后端注入,因此恒可用。
    get net(): NetBackend {
      return netBackend
    },
    /**
     * 打开外部链接(系统默认浏览器)。
     *
     * ⚠️ 桌面端**不能直接 `window.open`**:Tauri 的 WebView 会拦掉,表现为「点了
     * 打开原文没反应」。Tauri 注入 opener 插件(经 capability 授权);纯浏览器/CLI
     * 环境兜底 window.open(带 noopener)。
     *
     * ⚠️ **协议白名单(安全边界)** —— URL 常来自**远端内容**(feed 正文里的 `<a href>`、
     * 社交详情),不能原样丢给系统 opener:`file://` 能打开本地文件、自定义 scheme 能
     * 触发本机已注册的任意程序。白名单收在门面这**一处**,三个后端(Tauri/node/browser)
     * 与全部调用方自动受益。—— 判据 fail-closed:不在名单里一律拒绝。
     */
    async openExternal(url: string): Promise<void> {
      const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
      if (!scheme || !OPENABLE_SCHEMES.has(scheme)) {
        throw new Error(`已拦截:只允许打开 http/https/mailto 链接(收到 ${scheme ?? "无协议"})`)
      }
      await (_openExternal ?? (async (u: string) => void window.open(u, "_blank", "noopener")))(url)
    },
  }
}

/** 注入实现值(由各环境 inject 函数调用)。 */
export function setHostCaps(caps: {
  // 注入前先确保门面存在:调用方可能只 import 了 `@amoeba/host/runtime`
  // (没有根入口的历史副作用),或像 CLI 一样自行组装后端。

  http: HttpBackend
  js: JsBackend
  storage: StorageBackend
  now?: () => number
  ws?: WsBackend
  browser?: BrowserBackend
  openExternal?: (url: string) => Promise<void>
  updater?: UpdaterBackend
}): void {
  initAppHost()
  // 所有出站 HTTP 统一过 governor(分类/去重/配额/冷却),见 net/governor.ts。
  _http = governedHttp(caps.http)
  _js = caps.js
  _storage = caps.storage
  _now = caps.now
  _ws = caps.ws
  _browser = caps.browser
  _openExternal = caps.openExternal
  _updater = caps.updater
}
