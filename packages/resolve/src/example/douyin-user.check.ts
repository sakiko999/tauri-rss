/**
 * 抖音用户作品映射自检 —— `bun packages/resolve/src/example/douyin-user.check.ts`
 *
 * 守护的是**静默丢内容**：`aweme_list` 的字段名一旦变化（bit_rate → play_addr、
 * images → image_post_info），映射层不读就只剩空条目，没有任何报错。
 *
 * 字段依据：RSSHub 的 douyin user 路由（拦页面自己的 /aweme/post 响应）与
 * MediaCrawler 的解析（`video.bit_rate[].play_addr.url_list` 已是 CDN 直链）。
 */

import {
  awemeListToSocial,
  awemeToSocial,
  douyinUserUrl,
  pickAwemePlayUrl,
  readAwemeList,
} from "../platform/douyin/user.ts"

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed += 1
    console.error(`✘ ${msg}`)
  }
}

const videoAweme = {
  aweme_id: "7300000000000000001",
  desc: "第一行标题\n第二行正文 #话题",
  create_time: 1793000000,
  author: { nickname: "作者甲", avatar_thumb: { url_list: ["http://p3.douyinpic.com/av.jpeg"] } },
  statistics: { digg_count: 1234, comment_count: 56, share_count: 7 },
  video: {
    duration: 15000,
    cover: { url_list: ["http://p3.douyinpic.com/cover.jpeg"] },
    // 故意乱序 + 低档在前：必须按 bit_rate 降序取最高档（产流契约：最高清晰度排最前）。
    bit_rate: [
      { bit_rate: 800000, play_addr: { url_list: ["http://v3-web.douyinvod.com/low.mp4?x=1"] } },
      {
        bit_rate: 4000000,
        play_addr: { url_list: ["http://v3-web.douyinvod.com/high.mp4?x=1"] },
      },
      { bit_rate: 2000000, play_addr: { url_list: [""] } },
    ],
  },
}

const v = awemeToSocial(videoAweme, "douyin:user", 42)!
ok(v.id === "dy-7300000000000000001", `id 带 dy- 前缀（得 ${v.id}）`)
ok(v.url === "https://www.douyin.com/video/7300000000000000001", `url 指向作品页（得 ${v.url}）`)
ok(v.title === "第一行标题", `title 只取首行（得 ${JSON.stringify(v.title)}）`)
ok(v.content === "第一行标题\n第二行正文 #话题", "content 保留完整正文")
ok(v.kind === "social", "kind = social")
ok(String(v.video).includes("high.mp4"), `视频直链取最高 bit_rate（得 ${v.video}）`)
ok(String(v.video).startsWith("https://"), `直链改成 https（得 ${v.video}）`)
ok(v.hasVideo === true, "带 hasVideo 标记")
ok(v.images?.[0]?.url === "https://p3.douyinpic.com/cover.jpeg", "无图集时用视频封面当展示图")
ok(v.likes === 1234 && v.replies === 56 && v.reposts === 7, "互动数映射")
ok(v.publishedAt === 1793000000000, `create_time → 毫秒时间戳（得 ${v.publishedAt}）`)
ok(v.durationSec === 15, `duration(ms) → 秒（得 ${v.durationSec}）`)
ok(v.author?.name === "作者甲" && v.author?.avatar === "https://p3.douyinpic.com/av.jpeg", "作者名与头像")

// 图文作品（aweme_type 68）：images 数组 + 一个**背景音乐**的 play_addr（实测结构），
// 绝不能当视频流。判据：有 images → 图文。
const imageAweme = {
  aweme_id: "7300000000000000002",
  aweme_type: 68,
  desc: "三张图",
  create_time: 1793000100,
  images: [
    { url_list: ["http://p9.douyinpic.com/a.jpeg"], width: 1080, height: 1440 },
    { url_list: ["http://p9.douyinpic.com/b.jpeg"], width: 1080, height: 1440 },
  ],
  video: {
    duration: 0,
    bit_rate: [],
    play_addr: { url_list: ["http://sf11-cdn-tos.douyinstatic.com/obj/ies-music/123"] },
  },
}
const img = awemeToSocial(imageAweme, "douyin:user", 1)!
ok(!img.video, `图文作品的 play_addr 是 BGM，不能当视频（得 ${img.video}）`)
ok(img.hasVideo === undefined, "图文作品不应标 hasVideo")
ok(img.images?.length === 2 && img.images[0]!.width === 1080, `图文图片集带上宽高（得 ${JSON.stringify(img.images)}）`)

// 缺 aweme_id 直接丢弃（无法去重/无法打开）。
ok(awemeToSocial({ desc: "没有 id" }, "douyin:user", 1) === null, "无 aweme_id 的条目应丢弃")

// bit_rate 全都不可用时回退 video.play_addr。
ok(
  pickAwemePlayUrl({
    bit_rate: [{ bit_rate: 1, play_addr: { url_list: [] } }],
    play_addr: { url_list: ["http://x/fallback.mp4"] },
  }) === "https://x/fallback.mp4",
  "bit_rate 不可用时回退 play_addr",
)

// 列表：按 id 去重（页面重复追加同一条是已知行为）。
const list = awemeListToSocial([videoAweme, imageAweme, { ...videoAweme }], "douyin:user", 9)
ok(list.length === 2, `重复条目应去重（得 ${list.length}）`)

// 响应体解析：坏 JSON / 非 aweme_list 结构一律空数组（由调用方报错，不静默当成 0 条内容）。
ok(readAwemeList("not json").length === 0, "坏 JSON → 空列表")
ok(readAwemeList(JSON.stringify({ status_code: 0 })).length === 0, "无 aweme_list → 空列表")
ok(readAwemeList(JSON.stringify({ aweme_list: [videoAweme] })).length === 1, "正常响应能取到列表")

ok(douyinUserUrl("MS4wLjAB") === "https://www.douyin.com/user/MS4wLjAB", "主页 URL 拼接")

if (failed === 0) console.log("抖音用户作品映射：全部通过")
process.exit(failed === 0 ? 0 : 1)
