/**
 * bili:ranking —— bilibili 排行榜(video channel)。
 *
 * `/x/web-interface/ranking/v2` 分区榜。rid 支持英文分区名(见 RID_TABLE)或数字。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { DanmakuPlayable, RssChannel, RssSource, SourceInfo, VideoPlayable } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { biliClient } from "../../platform/bili"
import { API, resolveBiliPlay, ugc } from "./video-common.ts"

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
      getDanmaku: (itemId) =>
        biliClient.getDanmaku(itemId, { kind: "vod", cookie: info.cookie || undefined }),
    }
  }
  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const rid = info.rid ?? "all"
    const numericRid = /^\d+$/.test(rid) ? rid : (RID_TABLE[rid] ?? "0")
    const data = await biliClient.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
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
