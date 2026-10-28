import { biliClient, now } from "@amoeba/resolve"
/**
 * bili:favlist —— B 站收藏夹订阅。
 *
 * 端点 `x/v3/fav/resource/list?media_id=&platform=web&pn=&ps=20`,公开收藏夹匿名可读;
 * **私有收藏夹需要登录**(cookie 从 info 取 + credentials provider 兜底——曾漏传,
 * 登录用户订阅私有夹也必失败)。实测 20 条/页,`has_more` 正常。
 *
 * ⚠️ `medias[].attr != 0` = 已失效/私密视频 —— 跳过(否则点开必碎)。
 * ⚠️ 收藏夹页 URL 的 `fid` 与 API 的 `media_id` 是同一个值。
 */
import type { Item } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"
import { parseBiliFavlistRef } from "./refs.ts"
import { API, ugc } from "./video-common.ts"

/** 官方文档 `ps` 上限 20(实测 40 也返回过,不依赖)。 */
const PAGE_SIZE = 20

export const BiliFavlistChannel = makeApiChannel({
  key: "bili:favlist",
  name: "B站收藏夹",
  kind: "video",
  sourceInfoTpl: [{ key: "mediaId", label: "收藏夹 ID 或链接", required: true }],
  channelTitle: (info) => `B站收藏夹 ${info.mediaId ?? ""}`,
  channelLink: "https://www.bilibili.com/",
  // ⚠️ 翻页用 hasMore:本页条目可能被 `attr != 0` 全过滤掉,「本页 0 条 = 没有更多」
  // 的默认判据会把后面的页永久截断。
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page): Promise<{ items: Item[]; hasMore?: boolean }> => {
    const ref = parseBiliFavlistRef(info.mediaId ?? "")
    if (!ref) {
      throw new Error("bili:favlist 需要收藏夹 ID 或链接（space.bilibili.com/<mid>/favlist?fid=…；仅公开收藏夹）")
    }
    const res = await biliClient.getJson<{
      data?: { medias?: Array<Record<string, any>> | null; has_more?: boolean }
    }>(
      `${API}/x/v3/fav/resource/list?media_id=${encodeURIComponent(ref.mediaId)}&platform=web&pn=${page}&ps=${PAGE_SIZE}`,
      { referer: "https://www.bilibili.com/", cookie: info.cookie },
    )
    const t = now()
    const items = (res?.data?.medias ?? [])
      // attr != 0 = 失效/私密条目,点开必碎。
      .filter((m) => Number(m?.attr ?? 0) === 0 && (m?.bvid || m?.id))
      .map((m) =>
        ugc("bili:favlist", t, {
          title: m.title,
          pic: m.cover,
          desc: m.intro,
          pubdate: m.pubtime,
          aid: m.id,
          bvid: m.bvid,
          owner: m.upper?.name ? { name: String(m.upper.name) } : undefined,
          duration: m.duration,
          rights: m.rights,
          forceBvid: true,
        }),
      )
    return { items, hasMore: typeof res?.data?.has_more === "boolean" ? res.data.has_more : undefined }
  },
})
