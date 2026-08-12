/**
 * HlsHostLoader — 走全局 appHost.http 的 hls.js 自定义 loader。
 *
 * 解决 YouTube HLS 的 CORS 问题:`googlevideo.com` 的 manifest/segment 不带
 * `Access-Control-Allow-Origin`,hls.js 默认 XHR 在浏览器(含 Tauri webview)
 * 被拦。走 appHost.http(Tauri 是 Rust reqwest 隧道,无 CORS;纯前端是
 * browser fetch,仍受 CORS,但至少统一走宿主)。
 *
 * 用法:hls.config.loader = HlsHostLoader
 */
import Hls from "hls.js"
import { LoadStats, type Loader, type LoaderCallbacks, type LoaderConfiguration, type LoaderContext, type LoaderStats } from "hls.js"
import { toArrayBuffer } from "../utils/buffer.ts"

/** hls.js 的 Loader 类型作为类实现(`new (config: HlsConfig) => Loader<LoaderContext>`)。 */
export class HlsHostLoader implements Loader<LoaderContext> {
  context: LoaderContext | null = null
  stats: LoaderStats = new LoadStats()
  private aborted = false

  constructor(_config: Hls["config"] extends object ? Hls["config"] : never) {}

  load(context: LoaderContext, _config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
    this.context = context
    this.stats = new LoadStats()
    // hls.js ABR 依赖这三个时间戳采样带宽(tload - tfirst)。不设(=0)会让
    // BandwidthEstimator 拒绝采样 → 估算锁死在 abrEwmaDefaultEstimate(500kbps),
    // ABR 降到低清档永不回升。start/first 在请求发起时打点,end 在完成时打点。
    const t0 = performance.now()
    this.stats.loading.start = t0
    this.stats.loading.first = t0
    const { url, responseType, headers, rangeStart, rangeEnd } = context
    const isBinary = responseType === "arraybuffer"

    const reqHeaders: Record<string, string> = {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      referer: "https://www.youtube.com/",
      ...headers,
    }
    if (rangeStart !== undefined && rangeEnd !== undefined) {
      reqHeaders["range"] = `bytes=${rangeStart}-${rangeEnd}`
    }

    globalThis.appHost.http
      .request({
        url,
        method: "GET",
        responseType: isBinary ? "arraybuffer" : "text",
        headers: reqHeaders,
      })
      .then((res) => {
        if (this.aborted) return
        if (res.status < 200 || res.status >= 300) {
          console.warn("[HlsHostLoader] HTTP", res.status, "for", url.slice(0, 80))
          callbacks.onError({ code: res.status, text: `HTTP ${res.status}` }, context, null, this.stats)
          return
        }
        this.stats.loading.end = performance.now()
        if (isBinary) {
          // appHost.http arraybuffer 返回 Uint8Array → hls.js 要 ArrayBuffer。
          const buf = toArrayBuffer(res.body as Uint8Array)
          this.stats.loaded = buf.byteLength
          this.stats.total = buf.byteLength
          callbacks.onSuccess({ url, data: buf }, this.stats, context, null)
        } else {
          const text = typeof res.body === "string" ? res.body : String(res.body)
          this.stats.loaded = text.length
          this.stats.total = text.length
          callbacks.onSuccess({ url, data: text }, this.stats, context, null)
        }
      })
      .catch((err: unknown) => {
        if (this.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.warn("[HlsHostLoader] err:", msg)
        callbacks.onError({ code: 0, text: msg }, context, null, this.stats)
      })
  }

  abort(): void {
    this.aborted = true
  }

  destroy(): void {
    this.aborted = true
  }
}
