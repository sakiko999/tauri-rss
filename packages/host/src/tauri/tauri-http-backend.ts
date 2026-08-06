/**
 * TauriHttpBackend — HttpBackend 实现,通过 Rust `http_get` command(reqwest)
 * 隧道请求,绕过 webview CORS。桌面生产 HTTP 后端。
 *
 * 类型来自根 global.d.ts(全局 HttpBackend/HttpRequest/HttpResponse)。
 */
import { invoke } from "@tauri-apps/api/core"

interface TauriHttpResponse {
  status: number
  headers: Record<string, string>
  /** utf-8 text for text/json; base64 for arraybuffer. */
  body: string
}

/** Decode a base64 string to bytes (arraybuffer transport). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export class TauriHttpBackend implements HttpBackend {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const method = req.method ?? "GET"
    const responseType = req.responseType ?? "text"

    // The Rust command returns base64 for arraybuffer, utf-8 otherwise.
    // 全局 HttpRequest 无 body 字段;Rust command 支持,此处经 withBody 传递。
    const withBody = req as HttpRequest & { body?: unknown }
    const res = await invoke<TauriHttpResponse>("http_get", {
      req: {
        url: req.url,
        method,
        headers: req.headers ?? {},
        body: typeof withBody.body === "string" ? withBody.body : undefined,
        timeoutMs: req.timeoutMs ?? 20000,
        responseType,
      },
    })

    let body: string | Uint8Array
    if (responseType === "arraybuffer") {
      body = base64ToBytes(res.body)
    } else {
      body = res.body
    }

    return { status: res.status, headers: res.headers, body }
  }
}
