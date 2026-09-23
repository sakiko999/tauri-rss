/**
 * bilibili 直播弹幕 —— getDanmuInfo(wbi 签名) → wss → op=7 认证 → 心跳 → op=5 弹幕。
 *
 * 协议(16B 大端头 + JSON body):
 *   op:2 心跳 / 3 心跳回 / 5 通知 / 7 认证进房 / 8 进房回
 *   protover:0 JSON / 2 zlib / 3 brotli —— op=5 通知按 protover 解压后按
 *   `[\x00-\x1f]+` 切分成逐条 JSON,`cmd=DANMU_MSG` → info[1] 文本。
 *
 * ⚠️ **token 有寿命 + op=8 鉴权回**:`getDanmuInfo` 的 token 过期后认证会被拒
 * (op=8 code!=0)。故 `createWsStream` 传 `refresh` 钩子——断线/鉴权失败重连前
 * 重新 `getDanmuInfo`(上限 3 次,超限放弃)。此前忽略 op=8,鉴权失败无感知、
 * 只反复拿过期 token 重连(参照 pure_live `bilibili_danmaku.dart:316` 同款修法)。
 *
 * ⚠️ 2026-09 实测修正:直播弹幕**匿名可用**(uid=0 + finger/spi 匿名 buvid3 →
 * op=8 {"code":0} 且收到真实 DANMU_MSG;probe 实测房间 24022841)。此前记的
 * 「匿名被 1006 拒」实为 buvid3 取自 cookie、匿名时为空所致,非 uid 问题。
 * 故认证帧 uid = nav 的 mid(cookie 登录态,匿名为 0),buvid3 登录时取 cookie、
 * 否则取匿名指纹(biliClient.anonBuvid3)。认证走 WS 帧 op=7 的 uid/buvid,
 * 不需 cookie header → 无 header 统一走宿主隧道
 * (sec-websocket-key 握手问题已修:into_client_request 构造完整请求)。
 * host 的 **wss_port 非标(常见 2245)必须拼端口**(默认 443 握手成功但非弹幕服务)。
 */
import { argbToHex, createWsStream, deferredStream } from "../../danmaku"
import type { DanmakuItem, DanmakuStream } from "../../danmaku"
import { biliClient } from "./client.ts"
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

/**
 * op=8 进房回:鉴权结果。`code != 0` = 认证失败,须刷新 token 重连
 * (参照 pure_live `bilibili_danmaku.dart:316` 同款,上限 3 次)。
 * 返回 true = 鉴权失败(调用方应 close 触发重连)。
 */
function isAuthRejected(p: { op: number; body: Uint8Array }): boolean {
  if (p.op !== 8) return false
  const text = TD.decode(p.body).trim()
  if (!text) return false // 空 body 视为成功(参照同款:code 缺省 0)
  try {
    const json = JSON.parse(text) as { code?: number }
    return Number(json?.code ?? 0) !== 0
  } catch {
    return false
  }
}

/** 解析一帧 WS 数据(op=5 弹幕 / op=8 鉴权结果),异步(brotli 解压)。 */
async function parseBiliDanmakuFrame(buf: Uint8Array): Promise<DanmakuItem[]> {
  const items: DanmakuItem[] = []
  for (const p of parseBiliPackets(buf)) {
    // 鉴权失败(op=8 code!=0):抛给 stream 层 → 触发 refresh 重连。
    if (isAuthRejected(p)) throw new Error(`bili:live 弹幕鉴权被拒(op=8)`)
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
  // 认证 uid = nav 带 cookie 的 mid;匿名时 nav 为 -101 → 0(实测匿名可用)。
  const uidPromise = cookie ? biliClient.navMid(cookie).catch(() => 0) : Promise.resolve(0)
  // buvid3:登录时取 cookie 里的,否则取匿名指纹(finger/spi)。匿名留空会被拒。
  const cookieBuvid3 = extractCookie(cookie ?? "", "buvid3")
  const buvid3Promise = cookieBuvid3 ? Promise.resolve(cookieBuvid3) : biliClient.anonBuvid3().catch(() => "")
  const q = await biliClient.signWeb(`id=${roomId}`, cookie)
  const res = await biliClient.getJson<{
    data?: { token?: string; host_list?: Array<{ host?: string; wss_port?: number }> }
  }>(`${API_LIVE}/xlive/web-room/v1/index/getDanmuInfo?${q}`, { referer: "https://live.bilibili.com/", cookie })
  const first = res?.data?.host_list?.[0]
  const host = first?.host
  const wssPort = first?.wss_port ?? 443
  const token = res?.data?.token
  if (!host || !token) throw new Error(`bili:live danmaku: no host/token for room ${roomId}`)
  const uid = await uidPromise
  const buvid3 = await buvid3Promise
  return { host, wssPort, token, uid, buvid3 }
}

/** token 刷新重试上限(参照 pure_live `_credentialRefreshCount >= 3` 即放弃)。 */
const MAX_CREDENTIAL_REFRESH = 3

/** bili 直播弹幕流:订阅时 getDanmuInfo → 建 WS(认证 → 心跳 → 收弹幕),退订断开。 */
export function biliLiveDanmakuStream(roomId: string, cookie?: string): DanmakuStream {
  return deferredStream(
    () => getDanmuInfo(roomId, cookie),
    (initial, onItems) => {
      // token 有寿命 → 断线重连须重新 getDanmuInfo,否则拿过期 key 认证被拒。
      let cred = initial
      let refreshes = 0
      const refresh = async (): Promise<boolean> => {
        if (refreshes >= MAX_CREDENTIAL_REFRESH) return false
        refreshes += 1
        cred = await getDanmuInfo(roomId, cookie)
        return true
      }
      return createWsStream({
        // 必须拼 wss_port(非标 2245 常见;默认 443 连上非弹幕服务)。
        // 动态求值:重连时 host/token 已被 refresh 更新。
        url: () => `wss://${cred.host}:${cred.wssPort}/sub`,
        refresh,
        onOpen: (ws) => {
          ws.send(
            biliFrame(7, {
              uid: cred.uid,
              roomid: Number(roomId),
              // protover:2 请求 zlib(DecompressionStream 标准支持);3=brotli 兼容性差。
              protover: 2,
              buvid: cred.buvid3,
              platform: "web",
              type: 2,
              key: cred.token,
            }),
          )
        },
        heartbeat: () => biliFrame(2, {}),
        heartbeatMs: HEARTBEAT_MS,
        onMessage: (data) => parseBiliDanmakuFrame(new Uint8Array(data)),
      })(onItems)
    },
    (e) => log.biliLive.warn("直播弹幕初始化失败(未开播?):", (e as Error)?.message),
  )
}
