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

    // 请求经 invoke → Rust reqwest 隧道发出,WebView 的 devtools Network 面板
    // 只能看到 http_get 这个 IPC 调用、看不到真实 URL。这里打日志补上:
    //   发起 → console.debug(devtools Console 需勾选 Verbose 才显示)
    //   完成 → console.info(非 2xx 用 console.warn,显眼标出失败)
    // devtools 里点开即可看到每次请求的完整路径 + 状态 + 耗时。
    const started = performance.now()
    console.debug(`[host:http] → ${method} ${req.url}`)

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

    const elapsed = Math.round(performance.now() - started)
    const line = `[host:http] ${method} ${req.url} → ${res.status} (${elapsed}ms)`
    if (res.status >= 400) console.warn(line)
    else console.info(line)

    let body: string | Uint8Array
    if (responseType === "arraybuffer") {
      body = base64ToBytes(res.body)
    } else {
      // 契约:responseType="json" 时 body 应是已解析对象(与 node/browser 后端一致)。
      body = res.body
    }

    return {
      status: res.status,
      headers: res.headers,
      // 契约:responseType="json" 时 body 应是已解析对象;解析失败(空/非 JSON)保留原串。
      body:
        responseType === "json" && typeof body === "string" && body.trim() !== ""
          ? ((JSON.parse(body) as unknown) ?? body)
          : body,
    }
  }
}
