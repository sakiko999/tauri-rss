/**
 * DashHostLoader — 走全局 appHost.http 的 dash.js 自定义 HTTPLoader。
 *
 * 解决 B 站 DASH 分片(mcdn.bilivideo.cn)的 CORS:分片响应不带
 * `Access-Control-Allow-Origin`,dash.js 默认 XHR 在浏览器/Tauri webview 被拦。
 * 走 appHost.http(Tauri 是 Rust reqwest 隧道,无 CORS;纯前端是 browser fetch,
 * 仍受 CORS,但至少统一走宿主)。
 *
 * 用法:player.extend("HTTPLoader", DashHostLoader, true) 在 attachSource 前调用。
 *
 * ⚠️ dash.js 的 extend 用 `Object.create` 实例化 loader——它期望**工厂函数**
 * (function HTTPLoader(cfg){...; return instance}),不是 class。所以这里导出的
 * DashHostLoader 是工厂函数,返回 { load, abort, reset, resetInitialSettings }。
 */
import { type URLLoader } from "dashjs"

interface DashLoadConfig {
  request?: {
    url?: string
    range?: string
    method?: string
  }
  success?: (data: ArrayBuffer | string, statusText: string, url: string) => void
  error?: (err: unknown) => void
  complete?: (req: unknown, statusText: string) => void
  abort?: (req: unknown) => void
  progress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void
}

interface DashLoaderInstance {
  load(config: DashLoadConfig): void
  abort(): void
  reset(): void
  resetInitialSettings(): void
}

/** dash.js 自定义 HTTPLoader 工厂(dash.js 用 Object.create 调用,须返回实例对象)。 */
export function DashHostLoader(_cfg?: object): DashLoaderInstance {
  let aborted = false
  let pending: { cancel: () => void } | null = null

  function load(config: DashLoadConfig): void {
    const req = config.request ?? {}
    const url = req.url ?? ""
    // 每次 load 重置 abort 态——dash.js seek/切档会 abort 旧请求,但同实例继续用。
    // 若不清除,后续新请求会被误判为 aborted 而无限加载。
    aborted = false
    if (!url) {
      config.error?.(new Error("DashHostLoader: no url"))
      return
    }
    // blob/data URL(MPD)无 CORS,浏览器原样 fetch;http(s) 分片走 appHost.http 隧道。
    if (/^blob:/i.test(url) || /^data:/i.test(url)) {
      const ctrl = new AbortController()
      pending = { cancel: () => ctrl.abort() }
      fetch(url, { signal: ctrl.signal })
        .then((res) => {
          if (aborted) return
          if (!res.ok) {
            config.error?.(new Error(`HTTP ${res.status}`))
            return
          }
          // blob 是 MPD(XML)——dash.js 解析器期望字符串,不是 ArrayBuffer。
          return res.text().then((text) => {
            config.success?.(text, res.statusText, url)
            config.complete?.(req, res.statusText)
          })
        })
        .catch((e: unknown) => {
          if (aborted) return
          config.error?.(e instanceof Error ? e : new Error(String(e)))
        })
      return
    }
    // http(s) 分片:Range 透传,走 appHost.http 隧道(无 CORS)。
    // dash.js 的 request.range 是裸 `start-end`(无 bytes= 前缀),HTTP 标准要求
    // `Range: bytes=0-914`,不补前缀 CDN 会当无 Range 返回完整文件(200)导致解析错位。
    const isBinary = !/\.mpd(\?|#|$)/i.test(url)
    const headers: Record<string, string> = {}
    if (req.range) headers["range"] = req.range.startsWith("bytes=") ? req.range : `bytes=${req.range}`
    globalThis.appHost.http
      .request({
        url,
        method: req.method ?? "GET",
        responseType: isBinary ? "arraybuffer" : "text",
        headers,
      })
      .then((res) => {
        if (aborted) return
        if (res.status < 200 || res.status >= 300) {
          config.error?.(new Error(`HTTP ${res.status}`))
          return
        }
        if (isBinary) {
          const bytes = res.body as Uint8Array
          const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
          config.success?.(buf, String(res.status), url)
          config.complete?.(req, String(res.status))
        } else {
          const text = typeof res.body === "string" ? res.body : String(res.body)
          config.success?.(new TextEncoder().encode(text).buffer as ArrayBuffer, String(res.status), url)
          config.complete?.(req, String(res.status))
        }
      })
      .catch((e: unknown) => {
        if (aborted) return
        config.error?.(e instanceof Error ? e : new Error(String(e)))
      })
  }

  function abort(): void {
    aborted = true
    pending?.cancel()
  }

  function reset(): void {
    aborted = true
    pending?.cancel()
  }

  function resetInitialSettings(): void {
    aborted = false
  }

  return { load, abort, reset, resetInitialSettings }
}

/** 供类型标注引用(URLLoader 契约)。 */
export type { URLLoader }
