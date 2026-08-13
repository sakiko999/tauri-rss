/**
 * bilibili 视频类 channel(square/popular/ranking/weekly/user_video)。
 *
 * 每个 channel 一个 class,直接 implements RssChannel。getSource 拼 source 对象字面量:
 * video channel 额外 implements VideoPlayable(resolvePlay = 模块纯函数 resolveBiliPlay)。
 * fetch 用 factory.ts 的 apiFetch(fetchItems → serializeFeed)。共享 BilibiliClient 的 wbi 签名。
 * video 项映射成 Video(kind=video)。
 *
 * 零登录:wbi 签名 nav 取密钥(未登录仍返回 wbi_img),纯 MD5 签名即可。
 */
import type { Article, Item, Stream, Video } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, RssChannel, RssSource, SourceInfo, VideoPlayable } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { createBilibiliClient } from "./client.ts"
import { biliDanmakuStream } from "./danmaku.ts"

const API = "https://api.bilibili.com"
const BVID_TIME = 1_589_990_400

/** bilibili UGC 视频 → Video(kind=video)。stream 留空——playurl 直链由下游懒解析。 */
function ugc(sourceId: string, t: number, v: {
  title: unknown
  pic?: unknown
  desc?: unknown
  pubdate?: unknown
  aid?: unknown
  bvid?: unknown
  owner?: { name?: string } | undefined
  forceBvid?: boolean
  duration?: unknown
}): Video {
  const pubdate = Number(v.pubdate ?? 0)
  const aid = Number(v.aid ?? 0)
  const bvid = v.bvid ? String(v.bvid) : undefined
  const useBvid = (pubdate >= BVID_TIME || v.forceBvid) && bvid
  const link = useBvid ? `https://www.bilibili.com/video/${bvid}` : `https://www.bilibili.com/video/av${aid}`
  const ownerName = v.owner?.name
  return {
    id: bvid ?? `av${aid}`,
    sourceId,
    kind: "video",
    title: String(v.title ?? "(untitled)"),
    url: link,
    summary: v.desc ? String(v.desc) : undefined,
    thumbnail: v.pic ? String(v.pic) : undefined,
    poster: v.pic ? String(v.pic) : undefined,
    author: ownerName ? { name: ownerName } : undefined,
    publishedAt: pubdate ? pubdate * 1000 : undefined,
    fetchedAt: t,
    duration: typeof v.duration === "number" ? v.duration : undefined,
    channel: ownerName ? { name: ownerName } : undefined,
    // playable stream lazily resolved downstream — bilibili playurl needs bvid+cid and URLs carry a deadline signature
  }
}

/**
 * 共享的 bili 视频懒解析:bvid/aid → cid → 全档位 durl mp4 直链。
 * 4 个 video channel 的 `resolvePlay` 方法都调它(避免重复代码)。
 * info 携带 core 层注入的登录 cookie → 解锁更高档位(登录 1080P+);无则零登录。
 */
function resolveBiliPlay(itemId: string, info?: SourceInfo): Promise<Stream[]> {
  const client = createBilibiliClient({ cookie: (info?.cookie as string) || undefined })
  return client.resolveCid(itemId).then((cid) => client.resolvePlayUrl(itemId, cid))
}

// ── bili:square(热搜)────────────────────────────────────────────────────────

export class BiliSquareChannel implements RssChannel {
  readonly key = "bili:square"
  readonly name = "bilibili 热搜"
  readonly kind = "article" as const
  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }
  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const client = createBilibiliClient()
    const signed = await client.signWeb("limit=50&platform=web")
    const data = await client.getJson<{ data?: { trending?: { list?: Array<Record<string, unknown>> } } }>(
      `${API}/x/web-interface/wbi/search/square?${signed}`,
    )
    const list = data?.data?.trending?.list ?? []
    const t = now()
    return list.map((raw, i) => {
      const keyword = String(raw.keyword ?? "")
      const link =
        String(raw.link ?? raw.goto ?? "") ||
        `https://search.bilibili.com/all?${new URLSearchParams({ keyword })}&from_source=webtop_search`
      return {
        id: `bili-rank-${i}-${keyword}`,
        sourceId: "bili:square",
        kind: "article",
        title: keyword,
        url: link,
        summary: raw["icon"] ? `<img src="${raw.icon}">` : undefined,
        content: `<p>${keyword}</p>`,
        contentFormat: "html",
        fetchedAt: t,
        raw,
      } satisfies Article
    })
  }
  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "bilibili 热搜", channelLink: "https://www.bilibili.com/" }
  }
}

// ── bili:popular(综合热门)────────────────────────────────────────────────────

