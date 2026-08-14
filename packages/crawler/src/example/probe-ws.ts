/**
 * probe-ws —— 提前验证「浏览器原生 WebSocket(无自定义 header)能否连四家直播弹幕」。
 *
 * 回答 docs/danmaku-research.md「四、四平台 WS 弹幕落地清单」的通道选型:标准 WebSocket
 * 不能设自定义 header,若服务器接受无 header 连接,浏览器原生即可落地(零新基础设施);
 * 被 403/Origin 拒才需要 Rust ws_connect。
 *
 * 探测策略:
 *   1. 先无 header(标准 `new WebSocket(url)`)——最接近「浏览器原生」下限;
 *   2. 失败则带浏览器模拟头(Origin/UA,bun 扩展)重试——区分「无 header 被拒」vs「不可达」。
 *
 * 测项(房间取 desktop 测试订阅):
 *   - bilibili 直播(6,带 core 默认登录 cookie): getDanmuInfo(wbi 签名) → wss → op=7 认证 → 等 op=5/3/8
 *   - douyu(9999):  wss://danmuproxy.douyu.com:8506 → loginreq+joingroup(STT) → 等 690 帧
 *   - huya(60066):  wss://cdnws.api.huya.com → 握手成功即通过(Tars 进房另测)
 *   - douyin:        wss://webcast3-ws-web-lq.douyin.com(无签名)→ 预期被拒(证明签名必须)
 *
 * Run: bun run packages/crawler/src/example/probe-ws.ts
 */
import { biliClient } from "../platform/bili"
import { brotliDecompressSync, inflateSync } from "node:zlib"
// 相对路径引用 core 常量(bun 单文件跑解析不到 workspace 包;纯常量文件无副作用)。
import { setupBackends } from "./backend.ts"

interface WsProbe {
  name: string
  ok: boolean
  detail: string
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/**
 * 原生 WS 探测。opts.header 提供时用 bun 扩展 `new WebSocket(url, { headers })`(模拟浏览器
 * 带 Origin/UA),否则标准无 header。onMessage 返回非 null 即成功(detail)。
 */
/** bun 的 send 接受 Uint8Array;TS 类型收窄到 ArrayBufferView<ArrayBuffer>,cast 掉。 */
function wsSend(ws: WebSocket, data: Uint8Array): void {
  ws.send(data as unknown as ArrayBufferView<ArrayBuffer>)
}

function probeNative(
  name: string,
  url: string,
  onOpen: (ws: WebSocket) => void,
  onMessage: (data: string | ArrayBuffer) => string | null,
  opts: { timeoutMs?: number; successOnOpen?: boolean; header?: Record<string, string> } = {},
): Promise<WsProbe> {
  const timeoutMs = opts.timeoutMs ?? 6000
  const p = new Promise<WsProbe>((resolve) => {
    let ws: WebSocket
    try {
      // bun 扩展支持 { headers };TS 类型只认 protocols 数组,cast 掉。
      ws = opts.header ? new WebSocket(url, { headers: opts.header } as unknown as string[]) : new WebSocket(url)
    } catch (e) {
      resolve({ name, ok: false, detail: `构造失败:${(e as Error)?.message}` })
      return
    }
    ws.binaryType = "arraybuffer"
    let settled = false
    let opened = false
    const finish = (r: WsProbe) => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    const timer = setTimeout(() => {
      try { ws.close() } catch { /* noop */ }
      finish({ name, ok: false, detail: `timeout(${timeoutMs}ms)${opened ? "(曾握手成功,但无有效消息)" : "(握手未完成)"}` })
    }, timeoutMs)
    ws.onopen = () => {
      opened = true
      if (opts.successOnOpen) {
        clearTimeout(timer)
        finish({ name, ok: true, detail: "握手成功(连接建立,header 未拦截)" })
        try { ws.close() } catch { /* noop */ }
        return
      }
      onOpen(ws)
    }
    ws.onmessage = (ev) => {
      const hit = onMessage(ev.data as string | ArrayBuffer)
      if (hit) {
        clearTimeout(timer)
        finish({ name, ok: true, detail: hit })
      }
    }
    ws.onerror = () => finish({ name, ok: false, detail: "握手失败(服务器拒绝/网络错误)" })
    ws.onclose = (ev) => {
      clearTimeout(timer)
      finish({ name, ok: false, detail: `closed code=${ev.code} reason=${ev.reason || "(空)"}` })
    }
  })
  return Promise.race([
    p,
    new Promise<WsProbe>((resolve) => setTimeout(() => resolve({ name, ok: false, detail: "race 总超时" }), timeoutMs + 2000)),
  ])
}

/** 失败时带浏览器模拟头重试,返回更优结果(区分 header vs 不可达)。 */
async function retryWithHeader(prev: WsProbe, url: string, onOpen: (ws: WebSocket) => void, onMessage: (d: string | ArrayBuffer) => string | null, origin: string): Promise<WsProbe> {
  if (prev.ok) return prev
  const withHeader = await probeNative(prev.name, url, onOpen, onMessage, {
    timeoutMs: 5000,
    header: { origin, "user-agent": BROWSER_UA },
  })
  if (withHeader.ok) return { ...withHeader, detail: `${withHeader.detail}【带 Origin/UA 后成功 → 浏览器原生 WS 可行】` }
  return { ...prev, detail: `${prev.detail} / 带 header 仍失败:${withHeader.detail}` }
}

// ── bilibili 直播 ────────────────────────────────────────────────────────

const BILI_LIVE = "https://api.live.bilibili.com"

function biliFrame(op: number, bodyObj: unknown, protover = 0): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(bodyObj))
  const frame = new Uint8Array(16 + body.length)
  const dv = new DataView(frame.buffer)
  dv.setUint32(0, 16 + body.length, false)
  dv.setUint16(4, 16, false)
  dv.setUint16(6, protover, false)
  dv.setUint32(8, op, false)
  dv.setUint32(12, 1, false)
  frame.set(body, 16)
  return frame
}

