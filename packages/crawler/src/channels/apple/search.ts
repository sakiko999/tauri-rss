/**
 * apple:podcast-search —— 按关键词搜 Apple 播客节目。
 *
 * 与 chart 的区别:`search` 接口**直接返回 `feedUrl`**(不需二次 Lookup),
 * 所以这里少一次往返。产出与 chart 同构(`kind: audio`,`url` = 节目 RSS)。
 */
import type { Audio, Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now, searchApplePodcasts } from "@tauri-playground/resolve"

export class ApplePodcastSearchChannel implements RssChannel {
  readonly key = "apple:podcast-search"
  readonly name = "Apple 播客搜索"
  readonly kind = "audio" as const
  // ⚠️ **刻意不声明 `defaultInfo`** —— 发现页的「可订阅榜单」判据是
  // `!!defaultInfo || 无必填项`,而**空对象是 truthy**。写了 `= {}` 会让这个
  // 需要 q 参数的渠道被误列进「一键订阅」,点下去必然失败。
  // (同 `bili:search`:它也不声明 defaultInfo,靠 `required: true` 排除。)
  readonly sourceInfoTpl = [
    { key: "q", label: "关键词", required: true },
    { key: "country", label: "国家区(如 cn / us),默认 cn", required: false },
    { key: "limit", label: "条数(默认 20,最多 100)", required: false },
  ]

  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const q = String(info.q ?? "").trim()
    if (!q) throw new Error("apple:podcast-search 需要 q 参数")
    const country = String(info.country ?? "cn").trim() || "cn"
    const limit = Math.min(Math.max(Number(info.limit ?? 20) || 20, 1), 100)

    const podcasts = await searchApplePodcasts(q, limit, country)
    const t = now()
    return podcasts.map((p): Audio => ({
      id: `apple-podcast-${p.id}`,
      sourceId: this.key,
      kind: "audio",
      title: p.title,
      url: p.feedUrl,
      thumbnail: p.artwork,
      author: p.author ? { name: p.author } : undefined,
      summary: `${p.author}${p.genre ? ` · ${p.genre}` : ""}${p.episodeCount ? ` · ${p.episodeCount} 集` : ""}`,
      fetchedAt: t,
      artist: p.author || undefined,
      raw: { appleId: p.id, pageUrl: p.pageUrl, feedUrl: p.feedUrl },
    }))
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `${this.name} · ${String(info.q ?? "")}`, channelLink: "https://podcasts.apple.com/" }
  }
}