export class BiliPopularChannel implements RssChannel {
  readonly key = "bili:popular"
  readonly name = "bilibili 综合热门"
  readonly kind = "video" as const
  // 视频源:implements VideoPlayable,resolvePlay 闭包捕获 info(core 层注入 cookie)。
  getSource(info: SourceInfo): RssSource & VideoPlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: (itemId) => resolveBiliPlay(itemId, info),
      getDanmaku: (itemId) => biliDanmakuStream(itemId, (info.cookie as string) || undefined),
    }
  }
  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const client = createBilibiliClient()
    const data = await client.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
      `${API}/x/web-interface/popular`,
    )
    const list = data?.data?.list ?? []
    const t = now()
    return list.map((raw) =>
      ugc("bili:popular", t, {
        title: raw.title,
        pic: raw.pic,
        desc: raw.desc,
        pubdate: raw.pubdate,
        aid: raw.aid,
        bvid: raw.bvid,
        owner: (raw.owner as { name?: string }) ?? undefined,
      }),
    )
  }
  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "bilibili 综合热门", channelLink: "https://www.bilibili.com/" }
  }
}

// ── bili:ranking(排行榜)────────────────────────────────────────────────────────

const RID_TABLE: Record<string, string> = {
  all: "0", anime: "1", guochuang: "4", documentary: "3", movie: "2", tv: "5", variety: "7",
  douga: "1005", game: "1008", kichiku: "1007", music: "1003", dance: "1004", cinephile: "1001",
  ent: "1002", knowledge: "1010", tech: "1012", food: "1020", car: "1013", fashion: "1014",
  sports: "1018", animal: "1024",
}

export class BiliRankingChannel implements RssChannel {
  readonly key = "bili:ranking"
  readonly name = "bilibili 排行榜"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "rid", label: "分区(all/douga/…)", required: false }]
  getSource(info: SourceInfo): RssSource & VideoPlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: (itemId) => resolveBiliPlay(itemId, info),
      getDanmaku: (itemId) => biliDanmakuStream(itemId, (info.cookie as string) || undefined),
    }
  }
  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const rid = info.rid ?? "all"
    const numericRid = /^\d+$/.test(rid) ? rid : (RID_TABLE[rid] ?? "0")
    const client = createBilibiliClient()
    const data = await client.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
      `${API}/x/web-interface/ranking/v2?rid=${numericRid}&type=all&web_location=333.934`,
      { referer: `https://www.bilibili.com/v/popular/rank/${rid}` },
    )
    const list = data?.data?.list ?? []
    const t = now()
    return list.map((raw) =>
      ugc("bili:ranking", t, {
        title: raw.title,
        pic: raw.pic,
        desc: raw.desc || raw.title,
        pubdate: raw.ctime,
        aid: raw.aid,
        bvid: raw.bvid,
        owner: (raw.owner as { name?: string }) ?? undefined,
      }),
    )
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `bilibili 排行榜·${info.rid ?? "all"}`, channelLink: "https://www.bilibili.com/v/popular/rank/all" }
  }
}

// ── bili:weekly(每周必看)────────────────────────────────────────────────────────

export class BiliWeeklyChannel implements RssChannel {
  readonly key = "bili:weekly"
  readonly name = "B站每周必看"
  readonly kind = "video" as const
  getSource(info: SourceInfo): RssSource & VideoPlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: (itemId) => resolveBiliPlay(itemId, info),
      getDanmaku: (itemId) => biliDanmakuStream(itemId, (info.cookie as string) || undefined),
    }
  }
  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const client = createBilibiliClient()
    const status = await client.getJson<{ data?: Array<{ number: number; name: string }> }>(
      "https://app.bilibili.com/x/v2/show/popular/selected/series?type=weekly_selected",
      { referer: "https://www.bilibili.com/h5/weekly-recommend" },
    )
    // app 版接口的 data 直接是 series 数组(不是 data.data 两层)。
    const series = status?.data ?? []
    const head = series[0]
    if (!head) throw new Error("bilibili weekly: no series")
    const data = await client.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
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

// ── bili:user_video(UP 主投稿)─────────────────────────────────────────────────

export class BiliUserVideoChannel implements RssChannel {
  readonly key = "bili:user_video"
  readonly name = "bilibili UP 主投稿"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "uid", label: "UP 主 uid", required: true }]
  getSource(info: SourceInfo): RssSource & VideoPlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: (itemId) => resolveBiliPlay(itemId, info),
      getDanmaku: (itemId) => biliDanmakuStream(itemId, (info.cookie as string) || undefined),
    }
  }
  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const uid = info.uid ?? ""
    if (!uid) throw new Error("bili:user_video 需要 uid")
    const client = createBilibiliClient({ buvid: true })
    const signed = await client.signWeb(`mid=${uid}&ps=30&pn=1&platform=web&order=pubdate`)
    const data = await client.getJson<{ data?: { list?: { vlist?: Array<Record<string, unknown>> } } }>(
      `${API}/x/space/wbi/arc/search?${signed}`,
      { referer: `https://space.bilibili.com/${uid}/video` },
    )
    const vlist = data?.data?.list?.vlist ?? []
    const t = now()
    return vlist.map((v) =>
      ugc("bili:user_video", t, {
        title: v.title,
        pic: v.pic,
        desc: v.description,
        pubdate: v.created,
        aid: v.aid,
        bvid: v.bvid,
        owner: v.author ? { name: String(v.author) } : undefined,
      }),
    )
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    const uid = info.uid ?? ""
    return { channelTitle: `bilibili UP 主 ${uid}`, channelLink: `https://space.bilibili.com/${uid}` }
  }
}
