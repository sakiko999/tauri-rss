/**
 * 视频帖（视频笔记 / 视频微博）映射自检 —— `bun packages/resolve/src/example/video-post.check.ts`
 *
 * 守护的是**静默丢视频**：平台数据里带着播放直链，但转换函数不读就没有任何报错，
 * 详情弹窗永远只有封面。
 *
 * 字段依据（2026-10-30，参考 tmp/RSSHub 的 xhs util / weibo utils）：
 * - 小红书详情 `note.type === "video"` + `note.video.media.stream.<codec>[0].masterUrl`，
 *   codec 键是 h264/h265/h266/av1（**av1 常排最前**）；回退 `consumer.originVideoKey`；
 * - 微博列表 `page_info.type === "video"` + `urls.mp4_720p_mp4` / `media_info.stream_url`，
 *   封面在 `page_pic.url`（pics 为空时兜底）。
 */

import { mblogToSocial } from "../platform/weibo/client.ts"
import { noteCardToSocial, noteDetailToSocial } from "../platform/xhs/client.ts"

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed += 1
    console.error(`✘ ${msg}`)
  }
}

// ── 小红书：视频笔记 ───────────────────────────────────────────────
// ⚠️ av1 故意排在最前：WebView2 解码不稳，必须按 h264 偏好选流，不能按键序。
const xhsVideoNote = {
  noteId: "v1",
  type: "video",
  title: "视频笔记",
  desc: "正文",
  time: 1791961240000,
  imageList: [{ width: 1080, height: 1440, urlDefault: "http://sns-webpic-qc.xhscdn.com/p.webp" }],
  video: {
    media: {
      stream: {
        av1: [{ masterUrl: "http://sns-video-v1.xhscdn.com/av1.mp4?sign=a" }],
        h264: [
          {
            masterUrl: "http://sns-video-v6.xhscdn.com/h264.mp4?sign=1&t=2",
            backupUrls: ["http://sns-bak-v1.xhscdn.com/h264-bak.mp4"],
          },
        ],
      },
    },
  },
}
const xhs = noteDetailToSocial(xhsVideoNote, "xhs:explore", 1) as any
ok(String(xhs?.video).includes("h264.mp4"), `xhs 视频应优先 h264（得 ${xhs?.video}）`)
ok(String(xhs?.video).startsWith("https://"), `xhs 视频直链应 https（得 ${xhs?.video}）`)
ok(String(xhs?.video).includes("sign=1&t=2"), "xhs 签名参数应原样保留")
ok(xhs?.images?.[0]?.url?.startsWith("https://"), "xhs 视频笔记封面（poster）应保留")

// stream 缺失时回退 originVideoKey（不带签名，活得久）。
const xhsKeyNote = {
  noteId: "v2",
  type: "video",
  title: "只有 key 的视频",
  desc: "",
  time: 1791961240000,
  imageList: [],
  video: { media: { stream: {} }, consumer: { originVideoKey: "abc/def.mp4" } },
}
const xhsKey = noteDetailToSocial(xhsKeyNote, "xhs:explore", 1) as any
ok(xhsKey?.video === "https://sns-video-al.xhscdn.com/abc/def.mp4", `xhs 应回退 originVideoKey（得 ${xhsKey?.video}）`)

// 非视频笔记不得产出 video（别把视频字段给图文笔记）。
const xhsPlain = noteDetailToSocial({ ...xhsVideoNote, type: "normal" }, "xhs:explore", 1) as any
ok(!xhsPlain?.video, "xhs 图文笔记不应有 video")

// 列表 noteCard 的 type 标记（实测 2026-10-30：video/normal）→ hasVideo：
// 列表拿不到流，卡片角标先靠这个信号。
const cardVideo = noteCardToSocial(
  {
    type: "video",
    displayTitle: "视频笔记",
    cover: { urlDefault: "http://x/c.webp", width: 3, height: 4 },
    time: 1791961240000,
  },
  "xhs:user",
  1,
  "v3",
  "tok",
) as any
ok(cardVideo?.hasVideo === true, `xhs 列表视频笔记应带 hasVideo（得 ${cardVideo?.hasVideo}）`)
ok(!cardVideo?.video, "xhs 列表项不应有直链（流等详情）")
const cardPlain = noteCardToSocial(
  {
    type: "normal",
    displayTitle: "图文",
    cover: { urlDefault: "http://x/p.webp", width: 3, height: 4 },
    time: 1791961240000,
  },
  "xhs:user",
  1,
  "v4",
  "tok",
) as any
ok(cardPlain?.hasVideo === undefined, "xhs 列表图文笔记不应带 hasVideo")

// ── 微博：视频微博 ─────────────────────────────────────────────────
const wbPoster = { url: "http://wx1.sinaimg.cn/large/p.jpg" }
const wbVideo = {
  id: "wb1",
  text_raw: "视频微博",
  created_at: "Wed Oct 22 10:00:00 +0800 2026",
  pics: [],
  page_info: {
    type: "video",
    page_pic: wbPoster,
    urls: { mp4_720p_mp4: "http://f.video.weibocdn.com/720.mp4?label=mp4_720p" },
    media_info: { stream_url_hd: "http://f.video.weibocdn.com/hd.mp4" },
  },
}
const wb = mblogToSocial(wbVideo, "weibo:user", 1) as any
ok(String(wb?.video).startsWith("https://"), `微博视频直链应 https（得 ${wb?.video}）`)
ok(String(wb?.video).includes("720.mp4"), `微博应优先 720p（得 ${wb?.video}）`)
ok(wb?.images?.[0]?.url?.startsWith("https://"), "微博视频封面应兜底进 images（page_pic）")

// 只有 media_info 旧结构时也要取到直链。
const wbLegacy = {
  id: "wb2",
  text_raw: "旧结构视频",
  created_at: "Wed Oct 22 10:00:00 +0800 2026",
  pics: [{ url: "http://wx1.sinaimg.cn/orj360/c.jpg" }],
  page_info: { type: "video", media_info: { stream_url: "http://f.video.weibocdn.com/sd.mp4" } },
}
const wbL = mblogToSocial(wbLegacy, "weibo:user", 1) as any
ok(String(wbL?.video).includes("sd.mp4"), `微博应回退 media_info.stream_url（得 ${wbL?.video}）`)
ok(wbL?.images?.[0]?.url?.includes("c.jpg"), "有 pics 时不动原图集")

// 非视频微博不得产出 video。
const wbPlain = mblogToSocial(
  {
    id: "wb3",
    text_raw: "普通微博",
    created_at: "Wed Oct 22 10:00:00 +0800 2026",
    pics: [],
    page_info: { type: "article" },
  },
  "weibo:user",
  1,
) as any
ok(!wbPlain?.video, "普通微博不应有 video")

if (failed === 0) console.log("视频帖映射：全部通过")
process.exit(failed === 0 ? 0 : 1)