function parseBiliPackets(buf: Uint8Array): Array<{ op: number; ver: number; body: Uint8Array }> {
  const out: Array<{ op: number; ver: number; body: Uint8Array }> = []
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = 0
  while (off + 16 <= buf.length) {
    const total = dv.getUint32(off, false)
    const headerLen = dv.getUint16(off + 4, false)
    const ver = dv.getUint16(off + 6, false)
    const op = dv.getUint32(off + 8, false)
    const end = Math.min(off + total, buf.length)
    if (headerLen >= 16 && end > off + headerLen) out.push({ op, ver, body: buf.slice(off + headerLen, end) })
    if (total <= 0) break
    off += total
  }
  return out
}

function decodeBiliBody(ver: number, body: Uint8Array): string[] {
  try {
    if (ver === 0) return new TextDecoder().decode(body).split(/[\x00-\x1f]+/).filter(Boolean)
    const raw =
      ver === 3
        ? brotliDecompressSync(Buffer.from(body))
        : ver === 2
          ? inflateSync(Buffer.from(body))
          : Buffer.from(body)
    return new TextDecoder().decode(raw).split(/[\x00-\x1f]+/).filter(Boolean)
  } catch {
    return []
  }
}

async function probeBiliLive(roomId: string): Promise<WsProbe> {
  let host = ""
  let token = ""
  try {
    const q = await Promise.race([
      biliClient.signWeb(`id=${roomId}`),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 6000)),
    ])
    if (q) {
      const info = await Promise.race([
        biliClient.getJson<{ data?: { token?: string; host_list?: Array<{ host?: string }> } }>(
          `${BILI_LIVE}/xlive/web-room/v1/index/getDanmuInfo?${q}`,
        ),
        new Promise<{ data?: { token?: string; host_list?: Array<{ host?: string }> } } | undefined>((resolve) =>
          setTimeout(() => resolve(undefined), 6000),
        ),
      ])
      host = info?.data?.host_list?.[0]?.host ?? ""
      token = info?.data?.token ?? ""
    }
  } catch {
    host = ""
  }
  if (!host || !token) return { name: "bilibili 直播", ok: false, detail: "getDanmuInfo 无 host/token(HTTP 前置超时?)" }

  return probeNative(
    "bilibili 直播",
    `wss://${host}/sub`,
    (ws) => {
      wsSend(ws, biliFrame(7, { uid: 0, roomid: Number(roomId), protover: 3, buvid: "", platform: "web", type: 2, key: token }))
      wsSend(ws, biliFrame(2, {}))
    },
    (data) => {
      if (typeof data === "string") return null
      for (const p of parseBiliPackets(new Uint8Array(data))) {
        if (p.op === 3) return "收到 op=3 心跳回(认证通过,服务器存活)"
        if (p.op === 5) {
          const cmds = decodeBiliBody(p.ver, p.body)
          if (cmds.some((c) => c.includes("DANMU_MSG"))) return `收到 op=5 弹幕:${cmds.find((c) => c.includes("DANMU_MSG"))?.slice(0, 80)}`
          if (cmds.length) return `收到 op=5(ver=${p.ver}):${cmds[0]?.slice(0, 60)}`
        }
      }
      return null
    },
  )
}

// ── douyu ────────────────────────────────────────────────────────────────

