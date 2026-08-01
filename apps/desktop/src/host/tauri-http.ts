/**
 * TauriHttpBackend — a `PlatformHost.http` implementation that tunnels requests
 * through the Rust `http_get` command (reqwest), bypassing webview CORS.
 *
 * This is the production HTTP backend for desktop; the webview's own `fetch()`
 * would be CORS-blocked for RSS feeds and live-platform APIs.
 */
import { invoke } from "@tauri-apps/api/core"
import type {
  HttpBackend,
  HttpRequest,
  HttpResponse,
} from "@tauri-playground/core"

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
    const res = await invoke<TauriHttpResponse>("http_get", {
      req: {
        url: req.url,
        method,
        headers: req.headers ?? {},
        body: typeof req.body === "string" ? req.body : undefined,
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
