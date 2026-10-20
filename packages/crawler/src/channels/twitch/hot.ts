/**
 * twitch:hot —— Twitch 热门直播(匿名 GraphQL,按观看数降序)。
 *
 * 无参数;支持游标翻页(`fetchMore`,见 streams.ts)。只输出 Live item,
 * 播放走 resolver by-url。不实现 fetchPassive / Loginable / passive。
 */
import { type SerializeOptions } from "@amoeba/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { fetchTwitchTopStreams } from "@amoeba/resolve"
import { createTwitchStreamsSource } from "./streams.ts"

export class TwitchHotChannel implements RssChannel {
  readonly key = "twitch:hot"
  readonly name = "Twitch 热门直播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = []

  getSource(_info: SourceInfo): RssSource & Partial<Pageable> {
    return createTwitchStreamsSource({
      sourceId: this.key,
      channelOptions: () => this.channelOptions(),
      fetchPage: (after) => fetchTwitchTopStreams(30, after),
    })
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "Twitch 热门直播", channelLink: "https://www.twitch.tv/directory" }
  }
}
