/**
 * bilibili 视频弹幕 —— seg.so 全量懒解析(VOD 时间轴用)。
 *
 * 复用 BilibiliClient:view 接口拿 cid + duration(算段数),逐段抓 seg.so,
 * protobuf 手写 wire 解码(decodeDanmakuSeg)。匿名可用(软风控,带登录 cookie 更稳)。
 * 每段 6 分钟,段数 = ceil(durationSec/360) + 1。
 */
import type { DanmakuItem } from "../../danmaku/types.ts"
import type { DanmakuStream } from "../../index.ts"
import { decodeDanmakuSeg } from "../../danmaku/proto.ts"
import { BILIBILI_UA, createBilibiliClient } from "./client.ts"

const API = "https://api.bilibili.com"
/** 每段弹幕时长,秒。 */
const SEGMENT_SEC = 360

/** 十进制 ARGB → #RRGGBB(对齐 dart LiveMessageColor.numberToColor)。 */
function intColorToHex(intColor: number): string {
  const hex = intColor.toString(16)
  let rrggbb: string
  if (hex.length === 6) rrggbb = hex
  else if (hex.length === 8) rrggbb = hex.slice(2) // 跳 alpha
  else if (hex.length === 4) rrggbb = `00${hex}`
  else rrggbb = "ffffff"
  return `#${rrggbb}`
}

/** 抓一段 seg.so(二进制,走宿主 arraybuffer 隧道)。非 200 / 空段返回 null。 */
async function fetchDanmakuSeg(cid: number, n: number): Promise<Uint8Array | null> {
  const res = await globalThis.appHost.http.request({
    url: `${API}/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=${n}`,
    method: "GET",
    responseType: "arraybuffer",
    headers: { "user-agent": BILIBILI_UA, referer: "https://www.bilibili.com/video/" },
  })
  if (res.status !== 200) return null
  const buf = res.body as Uint8Array | undefined
  return buf && buf.byteLength > 0 ? buf : null
}

/**
 * B站视频弹幕懒解析:bvid/aid → view(cid+duration) → 逐段 seg.so → DanmakuItem[]。
 * 4 个 video channel 的 `resolveDanmaku` 都调它(与 resolveBiliPlay 同范式)。
 */
export async function resolveBiliDanmaku(itemId: string, cookie?: string): Promise<DanmakuItem[]> {
  const client = createBilibiliClient({ cookie })
  const id = itemId.startsWith("av") ? `av${itemId.slice(2)}` : itemId
  const view = await client.getJson<{ data?: { cid?: number; duration?: number } }>(
    `${API}/x/web-interface/view?bvid=${encodeURIComponent(id)}`,
    { referer: `https://www.bilibili.com/video/${itemId}` },
  )
  const cid = view?.data?.cid
  if (!cid) throw new Error(`bilibili danmaku: no cid for ${itemId}`)
  const durationSec = view?.data?.duration ?? 0
  const segments = Math.max(1, Math.ceil(durationSec / SEGMENT_SEC) + 1)

  const items: DanmakuItem[] = []
  for (let n = 1; n <= segments; n++) {
    const buf = await fetchDanmakuSeg(cid, n)
    if (!buf) break
    for (const e of decodeDanmakuSeg(buf)) {
      items.push({ text: e.content, mode: e.mode, timeMs: e.progress, color: intColorToHex(e.color) })
    }
  }
  return items
}

/**
 * bili VOD 弹幕流:订阅时一次性 load 全量推给 onItems(items 带 timeMs,
 * 消费者按播放时间轴过滤)。首轮失败(接口异常)静默。
 */
export function biliDanmakuStream(itemId: string, cookie?: string): DanmakuStream {
  return (onItems) => {
    let stopped = false
    void resolveBiliDanmaku(itemId, cookie)
      .then((items) => {
        if (!stopped && items.length) onItems(items)
      })
      .catch(() => {})
    return () => {
      stopped = true
    }
  }
}
