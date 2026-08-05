/**
 * BilibiliSource — multi-route Bilibili API adapter (the single bilibili source;
 * the former separate `BilibiliRankSource` hot-search is now the `hot-search`
 * route below).
 *
 * Routes (all plain GET on `api.bilibili.com`, ported from RSSHub):
 *   - hot-search 热搜    `/x/web-interface/wbi/search/square`     (wbi-signed)
 *   - popular   综合热门  `/x/web-interface/popular`            (no signature)
 *   - ranking   排行榜    `/x/web-interface/ranking/v2?rid=…`  (no signature)
 *   - weekly    每周必看  `app.bilibili.com/.../selected`       (no signature)
 *   - user-video UP 主投稿 `/x/space/wbi/arc/search`            (wbi-signed)
 *   - live-room 直播房间  (BilibiliSite: getRoomDetail → FeedLive)
 *
 * No login, no puppeteer: the wbi-signed routes reuse the shared
 * `BilibiliClient` (nav → mixin key → MD5), the same zero-login trick the
 * former rank source used. Video items map to a `FeedArticle` carrying a video
 * attachment; live rooms map to a `FeedLive` (via `BilibiliSite`, the internal
 * live site kept in `./live-site.ts`).
 *
 * HTTP + signing go through the shared `BilibiliClient` (`createBilibiliClient`
 * from `client.ts`) — the same client the live `BilibiliSite` uses, so "bili
 * live 和 bili 源" share all the same low-level operations.
 *
 * Sources:
 *   - tmp/RSSHub/lib/routes/bilibili/hot-search.ts
 *   - tmp/RSSHub/lib/routes/bilibili/popular.ts
 *   - tmp/RSSHub/lib/routes/bilibili/ranking.ts
 *   - tmp/RSSHub/lib/routes/bilibili/weekly-recommend.ts
 *   - tmp/RSSHub/lib/routes/bilibili/video.ts (API path `/x/space/wbi/arc/search`)
 */
import type { FeedArticle, FeedItem, FeedLive, FeedStream } from "../../types/feed-item.ts"
import type { ProducerHost } from "../../types/producer-host.ts"
import type { LivePlayUrl } from "../../types/result.ts"
import type { LiveRoomPage } from "../../types/live-site.ts"
import type { BilibiliConfig, BilibiliSubscription } from "../../types/subscription.ts"
import { BaseSource } from "../base-source.ts"
import { createBilibiliClient } from "./client.ts"
import { BilibiliSite } from "./live-site.ts"

const API_MAIN = "https://api.bilibili.com"

/** pubdate at/after which items link by bvid (before that: /av{aid}). */
const BVID_TIME = 1_589_990_400

export class BilibiliSource extends BaseSource<BilibiliSubscription> {
  readonly sourceId = "bilibili" as const
  readonly builtinSubscriptions = [
    { id: "bili-hot", title: "bilibili 热搜", tag: "API · 热搜", config: { route: "hot-search" } },
    { id: "bili-popular", title: "bilibili 综合热门", tag: "API · 视频", config: { route: "popular" } },
    { id: "bili-ranking", title: "bilibili 排行榜·全站", tag: "API · 视频", config: { route: "ranking", rid: "all" } },
    { id: "bili-weekly", title: "B站每周必看", tag: "API · 视频", config: { route: "weekly" } },
    { id: "bili-3b1b", title: "3Blue1Brown (B 站)", tag: "API · UP主", config: { route: "user-video", uid: "511068914" } },
    { id: "bili-live", title: "bilibili 直播示例", tag: "API · 直播", config: { route: "live-room", roomId: "998" } },
  ] as const
  readonly meta = {
    name: "bilibili",
    description: "热搜 / 热门 / 排行 / 每周必看 / UP 主投稿 / 直播房间",
    configSchema: [
      { key: "route", label: "路由", type: "select" as const, required: true, options: [
        { value: "hot-search", label: "热搜" },
        { value: "popular", label: "综合热门" },
        { value: "ranking", label: "排行榜" },
        { value: "weekly", label: "每周必看" },
        { value: "user-video", label: "UP 主投稿" },
        { value: "live-room", label: "直播房间" },
      ] },
      { key: "rid", label: "排行分区(ranking)", type: "text" as const },
      { key: "uid", label: "UP 主 ID(user-video)", type: "text" as const },
      { key: "roomId", label: "直播间 ID(live-room)", type: "text" as const },
    ],
  }

