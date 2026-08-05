/**
 * BilibiliSource — multi-route Bilibili API adapter.
 *
 * Routes (all plain GET on `api.bilibili.com`, ported from RSSHub):
 *   - popular   综合热门  `/x/web-interface/popular`            (no signature)
 *   - ranking   排行榜    `/x/web-interface/ranking/v2?rid=…`  (no signature)
 *   - weekly    每周必看  `app.bilibili.com/.../selected`       (no signature)
 *   - user-video UP 主投稿 `/x/space/wbi/arc/search`            (wbi-signed)
 *
 * No login, no puppeteer: the wbi-signed routes reuse `wbi.ts` (nav → mixin key
 * → MD5), the same zero-login trick the rank source uses. Every item is mapped
 * to an `FeedArticle` carrying a video attachment (mirrors how the rank source
 * emits keyword articles) so the classifier/UI treat them uniformly.
 *
 * Sources:
 *   - tmp/RSSHub/lib/routes/bilibili/popular.ts
 *   - tmp/RSSHub/lib/routes/bilibili/ranking.ts
 *   - tmp/RSSHub/lib/routes/bilibili/weekly-recommend.ts
 *   - tmp/RSSHub/lib/routes/bilibili/video.ts (API path `/x/space/wbi/arc/search`)
 */
import type { FeedArticle, FeedItem, FeedStream } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { BilibiliRoute, BilibiliSubscription } from "../../types/subscription.ts"
import type { SourceAdapter } from "../source-adapter.ts"
import { createWbiSigner } from "./wbi.ts"

const API_MAIN = "https://api.bilibili.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/** pubdate at/after which items link by bvid (before that: /av{aid}). */
const BVID_TIME = 1_589_990_400

export class BilibiliSource implements SourceAdapter<BilibiliSubscription> {
  readonly kind = "bilibili" as const
  readonly meta = {
    name: "bilibili",
    description: "热门 / 排行 / 每周必看 / UP 主投稿",
    configSchema: [
      { key: "route", label: "路由", type: "select" as const, required: true, options: [
        { value: "popular", label: "综合热门" },
        { value: "ranking", label: "排行榜" },
        { value: "weekly", label: "每周必看" },
        { value: "user-video", label: "UP 主投稿" },
      ] },
      { key: "rid", label: "排行分区(ranking)", type: "text" as const },
      { key: "uid", label: "UP 主 ID(user-video)", type: "text" as const },
    ],
  }

  /** Build a subscription from form values (plugin seam: config → Subscription). */
  createSubscription(
    base: { id: string; title: string; enabled: boolean; createdAt: number; updatedAt: number },
    config: Record<string, unknown>,
  ): BilibiliSubscription {
    return {
      ...base,
      kind: "bilibili",
      route: (config.route as BilibiliRoute) ?? "popular",
      ...(config.rid ? { rid: String(config.rid) } : {}),
      ...(config.uid ? { uid: String(config.uid) } : {}),
    }
  }

  async fetch(subscription: BilibiliSubscription, host: ProducerHost): Promise<FeedItem[]> {
    const now = host.now()
    const items = await this.fetchRoute(subscription, host, now)
    return items
  }

