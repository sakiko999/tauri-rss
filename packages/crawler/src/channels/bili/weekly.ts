/**
 * bili:weekly —— B站每周必看(video channel)。
 *
 * app 接口拿 series 列表 + 期内容。implements VideoPlayable + DanmakuPlayable。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, RssChannel, RssSource, SourceInfo, VideoPlayable } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { biliClient } from "../../platform/bili"
import { resolveBiliPlay, ugc } from "./video-common.ts"

export class BiliWeeklyChannel implements RssChannel {
  readonly key = "bili:weekly"
  readonly name = "B站每周必看"
  readonly kind = "video" as const
  getSource(info: SourceInfo): RssSource & VideoPlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: (itemId) => resolveBiliPlay(itemId, info),
      getDanmaku: (itemId) =>
        biliClient.getDanmaku(itemId, { kind: "vod", cookie: info.cookie || undefined }),
    }
  }
  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const status = await biliClient.getJson<{ data?: Array<{ number: number; name: string }> }>(
      "https://app.bilibili.com/x/v2/show/popular/selected/series?type=weekly_selected",
      { referer: "https://www.bilibili.com/h5/weekly-recommend" },
    )
    // app 版接口的 data 直接是 series 数组(不是 data.data 两层)。
    const series = status?.data ?? []
    const head = series[0]
    if (!head) throw new Error("bilibili weekly: no series")
    const data = await biliClient.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
      `https://app.bilibili.com/x/v2/show/popular/selected?type=weekly_selected&number=${head.number}`,
      { referer: `https://www.bilibili.com/h5/weekly-recommend?num=${head.number}&navhide=1` },
    )
    const list = data?.data?.list ?? []
    const t = now()
    return list.map((raw) =>
      ugc("bili:weekly", t, {
        title: raw.title,
        pic: raw.cover,
        desc: `${head.name} ${raw.title} - ${raw.rcmd_reason ?? ""}`,
        pubdate: 0,
        aid: raw.param,
        bvid: raw.bvid,
        forceBvid: head.number > 60,
      }),
    )
  }
  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "B站每周必看", channelLink: "https://www.bilibili.com/h5/weekly-recommend" }
  }
}
