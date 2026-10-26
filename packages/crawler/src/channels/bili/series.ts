/**
 * bili:series —— B 站「视频列表 / 系列」订阅。
 *
 * 端点:
 *   - 元信息 `x/series/series?series_id=`(匿名;返回 `meta.mid`,不用用户手填);
 *   - 条目 `x/series/archives?mid=&series_id=&pn=&ps=20`(匿名,固定 20/页)。
 *
 * ⚠️ `mid` 必须是列表作者的真实 mid:传 1 这类错值会 code 0 但 `archives` 为空,
 * 看起来像「列表没内容」。所以先查元信息拿 mid,不要求用户输入。
 * 输入:series ID 或列表 URL(`/lists/<sid>`、`seriesdetail?sid=`、`list/<mid>?sid=`)。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems, apiFetchMore } from "../factory.ts"
import { biliClient, now } from "@amoeba/resolve"
import { API, ugc } from "./video-common.ts"
import { parseBiliSeriesRef } from "./refs.ts"

/** 上游固定 20/页(传 50 也只给 20)。 */
const PAGE_SIZE = 20

/** 查列表作者 mid(元信息接口匿名可用)。失败抛清晰错误。 */
async function fetchSeriesMid(seriesId: string): Promise<string> {
  const res = await biliClient.getJson<{ data?: { meta?: { mid?: number } } }>(
    `${API}/x/series/series?series_id=${encodeURIComponent(seriesId)}`,
    { referer: "https://www.bilibili.com/" },
  )
  const mid = res?.data?.meta?.mid
  if (!mid) throw new Error(`bili:series 找不到视频列表 ${seriesId}`)
  return String(mid)
}

/**
 * seriesId → 作者 mid 的**模块级** memo。
 * ⚠️ 不能按 source 实例 memo:core 每次 refresh / loadMore 都新建 source,
 * 实例级缓存跨不过一次调用 —— 每翻一页都会多打一次 `x/series/series`(该端点 -352 敏感)。
 * mid 不可变,可长期缓存;失败时删掉重试。
 */
const midCache = new Map<string, Promise<string>>()
function midFor(seriesId: string): Promise<string> {
  let p = midCache.get(seriesId)
  if (!p) {
    p = fetchSeriesMid(seriesId)
    midCache.set(seriesId, p)
    p.catch(() => midCache.delete(seriesId))
  }
  return p
}

export class BiliSeriesChannel implements RssChannel {
  readonly key = "bili:series"
  readonly name = "B站视频列表"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "seriesId", label: "视频列表 ID 或链接", required: true }]

  getSource(info: SourceInfo): RssSource & Pageable {
    const mid = (): Promise<string> => {
      const ref = parseBiliSeriesRef(info.seriesId ?? "")
      if (!ref) {
        return Promise.reject(
          new Error("bili:series 需要视频列表 ID 或链接（space.bilibili.com/<mid>/lists/<sid>?type=series）"),
        )
      }
      return midFor(ref.seriesId)
    }
    return {
      fetch: apiFetchItems(() => this.fetchItems(info, mid, 1), () => this.channelOptions(info)),
      fetchMore: apiFetchMore((page) => this.fetchItems(info, mid, page), () => this.channelOptions(info), {
        first: 2,
        step: 1,
      }),
    }
  }

  private async fetchItems(info: SourceInfo, mid: () => Promise<string>, page: number): Promise<Item[]> {
    const ref = parseBiliSeriesRef(info.seriesId ?? "")
    if (!ref) throw new Error("bili:series 需要视频列表 ID 或链接")
    const m = await mid()
    const res = await biliClient.getJson<{ data?: { archives?: Array<Record<string, any>> } }>(
      // ⚠️ 分页参数是 `pn`/`ps`(不是 season 那套 `page_num`/`page_size`):
      // 实测传 page_num=2 会静默返回第 1 页,表现为翻页永远重复首页。
      `${API}/x/series/archives?mid=${encodeURIComponent(m)}&series_id=${encodeURIComponent(ref.seriesId)}&pn=${page}&ps=${PAGE_SIZE}`,
      { referer: "https://www.bilibili.com/" },
    )
    const t = now()
    return (res?.data?.archives ?? [])
      .filter((a) => a?.bvid || a?.aid)
      .map((a) =>
        ugc("bili:series", t, {
          title: a.title,
          pic: a.pic,
          desc: a.desc,
          pubdate: a.pubdate,
          aid: a.aid,
          bvid: a.bvid,
          duration: a.duration,
          rights: a.rights,
        }),
      )
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `B站视频列表 ${info.seriesId ?? ""}`, channelLink: "https://www.bilibili.com/" }
  }
}
