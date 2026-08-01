/**
 * Platform host capability types — the seam between the (web-standard) data
 * layer and the (runtime-specific) environment that runs it.
 *
 * Why this exists: RSS feeds and live-platform APIs send no CORS headers, so
 * `fetch()` fails inside a desktop/mobile webview. `http` therefore must be a
 * host capability: native fetch (no CORS) on desktop, `@capacitor/http` (which
 * bypasses CORS) on mobile. Storage, logging, and the clock are likewise
 * injected so the data layer imports nothing runtime-specific.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"
export type HttpResponseType = "text" | "json" | "arraybuffer"

export interface HttpRequest {
  url: string
  method?: HttpMethod
  headers?: Record<string, string>
  body?: string | Uint8Array
  timeoutMs?: number
  responseType?: HttpResponseType
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  /** Text for `text`/`json`, raw bytes for `arraybuffer`. */
  body: string | Uint8Array
}

/** CORS-free HTTP, provided by the host. */
export interface HttpBackend {
  request(req: HttpRequest): Promise<HttpResponse>
}

/** Key-value persistence for subscriptions + item cache. */
export interface StorageBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** All keys, optionally limited to a prefix (namespace). */
  keys(prefix?: string): Promise<string[]>
}

export type LogLevel = "debug" | "info" | "warn" | "error"

/**
 * JS execution backend. Needed because some live platforms (Douyu, Douyin)
 * sign requests by executing an obfuscated JS blob. Rather than reverse-
 * engineer ABogus/CryptoJS, the data layer runs the original blobs verbatim
 * through this capability. Hosts provide execution:
 *   - desktop: node:vm / Bun
 *   - mobile:  Capacitor JS plugin
 *   - dev/web: `new Function` (CSP permitting)
 */
export interface JsBackend {
  /** Evaluate `code` in a fresh scope; return its completion value. */
  eval(code: string): unknown
  /** Evaluate `code` (definitions), then call `fn(...args)`; return its result. */
  call(code: string, fn: string, args: (string | number)[]): unknown
}

/**
 * Logger sink. Mirrors dart `CoreLog.onPrintLog(Level, String)` — the app can
 * redirect data-layer logs to its own logger surface.
 */
export interface Logger {
  log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void
}

/**
 * The bundle of host capabilities the data layer needs. Implementations:
 *   - desktop: native fetch (no CORS) + node storage
 *   - mobile:  Capacitor plugins
 *   - dev/web: `BrowserHost` (CORS-limited `fetch`)
 */
export interface PlatformHost {
  http: HttpBackend
  storage: StorageBackend
  js: JsBackend
  log: Logger
  /** Injectable clock — epoch ms. Enables deterministic tests. */
  now(): number
}
