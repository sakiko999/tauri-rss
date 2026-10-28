/**
 * bili:user_video —— bilibili UP 主投稿(video channel)。
 *
 * wbi 签名 `space/wbi/arc/search`(space 系 WAF 要求 dm_* 指纹,走 signSpace)。
 *
 * ⚠️ 必须带登录 cookie:早先这里漏传 info.cookie,登录用户也永远匿名,space 接口
 * 对匿名请求间歇 412/-352(2026-10-21 修)。cookie 从 info 显式取(provider 是
 * client 兜底,显式传让 CLI kv 覆盖可达)。
 *
 * 翻页 `pn` 递增(ps 固定 30):早先只取第一页,UP 主投稿超过 30 条时永远拿不全
 * (2026-10-27 实测 7 个订阅里 6 个卡在 30 条上限)。`data.page.count` 给真实总数,
 * 拿它判 hasMore;缺失时退回「满页 ⇒ 可能还有下一页」。
 */

import { biliClient, now } from "@amoeba/resolve"

import { makeApiChannel } from "../factory.ts"
import { API, ugc } from "./video-common.ts"

const PAGE_SIZE = 30

export const BiliUserVideoChannel = makeApiChannel({
  key: "bili:user_video",
  name: "B站 UP 主投稿",
  kind: "video",
  sourceInfoTpl: [{ key: "uid", label: "UP 主 uid", required: true }],
  channelTitle: (info) => `B站 UP 主 ${info.uid ?? ""}`,
  channelLink: (info) => `https://space.bilibili.com/${info.uid ?? ""}`,
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const uid = info.uid ?? ""
    if (!uid) throw new Error("bili:user_video 需要 uid")
    const cookie = info.cookie || undefined
    const signed = await biliClient.signSpace(
      `mid=${uid}&ps=${PAGE_SIZE}&pn=${page}&platform=web&order=pubdate&keyword=&tid=0&web_location=1550101`,
      cookie,
    )
    const data = await biliClient.getJson<{
      data?: { list?: { vlist?: Array<Record<string, unknown>> }; page?: { count?: number } }
    }>(`${API}/x/space/wbi/arc/search?${signed}`, {
      referer: `https://space.bilibili.com/${uid}/video`,
      cookie,
      buvid: true,
    })
    const vlist = data?.data?.list?.vlist ?? []
    const t = now()
    const items = vlist.map((v) =>
      ugc("bili:user_video", t, {
        title: v.title,
        pic: v.pic,
        desc: v.description,
        pubdate: v.created,
        aid: v.aid,
        bvid: v.bvid,
        rights: v.rights,
        // space arc/search 没有 rights 对象，充电专属只体现在 is_charging_arc 上。
        charging: v.is_charging_arc,
        owner: v.author ? { name: String(v.author) } : undefined,
      }),
    )
    const count = data?.data?.page?.count
    const hasMore = typeof count === "number" ? page * PAGE_SIZE < count : vlist.length >= PAGE_SIZE
    // 真实总数带上(tpl:total → core pageTotals):apiFetchMore 现已透传 total。
    return { items, hasMore, total: typeof count === "number" ? count : undefined }
  },
})
