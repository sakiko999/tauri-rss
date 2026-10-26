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
  /**
   * 浏览器窗口模式：
   *   - `hidden`：SW_HIDE，不渲染（SSR/DOM 读取够用，CPU≈0）；
   *   - `interactive`：屏外 shown + 遮挡 flag，渲染/IntersectionObserver/懒加载/
   *     scroll 事件与可见窗口一致（滚动驱动页面需要）。
   */
  type BrowserWindowMode = "hidden" | "interactive"

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
    /** WebSocket 隧道(桌面 Rust ws_connect / node ws 包)。缺失时 crawler 兜底用原生 WS(无自定义 header)。 */
    ws?: WsBackend
    /** 浏览器模拟(CDP 附加真实 Edge/Chrome;Tauri 桌面注入)。缺失时 weibo/xhs user 降级现有路径。 */
    browser?: BrowserBackend
    /**
     * 打开外部链接(系统默认浏览器)。桌面走 Tauri opener 插件(WebView 会拦
     * `window.open`);纯浏览器环境兜底 `window.open`。
     */
    openExternal(url: string): Promise<void>
    /**
     * 防盗链图片是否经宿主隧道转发(镜像 settings.imageProxy;ui 的 MediaImage 直读)。
     * 由 app 层在设置变化时写入。undefined = 默认开启。
     */
    imageProxy?: boolean
    /** 省流模式:不加载任何图片(镜像 settings.dataSaver;ui 的 MediaImage 直读)。 */
    dataSaver?: boolean
    /**
     * 桌面 WebView2 已在原生网络层注入防盗链 Referer(见 apps/src-tauri/src/media_referer.rs)。
     * true 时 MediaImage / 实况视频直接使用原 URL，不再走 blob 隧道；失败仍回退隧道。
     */
    nativeMediaReferer?: boolean
    /** 自动更新(仅 Tauri 桌面注入;浏览器/CLI/移动端为 undefined)。 */
    updater?: UpdaterBackend
    /** 网络治理(等级/冷却/统计)。host 内建,始终存在。 */
    net?: NetBackend
  }

  /** 单个平台的配额(与 host 的 NetPolicy 同形,见 docs/crawler-risk-control.md §2.5)。 */
  interface PlatformQuotaConfig {
    maxConcurrent: number
    rpm: number
    minIntervalMs: number
    cooldownBaseMs: number
  }

  /**
   * 网络治理能力(NetworkGovernor 门面):
   *   - configure: 切换等级(L0 / L1 / L2 / L3)与配额,局部字段合并;
   *   - reportRisk: 显式上报平台风控信号,按信号写平台冷却;
   *   - browserGate: 浏览器(CDP)操作的准入(冷却 + 最小间隔 + 抖动);
   *   - governorStats: 自检/诊断(活跃冷却剩余毫秒 / 在途 / 排队)。
   */
  interface NetBackend {
    configure(input: {
      /** 全局默认等级(0 直通 / 1 入门 / 2 标准 / 3 严格)。 */
      level?: 0 | 1 | 2 | 3
      /**
       * 平台级等级覆盖(整表替换)。`"*"` 是未知 host / RSS 的兜底覆盖;
       * 优先顺序:精确平台 → `"*"` → `level`。
       * ⚠️ 没有「浏览器被动」档:被动采集是渠道属性,不是等级。
       */
      levels?: Record<string, 0 | 1 | 2 | 3>
      globalMaxConcurrent?: number
      platforms?: Record<string, PlatformQuotaConfig>
    }): void
    reportRisk(platform: string, signal: string): void
    /**
     * 浏览器操作准入:平台冷却未到期时抛错,否则按最小间隔 + 随机抖动放行。
     * CDP 流量不经过 `governedHttp`,xhs/weibo 的主路径必须显式过这道闸。
     * ⚠️ 登录流程不应调用(冷却期仍需允许用户重新扫码)。
     */
    browserGate(platform: string): Promise<void>
    governorStats(): {
      cooldowns: Record<string, number>
      inFlight: number
      queued: number
      /** 最近一次 HTTP 端到端耗时(ms)与所属平台;播放器统计面板用。 */
      lastLatency: { ms: number; platform: string } | null
      /** 进程内累计出站请求数与响应体大小(≈ 字节);播放器统计面板用。 */
      network: { requests: number; bytes: number }
    }
  }

  /** 一条可安装的更新。 */
  interface UpdateInfo {
    version: string
    currentVersion: string
    body?: string
    date?: string
  }

  /** 更新包下载进度。`downloaded` 是累计字节数。 */
  type UpdateEvent =
    | { event: "started"; contentLength?: number }
    | { event: "progress"; downloaded: number; contentLength?: number }
    | { event: "finished" }

  /**
   * 自动更新能力。签名校验与安装包执行都在 Rust 侧(tauri-plugin-updater),
   * 前端只负责查询/展示/触发;安装包必须是签名过的 NSIS setup.exe。
   */
  interface UpdaterBackend {
    /** 当前应用版本(不联网)。 */
    version(): Promise<string>
    /** 查询最新版;已是最新返回 null。 */
    check(): Promise<UpdateInfo | null>
    /** 下载并安装最近一次 check() 的结果(Windows 会拉起 NSIS 安装器)。 */
    downloadAndInstall(onEvent: (e: UpdateEvent) => void): Promise<void>
    /** 安装完成后重启应用。 */
    relaunch(): Promise<void>
  }

  /** 一条 WS 长连接(桌面/node 由宿主管理;crawler createWsStream 消费)。 */
  interface WsConnection {
    readonly connectionId: string
    /** 对齐 WebSocket.readyState 常量:0 CONNECTING / 1 OPEN / 3 CLOSED。 */
    readonly readyState: number
    /** 发送二进制帧(弹幕心跳/认证)。 */
    send(data: Uint8Array): void
    /** 关闭连接(前端退订)。 */
    close(): void
  }

  /** WS 连接选项(crawler createWsStream 传入)。 */
  interface WsConnectOptions {
    url: string
    /** 自定义握手 header(douyin 需 UA/Cookie/Origin)。 */
    headers?: Record<string, string>
    timeoutMs?: number
    onOpen?: (conn: WsConnection) => void
    onMessage: (data: Uint8Array, conn: WsConnection) => void
    onClose?: (code: number, reason: string) => void
  }

  /** WebSocket 能力(带自定义 header 的握手,浏览器原生 WS 做不到)。 */
  interface WsBackend {
    connect(opts: WsConnectOptions): Promise<WsConnection>
  }

  /**
   * 浏览器 lane(多 tab)句柄 —— 风控 §3.13 lane 化。
   * 每个 lane 一条独立 CDP 连接(独立 target/pending/事件帧),互不串台;
   * evaluate/send/onEvent/getCookies 形状对齐 BrowserBackend,cdp 层助手
   * (cdpFetch/cdpEvaluate/cdpNavigate/capturePage)可直接吃 tab 句柄。
   * cookie 是浏览器级共享的(登录完其它 lane 直接受益)。
   */
  interface BrowserTab {
    readonly key: string
    evaluate<T = unknown>(
      expression: string,
      opts?: { awaitPromise?: boolean; returnByValue?: boolean },
    ): Promise<T>
    /** 读 cookie(浏览器级;任何 tab 连接都能读)。 */
    getCookies(url?: string): Promise<Record<string, string>>
    /** 原始 CDP 命令(被动采集 capturePage 用;绑定本 tab 的连接)。 */
    send?(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>
    /** 订阅 CDP 事件帧(仅本 tab;多 lane 下不会收到别平台的事件)。 */
    onEvent?(cb: (method: string, params: unknown, sessionId?: string) => void): () => void
    /**
     * 把该 tab 切为当前激活 tab(毫秒级、**不触发重载**)。滚动驱动前必须:
     * 非激活 tab 的 visibilityState=hidden 下 rAF/IntersectionObserver 停摆(§3.9)。
     */
    activate?(): Promise<void>
    /** 关闭该 tab(target 级;不影响浏览器进程与其它 lane)。 */
    close(): Promise<void>
    /** 中止本 tab 在途调用并断开连接(刷新超时用;不波及其它 lane)。 */
    abortPending?(reason: string): void
  }

  /**
   * 浏览器模拟能力(Tauri WebView2 隐藏窗口 + CDP)。微博/小红书反爬强,
   * 需真实浏览器提供登录态 + JS 签名 + 设备指纹:
   *   - evaluate: 页面上下文执行 JS(如 window._webmsxyw 取 x-s、页面内 fetch 数据),
   *     returnByValue 返回序列化结果 —— CDP 语义(cdp.ts)收敛在 crawler 侧。
   *   - close: 关闭浏览器进程(应用退出时)。
   */
  interface BrowserBackend {
    evaluate<T = unknown>(
      expression: string,
      opts?: { awaitPromise?: boolean; returnByValue?: boolean },
    ): Promise<T>
    /** 读指定域 cookie(name → value,含 HttpOnly)。传 url 只取该域(Network.getCookies urls),
     *  不传取全部(getAllCookies)。
     *  ⚠️ document.cookie 读不到 HttpOnly(如 xhs web_session),登录态检测/取 cookie 必须走这里。 */
    getCookies(url?: string): Promise<Record<string, string>>
    /**
     * 清除匹配域名后缀的 cookie(含 HttpOnly),返回删除数量。
     * 「清除凭证」用它真正退出浏览器账号;没有该方法的宿主跳过。
     */
    clearCookies?(domainSuffix: string): Promise<number>
    /**
     * 切换窗口模式（可选：非 Tauri 后端没有可切换的窗口）。
     * 幂等；未启动时会按该模式拉起。见 `BrowserWindowMode`。
     */
    setMode?(mode: BrowserWindowMode): Promise<void>
    /**
     * 发送原始 CDP 命令（LX 被动采集用；默认 page target）。
     * 可选：非 Tauri 后端不提供。调用方负责先确保连接。
     */
    send?(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>
    /**
     * 订阅 CDP 事件（无 id 的事件帧）；返回取消订阅函数。
     * 可选：非 Tauri 后端不提供。
     */
    onEvent?(cb: (method: string, params: unknown, sessionId?: string) => void): () => void
    /** 关闭浏览器进程(应用退出)。 */
    close(): Promise<void>
    /**
     * 清空浏览器 profile(登录态/缓存)。实现里会先关抓取 webview 再删目录,
     * 下次 webview_browser_open 自建全新实例。可选:非 Tauri 后端不提供。
     * ⚠️ 会掉微博/小红书等靠抓取浏览器 profile 的登录态。
     */
    resetProfile?(): Promise<string>
    /**
     * 中止在途调用并断开连接。上层整轮刷新超时时调用,让被挂住的 await 立刻返回
     * 错误而不是继续持锁(见 packages/host/src/browser/channel.ts 的 abortPending 注释)。
     * 可选:非 Tauri 后端不提供(它们底层走 fetch,自带超时)。
     */
    abortPending?(reason: string): void
    /**
     * 取一个 lane 的 tab 句柄(lane 化 §3.13)。同 key 复用同一 target,异 key 各自
     * 独立连接(独立 pending/事件帧,互不串台)。可选:非 Tauri 后端不提供 ——
     * 调用方回落单 page 语义(所有 lane 共享默认页)。
     */
    tab?(key: string): BrowserTab
    /**
     * 中止所有 lane tab 的在途调用并断开其连接(整轮刷新超时兜底)。
     * keepLogin=true 时跳过 login:* lane —— 登录在等用户扫码,掐了连接会表现成
     * 「手机已确认但登录超时」。默认后端(default page)不在其列(abortPending 管)。
     */
    abortTabs?(reason: string, opts?: { keepLogin?: boolean }): void
  }

  /**
   * SQL 型存储后端的建表契约。**DDL 唯一权威在 core `db/schema.ts`**，
   * 由 core 在 createDataLayer 时注入；host 只执行，不 import core。
   */
  interface StorageMigration {
    version: number
    name: string
    sql: string
    checksum: string
  }

  interface StorageSchema {
    table: string
    ddl: string
    /** 幂等 SQL,按序全量执行(旧后端兼容路径)。 */
    migrations: ReadonlyArray<string>
    /** 版本化迁移：先建版本表；已应用版本 checksum 不一致则拒绝启动。 */
    versioned?: {
      table: string
      ddl: string
      migrations: ReadonlyArray<StorageMigration>
    }
  }

  /** 键值持久化(订阅配置 / 阅读状态 / 设置)。 */
  interface StorageBackend {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
    /** 全部 key,可选前缀过滤(命名空间)。 */
    keys(prefix?: string): Promise<string[]>
    /**
     * SQL 型后端注入 schema（KV/localStorage/内存后端不需要实现）。
     * core 在 `createDataLayer()` 首次读写前调用；实现方应在此之前完成建表。
     */
    setSchema?(schema: StorageSchema): void
    /** 关闭底层句柄（long-lived 服务进程退出前调用；其它后端可不实现）。 */
    close?(): void
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
    /**
     * 网络治理覆盖(可选):
     *   - platform: 显式指定平台桶(默认由 URL host 推导);
     *   - metered: false 跳过 RPM/冷却(媒体/图片),true 强制计量;
     *   - dedupeKey: 并发相同请求合并的键(默认 method+url+body)。
     */
    policy?: { platform?: string; metered?: boolean; dedupeKey?: string }
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
   * 全局宿主门面(由 @amoeba/host 初始化)。字段是 getter:
   * http/js/storage 未注入时访问抛清晰错误;log/now 缺失用兜底。
   * 应用/example 启动时调 injectXxxHost() 填实现,之后依赖它的包直接
   * `globalThis.appHost.http` 等。
   */
  var appHost: AppHost
}
