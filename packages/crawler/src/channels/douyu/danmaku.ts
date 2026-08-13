/**
 * douyu 弹幕 —— wss://danmuproxy:8506 + STT 纯文本(无鉴权,probe 实测原生可连)。
 *
 * 协议(12B 小端头 + STT body):
 *   头:fullLen(fullLen2 同值) + packType(689 client→server / 690 server→client) +
 *      encrypted + reserved;body = fullLen-9 字节,末尾 0x00。
 *   body 是 STT:`k@=v/k@=v/`,转义 `@S`→`/`、`@A`→`@`。
 *   `type@=chatmsg` → txt/nn/col(col 是斗鱼专属 6 色索引,非真 hex)。
 * 心跳 `type@=mrkl/`(45s);进房 loginreq + joingroup。
 */
import type { DanmakuItem, DanmakuStream } from "../../index.ts"
import { createWsStream } from "../../danmaku/ws.ts"

const WS_URL = "wss://danmuproxy.douyu.com:8506"
/** 心跳间隔,ms(douyu 45s,断连限流严格)。 */
const HEARTBEAT_MS = 45000

/** 斗鱼专属 6 色索引(dart getColor):1红 2蓝 3绿 4橙 5紫 6粉。 */
const DOUYU_COLORS: Record<number, string> = {
  1: "#ff0000",
  2: "#1e87f0",
  3: "#7ac84b",
  4: "#ff7f00",
  5: "#9b39f4",
  6: "#ff69b4",
}

/** 12B 小端头 + STT body + 末尾 0x00 → 一帧(client→server packType=689)。 */
function douyuFrame(body: string): Uint8Array {
  const bodyBuf = new TextEncoder().encode(body)
  const full = 9 + bodyBuf.length
  const frame = new Uint8Array(12 + bodyBuf.length + 1)
  const dv = new DataView(frame.buffer)
  dv.setUint32(0, full, true)
  dv.setUint32(4, full, true)
  dv.setUint16(8, 689, true) // client→server
  frame[10] = 0 // encrypted
  frame[11] = 0 // reserved
  frame.set(bodyBuf, 12)
  frame[12 + bodyBuf.length] = 0
  return frame
}

/** STT → 对象(`k@=v/` 切分 + @S/@A 转义;与 dart sttToJObject 单层等价)。 */
function sttParse(str: string): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const field of str.split("/")) {
    if (!field) continue
    const i = field.indexOf("@=")
    if (i < 0) continue
    obj[field.slice(0, i)] = field.slice(i + 2).replace(/@S/g, "/").replace(/@A/g, "@")
  }
  return obj
}

/** 解析一帧 server 数据(690 帧) → 弹幕。 */
function parseDouyuFrame(data: Uint8Array): DanmakuItem[] {
  if (data.length < 12) return []
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const full = dv.getUint32(0, true)
  if (dv.getUint16(8, true) !== 690) return [] // server→client
  const bodyLen = full - 9
  const body = new TextDecoder().decode(data.subarray(12, Math.min(12 + bodyLen, data.length)))
  const obj = sttParse(body)
  if (obj["type"] !== "chatmsg") return []
  // dms 缺失 = 屏蔽弹幕(主播/房管设置的禁言列表,dart 同款跳过)。
  if (obj["dms"] == null) return []
  const col = Number(obj["col"]) || 0
  return [{ text: String(obj["txt"] ?? ""), user: String(obj["nn"] ?? ""), color: DOUYU_COLORS[col] }]
}

/** douyu 弹幕流:订阅即建连(进房+心跳),退订断开。 */
export function douyuDanmakuStream(roomId: string): DanmakuStream {
  return createWsStream({
    url: WS_URL,
    onOpen: (ws) => {
      const send = (body: string): void => {
        ws.send(douyuFrame(body) as unknown as ArrayBufferView<ArrayBuffer>)
      }
      send(`type@=loginreq/roomid@=${roomId}/`)
      send(`type@=joingroup/rid@=${roomId}/gid@=-9999/`)
    },
    heartbeat: () => douyuFrame("type@=mrkl/"),
    heartbeatMs: HEARTBEAT_MS,
    onMessage: (data) => parseDouyuFrame(new Uint8Array(data)),
  })
}
