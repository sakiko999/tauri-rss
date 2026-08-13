/**
 * douyin 弹幕 protobuf —— PushFrame/Response/Message/ChatMessage 手写 wire 解码。
 *
 * 字段号来自 dart douyin.pb.dart(已逐类核对):
 *   PushFrame:seqId=1 logId=2 service=3 method=4 headersList=5 payloadEncoding=6
 *              payloadType=7 payload=8(bytes)
 *   Response:messagesList=1(repeated Message) cursor=2 fetchInterval=3 now=4
 *             internalExt=5 fetchType=6 routeParams=7 heartbeatDuration=8
 *             needAck=9 pushServer=10
 *   Message:method=1(string) payload=2(bytes) msgId=3 msgType=4
 *   ChatMessage:common=1(Common) user=2(User) content=3
 *   User:id=1 shortId=2 nickName=3
 *
 * 帧链路:PushFrame{logId, payload} → payload 是 gzip → Response{messagesList, needAck,
 * internalExt};needAck=true 时回 ack(修正 dart sendAck 的 payloadType 被覆盖 bug)。
 */
import type { DanmakuItem } from "../index.ts"

// wire format:tag = varint(field<<3 | wireType);0=varint,1=64bit,2=length,5=32bit。

/** 编解码复用单例(每帧热路径,全量 decode 会重置内部状态,共享安全)。 */
const TE = new TextEncoder()
const TD = new TextDecoder()

/** 遍历 protobuf 消息所有字段。bytes=length 内容(仅 wire2);varint=varint 值(仅 wire0)。 */
function* protoFields(buf: Uint8Array): Generator<{ field: number; wire: number; bytes: Uint8Array; varint: number }> {
  let p = 0
  const varint = (): number => {
    let v = 0
    let s = 0
    while (p < buf.length) {
      const b = buf[p++]!
      v |= (b & 0x7f) << s
      if ((b & 0x80) === 0) break
      s += 7
    }
    return v >>> 0
  }
  const empty = new Uint8Array(0)
  while (p < buf.length) {
    const tag = varint()
    const field = tag >>> 3
    const wire = tag & 7
    if (wire === 0) {
      yield { field, wire, varint: varint(), bytes: empty }
    } else if (wire === 2) {
      const len = varint()
      const bytes = buf.subarray(p, p + len)
      p += len
      yield { field, wire, varint: 0, bytes }
    } else if (wire === 1) {
      p += 8
      yield { field, wire, varint: 0, bytes: empty }
    } else if (wire === 5) {
      p += 4
      yield { field, wire, varint: 0, bytes: empty }
    } else {
      break // group 类型(3/4)跳过
    }
  }
}

function pbString(buf: Uint8Array, field: number): string {
  for (const f of protoFields(buf)) {
    if (f.field === field && f.wire === 2) return TD.decode(f.bytes)
  }
  return ""
}
function pbBytes(buf: Uint8Array, field: number): Uint8Array | null {
  for (const f of protoFields(buf)) {
    if (f.field === field && f.wire === 2) return f.bytes
  }
  return null
}

// ── 编码(发送 hb/ack) ───────────────────────────────────────────────────

function varintEncode(n: number): Uint8Array {
  const out: number[] = []
  let v = n >>> 0
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v)
  return Uint8Array.from(out)
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}
function pbFieldString(field: number, s: string): Uint8Array {
  const bytes = TE.encode(s)
  return concat(varintEncode((field << 3) | 2), varintEncode(bytes.length), bytes)
}
function pbFieldBytes(field: number, bytes: Uint8Array): Uint8Array {
  return concat(varintEncode((field << 3) | 2), varintEncode(bytes.length), bytes)
}

/** 心跳/进房帧:PushFrame{payloadType:"hb"}(10s;进房同款,无独立认证帧)。 */
export function douyinHeartbeatFrame(): Uint8Array {
  return pbFieldString(7, "hb")
}

/** ack 帧:PushFrame{logId, payloadType:"ack", payload:internalExt}(dart sendAck 的修正版)。 */
export function douyinAckFrame(logId: number, internalExt: string): Uint8Array {
  return concat(
    pbFieldString(2, String(logId)),
    pbFieldString(7, "ack"),
    pbFieldBytes(8, TE.encode(internalExt)),
  )
}

/** gzip 解压(DecompressionStream,浏览器/Node 18+ 内置)。失败原样返回(非 gzip 帧)。 */
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  try {
    const ds = new DecompressionStream("gzip")
    const stream = new Blob([data as unknown as ArrayBufferView<ArrayBuffer>]).stream().pipeThrough(ds)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return data
  }
}

/**
 * 解析一帧 PushFrame → 弹幕。需要 ack 时回调发送 ack 帧。
 * 链路:PushFrame{logId, payload} → gzip → Response{needAck, internalExt, messagesList[]}
 * → Message{method=="WebcastChatMessage", payload} → ChatMessage{user.nickName, content}。
 */
export async function decodeDouyinPushFrame(buf: Uint8Array, onAck: (frame: Uint8Array) => void): Promise<DanmakuItem[]> {
  let logId = 0
  let payload: Uint8Array | null = null
  for (const f of protoFields(buf)) {
    if (f.field === 2 && f.wire === 0) logId = f.varint
    else if (f.field === 8 && f.wire === 2) payload = f.bytes
  }
  if (!payload) return []
  const resp = await gunzip(payload)

  // Response:needAck(field9 varint), internalExt(field5 string), messagesList(field1 repeated)。
  let needAck = false
  let internalExt = ""
  for (const f of protoFields(resp)) {
    if (f.field === 9 && f.wire === 0) needAck = f.varint !== 0
    else if (f.field === 5 && f.wire === 2) internalExt = TD.decode(f.bytes)
  }
  if (needAck && logId) onAck(douyinAckFrame(logId, internalExt))

  const items: DanmakuItem[] = []
  for (const f of protoFields(resp)) {
    if (f.field !== 1 || f.wire !== 2) continue // messagesList[i]
    if (pbString(f.bytes, 1) !== "WebcastChatMessage") continue
    const msgPayload = pbBytes(f.bytes, 2)
    if (!msgPayload) continue
    // ChatMessage:user(field2 → User.nickName=field3), content(field3)。
    let nick = ""
    let content = ""
    for (const cf of protoFields(msgPayload)) {
      if (cf.field === 2 && cf.wire === 2) {
        for (const uf of protoFields(cf.bytes)) {
          if (uf.field === 3 && uf.wire === 2) nick = TD.decode(uf.bytes)
        }
      } else if (cf.field === 3 && cf.wire === 2) {
        content = TD.decode(cf.bytes)
      }
    }
    if (content) items.push({ text: content, user: nick })
  }
  return items
}
