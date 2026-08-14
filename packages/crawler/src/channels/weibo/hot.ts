/**
 * weibo:hot —— 微博实时热搜 channel(kind: social)。
 *
 * 热搜榜走 PC 端 `weibo.com/ajax/statuses/hot_band`(匿名 200,50 词带热度 num)。
 * 每个热搜词一条 Social(无图,title=词,content=热度,raw 存 word 供点击加载)。
 * 点热搜词 → resolveHotWord(word):`container/getIndex?containerid=100103type=1&q={word}`
 * 搜索该词微博流(需完整登录 cookie)。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { HotWordSource, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpJson, now } from "../../host.ts"
import { PC_UA, WB_BASE, mblogCardsToItems, weiboClient } from "../../platform/weibo"

export class WeiboHotChannel implements RssChannel {
  readonly key = "weibo:hot"
  readonly name = "微博实时热搜"
  readonly kind = "social" as const
  readonly defaultInfo: SourceInfo = {}
  getSource(info: SourceInfo): RssSource & HotWordSource {
    const cookie = (info.cookie as string) || undefined
    return {
      fetch: apiFetch(() => this.fetchItems(), () => this.channelOptions()),
      resolveHotWord: (word) => this.resolveHotWordImpl(word, cookie),
    }
  }

  private async fetchItems(): Promise<Item[]> {
    // PC 端 hot_band:匿名 200,无需 cookie。
    const body = await httpJson<{ data?: { band_list?: any[] } }>("https://weibo.com/ajax/statuses/hot_band", {
      "User-Agent": PC_UA,
      Referer: "https://weibo.com/",
    })
    const band = body?.data?.band_list ?? []
    const t = now()
    return band.map((b: any, i: number): Item => {
      // 词条去 # 包裹(实测 word 或 word_scheme)。
      const word = String(b.word ?? b.word_scheme ?? "").replace(/^#|#$/g, "")
      return {
        // id 用 word 而非数组下标:刷新后词条位置移动,下标作 id 会让同一词条反复进库
        // (core 按 id 去重失效)。word 天然稳定。
        id: `wb-hot-${word}`,
        sourceId: this.key,
        kind: "social",
        title: word || "(热搜词)",
        url: `https://m.weibo.cn/search?containerid=100103type%3D1%26q%3D${encodeURIComponent(word)}`,
        content: `#${word}# 热度 ${b.num ?? ""}`.trim(),
        fetchedAt: t,
        raw: { word, num: b.num, index: i },
      }
    })
  }

  /** 热搜词 → 该词下微博流(keyword 搜索,需 cookie)。 */
  private async resolveHotWordImpl(word: string, cookie?: string): Promise<Item[]> {
    const q = encodeURIComponent(word)
    const body = await weiboClient.getJson<{ ok?: number; msg?: string; data?: { cards?: any[] } }>(
      `${WB_BASE}/api/container/getIndex?containerid=100103type%3D1%26q%3D${q}`,
      { cookie, referer: `${WB_BASE}/search?containerid=100103type%3D1%26q%3D${q}` },
    )
    if (body?.ok !== 1) throw new Error(`weibo 热搜词 "${word}" 搜索失败: ${body?.msg ?? "未知错误"}`)
    // 热搜词流与用户流一致:展开长文 + 补图尺寸(批处理统一)。
    return mblogCardsToItems(body.data?.cards ?? [], this.key, cookie)
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "微博实时热搜", channelLink: "https://s.weibo.com/top/summary" }
  }
}