  /** Build a subscription from form values (plugin seam: config → Subscription). */
  createSubscription(
    base: { id: string; sourceId: string; title: string; enabled: boolean; createdAt: number; updatedAt: number },
    config: Record<string, unknown>,
  ): BilibiliSubscription {
    const route = (config.route as BilibiliConfig["route"]) ?? "popular"
    const cfg: BilibiliConfig = { route }
    if (config.rid) cfg.rid = String(config.rid)
    if (config.uid) cfg.uid = String(config.uid)
    if (config.roomId) cfg.roomId = String(config.roomId)
    return { ...base, sourceId: "bilibili", config: cfg }
  }

  /** Bilibili live room discovery (bilibili live rides this source's route). */
  async listRecommendRooms(host: ProducerHost, page = 1): Promise<LiveRoomPage> {
    const site = new BilibiliSite(host)
    return site.getRecommendRooms(page)
  }

  async fetch(subscription: BilibiliSubscription, host: ProducerHost): Promise<FeedItem[]> {
    const now = host.now()
    return this.fetchRoute(subscription, host, now)
  }

  private async fetchRoute(
    subscription: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedItem[]> {
    switch (subscription.config.route) {
      case "hot-search":
        return this.hotSearch(subscription, host, now)
      case "popular":
        return this.popular(subscription, host, now)
      case "ranking":
        return this.ranking(subscription, host, now)
      case "weekly":
        return this.weekly(subscription, host, now)
      case "user-video":
        return this.userVideo(subscription, host, now)
      case "live-room":
        return this.liveRoom(subscription, host, now)
      default:
        // Exhaustive: adding a route to BilibiliConfig must produce a case above.
        const neverRoute: never = subscription.config.route
        throw new Error(`Unknown bilibili route: ${neverRoute}`)
    }
  }

  // ── 热搜(wbi 签名)──────────────────────────────────────────────────────────

  private async hotSearch(
    sub: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedArticle[]> {
    const client = createBilibiliClient({ host })
    const params = await client.signWeb("limit=50&platform=web")
    const data = await client.getJson(`${API_MAIN}/x/web-interface/wbi/search/square?${params}`)
    const trending = data?.data?.trending
    const list: Array<Record<string, unknown>> = Array.isArray(trending?.list) ? trending.list : []
    return list.map((item, i) => {
      const keyword = String(item.keyword ?? "")
      const link =
        String(item.link ?? item.goto ?? "") ||
        `https://search.bilibili.com/all?${new URLSearchParams({ keyword })}&from_source=webtop_search`
      return {
        id: `bili-rank-${i}-${keyword}`,
        sourceId: "bilibili",
        kind: "article",
        title: keyword,
        url: link,
        summary: item["icon"] ? `<img src="${item.icon}">` : undefined,
        content: `<p>${keyword}</p>`,
        contentFormat: "html",
        author: sub.title ? { name: sub.title } : undefined,
        publishedAt: now,
        fetchedAt: now,
        raw: item,
      }
    })
  }

  // ── 综合热门 ──────────────────────────────────────────────────────────────

  private async popular(
    sub: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedArticle[]> {
    const client = createBilibiliClient({ host })
    const data = await client.getJson(`${API_MAIN}/x/web-interface/popular`, {
      referer: "https://www.bilibili.com/",
    })
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
    const client = createBilibiliClient({ host })
    // Keep the full 22-partition table minimal here: rid can be a Chinese slug
    // ("all", "douga", …) or a numeric rid. Numeric → default x/web ranking/v2.
    const rid = sub.config.rid ?? "all"
    const isNumeric = /^\d+$/.test(rid)
    const numericRid = isNumeric
      ? rid
      : (RID_TABLE as Record<string, string>)[rid] ?? "0"
    const apiBase = `${API_MAIN}/x/web-interface/ranking/v2`
    const params = `rid=${numericRid}&type=all&web_location=333.934`
    const data = await client.getJson(`${apiBase}?${params}`, {
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
    const client = createBilibiliClient({ host })
    const status = await client.getJson(
      "https://app.bilibili.com/x/v2/show/popular/selected/series?type=weekly_selected",
      { referer: "https://www.bilibili.com/h5/weekly-recommend" },
    )
    const series = status?.data?.data
    if (!Array.isArray(series) || !series[0]) throw new Error("bilibili weekly: no series")
    const number = series[0].number
    const name = series[0].name
    const data = await client.getJson(
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
    if (!sub.config.uid) throw new Error("bilibili user-video requires a uid")
    const uid = sub.config.uid
    const client = createBilibiliClient({ host })
    const signed = await client.signWeb(`mid=${uid}&ps=30&pn=1&platform=web&order=pubdate`)
    const data = await client.getJson(
      `${API_MAIN}/x/space/wbi/arc/search?${signed}`,
      { referer: `https://space.bilibili.com/${uid}/video` },
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

  // ── 直播房间(经 BilibiliSite 复用 live 能力)─────────────────────────────

  private async liveRoom(
    sub: BilibiliSubscription,
    host: ProducerHost,
    now: number,
  ): Promise<FeedLive[]> {
    if (!sub.config.roomId) throw new Error("bilibili live-room requires a roomId")
    const roomId = sub.config.roomId
    const site = new BilibiliSite(host)
    const detail = await site.getRoomDetail(roomId)
    return [
      {
        id: `bilibili:${roomId}`,
        sourceId: "live:bilibili",
        kind: "live",
        title: detail.title,
        url: detail.url,
        thumbnail: detail.cover,
        author: { name: detail.userName, avatar: detail.userAvatar || undefined },
        publishedAt: undefined,
        fetchedAt: now,
        platform: "bilibili",
        roomId,
        liveStatus: detail.status ? "live" : "offline",
        online: detail.online,
        isRecord: detail.isRecord,
        introduction: detail.introduction,
        notice: detail.notice,
        showTime: detail.showTime,
        raw: detail.data,
      },
    ]
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
    sub: BilibiliSubscription,
    host: ProducerHost,
    videoId: string,
  ): Promise<FeedStream[]> {
    if (sub.config.route === "live-room") {
      throw new Error(`bilibili resolveVideoPlay does not support route='${sub.config.route}'`)
    }
    const client = createBilibiliClient({ host })
    const referer = "https://www.bilibili.com/"
    const view = await client.getJson(
      `${API_MAIN}/x/web-interface/view?bvid=${encodeURIComponent(videoId)}`,
      { referer },
    )
    const cid = view?.data?.cid
    if (!cid) throw new Error(`bilibili view: no cid for ${videoId}`)

    const play = await client.getJson(
      `${API_MAIN}/x/player/playurl?bvid=${encodeURIComponent(videoId)}&cid=${cid}&qn=64&platform=html5`,
      { referer },
    )
    const durl: Array<{ url?: string }> = Array.isArray(play?.data?.durl) ? play.data.durl : []
    return durl
      .map((d) => ({ url: d.url ?? "", format: "mp4" as const, headers: { referer } }))
      .filter((s) => s.url.length > 0)
  }

  /**
   * Lazily resolve a live room's playable URLs (subscription-scoped, live-room
   * route only). Delegates to `BilibiliSite` — the same three-step resolve
   * `LiveSource.resolveLivePlay` used for the old live-room kind.
   */
  async resolveLivePlay(
    sub: BilibiliSubscription,
    host: ProducerHost,
  ): Promise<LivePlayUrl> {
    if (sub.config.route !== "live-room" || !sub.config.roomId) {
      throw new Error("bilibili resolveLivePlay only supports route='live-room'")
    }
    const roomId = sub.config.roomId
    const site = new BilibiliSite(host)
    const detail = await site.getRoomDetail(roomId)
    const qualities = await site.getPlayQualities(detail)
    const best = qualities[0]
    if (!best) throw new Error(`No play qualities for room ${roomId}`)
    return site.getPlayUrls(detail, best)
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
