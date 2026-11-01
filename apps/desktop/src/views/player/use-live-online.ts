/**
 * 直播观看页的人气实时刷新。
 *
 * 条目里的 `online` 是订阅抓取那一刻的读数;看直播时它会立刻过期。这里在播放页
 * 存活期间按固定间隔用 `previewChannel` 重新取一次**同一房间**的元数据(不写入
 * 订阅、不动缓存),只把 `online` 提到界面上。
 *
 * ⚠️ 失败一律静默保留上次读数:人气不是主功能,网络/风控错误不该打断播放。
 * ⚠️ 页面隐藏时跳过请求(省配额;回前台后下一拍恢复)。
 */

import type { LiveItem, MediaItem } from "@amoeba/core"
import { platformOfHost } from "@amoeba/platform"
import { useEffect, useState } from "react"

import { itemKey, onlineOf } from "../../lib/media.ts"
import { LIVE_SUB_CHANNEL } from "../../lib/subscriptions.ts"
import { useDesktop } from "../../store/index.ts"

/** 轮询间隔:平台元数据接口都便宜,但别到风控阈值。 */
const POLL_MS = 30_000
/** 打开播放页时订阅刷新刚取过,先等一拍再重复请求。 */
const FIRST_DELAY_MS = 8_000

/** 条目 URL → 平台表 id("bili" / "douyu" / …);解析失败给空串。 */
function platformOfItem(item: MediaItem): string {
  try {
    return platformOfHost(new URL(String(item.url)).host)
  } catch {
    return ""
  }
}

export function useLiveOnline(item: MediaItem | null | undefined): number | undefined {
  const dl = useDesktop((s) => s.dl)
  const key = item ? itemKey(item) : ""
  const isLive = item?.kind === "live"
  const roomId = isLive ? String((item as LiveItem).roomId ?? "") : ""
  // LiveItem.platform 是 "bilibili" 这种展示名,订阅渠道表用的是平台表 id("bili");
  // 用 URL 域名走 platformOfHost,避免再抄一张别名表。
  const platform = isLive && item?.url ? platformOfItem(item) : ""
  const initial = item ? onlineOf(item) : undefined
  const [online, setOnline] = useState<number | undefined>(initial)

  // 换条目:先回到条目自带的读数(列表抓取时的人气),再等轮询更新。
  useEffect(() => {
    setOnline(initial)
  }, [key, initial])

  useEffect(() => {
    if (!dl || !roomId || !platform) return
    const channelKey = LIVE_SUB_CHANNEL[platform]
    if (!channelKey) return
    // 直播渠道的首个必填参数就是房间标识(roomIds / videoId),不在这里另抄一张表。
    const field = dl.listChannels().find((c) => c.key === channelKey)?.sourceInfoTpl?.[0]?.key
    if (!field) return

    let stopped = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const r = await dl.previewChannel(channelKey, { [field]: roomId })
        if (stopped) return
        const hit = (r.items as LiveItem[]).find((i) => String(i.roomId ?? "") === roomId) ?? r.items[0]
        const n = hit ? onlineOf(hit as MediaItem) : undefined
        if (n !== undefined) setOnline(n)
      } catch {
        // 保留上次读数(见文件头)。
      }
    }
    const first = setTimeout(() => void tick(), FIRST_DELAY_MS)
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      stopped = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [dl, key, roomId, platform])

  return online
}
