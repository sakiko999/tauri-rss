/**
 * huya 分区房间 —— 按二级分区列直播间(`gameId` = bussLive 的 gid)。
 *
 * 顶层分区是平台固定枚举(4 个),二级分区见 `resolve/platform/huya/discover.ts`
 * 的 `fetchHuyaSubCategories`。本 channel 参数 = 二级分区 id。
 *
 * 分页:页码制(page 递增),服务端每页固定 ~120 条(不接受 pageSize)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch, apiFetchMore } from "../factory.ts"
import { httpJson, now } from "@tauri-playground/resolve"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

export class HuyaCategoryChannel implements RssChannel {
  readonly key = "live:huya:category"
  readonly name = "虎牙分区直播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "gameId", label: "分区 ID(如 1=英雄联盟、862=CS2)", required: true }]

  getSource(info: SourceInfo): RssSource & Pageable {
    return {
      fetch: apiFetch(() => this.fetchItems(info, 1), () => this.channelOptions(info)),
      fetchMore: apiFetchMore((page) => this.fetchItems(info, page), () => this.channelOptions(info), {
        first: 2,
        step: 1,
      }),
    }
  }

  private async fetchItems(info: SourceInfo, page: number): Promise<Item[]> {
    const gameId = String(info.gameId ?? "").trim()
    if (!gameId) throw new Error("huya:category 需要 gameId 参数")
    const res = await httpJson<{ data?: { datas?: Array<Record<string, any>> } }>(
      `https://www.huya.com/cache.php?m=LiveList&do=getLiveListByPage&tagAll=0&gameId=${encodeURIComponent(gameId)}&page=${page}`,
      { "user-agent": UA, referer: "https://www.huya.com/" },
    )
    const t = now()
    const datas = Array.isArray(res?.data?.datas) ? res.data.datas : []
    return datas.map((item): Live => {
      const profileRoom = String(item.profileRoom ?? "")
      const title = String(item.introduction ?? "") || String(item.roomName ?? "")
      let cover = item.screenshot ? String(item.screenshot) : ""
      if (cover && !cover.includes("?")) cover += "?x-oss-process=style/w338_h190"
      return {
        id: `huya:${profileRoom}`,
        sourceId: "live:huya:category",
        kind: "live",
        title,
        url: `https://www.huya.com/${profileRoom}`,
        thumbnail: cover || undefined,
        author: item.nick ? { name: String(item.nick) } : undefined,
        fetchedAt: t,
        platform: "huya",
        roomId: profileRoom,
        liveStatus: "live",
        online: Number(item.totalCount ?? 0),
      }
    })
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `虎牙分区直播 ${info.gameId ?? ""}`, channelLink: "https://www.huya.com/" }
  }
}
