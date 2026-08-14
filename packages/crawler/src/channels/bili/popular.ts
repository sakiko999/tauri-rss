/**
 * bili:popular —— bilibili 综合热门(video channel)。
 *
 * `/x/web-interface/popular` 全站热门。implements VideoPlayable + DanmakuPlayable,
 * getDanmaku 走 bili VOD 弹幕(kind:"vod")。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, RssChannel, RssSource, SourceInfo, VideoPlayable } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { biliClient } from "../../platform/bili"
import { API, resolveBiliPlay, ugc } from "./video-common.ts"

export class BiliPopularChannel implements RssChannel {
  readonly key = "bili:popular"
  readonly name = "bilibili 综合热门"
  readonly kind = "video" as const
  // 视频源:implements VideoPlayable,resolvePlay 闭包捕获 info(core 层注入 cookie)。
  getSource(info: SourceInfo): RssSource & VideoPlayable & DanmakuPlayable {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
      resolvePlay: (itemId) => resolveBiliPlay(itemId, info),
      getDanmaku: (itemId) =>
        biliClient.getDanmaku(itemId, { kind: "vod", cookie: info.cookie || undefined }),
    }
  }
  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const data = await biliClient.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
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
