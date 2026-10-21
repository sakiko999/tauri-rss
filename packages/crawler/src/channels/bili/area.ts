/**
 * bili:live:area —— 按分区列直播间(参数化 parentAreaId + areaId,页码翻页)。
 *
 * 上游 second/getList:**需登录态**(wbi 签名 + buvid + w_webid,匿名实测 `-352`;
 * 20 条/页 + `has_more`)。cookie 三级:订阅 `info.cookie` 显式 > credentials
 * provider(settings 扫码登录)兜底;两者皆无 → -352 → 翻译成登录引导文案。
 * 字段映射照 hot.ts(getListByArea 同形:roomId/title/uname/cover/online)。
 */
import type { Live } from "@amoeba/xml"
import { makeApiChannel } from "../factory.ts"
import { fetchBiliAreaRooms, now } from "@amoeba/resolve"

export const BiliLiveAreaChannel = makeApiChannel({
  key: "bili:live:area",
  name: "B站分区直播",
  kind: "live",
  sourceInfoTpl: [
    { key: "parentAreaId", label: "父分区 ID(如 2=网游、6=手游)", required: true },
    { key: "areaId", label: "子分区 ID(0=该分区全部)", placeholder: "0" },
  ],
  channelTitle: (info) => `B站分区直播 ${info.parentAreaId ?? ""}/${info.areaId || "0"}`,
  channelLink: (info) =>
    `https://live.bilibili.com/p/eden/area-tags?parentAreaId=${info.parentAreaId ?? ""}&areaId=${info.areaId || "0"}`,
  // 页码游标(首页 fetch 用 page=1,翻页从 2 起步 +1);上游 has_more 说话,不猜到底。
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    const parentAreaId = String(info.parentAreaId ?? "").trim()
    const areaId = String(info.areaId ?? "").trim() || "0"
    if (!parentAreaId) throw new Error("bili:live:area 需要 parentAreaId 参数")
    let rooms
    try {
      rooms = await fetchBiliAreaRooms(parentAreaId, areaId, page, info.cookie)
    } catch (e) {
      // 上游 API -352(匿名/登录态被风控)翻译成登录引导。⚠️ 用完整错误前缀匹配:
      // governor 的冷却拒绝「平台冷却中（bili，…信号 -352）」也含 "-352" 字样,
      // 但那是「稍后重试」,不能改写成「需要登录」。
      if (/bilibili API -352/.test(String((e as Error)?.message ?? ""))) {
        throw new Error("B站直播分区列房需要登录：请到「账号与凭证」扫码登录")
      }
      throw e
    }
    const t = now()
    const items = rooms.list.map((item): Live => {
      const roomid = String(item.roomid ?? "")
      const cover = String(item.cover ?? "")
      return {
        id: `bilibili:${roomid}`,
        sourceId: "bili:live:area",
        kind: "live",
        title: String(item.title ?? ""),
        url: `https://live.bilibili.com/${roomid}`,
        thumbnail: cover || undefined,
        author: item.uname ? { name: String(item.uname) } : undefined,
        fetchedAt: t,
        platform: "bilibili",
        roomId: roomid,
        liveStatus: "live",
        online: Number(item.online ?? 0),
      }
    })
    return { items, hasMore: rooms.hasMore }
  },
})
