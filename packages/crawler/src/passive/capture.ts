/**
 * passive/capture —— 从 CDP `Network` 域收集页面自身请求的响应体（LX 路线 A）。
 *
 * 约定：
 *   - **只观察，不构造请求**。`trigger` 只能做导航 / 滚动 / 点击这类页面自然行为；
 *     不要在 trigger 里发自定义 fetch。
 *   - 调用方必须已经持有浏览器独占权并设好窗口模式（一般用
 *     `withBrowserMode(browser, mode, () => capturePage(...))`）。
 *   - 只收文本类 MIME；二进制/媒体直接跳过（不占缓冲）。
 *   - body 写入 `passiveBuffer`（内存，TTL/限额见 buffer.ts）。
 *
 * 实测依据见 `docs/crawler-risk-control.md` §3.5：304 可取缓存体、gzip 自动解压、
 * 12MB 在 16MB 缓冲下可取、重定向 body 拿不到、SSE 需 `streamResourceContent`（暂未接）。
 */

import { passiveBuffer } from "./buffer.ts"

export interface CaptureOptions {
  platform: string
  endpoint: string
  /** 只收哪些 URL（用于过滤同一页面上的无关请求）。 */
  match: (url: URL) => boolean
  /** 触发页面自然请求（导航/滚动/点击）。禁止在内部构造自定义请求。 */
  trigger: (browser: BrowserBackend) => Promise<void>
  /** 匹配请求结束后再等多久算「静默」（默认 600ms）。 */
  idleMs?: number
  timeoutMs?: number
}

/** 只保留可当文本解析的响应；图片/视频/字体等直接跳过。 */
const TEXT_MIME =
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|application\/[^;]+\+(json|xml))/i

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Inflight {
  url: string
  status?: number
  mime?: string
}

/**
 * 触发页面自然请求并收集匹配的响应体，返回尝试写入缓冲的条数。
 * 无 `send`/`onEvent` 的后端（浏览器直跑/CLI）会抛错。
 */
export async function capturePage(browser: BrowserBackend, opts: CaptureOptions): Promise<number> {
  const send = browser.send?.bind(browser)
  const onEvent = browser.onEvent?.bind(browser)
  if (!send || !onEvent) throw new Error("LX 被动采集需要 browser.send / browser.onEvent")

  const inflight = new Map<string, Inflight>()
  const writes: Promise<unknown>[] = []
  let lastActivity = Date.now()

  const off = onEvent((method, raw) => {
    const params = raw as {
      requestId?: string
      request?: { url?: string }
      response?: { status?: number; mimeType?: string }
    }
    const rid = params?.requestId
    if (!rid) return

    if (method === "Network.requestWillBeSent") {
      const rawUrl = params.request?.url
      if (typeof rawUrl !== "string") return
      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        return
      }
      if (!opts.match(url)) return
      // 重定向会复用 requestId：以最后一跳为准。
      inflight.set(rid, { url: url.href })
      lastActivity = Date.now()
      return
    }

    if (method === "Network.responseReceived") {
      const p = inflight.get(rid)
      if (!p) return
      p.status = params.response?.status
      p.mime = params.response?.mimeType
      return
    }

    if (method === "Network.loadingFinished") {
      const p = inflight.get(rid)
      if (!p) return
      inflight.delete(rid)
      lastActivity = Date.now()
      if (p.mime && !TEXT_MIME.test(p.mime)) return
      writes.push(
        send("Network.getResponseBody", { requestId: rid })
          .then((r) => {
            const body = (r as { body?: string })?.body
            if (typeof body !== "string" || !body) return
            passiveBuffer.push({
              platform: opts.platform,
              endpoint: opts.endpoint,
              url: p.url,
              status: p.status ?? 0,
              mime: p.mime ?? "",
              body,
            })
          })
          .catch(() => {
            /* 304/重定向/已驱逐：跳过，不重发请求 */
          }),
      )
      return
    }

    if (method === "Network.loadingFailed") {
      // 导航/SSE 关闭的 ERR_ABORTED 属正常结束；只做清理。
      if (!inflight.delete(rid)) return
      lastActivity = Date.now()
    }
  })

  try {
    await send("Network.enable", {
      maxTotalBufferSize: 64 * 1024 * 1024,
      maxResourceBufferSize: 16 * 1024 * 1024,
    })
    await opts.trigger(browser)

    const idleMs = opts.idleMs ?? 600
    const deadline = Date.now() + (opts.timeoutMs ?? 20_000)
    while (Date.now() < deadline) {
      if (inflight.size === 0 && Date.now() - lastActivity >= idleMs) break
      await sleep(100)
    }
    await Promise.allSettled(writes)
  } finally {
    off()
  }
  return writes.length
}
