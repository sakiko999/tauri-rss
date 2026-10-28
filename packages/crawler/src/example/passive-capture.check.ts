import { passiveBuffer } from "../passive/buffer.ts"
/**
 * capturePage 自检 —— `bun packages/crawler/src/example/passive-capture.check.ts`
 * 用假 BrowserBackend 回放 CDP 事件，验证：匹配/非匹配过滤、文本 MIME 才取 body、
 * 拿不到 send/onEvent 时明确报错。
 */
import { capturePage } from "../passive/capture.ts"

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

const listeners = new Set<(method: string, params: unknown) => void>()
const bodies: Record<string, string> = {
  "1": "<html>SSR-HTML</html>",
  "2": "PNG-BYTES",
}
const fake = {
  async send(method: string, params?: Record<string, unknown>) {
    if (method === "Network.getResponseBody") return { body: bodies[String(params?.requestId)] ?? "" }
    return {}
  },
  onEvent(cb: (method: string, params: unknown) => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  async evaluate() {
    return null
  },
  async getCookies() {
    return {}
  },
  async close() {},
} as unknown as BrowserBackend

const emit = (method: string, params: unknown) => {
  for (const cb of [...listeners]) cb(method, params)
}

passiveBuffer.clear()

const n = await capturePage(fake, {
  platform: "xhs",
  endpoint: "explore",
  match: (u) => u.pathname === "/explore",
  trigger: async () => {
    // 匹配 + 文本：应写入
    emit("Network.requestWillBeSent", { requestId: "1", request: { url: "https://x.com/explore?wts=1" } })
    // 不匹配：应忽略
    emit("Network.requestWillBeSent", { requestId: "2", request: { url: "https://x.com/static/a.png" } })
    emit("Network.responseReceived", { requestId: "1", response: { status: 200, mimeType: "text/html" } })
    emit("Network.responseReceived", { requestId: "2", response: { status: 200, mimeType: "image/png" } })
    emit("Network.loadingFinished", { requestId: "1" })
    emit("Network.loadingFinished", { requestId: "2" })
    // 失败的请求只清理，不写
    emit("Network.loadingFailed", { requestId: "3", errorText: "net::ERR_ABORTED" })
  },
  idleMs: 50,
  timeoutMs: 3000,
})

ok(n === 1, "只对匹配的文本响应取 body")
const entry = passiveBuffer.getLatest("xhs", "explore")
ok(entry?.body === "<html>SSR-HTML</html>", "响应体写入缓冲")
ok(entry?.mime === "text/html" && entry?.status === 200, "status/mime 一并落库")
ok(passiveBuffer.get("xhs", "explore", "https://x.com/static/a.png") === null, "非匹配请求不写入")

// 缺能力时必须显式报错（调用方据此判断 LX 不可用）
let threw = false
try {
  await capturePage({} as BrowserBackend, {
    platform: "x",
    endpoint: "y",
    match: () => true,
    trigger: async () => {},
  })
} catch {
  threw = true
}
ok(threw, "后端缺少 send/onEvent 时抛错")

if (fails) {
  console.error(`\n${fails} 项失败`)
  process.exit(1)
}
console.log("\n全部通过")
