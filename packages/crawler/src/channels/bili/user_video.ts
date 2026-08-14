/**
 * bili:user_video —— bilibili UP 主投稿(video channel)。
 *
 * wbi 签名 `space/wbi/arc/search`(需 buvid)。implements VideoPlayable + DanmakuPlayable。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, RssChannel, RssSource, SourceInfo, VideoPlayable } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { biliClient } from "../../platform/bili"
import { API, resolveBiliPlay, ugc } from "./video-common.ts"

export class BiliUserVideoChannel implements RssChannel {
  readonly key = "bili:user_video"
  readonly name = "bilibili UP 主投稿"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "uid", label: "UP 主 uid", required: true }]
  getSource(info: SourceInfo): RssSource & VideoPlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: (itemId) => resolveBiliPlay(itemId, info),
      getDanmaku: (itemId) =>
        biliClient.getDanmaku(itemId, { kind: "vod", cookie: info.cookie || undefined }),
    }
  }
  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const uid = info.uid ?? ""
    if (!uid) throw new Error("bili:user_video 需要 uid")
    const signed = await biliClient.signWeb(`mid=${uid}&ps=30&pn=1&platform=web&order=pubdate`)
    const data = await biliClient.getJson<{ data?: { list?: { vlist?: Array<Record<string, unknown>> } } }>(
      `${API}/x/space/wbi/arc/search?${signed}`,
      { referer: `https://space.bilibili.com/${uid}/video`, buvid: true },
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
