/**
 * bili:season —— B 站视频合集(`ugc_season`)订阅。
 *
 * 端点 `x/polymer/web-space/seasons_archives_list`,匿名可用:
 *   - **必须带 Referer** `https://www.bilibili.com/`(不带返回 `-352`);
 *   - `mid` 可以是 0,服务端会回真实 `meta.mid`;
 *   - 实测 30 条/页,`page_size=100` 也接受 —— 这里固定 30(探针实测口径)。
 *
 * 输入:合集 ID,或视频链接/BV 号(先读 `x/web-interface/view` 的 `data.ugc_season.id`)。
 * 翻页:`page_num` 递增,本页为空即止(apiFetchMore 数值游标)。
 * 条目没有作者名(archives[] 只有 bvid/title/pic/pubdate/duration/stat),author 留空。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems, apiFetchMore } from "../factory.ts"
import { biliClient, now } from "@amoeba/resolve"
import { API, ugc } from "./video-common.ts"
import { parseBiliSeasonRef } from "./refs.ts"

const PAGE_SIZE = 30

/** 合集输入 → seasonId(视频链接要联网换一次)。失败抛清晰错误。 */
async function resolveSeasonId(raw: string): Promise<string> {
  const ref = parseBiliSeasonRef(raw)
  if (!ref) {
    throw new Error("bili:season 需要合集 ID 或视频链接（space.bilibili.com/<mid>/channel/collectiondetail?sid=…）")
  }
  if (ref.seasonId) return ref.seasonId

  const videoId = ref.videoId!
  const q = videoId.startsWith("av") ? `aid=${videoId.slice(2)}` : `bvid=${encodeURIComponent(videoId)}`
  const res = await biliClient.getJson<{ data?: { ugc_season?: { id?: number } } }>(
    `${API}/x/web-interface/view?${q}`,
    { referer: `https://www.bilibili.com/video/${videoId}` },
  )
  const seasonId = res?.data?.ugc_season?.id
  if (!seasonId) throw new Error(`视频 ${videoId} 不属于任何合集`)
  return String(seasonId)
}

/**
 * 输入 → seasonId 的**模块级** memo。
 * ⚠️ 不能放在 `getSource` 里:core 每次 refresh / loadMore 都**新建** source 实例,
 * 实例级 memo 跨不过一次调用 —— 视频链接输入时每翻一页都会再发一次 view 请求
 * (该端点 -352 敏感,请求数翻倍会直接表现为翻页失败)。合集 ID 不可变,可长期缓存;
 * 失败时删掉,下次重试。
 */
const seasonIdCache = new Map<string, Promise<string>>()
function seasonIdFor(raw: string): Promise<string> {
  let p = seasonIdCache.get(raw)
  if (!p) {
    p = resolveSeasonId(raw)
    seasonIdCache.set(raw, p)
    p.catch(() => seasonIdCache.delete(raw))
  }
  return p
}

export class BiliSeasonChannel implements RssChannel {
  readonly key = "bili:season"
  readonly name = "B站视频合集"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "seasonId", label: "合集 ID 或视频链接", required: true }]

  getSource(info: SourceInfo): RssSource & Pageable {
    const seasonId = (): Promise<string> => seasonIdFor(info.seasonId ?? "")
    return {
      fetch: apiFetchItems(
        () => this.fetchItems(seasonId, 1),
        () => this.channelOptions(info),
      ),
      fetchMore: apiFetchMore(
        (page) => this.fetchItems(seasonId, page),
        () => this.channelOptions(info),
        {
          first: 2,
          step: 1,
        },
      ),
    }
  }

  private async fetchItems(seasonId: () => Promise<string>, page: number): Promise<Item[]> {
    const id = await seasonId()
    const res = await biliClient.getJson<{ data?: { archives?: Array<Record<string, any>> } }>(
      `${API}/x/polymer/web-space/seasons_archives_list?mid=0&season_id=${encodeURIComponent(id)}&page_num=${page}&page_size=${PAGE_SIZE}`,
      // ⚠️ 必须带 Referer:匿名请求不带时返回 -352(风控),见文件头。
      { referer: "https://www.bilibili.com/" },
    )
    const t = now()
    return (res?.data?.archives ?? [])
      .filter((a) => a?.bvid || a?.aid)
      .map((a) =>
        ugc("bili:season", t, {
          title: a.title,
          pic: a.pic,
          pubdate: a.pubdate,
          aid: a.aid,
          bvid: a.bvid,
          duration: a.duration,
          rights: a.rights,
        }),
      )
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `B站合集 ${info.seasonId ?? ""}`, channelLink: "https://www.bilibili.com/" }
  }
}
