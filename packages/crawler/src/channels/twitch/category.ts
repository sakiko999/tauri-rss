/**
 * twitch:category —— Twitch 分区直播(匿名 GraphQL `game(slug).streams`)。
 *
 * 参数 `category` 接受裸 slug(`just-chatting`)或目录页链接;归一化见
 * resolve 的 `normalizeTwitchCategory`。支持游标翻页(fetchMore,见 streams.ts)。
 * 不实现 fetchPassive / Loginable / passive。
 * 分类目录另见 `categories.ts`(`twitch:categories`,产 kind:"category" 条目)。
 */
import { type SerializeOptions } from "@amoeba/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { fetchTwitchCategoryStreams, normalizeTwitchCategory } from "@amoeba/resolve"
import { createTwitchStreamsSource } from "./streams.ts"

export class TwitchCategoryChannel implements RssChannel {
  readonly key = "twitch:category"
  readonly name = "Twitch 分区直播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [
    {
      key: "category",
      label: "分类 slug 或目录链接",
      required: true,
      placeholder: "just-chatting 或 twitch.tv/directory/category/just-chatting",
    },
  ]

  getSource(info: SourceInfo): RssSource & Partial<Pageable> {
    const raw = String(info.category ?? "")
    return createTwitchStreamsSource({
      sourceId: this.key,
      channelOptions: () => this.channelOptions(raw),
      fetchPage: async (after) => {
        const slug = normalizeTwitchCategory(raw)
        if (!slug) throw new Error(`twitch:category 分类无效(${raw.trim() || "空"})`)
        return fetchTwitchCategoryStreams(slug, 30, after)
      },
    })
  }

  private channelOptions(raw: string): SerializeOptions {
    const slug = normalizeTwitchCategory(raw)
    return {
      channelTitle: slug ? `Twitch 分区 ${slug}` : "Twitch 分区",
      channelLink: slug ? `https://www.twitch.tv/directory/category/${slug}` : "https://www.twitch.tv/directory",
    }
  }
}
