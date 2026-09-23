/**
 * douyin 分区房间 —— 按分区列直播间(参数化 `partition` + `partition_type`)。
 *
 * 与 `hot.ts` 同接口(`partition/detail/room/v2` + ABogus),差别只在分区参数:
 * hot.ts 硬编码「综合」(partition=720, type=1);本 channel 由用户给分区 id。
 *
 * ⚠️ **partition_type 必须与 id 配套**(实测 2026-09):顶层分区(聊天/音乐/游戏…)
 * type=4,子分区(射击游戏/竞技游戏…)type=1。传错取不到数据。分区树见
 * `resolve/platform/douyin/category.ts`(`fetchDouyinCategories`)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore } from "../factory.ts"
import { now } from "@tauri-playground/resolve"
import { douyinClient } from "@tauri-playground/resolve"

const LIVE = "https://live.douyin.com"
const COUNT = 15

export class DouyinCategoryChannel implements RssChannel {
  readonly key = "live:douyin:category"
  readonly name = "抖音分区直播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [
    { key: "partition", label: "分区 ID(如 1=射击游戏、101=聊天)", required: true },
    { key: "partitionType", label: "分区类型(顶层 4 / 子分区 1)", required: true, placeholder: "1" },
  ]

  getSource(info: SourceInfo): RssSource & Pageable {
    return {
      fetch: apiFetch(() => this.fetchItems(info, 0), () => this.channelOptions(info)),
      fetchMore: apiFetchMore(
        (offset) => this.fetchItems(info, offset),
        () => this.channelOptions(info),
        { first: COUNT, step: COUNT },
      ),
    }
  }

  private async fetchItems(info: SourceInfo, offset: number): Promise<Item[]> {
    const partition = String(info.partition ?? "").trim()
    const partitionType = String(info.partitionType ?? "1").trim()
    if (!partition) throw new Error("douyin:category 需要 partition 参数")
    const params = new URLSearchParams({
      aid: "6383",
      app_name: "douyin_web",
      live_id: "1",
      device_platform: "web",
      language: "zh-CN",
      enter_from: "link_share",
      cookie_enabled: "true",
      screen_width: "1980",
      screen_height: "1080",
      browser_language: "zh-CN",
      browser_platform: "Win32",
      browser_name: "Edge",
      browser_version: "125.0.0.0",
      browser_online: "true",
      count: String(COUNT),
      offset: String(offset),
      partition,
      partition_type: partitionType,
      req_from: "2",
    })
    const res = await douyinClient.getJson<{ data?: { data?: Array<Record<string, any>> } }>(
      `${LIVE}/webcast/web/partition/detail/room/v2/?${params.toString()}`,
      { referer: LIVE },
    )
    const t = now()
    const list = Array.isArray(res?.data?.data) ? res.data.data : []
    return list.map((item): Live => {
      const room = (item.room ?? {}) as Record<string, any>
      const webRid = String(item.web_rid ?? "")
      const owner = (room.owner ?? {}) as Record<string, any>
      const viewStats = (room.room_view_stats ?? {}) as Record<string, any>
      const coverList = Array.isArray(room.cover?.url_list) ? (room.cover.url_list as unknown[]) : []
      return {
        id: `douyin:${webRid}`,
        sourceId: "live:douyin:category",
        kind: "live",
        title: String(room.title ?? ""),
        url: `${LIVE}/${webRid}`,
        thumbnail: coverList[0] ? String(coverList[0]) : undefined,
        author: owner.nickname ? { name: String(owner.nickname) } : undefined,
        fetchedAt: t,
        platform: "douyin",
        roomId: webRid,
        liveStatus: "live",
        online: Number(viewStats.display_value ?? 0),
      }
    })
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `抖音分区直播 ${info.partition ?? ""}`, channelLink: LIVE }
  }
}
