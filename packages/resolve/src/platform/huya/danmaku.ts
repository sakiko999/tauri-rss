/**
 * huya 弹幕 —— wss://cdnws.api.huya.com + Tars 编解码(probe 实测原生握手可连)。
 *
 * 进房参数(ayyuid/topSid/subSid)来自房间页 HNF_GLOBAL_INIT(与播放解析同源):
 *   ayyuid = tLiveInfo.lYyid;topSid/subSid = roomInfo 顶层(缺失用 lChannelId 正则兜底)。
 * 进房 = Tars wscmd{tag0=1, tag1=bytes(进房数据)};进房数据 8 字段(dart getJoinData)。
 * 心跳固定字节 60s;消息外层 tag0=type(7)→ tag1=HYPushMessage{uri, msg} →
 * uri=1400 → HYMessage{userInfo.nickName, content, bulletFormat.fontColor}。
 */
import { createWsStream, deferredStream } from "../../danmaku"
import type { DanmakuStream } from "../../danmaku"
import { decodeHuyaDanmakuFrame, TarsWriter } from "./danmaku-tars.ts"
import { log } from "../../log.ts"
import { M_HUYA, huyaClient } from "./client.ts"

const WS_URL = "wss://cdnws.api.huya.com"
/** 心跳间隔,ms(固定字节,60s)。 */
const HEARTBEAT_MS = 60000
/** 心跳固定字节(dart base64.decode("ABQdAAwsNgBM"))。 */
const HEARTBEAT = Uint8Array.from([0x00, 0x14, 0x1d, 0x00, 0x0c, 0x2c, 0x36, 0x00])

/** 弹幕进房参数。 */
interface HuyaDanmakuArgs {
  ayyuid: number
  topSid: number
  subSid: number
}

/**
 * 从房间页提取进房参数。⚠️ HNF_GLOBAL_INIT 里 lYyid/lUid 常被置 0(隐私保护),
 * 真实值用 HTML 正则(dart _getRoomInfo 同款):ayyuid=lYyid、topSid=lChannelId、
 * subSid=lSubChannelId。直播房间才带 tid/sid;未直播(或字段缺失)时用 ayyuid 兜底,
 * 保证连接尝试(未直播服务器无弹幕,不报错)。
 */
async function fetchHuyaDanmakuArgs(roomId: string): Promise<HuyaDanmakuArgs> {
  const html = await huyaClient.getHtml(`${M_HUYA}/${roomId}`)
  const ayyuid = Number(html.match(/lYyid":([0-9]+)/)?.[1] ?? 0)
  const topSid = Number(html.match(/lChannelId":([0-9]+)/)?.[1] ?? 0)
  const subSid = Number(html.match(/lSubChannelId":([0-9]+)/)?.[1] ?? 0)
  if (!ayyuid) throw new Error(`huya danmaku: 无 lYyid(房间 ${roomId} 异常)`)
  return { ayyuid, topSid: topSid || ayyuid, subSid: subSid || ayyuid }
}

/** 编码进房帧(wscmd{tag0=1, tag1=进房数据};dart getJoinData 同构)。 */
function encodeHuyaJoin(args: HuyaDanmakuArgs): Uint8Array {
  const join = new TarsWriter()
  join.writeInt(args.ayyuid, 0)
  join.writeBool(true, 1)
  join.writeString("", 2)
  join.writeString("", 3)
  // dart: getJoinData(ayyuid, topSid, topSid) —— tid/sid 都传 topSid。
  join.writeInt(args.topSid, 4)
  join.writeInt(args.topSid, 5)
  join.writeInt(0, 6)
  join.writeInt(0, 7)
  const wscmd = new TarsWriter()
  wscmd.writeInt(1, 0)
  wscmd.writeBytes(join.bytes, 1)
  return wscmd.bytes
}

/** huya 弹幕流:订阅时页面解析进房参数 → 建 WS(进房+心跳),退订断开。 */
export function huyaDanmakuStream(roomId: string): DanmakuStream {
  return deferredStream(
    () => fetchHuyaDanmakuArgs(roomId),
    (args, onItems) =>
      createWsStream({
        url: WS_URL,
        onOpen: (ws) => {
          ws.send(encodeHuyaJoin(args))
        },
        heartbeat: () => HEARTBEAT,
        heartbeatMs: HEARTBEAT_MS,
        onMessage: (data) => decodeHuyaDanmakuFrame(new Uint8Array(data)),
      })(onItems),
    (e) => log.huya.warn("弹幕初始化失败(未开播?):", (e as Error)?.message),
  )
}
