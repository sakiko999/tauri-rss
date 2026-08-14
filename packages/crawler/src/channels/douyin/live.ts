/**
 * douyin 直播房间 channel —— HTTP + ABogus 签名(host.js)。
 *
 * 复刻 producer 的 DouyinSite:对 `live.douyin.com/webcast/...` 请求用 host.js
 * 执行 ABOGUS_JS 里的 `getABogus(query, UA)` 生成 a_bogus 参数;ttwid cookie 由
 * 首页 warmup 抓取(memoized)。
 *
 * 产 Live Item(状态 + 元数据);resolveLivePlay 懒解析走 platform/douyin/stream.ts
 * 的 douyinResolveStreams(enter → reflow → HTML 三级降级,每次独立取新鲜签名直链)。
 * liveStatus 判定:**status==2 才是直播中**(复刻 dart,实测在播房间返回 2);
 * status==4 是 roomId 一次性、需改用 webRid,非直播中。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { log } from "../../log.ts"
import { toInt } from "../../utils/number.ts"
import { parseRoomIds } from "../../utils/room-ids.ts"
import { strOr } from "../../utils/str.ts"
import { douyinClient, douyinResolveStreams, fetchRoom } from "../../platform/douyin"


const LIVE = "https://live.douyin.com"

export class DouyinLiveChannel implements RssChannel {
  readonly key = "live:douyin"
  readonly name = "抖音直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomIds", label: "直播间 ID(逗号分隔,可多个)", required: true }]
  // 直播源:implements LivePlayable + DanmakuPlayable。resolveLivePlay 走平台层
  // douyinResolveStreams(enter/reflow/HTML 三级降级);getDanmaku 走 client。
  // fetch 支持多房间(roomIds 逗号分隔);resolveLivePlay/getDanmaku 本就是按 roomId
  // 工作的纯函数,天然支持任一房间。hot channel 通过 liveHotSource 委托复用。
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolveLivePlay: douyinResolveStreams,
      getDanmaku: (roomId) => douyinClient.getDanmaku(roomId),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomIds = parseRoomIds(info)
    if (!roomIds.length) throw new Error("live:douyin 需要 roomIds")
    const t = now()
    const rooms = await Promise.all(
      roomIds.map((roomId) =>
        this.fetchOne(roomId).catch((e) => {
          log.douyin.warn(`房间 ${roomId} 拉取失败,跳过:`, (e as Error)?.message)
          return null
        }),
      ),
    )
    return rooms.filter((r): r is Live => r !== null).map((live) => ({ ...live, fetchedAt: t }))
  }

  /** 单房间 → Live item(enter API;房间失败抛错,由调用方 catch 隔离)。 */
  private async fetchOne(roomId: string): Promise<Live> {
    const res = await fetchRoom(roomId)
    const room = (res?.data?.data?.[0] ?? res?.data?.room ?? {}) as Record<string, any>
    const user = (res?.data?.data?.[0]?.user ?? res?.data?.user ?? {}) as Record<string, any>
    const streamUrl = (room.stream_url ?? {}) as Record<string, any>
    // douyin room.status 语义:2=直播中(复刻 dart,实测 217952067344 在播时 status=2)。
    // 4=roomId 一次性(需改用 webRid,见 dart getRoomDetailByRoomId),非直播中。
    const isLive = toInt(room.status) === 2

    return {
      // id 用长号 id_str(唯一稳定);roomId 必须用订阅传入的 web_rid(短号)——
      // douyin 的 enter API / HTML 页面 / resolveLivePlay 都用 web_rid,不是 room_id。
      id: `douyin:${String(room.id_str ?? roomId)}`,
      sourceId: "live:douyin",
      kind: "live",
      title: String(room.title ?? ""),
      url: `${LIVE}/${roomId}`,
      thumbnail: String(streamUrl?.default?.push_hd?.main?.[0]?.flv ?? room?.cover?.url_list?.[0] ?? ""),
      author: { name: String(user.nickname ?? ""), avatar: String(user?.avatar_thumb?.url_list?.[0] ?? "") || undefined },
      fetchedAt: now(),
      platform: "douyin",
      roomId: String(roomId),
      liveStatus: isLive ? "live" : "offline",
      online: toInt(room?.room_view_stats?.display_value),
      introduction: strOr(room.intro),
      // stream_url 藏 play 数据,供下游 getPlayQualities/Urls(本地解析)。
      raw: streamUrl,
    }
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `抖音直播 ${String(info.roomIds ?? info.roomId ?? "")}`, channelLink: `${LIVE}/${String(info.roomIds ?? info.roomId ?? "")}` }
  }
}
