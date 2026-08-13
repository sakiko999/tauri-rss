/**
 * bilibili 直播弹幕 —— getDanmuInfo(wbi 签名) → wss → op=7 认证 → 心跳 → op=5 弹幕。
 *
 * 协议(16B 大端头 + JSON body;probe-ws 已实测原生 WS 可连):
 *   op:2 心跳 / 3 心跳回 / 5 通知 / 7 认证进房 / 8 进房回
 *   protover:0 JSON / 2 zlib / 3 brotli —— op=5 通知按 protover 解压后按
 *   `[\x00-\x1f]+` 切分成逐条 JSON,`cmd=DANMU_MSG` → info[1] 文本。
 * 匿名可连;getDanmuInfo 带登录 cookie 更稳(probe 实测匿名可能超时)。
 */
import type { DanmakuItem, DanmakuStream } from "../../index.ts"
import { createWsStream } from "../../danmaku/ws.ts"
import { createBilibiliClient } from "./client.ts"
import { log } from "../../log.ts"

const API_LIVE = "https://api.live.bilibili.com"
/** 心跳间隔,ms。 */
const HEARTBEAT_MS = 60000

/** 16B 大端头 + JSON body → 一帧。 */
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

/** 逐包切分 16B 头粘包。 */
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

/** op=5 消息体解压(ver 2 zlib)。请求 protover:2,服务器回 zlib(DecompressionStream 标准支持)。
 *  ver 3(brotli)兼容尝试——标准 CompressionFormat 不含 "br"(Chrome 部分版本支持),失败原样返回。 */
async function inflateBiliBody(ver: number, data: Uint8Array): Promise<Uint8Array> {
  if (ver === 0) return data
  const format = ver === 3 ? ("br" as CompressionFormat) : ver === 2 ? "deflate" : null
  if (!format) return data
  try {
    const ds = new DecompressionStream(format)
    const stream = new Blob([data as unknown as ArrayBufferView<ArrayBuffer>]).stream().pipeThrough(ds)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return data
  }
}

/** 十进制 ARGB → #RRGGBB(与 bili/danmaku.ts 同逻辑)。 */
function intColorToHex(intColor: number): string {
  const hex = intColor.toString(16)
  const rrggbb =
    hex.length === 8 ? hex.slice(2) : hex.length === 4 ? `00${hex}` : hex.length === 6 ? hex : "ffffff"
  return `#${rrggbb}`
}

/** 解析一帧 WS 数据(op=5 弹幕),异步(brotli 解压)。 */
async function parseBiliDanmakuFrame(buf: Uint8Array): Promise<DanmakuItem[]> {
  const items: DanmakuItem[] = []
  for (const p of parseBiliPackets(buf)) {
    if (p.op !== 5) continue
    const body = await inflateBiliBody(p.ver, p.body)
    const text = new TextDecoder().decode(body)
    for (const line of text.split(/[\x00-\x1f]+/)) {
      if (!line) continue
      let json: { cmd?: string; info?: unknown[] } | null
      try {
        json = JSON.parse(line) as { cmd?: string; info?: unknown[] }
      } catch {
        continue
      }
      if (json?.cmd !== "DANMU_MSG") continue
      const info = json.info ?? []
      const msg = String(info[1] ?? "")
      if (!msg) continue
      items.push({
        text: msg,
        user: String((info[2] as unknown[] | undefined)?.[1] ?? ""),
        color: intColorToHex(Number((info[0] as unknown[] | undefined)?.[3] ?? 0xffffff)),
      })
    }
  }
  return items
}

/** getDanmuInfo(wbi 签名) → 弹幕服务器 host + token。 */
async function getDanmuInfo(roomId: string, cookie?: string): Promise<{ host: string; token: string }> {
  const client = createBilibiliClient({ referer: "https://live.bilibili.com/", live: true, cookie })
  const q = await client.signWeb(`id=${roomId}`)
  const res = await client.getJson<{ data?: { token?: string; host_list?: Array<{ host?: string }> } }>(
    `${API_LIVE}/xlive/web-room/v1/index/getDanmuInfo?${q}`,
  )
  const host = res?.data?.host_list?.[0]?.host
  const token = res?.data?.token
  if (!host || !token) throw new Error(`bili:live danmaku: no host/token for room ${roomId}`)
  return { host, token }
}

/** bili 直播弹幕流:订阅时 getDanmuInfo → 建 WS(认证 → 心跳 → 收弹幕),退订断开。 */
export function biliLiveDanmakuStream(roomId: string, cookie?: string): DanmakuStream {
  return (onItems) => {
    let stopped = false
    let unsub: (() => void) | undefined
    void getDanmuInfo(roomId, cookie)
      .then(({ host, token }) => {
        if (stopped) return
        unsub = createWsStream({
          url: `wss://${host}/sub`,
          onOpen: (ws) => {
            ws.send(
              biliFrame(7, {
                uid: 0,
                roomid: Number(roomId),
                // protover:2 请求 zlib(DecompressionStream 标准支持);3=brotli 兼容性差。
                protover: 2,
                buvid: "",
                platform: "web",
                type: 2,
                key: token,
              }) as unknown as ArrayBufferView<ArrayBuffer>,
            )
          },
          heartbeat: () => biliFrame(2, {}),
          heartbeatMs: HEARTBEAT_MS,
          onMessage: (data) => parseBiliDanmakuFrame(new Uint8Array(data)),
        })(onItems)
      })
      .catch((e) => {
        if (!stopped) log.biliLive.warn("直播弹幕初始化失败(未开播?):", (e as Error)?.message)
      })
    return () => {
      stopped = true
      unsub?.()
    }
  }
}
