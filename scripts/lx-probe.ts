/**
 * lx-probe —— LX 被动采集的 CDP 边界实测（风控文档 §3.7 P0）。
 *
 * 起一个独立 Edge（临时 profile，屏外 shown）+ 本地测试页，让**页面自己**发起
 * 各类请求，用 CDP `Network` 域观察：
 *   - 普通 JSON / gzip / 302 / ETag 304 / 12MB 大 body 的 `getResponseBody` 命中率
 *   - `responseReceivedExtraInfo` 与 `responseReceived` 的先后与真实状态码
 *   - SSE 的 `streamResourceContent` + `dataReceived.data` 分片
 *   - Service Worker 发起的请求是否落在单独的 target/session
 *
 * 用法：bun scripts/lx-probe.ts
 * 输出：一份 JSON 报告（stdout）。
 */

import { rm } from "node:fs/promises"
import { gzipSync } from "node:zlib"

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const PORT = Number(process.env.CDP_PORT ?? 9334)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── 本地测试服务 ──────────────────────────────────────────────────────────────
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>lx-probe</title></head>
<body><h1>lx-probe</h1>
<script>
(async () => {
  const log = window.__lx = { steps: [], done: false };
  const step = async (name, fn) => {
    try { const v = await fn(); log.steps.push({ name, ok: true, value: String(v).slice(0, 60) }) }
    catch (e) { log.steps.push({ name, ok: false, value: String(e).slice(0, 120) }) }
  };
  await step('json', () => fetch('/json').then(r => r.text()));
  await step('etag1', () => fetch('/etag', { cache: 'no-cache' }).then(r => r.text()));
  await step('etag2', () => fetch('/etag', { cache: 'no-cache' }).then(r => r.text()));
  await step('redirect', () => fetch('/redirect').then(r => r.text()));
  await step('gzip', () => fetch('/gzip').then(r => r.text()));
  await step('big', () => fetch('/big').then(r => r.text()).then(t => t.length));
  await step('sse', () => new Promise((resolve) => {
    const es = new EventSource('/sse'); let n = 0;
    es.onmessage = () => { n++; if (n >= 3) { es.close(); resolve(n) } };
    setTimeout(() => { es.close(); resolve(n) }, 3000);
  }));
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 20 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100));
    log.swControlled = !!navigator.serviceWorker.controller;
  } catch (e) { log.steps.push({ name: 'sw-register', ok: false, value: String(e) }) }
  await new Promise(r => setTimeout(r, 300));
  await step('sw-data', () => fetch('/sw-data').then(r => r.text()));
  log.done = true;
})();
</script></body></html>`

const BIG = JSON.stringify({ data: "x".repeat(12 * 1024 * 1024) })
const GZ = gzipSync(Buffer.from("gzip-body-".repeat(200)))

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    const p = url.pathname
    if (p === "/json") return Response.json({ ok: true, body: "json-body" })
    if (p === "/etag") {
      if (req.headers.get("if-none-match") === '"v1"') {
        return new Response(null, { status: 304, headers: { etag: '"v1"' } })
      }
      return new Response("etag-body", { headers: { etag: '"v1"', "cache-control": "no-cache" } })
    }
    if (p === "/redirect") return Response.redirect(new URL("/json", req.url).toString(), 302)
    if (p === "/gzip") {
      return new Response(GZ, { headers: { "content-type": "text/plain", "content-encoding": "gzip" } })
    }
    if (p === "/big") return new Response(BIG, { headers: { "content-type": "application/json" } })
    if (p === "/sw.js") {
      return new Response(
        `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname === '/sw-data') e.respondWith(fetch('/sw-inner'));
});`,
        { headers: { "content-type": "application/javascript" } },
      )
    }
    if (p === "/sw-data") return new Response("sw-not-intercepted")
    if (p === "/sw-inner") return new Response("sw-inner-body")
    if (p === "/sse") {
      const enc = new TextEncoder()
      let n = 0
      let timer: ReturnType<typeof setInterval>
      const stream = new ReadableStream({
        start(c) {
          timer = setInterval(() => {
            c.enqueue(enc.encode(`data: tick-${++n}\n\n`))
            if (n >= 5) {
              clearInterval(timer)
              c.close()
            }
          }, 200)
        },
        cancel() {
          clearInterval(timer)
        },
      })
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    }
    return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } })
  },
})

// ── 进程 ──────────────────────────────────────────────────────────────────────
async function portOwner(port: number): Promise<number | null> {
  const p = Bun.spawn(["netstat", "-ano"], { stdout: "pipe", stderr: "ignore" })
  const text = await new Response(p.stdout).text()
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(`:${port} `) || !line.includes("LISTENING")) continue
    const pid = Number(line.trim().split(/\s+/).pop())
    if (pid) return pid
  }
  return null
}

async function killPort(port: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const pid = await portOwner(port)
    if (pid === null) return
    const p = Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
    await p.exited
    await sleep(200)
  }
}

async function waitCdp(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return
    } catch {
      /* 未就绪 */
    }
    if (Date.now() > deadline) throw new Error(`CDP ${port} 未就绪`)
    await sleep(200)
  }
}

// ── CDP 客户端 ────────────────────────────────────────────────────────────────
interface Cdp {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>
  onEvent(cb: (method: string, params: any, sessionId?: string) => void): void
  close(): void
}

async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url)
  let id = 0
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()
  const listeners: Array<(m: string, p: any, sid?: string) => void> = []
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res(), { once: true })
    ws.addEventListener("error", () => rej(new Error("CDP ws 连接失败")), { once: true })
  })
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as {
      id?: number
      method?: string
      params?: any
      sessionId?: string
      result?: any
      error?: any
    }
    if (msg.id !== undefined) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.rej(new Error(`CDP ${JSON.stringify(msg.error)}`))
      else p.res(msg.result)
      return
    }
    if (msg.method) for (const l of listeners) l(msg.method, msg.params, msg.sessionId)
  })
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const myId = ++id
        pending.set(myId, { res, rej })
        ws.send(JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) }))
      }),
    onEvent: (cb) => listeners.push(cb),
    close: () => ws.close(),
  }
}

// ── 采集状态 ──────────────────────────────────────────────────────────────────
interface ReqInfo {
  url: string
  type: string
  status?: number
  mime?: string
  fromCache?: boolean
  extraStatus?: number
  extraAfter?: boolean
  redirectStatus?: number
  redirectBody?: { ok: boolean; len?: number; error?: string }
  finished?: boolean
  failed?: string
  body?: { ok: boolean; len?: number; head?: string; error?: string }
  swSession?: boolean
  streamChunks?: number
  streamBytes?: number
}

const reqs = new Map<string, ReqInfo>()
const pendingBodies: Promise<void>[] = []
const key = (sid: string | undefined, rid: string) => `${sid ?? "page"}|${rid}`
const TEST_PATHS = new Set(["/page", "/json", "/etag", "/redirect", "/gzip", "/big", "/sse", "/sw-data", "/sw-inner"])

let swSession: string | undefined
let swAttached = false
const pageCdp = await (async () => {
  await killPort(PORT)
  const profile = `${process.env.TEMP ?? "."}\\lx-probe-${process.pid}`
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-default-apps",
    "--window-position=-32000,-32000",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
    "about:blank",
  ]
  Bun.spawn([EDGE, ...args], { stdout: "ignore", stderr: "ignore" })
  await waitCdp(PORT)

  const version = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) as {
    Browser: string
    webSocketDebuggerUrl: string
  }

  // browser-level：发现 SW target 并 attach（SW 请求不在 page session 里）
  const browser = await connect(version.webSocketDebuggerUrl)
  browser.onEvent(async (method, params) => {
    if (method === "Target.targetCreated" && params.targetInfo?.type === "service_worker") {
      if (!String(params.targetInfo.url).includes("/sw.js")) return
      try {
        await browser.send("Target.attachToTarget", { targetId: params.targetInfo.targetId, flatten: true })
      } catch {
        /* 已附着/不可附着 */
      }
    }
    if (method === "Target.attachedToTarget") {
      swSession = params.sessionId
      swAttached = true
      await browser
        .send(
          "Network.enable",
          { maxTotalBufferSize: 64 * 1024 * 1024, maxResourceBufferSize: 16 * 1024 * 1024 },
          params.sessionId,
        )
        .catch(() => {})
    }
  })
  await browser.send("Target.setDiscoverTargets", { discover: true })

  // page-level：主采集通道
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{
    type: string
    url: string
    webSocketDebuggerUrl: string
  }>
  const pageTarget = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
  if (!pageTarget) throw new Error("没有 page target")
  const page = await connect(pageTarget.webSocketDebuggerUrl)

  // ⚠️ SW 的 Network 事件走 browser 连接 + sessionId，page 连接收不到；
  // 同一个采集器分别挂到两条连接上，命令也发回对应的连接。
  const makeCollector = (conn: Cdp) => (method: string, params: any, sid?: string) => {
    if (method === "Network.requestWillBeSent") {
      const r = params.request
      const path = (() => {
        try {
          return new URL(r.url).pathname
        } catch {
          return ""
        }
      })()
      if (!TEST_PATHS.has(path)) return
      const k = key(sid, params.requestId)
      const prev = reqs.get(k)
      const info: ReqInfo = { url: r.url, type: params.type, swSession: !!sid }
      if (prev) info.redirectStatus = prev.status
      if (params.redirectResponse) {
        info.redirectStatus = params.redirectResponse.status
        // 跳转响应体：立刻试一次，记录能不能取到
        pendingBodies.push(
          conn
            .send("Network.getResponseBody", { requestId: params.requestId }, sid)
            .then((b: any) => {
              info.redirectBody = { ok: true, len: b.body.length }
            })
            .catch((e: Error) => {
              info.redirectBody = { ok: false, error: e.message.slice(0, 120) }
            }),
        )
      }
      reqs.set(k, info)
      return
    }
    if (method === "Network.responseReceived") {
      const k = key(sid, params.requestId)
      const info = reqs.get(k)
      if (!info) return
      info.status = params.response.status
      info.mime = params.response.mimeType
      info.fromCache = params.response.fromDiskCache || params.response.fromServiceWorker
      if (new URL(info.url).pathname === "/sse") {
        conn.send("Network.streamResourceContent", { requestId: params.requestId }, sid).catch(() => {})
      }
      return
    }
    if (method === "Network.responseReceivedExtraInfo") {
      const k = key(sid, params.requestId)
      const info = reqs.get(k)
      if (!info) return
      info.extraStatus = params.statusCode
      info.extraAfter = info.status !== undefined
      return
    }
    if (method === "Network.dataReceived") {
      const k = key(sid, params.requestId)
      const info = reqs.get(k)
      if (!info) return
      info.streamChunks = (info.streamChunks ?? 0) + 1
      if (typeof params.data === "string") info.streamBytes = (info.streamBytes ?? 0) + params.data.length
      return
    }
    if (method === "Network.loadingFinished") {
      const k = key(sid, params.requestId)
      const info = reqs.get(k)
      if (!info) return
      info.finished = true
      pendingBodies.push(
        conn
          .send("Network.getResponseBody", { requestId: params.requestId }, sid)
          .then((r: { body: string; base64Encoded: boolean }) => {
            info.body = { ok: true, len: r.body.length, head: r.body.slice(0, 40) }
          })
          .catch((e: Error) => {
            info.body = { ok: false, error: e.message.slice(0, 160) }
          }),
      )
      return
    }
    if (method === "Network.loadingFailed") {
      const info = reqs.get(key(sid, params.requestId))
      if (info) info.failed = params.errorText
    }
  }
  page.onEvent(makeCollector(page))
  browser.onEvent(makeCollector(browser))
  await page.send("Network.enable", {
    maxTotalBufferSize: 64 * 1024 * 1024,
    maxResourceBufferSize: 16 * 1024 * 1024,
  })

  await page.send("Runtime.evaluate", {
    expression: `location.href = ${JSON.stringify(`http://127.0.0.1:${server.port}/page`)}`,
  })

  // 等页面自己跑完所有测试步骤
  const deadline = Date.now() + 40_000
  for (;;) {
    try {
      const r = await page.send("Runtime.evaluate", {
        expression: "JSON.stringify({ done: !!window.__lx?.done, steps: window.__lx?.steps ?? [] })",
        returnByValue: true,
      })
      const v = JSON.parse(r.result?.value ?? "{}") as { done?: boolean }
      if (v.done) break
    } catch {
      /* 导航过渡 */
    }
    if (Date.now() > deadline) throw new Error("测试页未在 40s 内完成")
    await sleep(500)
  }
  await sleep(1000) // 等最后的 body 回包

  const steps = await page
    .send("Runtime.evaluate", {
      expression: "JSON.stringify({ steps: window.__lx?.steps ?? [], swControlled: !!window.__lx?.swControlled })",
      returnByValue: true,
    })
    .then((r: any) => JSON.parse(r.result?.value ?? "{}"))

  return { version, page, browser, steps }
})()

// 收尾
await Promise.allSettled(pendingBodies)
await sleep(300)
const pageInfo = [...reqs.entries()].map(([k, v]) => ({ key: k, ...v }))
const swReqs = pageInfo.filter((r) => r.swSession)
pageCdp.page.close()
pageCdp.browser.close()
await killPort(PORT)
await rm(`${process.env.TEMP ?? "."}\\lx-probe-${process.pid}`, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
}).catch(() => {})
server.stop(true)

console.log(
  JSON.stringify(
    {
      browser: pageCdp.version.Browser,
      pageSteps: pageCdp.steps,
      sw: { attached: swAttached, session: swSession ?? null, requests: swReqs },
      requests: pageInfo,
    },
    null,
    2,
  ),
)