  private async fetchRoute(
    subscription: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedArticle[]> {
    switch (subscription.route) {
      case "popular":
        return this.popular(subscription, host, now)
      case "ranking":
        return this.ranking(subscription, host, now)
      case "weekly":
        return this.weekly(subscription, host, now)
      case "user-video":
        return this.userVideo(subscription, host, now)
      default:
        // Exhaustive: adding a route to BilibiliRoute must produce a case above.
        const neverRoute: never = subscription.route
        throw new Error(`Unknown bilibili route: ${neverRoute}`)
    }
  }

  // ── 综合热门 ──────────────────────────────────────────────────────────────

  private async popular(
    sub: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedArticle[]> {
    const data = await this.getJson(
      host,
      `${API_MAIN}/x/web-interface/popular`,
      { referer: "https://www.bilibili.com/" },
    )
    const list = data?.data?.list
    if (!Array.isArray(list)) throw new Error("bilibili popular: no data.list")
    return list.map((item: any) =>
      this.ugcArticle(sub, now, {
        title: item.title,
        pic: item.pic,
        desc: item.desc,
        pubdate: item.pubdate,
        aid: item.aid,
        bvid: item.bvid,
        owner: item.owner,
      }),
    )
  }

  // ── 排行榜 ────────────────────────────────────────────────────────────────

  private async ranking(
    sub: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedArticle[]> {
    // Keep the full 22-partition table minimal here: rid can be a Chinese slug
    // ("all", "douga", …) or a numeric rid. Numeric → default x/web ranking/v2.
    const rid = sub.rid ?? "all"
    const isNumeric = /^\d+$/.test(rid)
    const numericRid = isNumeric
      ? rid
      : (RID_TABLE as Record<string, string>)[rid] ?? "0"
    const apiBase = `${API_MAIN}/x/web-interface/ranking/v2`
    const params = `rid=${numericRid}&type=all&web_location=333.934`
    const data = await this.getJson(host, `${apiBase}?${params}`, {
      referer: `https://www.bilibili.com/v/popular/rank/${rid}`,
      origin: "https://www.bilibili.com",
    })
    const list = data?.data?.list ?? data?.result?.list
    if (!Array.isArray(list)) throw new Error("bilibili ranking: no data.list")
    return list.map((item: any) =>
      this.ugcArticle(sub, now, {
        title: item.title,
        pic: item.pic,
        desc: item.desc || item.title,
        pubdate: item.ctime,
        aid: item.aid,
        bvid: item.bvid,
        owner: item.owner,
      }),
    )
  }

  // ── 每周必看 ──────────────────────────────────────────────────────────────

  private async weekly(
    sub: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedArticle[]> {
    const status = await this.getJson(
      host,
      "https://app.bilibili.com/x/v2/show/popular/selected/series?type=weekly_selected",
      { referer: "https://www.bilibili.com/h5/weekly-recommend" },
    )
    const series = status?.data?.data
    if (!Array.isArray(series) || !series[0]) throw new Error("bilibili weekly: no series")
    const number = series[0].number
    const name = series[0].name
    const data = await this.getJson(
      host,
      `https://app.bilibili.com/x/v2/show/popular/selected?type=weekly_selected&number=${number}`,
      { referer: `https://www.bilibili.com/h5/weekly-recommend?num=${number}&navhide=1` },
    )
    const list = data?.data?.list
    if (!Array.isArray(list)) throw new Error("bilibili weekly: no data.list")
    return list.map((item: any) =>
      this.ugcArticle(sub, now, {
        title: item.title,
        pic: item.cover,
        desc: `${name} ${item.title} - ${item.rcmd_reason ?? ""}`,
        pubdate: 0,
        aid: item.param,
        bvid: item.bvid,
        owner: undefined,
        forceBvid: number > 60,
      }),
    )
  }

  // ── UP 主投稿(wbi 签名)────────────────────────────────────────────────────

  private async userVideo(
    sub: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedArticle[]> {
    if (!sub.uid) throw new Error("bilibili user-video requires a uid")
    const signer = createWbiSigner(host)
    const signed = await signer.sign(`mid=${sub.uid}&ps=30&pn=1&platform=web&order=pubdate`)
    const data = await this.getJson(
      host,
      `${API_MAIN}/x/space/wbi/arc/search?${signed}`,
      { referer: `https://space.bilibili.com/${sub.uid}/video` },
    )
    const vlist = data?.data?.list?.vlist
    if (!Array.isArray(vlist)) throw new Error("bilibili user-video: no data.list.vlist")
    return vlist.map((item: any) =>
      this.ugcArticle(sub, now, {
        title: item.title,
        pic: item.pic,
        desc: item.description,
        pubdate: item.created,
        aid: item.aid,
        bvid: item.bvid,
        owner: item.author ? { name: item.author } : undefined,
      }),
    )
  }

  // ── shared mapping ─────────────────────────────────────────────────────────

  private ugcArticle(
    sub: BilibiliSubscription,
    now: number,
    v: {
      title: string
      pic?: string
      desc?: string
      pubdate: number
      aid?: number
      bvid?: string
      owner?: { name?: string } | { name?: string }[] | undefined
      forceBvid?: boolean
    },
  ): FeedArticle {
    const useBvid = (v.pubdate >= BVID_TIME || v.forceBvid) && v.bvid
    const link = useBvid
      ? `https://www.bilibili.com/video/${v.bvid}`
      : `https://www.bilibili.com/video/av${v.aid}`
    const media: FeedArticle["media"] = v.bvid
      ? [{ kind: "video", url: link, poster: v.pic, mimeType: "text/html" }]
      : undefined
    return {
      id: v.bvid ?? `av${v.aid}`,
      sourceId: "bilibili",
      kind: "article",
      title: v.title ?? "(untitled)",
      url: link,
      summary: v.desc,
      thumbnail: v.pic,
      content: v.desc ? `<p>${v.desc}</p>` : undefined,
      contentFormat: v.desc ? "html" : undefined,
      author: ownerToAuthor(v.owner) ?? (sub.title ? { name: sub.title } : undefined),
      publishedAt: v.pubdate ? v.pubdate * 1000 : undefined,
      fetchedAt: now,
      media,
    }
  }

  // ── video play resolution (lazy) ──────────────────────────────────────────

  /**
   * Lazily resolve a video item's playable streams (item-scoped, unlike the
   * subscription-scoped `resolveLivePlay`). Two-step:
   *   `/x/web-interface/view?bvid=`  → cid
   *   `/x/player/playurl?bvid=&cid=` → durl[] direct mp4/flv URLs
   * Zero-login (just a Referer). URLs carry a `deadline` expiry signature, so
   * never cache this in a refresh snapshot — call it at play time.
   */
  async resolveVideoPlay(
    _sub: BilibiliSubscription,
    host: ProducerHost,
    videoId: string,
  ): Promise<FeedStream[]> {
    const referer = "https://www.bilibili.com/"
    const view = await this.getJson(
      host,
      `${API_MAIN}/x/web-interface/view?bvid=${encodeURIComponent(videoId)}`,
      { referer },
    )
    const cid = view?.data?.cid
    if (!cid) throw new Error(`bilibili view: no cid for ${videoId}`)

    const play = await this.getJson(
      host,
      `${API_MAIN}/x/player/playurl?bvid=${encodeURIComponent(videoId)}&cid=${cid}&qn=64&platform=html5`,
      { referer },
    )
    const durl: Array<{ url?: string }> = Array.isArray(play?.data?.durl) ? play.data.durl : []
    return durl
      .map((d) => ({ url: d.url ?? "", format: "mp4" as const, headers: { referer } }))
      .filter((s) => s.url.length > 0)
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async getJson(
    host: ProducerHost,
    url: string,
    headers: Record<string, string>,
  ): Promise<{ data?: any; result?: any; code?: number; message?: string }> {
    const res = await host.http.request({
      url,
      method: "GET",
      responseType: "json",
      headers: { "user-agent": UA, ...headers },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`bilibili HTTP ${res.status}: ${url}`)
    }
    const data = typeof res.body === "string" ? JSON.parse(res.body) : res.body
    if (data?.code !== undefined && data.code !== 0) {
      throw new Error(`bilibili API ${data.code}: ${data.message ?? "unknown error"}`)
    }
    return data
  }
}

function ownerToAuthor(
  owner: { name?: string } | { name?: string }[] | undefined,
): { name: string } | undefined {
  if (!owner) return undefined
  const name = Array.isArray(owner) ? owner[0]?.name : owner.name
  return name ? { name } : undefined
}

/** Chinese slug → numeric rid (subset of RSSHub's ridList; unknown → 0 全站). */
const RID_TABLE: Record<string, string> = {
  all: "0",
  anime: "1",
  guochuang: "4",
  documentary: "3",
  movie: "2",
  tv: "5",
  variety: "7",
  douga: "1005",
  game: "1008",
  kichiku: "1007",
  music: "1003",
  dance: "1004",
  cinephile: "1001",
  ent: "1002",
  knowledge: "1010",
  tech: "1012",
  food: "1020",
  car: "1013",
  fashion: "1014",
  sports: "1018",
  animal: "1024",
}