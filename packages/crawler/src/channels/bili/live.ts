/**
 * bili:live —— bilibili 直播房间 channel。
 *
 * 复刻 producer 的 BilibiliSite.getRoomDetail(wbi 签名 + buvid cookie),
 * 产单个 Live Item(状态 + 元数据,不含 playUrls——懒解析)。零登录。
 *
 * ⚠️ 能力抽离:本 channel **只输出 Live item 基础信息**(与 rsshub 一致)。
 * 可播流/弹幕解析在 crawler/src/resolver(按 item.url 路由 → platform/bili)。
 * resolveBiliLivePlay + helpers 已迁 platform/bili/live-play.ts。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "@tauri-playground/resolve"
import { log } from "@tauri-playground/resolve"
import { parseRoomIds } from "@tauri-playground/resolve"
import { biliClient } from "@tauri-playground/resolve"

const API_LIVE = "https://api.live.bilibili.com"

/**
 * 单房间 → Live item(getInfoByRoom)。独立纯函数(hot channel 委托 fetch 时对每个
 * 热门房间调用)。⚠️ 该方法**不抛错**:无直播信息/接口异常时返回 null(多房间一个失败
 * 不拖垮全部,单房间订阅由上层把 null 过滤后的空结果处理)。
 */
async function fetchBiliRoom(roomId: string, cookie?: string): Promise<Live | null> {
  try {
    const params = await biliClient.signLiveParams({ room_id: roomId }, cookie)
    const res = await biliClient.getJson<{ data?: Record<string, unknown> }>(
      `${API_LIVE}/xlive/web-room/v1/index/getInfoByRoom?${params}`,
      { referer: "https://live.bilibili.com/", buvid: true, cookie },
    )
    const ri = (res?.data?.["room_info"] ?? {}) as Record<string, unknown>
    const realRoomId = String(ri["room_id"] ?? roomId)
    return {
      id: `bilibili:${realRoomId}`,
      sourceId: "bili:live",
      kind: "live",
      title: String(ri["title"] ?? ""),
      url: `https://live.bilibili.com/${realRoomId}`,
      thumbnail: String(ri["cover"] ?? ""),
      author: { name: String(ri["uname"] ?? "") },
      fetchedAt: now(),
      platform: "bilibili",
      roomId: realRoomId,
      liveStatus: Number(ri["live_status"]) === 1 ? "live" : "offline",
      online: Number(ri["online"] ?? 0),
      introduction: ri["description"] ? String(ri["description"]) : undefined,
      showTime: ri["live_start_time"] ? String(ri["live_start_time"]) : undefined,
    }
  } catch (e) {
    log.biliLive.warn(`房间 ${roomId} 拉取失败:`, (e as Error)?.message)
    return null
  }
}

export class BiliLiveChannel implements RssChannel {
  readonly key = "bili:live"
  readonly name = "bilibili 直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [
    { key: "roomIds", label: "直播间 ID(逗号分隔,可多个)", required: true },
    {
      key: "cookie",
      label: "登录 cookie(可选)",
      required: false,
      // 提示:从浏览器 bilibili.com 已登录页面复制完整 cookie 串,解锁登录档位(非大会员 1080p)。
    },
  ]
  // 仅输出 Live item;流/弹幕统一走 crawler/resolver(按 item.url)。
  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomIds = parseRoomIds(info)
    if (!roomIds.length) throw new Error("bili:live 需要 roomIds")
    const t = now()
    const rooms = await Promise.all(roomIds.map((roomId) => fetchBiliRoom(roomId, info.cookie as string | undefined)))
    return rooms.filter((r): r is Live => r !== null).map((live) => ({ ...live, fetchedAt: t }))
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `bilibili 直播 ${String(info.roomIds ?? info.roomId ?? "")}`, channelLink: "https://live.bilibili.com/" }
  }
}