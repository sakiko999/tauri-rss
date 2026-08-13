/**
 * bilibili 直播弹幕 —— getDanmuInfo(wbi 签名) → wss → op=7 认证 → 心跳 → op=5 弹幕。
 *
 * 协议(16B 大端头 + JSON body):
 *   op:2 心跳 / 3 心跳回 / 5 通知 / 7 认证进房 / 8 进房回
 *   protover:0 JSON / 2 zlib / 3 brotli —— op=5 通知按 protover 解压后按
 *   `[\x00-\x1f]+` 切分成逐条 JSON,`cmd=DANMU_MSG` → info[1] 文本。
 *
 * ⚠️ 2026-08 风控:直播弹幕**必须真实登录 uid**——匿名(uid=0)认证被服务器
 * 1006 拒绝(握手成功即断,probe-bili-cookie 实测:uid=0 1006,真实 nav mid → op=8
 * {"code":0})。故认证帧 uid = nav 的 mid(cookie 登录态),buvid = cookie 提取的
 * buvid3。认证走 WS 帧 op=7 的 uid/buvid,不需 cookie header → 无 header 统一走
 * 宿主隧道(sec-websocket-key 握手问题已修:into_client_request 构造完整请求)。
 * host 的 **wss_port 非标(常见 2245)必须拼端口**(默认 443 握手成功但非弹幕服务)。
 */
import type { DanmakuItem, DanmakuStream } from "../../index.ts"
import { createWsStream } from "../../danmaku/ws.ts"
import { deferredStream } from "../../danmaku/deferred.ts"
import { argbToHex } from "../../danmaku/color.ts"
import { createBilibiliClient } from "./client.ts"
import { extractCookie } from "../../utils/cookie.ts"
import { log } from "../../log.ts"

/** 编解码复用单例(每帧热路径,共享安全)。 */
const TE = new TextEncoder()
const TD = new TextDecoder()

const API_LIVE = "https://api.live.bilibili.com"
/** 心跳间隔,ms。 */
const HEARTBEAT_MS = 60000

/** 16B 大端头 + JSON body → 一帧。 */
function biliFrame(op: number, bodyObj: unknown, protover = 0): Uint8Array {
  const body = TE.encode(JSON.stringify(bodyObj))
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

/** 解析一帧 WS 数据(op=5 弹幕),异步(brotli 解压)。 */
async function parseBiliDanmakuFrame(buf: Uint8Array): Promise<DanmakuItem[]> {
  const items: DanmakuItem[] = []
  for (const p of parseBiliPackets(buf)) {
    if (p.op !== 5) continue
    const body = await inflateBiliBody(p.ver, p.body)
    const text = TD.decode(body)
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
        color: argbToHex(Number((info[0] as unknown[] | undefined)?.[3] ?? 0xffffff)),
      })
    }
  }
  return items
}

/** getDanmuInfo(wbi 签名) → 弹幕服务器 host + wss_port + token + 登录 uid + buvid3。 */
async function getDanmuInfo(
  roomId: string,
  cookie?: string,
): Promise<{ host: string; wssPort: number; token: string; uid: number; buvid3: string }> {
  const client = createBilibiliClient({ referer: "https://live.bilibili.com/", live: true, cookie })
  // 认证 uid = nav 带 cookie 的 mid(2026 风控:匿名 0 被拒)。仅 cookie 时发(匿名必 0,
  // 白打一次);与 getDanmuInfo 并行,且复用 signWeb 的 nav 响应(client.navMid 共享缓存)。
  const uidPromise = cookie ? client.navMid().catch(() => 0) : Promise.resolve(0)
  const q = await client.signWeb(`id=${roomId}`)
  const res = await client.getJson<{
    data?: { token?: string; host_list?: Array<{ host?: string; wss_port?: number }> }
  }>(`${API_LIVE}/xlive/web-room/v1/index/getDanmuInfo?${q}`)
  const first = res?.data?.host_list?.[0]
  const host = first?.host
  const wssPort = first?.wss_port ?? 443
  const token = res?.data?.token
  if (!host || !token) throw new Error(`bili:live danmaku: no host/token for room ${roomId}`)
  const uid = await uidPromise
  const buvid3 = extractCookie(cookie ?? "", "buvid3")
  return { host, wssPort, token, uid, buvid3 }
}

/** bili 直播弹幕流:订阅时 getDanmuInfo → 建 WS(认证 → 心跳 → 收弹幕),退订断开。 */
export function biliLiveDanmakuStream(roomId: string, cookie?: string): DanmakuStream {
  return deferredStream(
    () => getDanmuInfo(roomId, cookie),
    ({ host, wssPort, token, uid, buvid3 }, onItems) =>
      createWsStream({
        // 必须拼 wss_port(非标 2245 常见;默认 443 连上非弹幕服务)。
        // 无 header(认证走 WS 帧 op=7 的 uid/buvid,不需 cookie header)——统一走宿主隧道。
        url: `wss://${host}:${wssPort}/sub`,
        onOpen: (ws) => {
          ws.send(
            biliFrame(7, {
              uid,
              roomid: Number(roomId),
              // protover:2 请求 zlib(DecompressionStream 标准支持);3=brotli 兼容性差。
              protover: 2,
              buvid: buvid3,
              platform: "web",
              type: 2,
              key: token,
            }) as unknown as ArrayBufferView<ArrayBuffer>,
          )
        },
        heartbeat: () => biliFrame(2, {}),
        heartbeatMs: HEARTBEAT_MS,
        onMessage: (data) => parseBiliDanmakuFrame(new Uint8Array(data)),
      })(onItems),
    (e) => log.biliLive.warn("直播弹幕初始化失败(未开播?):", (e as Error)?.message),
  )
}
