/**
 * 根级全局声明 —— 宿主能力注入契约。
 *
 * 各包(数据层 / 抓取层 / 未来 Tauri 扩展的工具)需要的宿主能力,通过全局
 * 对象 `globalThis.appHost` 注入:
 *   - 正常流程:由 Tauri 应用启动时注入(desktop/mobile 前端入口赋值)。
 *   - example/测试:自行构造同形状对象赋值。
 *
 * 这是一个**开放容器**,未来 Tauri 侧可扩展注入其他工具(http/js 之外的
 * 存储、日志、时钟等),只需在下面追加字段。
 *
 * 类型如何被各子项目看到:本文件被 `tsconfig.app.json` 的 `files` 引用,所有
 * `extends ../../tsconfig.app.json` 的包(crawler/core/desktop/ui)自动获得
 * 这些全局声明(TS 规定父配置里的相对路径按源出地解析)。
 */
export {}
declare global {
  /** 宿主注入的工具集。 */
  interface AppHost {
    http: HttpBackend
    js: JsBackend
    /** 持久化 KV。core 的 repo 用它存 subscriptions/reading/settings。 */
    storage: StorageBackend
    /** 日志;缺失时 core 用 console 兜底。 */
    log?: Logger
    /** 时钟(epoch ms);缺失时 core 用 Date.now 兜底。 */
    now?: () => number
  }

  /** 键值持久化(订阅配置 / 阅读状态 / 设置)。 */
  interface StorageBackend {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
    /** 全部 key,可选前缀过滤(命名空间)。 */
    keys(prefix?: string): Promise<string[]>
  }

  /** 日志输出。缺失时消费方用 console 兜底。 */
  interface Logger {
    log(level: "debug" | "info" | "warn" | "error", msg: string, ctx?: Record<string, unknown>): void
  }

  /** 一个 HTTP 请求。 */
  interface HttpRequest {
    url: string
    method?: string
    headers?: Record<string, string>
    /** 请求体(如 douyu 的 form 编码 POST)。string 原样发送;对象走 JSON.stringify。 */
    body?: string
    /** "text" | "json" | "arraybuffer"(arraybuffer 走 base64,与 producer 一致) */
    responseType?: "text" | "json" | "arraybuffer"
    timeoutMs?: number
  }

  /** HTTP 响应(text/json → 字符串/json 对象;arraybuffer → Uint8Array)。 */
  interface HttpResponse {
    status: number
    headers: Record<string, string>
    body: unknown
  }

  /** CORS-free HTTP,由宿主提供(Tauri http_get 隧道 / Node fetch / 浏览器 fetch)。 */
  interface HttpBackend {
    request(req: HttpRequest): Promise<HttpResponse>
  }

  /**
   * JS 执行后端。部分直播平台(douyu/douyin)用混淆 JS blob 签名请求
   * (CryptoJS / ABogus),通过它原样执行这些 blob:
   *   - desktop: new Function / node:vm
   *   - mobile:  Capacitor JS plugin
   *   - dev/web: new Function(CSP 允许时)
   */
  interface JsBackend {
    /** 执行 `code`(定义若干函数),并调用其中 `fn`,args 透传。 */
    call(code: string, fn: string, args: (string | number)[]): unknown
  }

  /**
   * 全局宿主门面(由 @tauri-playground/host 初始化)。字段是 getter:
   * http/js/storage 未注入时访问抛清晰错误;log/now 缺失用兜底。
   * 应用/example 启动时调 injectXxxHost() 填实现,之后依赖它的包直接
   * `globalThis.appHost.http` 等。
   */
  var appHost: AppHost
}
