/**
 * bili:user_video —— bilibili UP 主投稿(video channel)。
 *
 * wbi 签名 `space/wbi/arc/search`(需 buvid)。implements VideoPlayable + DanmakuPlayable。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { now } from "@amoeba/resolve"
import { biliClient } from "@amoeba/resolve"
import { API, ugc } from "./video-common.ts"

export class BiliUserVideoChannel implements RssChannel {
  readonly key = "bili:user_video"
  readonly name = "B站 UP 主投稿"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "uid", label: "UP 主 uid", required: true }]
  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }
  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const uid = info.uid ?? ""
    if (!uid) throw new Error("bili:user_video 需要 uid")
    // ⚠️ 必须带订阅/平台 cookie:早先这里漏传 `info.cookie`,登录用户也永远走匿名,
    // space 接口对匿名请求会间歇 412/-352(桌面设了 cookie 也不生效)。
    const cookie = (info.cookie as string) || undefined
    const signed = await biliClient.signSpace(
      `mid=${uid}&ps=30&pn=1&platform=web&order=pubdate&keyword=&tid=0&web_location=1550101`,
      cookie,
    )
    const data = await biliClient.getJson<{ data?: { list?: { vlist?: Array<Record<string, unknown>> } } }>(
      `${API}/x/space/wbi/arc/search?${signed}`,
      { referer: `https://space.bilibili.com/${uid}/video`, cookie, buvid: true },
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
    return { channelTitle: `B站 UP 主 ${uid}`, channelLink: `https://space.bilibili.com/${uid}` }
  }
}