function douyuFrame(body: string): Uint8Array {
  const bodyBuf = Buffer.from(`${body} `)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(8 + bodyBuf.length, 0)
  header.writeUInt32LE(8 + bodyBuf.length, 4)
  header.writeUInt16LE(689, 8)
  header[10] = 0
  header[11] = 0
  return Uint8Array.from(Buffer.concat([header, bodyBuf]))
}

const douyuOpen = (roomId: string) => (ws: WebSocket) => {
  wsSend(ws, douyuFrame(`type@=loginreq/roomid@=${roomId}/`))
  wsSend(ws, douyuFrame(`type@=joingroup/rid@=${roomId}/gid@=-9999/`))
  wsSend(ws, douyuFrame(`type@=mrkl/`))
}

const douyuMessage = (d: string | ArrayBuffer): string | null => {
  if (typeof d === "string") return null
  const buf = new Uint8Array(d)
  if (buf.length < 12) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint16(8, true) !== 690) return null
  const body = new TextDecoder().decode(buf.slice(12)).replace(/ +$/, "")
  if (body.includes("chatmsg")) {
    const txt = body.match(/txt@=([^/]+)/)?.[1] ?? "(空)"
    const nn = body.match(/nn@=([^/]+)/)?.[1] ?? "(空)"
    return `收到 chatmsg 弹幕 [${nn}]:${txt.slice(0, 40)}`
  }
  return `收到 server 帧(690):${body.slice(0, 40)}`
}

async function probeDouyu(roomId: string): Promise<WsProbe> {
  const noHeader = await probeNative("douyu", "wss://danmuproxy.douyu.com:8506", douyuOpen(roomId), douyuMessage)
  return retryWithHeader(noHeader, "wss://danmuproxy.douyu.com:8506", douyuOpen(roomId), douyuMessage, "https://www.douyu.com")
}

// ── huya(握手即通过) ─────────────────────────────────────────────────────

async function probeHuya(): Promise<WsProbe> {
  const noHeader = await probeNative("huya", "wss://cdnws.api.huya.com", () => {}, () => null, {
    successOnOpen: true,
  })
  return retryWithHeader(noHeader, "wss://cdnws.api.huya.com", () => {}, () => null, "https://www.huya.com")
}

// ── douyin(无签名,预期被拒) ──────────────────────────────────────────────

const DOUYIN_WS_URL =
  "wss://webcast3-ws-web-lq.douyin.com/webcast/im/push/v2/?app_name=douyin_web&version_code=180800&webcast_sdk_version=1.0.14-beta.0&update_version_code=1.0.14-beta.0&compress=gzip&device_platform=web&cookie_enabled=true&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=Win32&browser_name=Chrome&browser_version=125.0.0.0&browser_online=true&tz_name=Asia/Shanghai&room_id=0&aid=6383&os_name=Windows&referer=live.douyin.com"

async function probeDouyin(): Promise<WsProbe> {
  const noHeader = await probeNative(
    "douyin(无签名)",
    DOUYIN_WS_URL,
    () => {},
    (d) => `意外:无签名也握手成功(收到 ${typeof d === "string" ? d.slice(0, 40) : `${(d as ArrayBuffer).byteLength}B`})`,
    { timeoutMs: 6000 },
  )
  return retryWithHeader(
    noHeader,
    DOUYIN_WS_URL,
    () => {},
    () => `意外:无签名也握手成功(带 header)`,
    "https://live.douyin.com",
  )
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  setupBackends()
  console.log("probe: 浏览器原生 WebSocket(标准 API,无自定义 header)连通性\n")
  const results: WsProbe[] = await Promise.all([probeBiliLive("6"), probeDouyu("9999"), probeHuya(), probeDouyin()])

  console.log("── 结果 ────────────────────────────────────────────────")
  for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name.padEnd(16)} ${r.detail}`)
  console.log("\n结论:")
  console.log(`  bilibili 直播: ${results[0]!.ok ? "原生可行 → 无需 Rust WS" : "原生失败 → 需带 header 或 cookie 深查"}`)
  console.log(`  douyu:         ${results[1]!.ok ? "原生可行 → 无需 Rust WS" : "原生失败"}`)
  console.log(`  huya:          ${results[2]!.ok ? "原生可行 → 无需 Rust WS" : "原生失败"}`)
  console.log(`  douyin:        ${results[3]!.ok ? "无签名也能连(意外)→ 签名非必须" : "被拒/挂起 → 签名必须(与文档一致)"}`)
}

// 强制 exit:部分 WS 连接在 race 兜底后仍挂住 bun 事件循环,不 exit 进程不退出。
main().then(() => process.exit(0)).catch((err) => {
  console.error("❌ probe failed:", err)
  process.exit(1)
})
