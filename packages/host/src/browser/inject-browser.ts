/**
 * injectBrowserHost — 注入纯浏览器宿主能力(调试 apps / 纯前端场景)。
 *
 *   - http:    浏览器 fetch(CORS 受限——多数 RSS/直播 API 无 CORS,仅调试可用)
 *   - storage: localStorage
 *   - js:      FunctionJsBackend(new Function,CSP 放开时)
 *   - log:     console
 *   - now:     Date.now
 */
import { initAppHost, setHostCaps } from "../runtime.ts"
import { LocalStorageBackend } from "../tauri/local-storage-backend.ts"
import { FunctionJsBackend } from "../tauri/function-js-backend.ts"

/** 浏览器 fetch 实现的 HttpBackend(CORS 受限)。 */
function browserBackend(): HttpBackend {
  return {
    async request(req) {
      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers: req.headers ?? {},
        redirect: "follow",
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      })
      if (req.responseType === "arraybuffer") {
        const buf = new Uint8Array(await res.arrayBuffer())
        return { status: res.status, headers: {}, body: buf }
      }
      const text = await res.text()
      return { status: res.status, headers: {}, body: req.responseType === "json" ? JSON.parse(text) : text }
    },
  }
}

export function injectBrowserHost(): void {
  initAppHost()
  setHostCaps({
    http: browserBackend(),
    storage: new LocalStorageBackend("browser-rss:"),
    js: new FunctionJsBackend(),
  })
}
