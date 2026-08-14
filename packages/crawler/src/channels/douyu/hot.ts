/**
 * douyu 直播热门 —— japi/weblist/apinc/allpage(无鉴权),支持分页加载更多。
 *
 * 复刻 dart getRecommendRooms(douyu_site.dart):`allpage/{page}/1`(栏目 6 是综合热门),
 * `data.rl[]` 过滤 type==1(直播间),产多条 Live item(rid/rn/nn/rs16/ol)。
 * 分页:**页码制**(page 递增),`isPageable` 探测 → fetchMore 翻页(本页为空 = 没有更多)。
 *
 * 能力:对外是独立 channel(无参,热门发现);内部**委托同平台 DouyuLiveChannel**
 * 的 resolveLivePlay/getDanmaku(hot 是「特殊的 live channel」——外部区分开,机制复用)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, LivePlayable, Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore, liveHotSource } from "../factory.ts"
import { httpJson, now } from "../../host.ts"
import { DouyuLiveChannel } from "./live.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

export class DouyuLiveHotChannel implements RssChannel {
  readonly key = "live:douyu:hot"
  readonly name = "斗鱼直播热门"
  readonly kind = "live" as const
  readonly defaultInfo = {}
  /** 内部持同平台 live channel,委托其懒解析/弹幕能力(对外 channel 身份仍是 hot)。 */
  getSource(info: SourceInfo): RssSource & LivePlayable & DanmakuPlayable & Pageable {
    return liveHotSource(new DouyuLiveChannel().getSource(info), {
      fetch: apiFetch(() => this.fetchItems(info, 1), () => this.channelOptions(info)),
      // 页码游标(首页 fetch 用 page=1,翻页从 2 起步 +1;本页为空即止)。
      fetchMore: apiFetchMore((page) => this.fetchItems(info, page), () => this.channelOptions(info), { first: 2, step: 1 }),
    })
  }

  private async fetchItems(_info: SourceInfo, page: number): Promise<Item[]> {
    const res = await httpJson<{ data?: { rl?: Array<Record<string, any>> } }>(
      `https://www.douyu.com/japi/weblist/apinc/allpage/6/${page}`,
      { "user-agent": UA, referer: "https://www.douyu.com/" },
    )
    const t = now()
    const rl = Array.isArray(res?.data?.rl) ? res.data.rl : []
    return rl
      .filter((item) => Number(item.type) === 1) // 1=直播间(过滤广告位)
      .map((item): Live => {
        const rid = String(item.rid ?? "")
        return {
          id: `douyu:${rid}`,
          sourceId: "live:douyu:hot",
          kind: "live",
          title: String(item.rn ?? ""),
          url: `https://www.douyu.com/${rid}`,
          thumbnail: item.rs16 ? String(item.rs16) : undefined,
          author: item.nn ? { name: String(item.nn) } : undefined,
          fetchedAt: t,
          platform: "douyu",
          roomId: rid,
          liveStatus: "live",
          online: Number(item.ol ?? 0),
        }
      })
  }

  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "斗鱼直播热门", channelLink: "https://www.douyu.com/" }
  }
}
