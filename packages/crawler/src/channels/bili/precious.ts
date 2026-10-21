/**
 * bili:precious —— B站入站必刷(video channel)。
 *
 * `/x/web-interface/popular/precious` 匿名可用(2026-10-18 实测 98 条,
 * 无需 wbi/cookie;带站内 Referer 即可)。列表是站方人工精选的“镇站之宝”,
 * 基本静态,无分页。stream 仍留空,由下游按 bvid 懒解析。
 *
 * 原 RSSHub `/bilibili/precious` 路由就是同一端点(见 tmp/RSSHub
 * `routes/bilibili/bilibili-recommend.ts`),2026-10-18 收编进 crawler,
 * 因此删除了 `rsshub:bili:precious` 具名渠道。
 */
import { biliClient, now } from "@amoeba/resolve"
import { makeApiChannel } from "../factory.ts"
import { API, ugc } from "./video-common.ts"

export const BiliPreciousChannel = makeApiChannel({
  key: "bili:precious",
  name: "B站入站必刷",
  kind: "video",
  channelTitle: () => "B站入站必刷",
  channelLink: "https://www.bilibili.com/v/popular/history",
  fetchPage: async (info) => {
    const data = await biliClient.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
      `${API}/x/web-interface/popular/precious`,
      { referer: "https://www.bilibili.com/v/popular/history", cookie: info.cookie },
    )
    const list = data?.data?.list ?? []
    const t = now()
    return list.map((raw) =>
      ugc("bili:precious", t, {
        title: raw.title,
        pic: raw.pic,
        desc: raw.desc,
        // ⚠️ 不写原始 pubdate：这是一个**人工精选榜**，排序应按接口顺序而不是
        // 视频发布时间（否则 2023 年的条目会被排到 2020 年的“镇站之宝”前面）。
        // pubdate=0 → publishedAt 为空，selectors 用 fetchedAt 兜底（同批相同，
        // 稳定排序保持 feed 顺序）；forceBvid 保证有 bvid 时仍用现代链接。
        pubdate: 0,
        forceBvid: true,
        aid: raw.aid,
        bvid: raw.bvid,
        duration: raw.duration,
        owner: (raw.owner as { name?: string }) ?? undefined,
      }),
    )
  },
})
