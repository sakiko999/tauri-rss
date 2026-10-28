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

import { httpJson, now, parseCount } from "@amoeba/resolve"
import type { Live } from "@amoeba/xml"

import { makeApiChannel } from "../factory.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

export const DouyuLiveHotChannel = makeApiChannel({
  key: "live:douyu:hot",
  name: "斗鱼直播热门",
  kind: "live",
  defaultInfo: {},
  channelTitle: () => "斗鱼直播热门",
  channelLink: "https://www.douyu.com/",
  // 页码游标(首页 fetch 用 page=1,翻页从 2 起步 +1;hasMore 按过滤前 rl 行数:
  // 可 pageable 的渠道过滤条目必须显式回 hasMore,否则整页被滤空会被 core 判成
  // 到底 —— 工厂契约;hot 的 data.pgcnt 实测恒 0 不可用,按「原始页非空」推断,
  // 实测每页 40 条、page 170 起空页,不会死循环)。
  pageable: { first: 2, step: 1 },
  fetchPage: async (_info, page) => {
    const res = await httpJson<{ data?: { rl?: Array<Record<string, any>> } }>(
      `https://www.douyu.com/japi/weblist/apinc/allpage/6/${page}`,
      { "user-agent": UA, referer: "https://www.douyu.com/" },
    )
    const t = now()
    const rl = Array.isArray(res?.data?.rl) ? res.data.rl : []
    const items = rl
      // 1=直播间(过滤广告位)。缺失按 1 保留(与 category 同语义:宁多勿误删)。
      .filter((item) => Number(item.type ?? 1) === 1)
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
          // ⚠️ 不裸 Number:斗鱼 ol 可能是带单位串(「133.1万」)→ NaN(同平台搜索已用 parseCount)。
          online: parseCount(item.ol),
        }
      })
    return { items, hasMore: rl.length > 0 }
  },
})
