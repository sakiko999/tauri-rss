/**
 * bili:weekly —— B站每周必看(video channel)。
 *
 * app 接口拿 series 列表 + 期内容。
 */
import { biliClient, now } from "@amoeba/resolve"
import { makeApiChannel } from "../factory.ts"
import { ugc } from "./video-common.ts"

export const BiliWeeklyChannel = makeApiChannel({
  key: "bili:weekly",
  name: "B站每周必看",
  kind: "video",
  channelTitle: () => "B站每周必看",
  channelLink: "https://www.bilibili.com/h5/weekly-recommend",
  fetchPage: async (info) => {
    const status = await biliClient.getJson<{ data?: Array<{ number: number; name: string }> }>(
      "https://app.bilibili.com/x/v2/show/popular/selected/series?type=weekly_selected",
      { referer: "https://www.bilibili.com/h5/weekly-recommend", cookie: info.cookie },
    )
    // app 版接口的 data 直接是 series 数组(不是 data.data 两层)。
    // ⚠️ 取**期号最大**的一期而非 series[0]:接口顺序无契约,直接取首个可能在接口
    // 改序/返回倒序时拿到旧一期(每周必看应是最新一期)。
    const series = status?.data ?? []
    const head = [...series].sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0]
    if (!head) throw new Error("bilibili weekly: no series")
    const data = await biliClient.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
      `https://app.bilibili.com/x/v2/show/popular/selected?type=weekly_selected&number=${head.number}`,
      {
        referer: `https://www.bilibili.com/h5/weekly-recommend?num=${head.number}&navhide=1`,
        cookie: info.cookie,
      },
    )
    const list = data?.data?.list ?? []
    const t = now()
    return list.map((raw) =>
      ugc("bili:weekly", t, {
        title: raw.title,
        pic: raw.cover,
        desc: `${head.name} ${raw.title} - ${raw.rcmd_reason ?? ""}`,
        pubdate: 0,
        aid: raw.param,
        bvid: raw.bvid,
        duration: raw.duration,
        rights: raw.rights,
        forceBvid: head.number > 60,
      }),
    )
  },
})
