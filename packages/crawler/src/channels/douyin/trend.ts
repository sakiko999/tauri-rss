/**
 * douyin:trend —— 抖音热点榜 channel(kind: social)。
 *
 * 走 `www.douyin.com/aweme/v1/web/hot/search/list`(**匿名 200**,实测 2026-10):
 * 50 条全站热词(带热度/榜位/封面)。每条一个 Social,title=词,content=热度。
 *
 * ⚠️ **无词流**:点热词展开该词内容需 `live/search`(2483 需登录),故**不实现
 * `HotWordSource`** —— 与 weibo:hot(有词流)不同,这里只做「热点榜」本身。
 * 热词 url 指向抖音搜索页(用户点开在浏览器里搜,需登录由抖音处理)。
 *
 * 相关:`live:douyin:hot` 是**直播热门房间**(kind:live);本 channel 是**全站热点词**
 * (kind:social)。两者不同,勿混。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { fetchDouyinTrends, now } from "@amoeba/resolve"

export class DouyinTrendChannel implements RssChannel {
  readonly key = "douyin:trend"
  readonly name = "抖音热点榜"
  readonly kind = "social" as const
  readonly defaultInfo: SourceInfo = {}

  getSource(_info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(), () => this.channelOptions()),
    }
  }

  private async fetchItems(): Promise<Item[]> {
    const trends = await fetchDouyinTrends()
    const t = now()
    return trends.map((tr): Item => ({
      // id 用词而非下标(刷新后榜位会变,下标作 id 会让同一词反复进库)。
      id: `dy-trend-${tr.word}`,
      sourceId: this.key,
      kind: "social",
      title: tr.word,
      url: `https://www.douyin.com/search/${encodeURIComponent(tr.word)}`,
      content: `#${tr.word}# 热度 ${tr.hotValue ?? "?"}${tr.position ? ` · 榜位 ${tr.position}` : ""}`,
      thumbnail: tr.cover,
      fetchedAt: t,
      raw: { word: tr.word, hotValue: tr.hotValue, position: tr.position },
    }))
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "抖音热点榜", channelLink: "https://www.douyin.com/hot" }
  }
}
