/**
 * ProducerHost — the capability seam the producer (fetch adapters) needs.
 *
 * This is a producer-owned copy of core's `PlatformHost` structure (duck-typed
 * compatible), so the producer package does NOT import core. Hosts that
 * implement core's `PlatformHost` (createTauriHost / createBrowserHost) are
 * structurally compatible with this interface.
 *
 * Producers use `http` (CORS-free fetch), `js` (Douyu/Douyin sign blobs) and
 * `now` (timestamps + wbi wts). `storage` and `log` are needed by the
 * maintainer/consumer layers, but kept here so the interface is one shape.
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

/** Key-value persistence (subscriptions + item cache live behind this). */
export interface StorageBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

export type LogLevel = "debug" | "info" | "warn" | "error"

/** JS execution for live-platform sign blobs (Douyu CryptoJS / Douyin ABogus). */
export interface JsBackend {
  eval(code: string): unknown
  call(code: string, fn: string, args: (string | number)[]): unknown
}

export interface Logger {
  log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void
}

/** The bundle of host capabilities the producer needs. */
export interface ProducerHost {
  http: HttpBackend
  storage: StorageBackend
  js: JsBackend
  log: Logger
  /** Injectable clock — epoch ms. Enables deterministic tests. */
  now(): number
}
