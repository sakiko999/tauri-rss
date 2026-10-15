/**
 * apple:podcast-chart —— Apple 播客热门榜(按分类)。
 *
 * Apple 目录是**元数据源**:榜单给的是「节目」,不是「单集」。本 channel 把它们
 * 归一成 `kind: audio` 的 Item,`url` = 该节目**的 RSS feed** ——
 * 这样订阅它就能走既有的 `rss:podcast` 那条路(不另造解析器)。
 *
 * ⚠️ 每集的 audio enclosure **不在榜单里**(要拉每个 feed 才知道)。逐条拉
 * 20 个 feed 只为拿一个直链,对上游不礼貌且慢 —— 故 `stream` 留空,卡片不进播放页,
 * 点开走「打开原文」去 Apple 页 + RSS。后续真要进播放页,应做成**懒解析**
 * (像 by-url 那样点了才解析),而不是在 fetch 里批量拉。
 */
import type { Audio, Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { APPLE_PODCAST_GENRES, fetchApplePodcastChart, now } from "@tauri-playground/resolve"

export class ApplePodcastChartChannel implements RssChannel {
  readonly key = "apple:podcast-chart"
  readonly name = "Apple 播客热门榜"
  readonly kind = "audio" as const
  readonly defaultInfo: SourceInfo = { genre: "26" }
  readonly sourceInfoTpl = [
    {
      key: "genre",
      label: `分类(${APPLE_PODCAST_GENRES.map((g) => `${g.id}=${g.label}`).join(" / ")})`,
      required: false,
    },
    { key: "country", label: "国家区(如 cn / us),默认 cn", required: false },
    { key: "limit", label: "条数(默认 20,最多 100)", required: false },
  ]

  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const genre = Number(info.genre ?? 26) || 26
    const country = String(info.country ?? "cn").trim() || "cn"
    // 上限 100:再大 Apple 也会截断,且 Lookup 的 URL 会过长。
    const limit = Math.min(Math.max(Number(info.limit ?? 20) || 20, 1), 100)

    const podcasts = await fetchApplePodcastChart(genre, limit, country)
    const t = now()
    return podcasts.map((p, i): Audio => ({
      // ⚠️ id 用 Apple 目录 id(稳定),不用榜位 —— 榜位每天都变,当下标会让同一节目
      // 反复以「新条目」进库。
      id: `apple-podcast-${p.id}`,
      sourceId: this.key,
      kind: "audio",
      title: p.title,
      // url = **节目的 RSS feed**:订阅它即走 rss:podcast,点开也能直接看到 feed。
      url: p.feedUrl,
      thumbnail: p.artwork,
      author: p.author ? { name: p.author } : undefined,
      summary: `${p.author}${p.genre ? ` · ${p.genre}` : ""}${p.episodeCount ? ` · ${p.episodeCount} 集` : ""}`,
      fetchedAt: t,
      artist: p.author || undefined,
      // raw 里带榜位与 Apple 页,供 UI/调试;不参与 tpl: 契约。
      raw: { rank: i + 1, appleId: p.id, pageUrl: p.pageUrl, feedUrl: p.feedUrl },
    }))
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    const g = APPLE_PODCAST_GENRES.find((x) => String(x.id) === String(info.genre ?? 26))
    return {
      channelTitle: `${this.name}${g && g.id !== 26 ? ` · ${g.label}` : ""}`,
      channelLink: "https://podcasts.apple.com/",
    }
  }
}
