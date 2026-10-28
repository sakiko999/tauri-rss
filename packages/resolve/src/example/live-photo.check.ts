/**
 * 实况图（Live Photo）映射自检 —— `bun packages/resolve/src/example/live-photo.check.ts`
 *
 * 守护的是**静默丢字段**：平台给了 live 视频地址，但我们只取静态图时不会报错，
 * 只是卡片上永远没有「实况」、详情里永远播不出来。
 *
 * 实测（2026-10-22）：
 * - 小红书详情 `imageList[i].livePhoto === true` + `stream.EF4[0].masterUrl`（不是 h264）；
 * - 微博 `pics[].type === "livephoto"` + `pics[].videoSrc`（302 包装器）。
 */
import { noteDetailToSocial } from "../platform/xhs/client.ts"
import { mblogToSocial } from "../platform/weibo/client.ts"

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) {
    failed += 1
    console.error(`✘ ${msg}`)
  }
}

// ── 小红书：livePhoto + 非 h264 的 codec 键 ────────────────────────────────
const xhsNote = {
  noteId: "n1",
  title: "带实况的笔记",
  desc: "正文",
  time: 1791961240000,
  xsecToken: "tok",
  imageList: [
    {
      width: 1080,
      height: 1440,
      urlDefault: "http://sns-webpic-qc.xhscdn.com/a.webp",
      livePhoto: true,
      stream: {
        EF4: [
          {
            masterUrl: "http://sns-video-v6.xhscdn.com/a.mp4?sign=1&t=2",
            backupUrls: ["http://sns-bak-v1.xhscdn.com/a.mp4"],
          },
        ],
        EF5: [],
      },
    },
    { width: 1080, height: 1440, urlDefault: "http://sns-webpic-qc.xhscdn.com/b.webp", livePhoto: false, stream: {} },
    // livePhoto 为真但没有 stream：不能产出半截 live，也不能抛错。
    { urlDefault: "http://sns-webpic-qc.xhscdn.com/c.webp", livePhoto: true, stream: {} },
  ],
}
const xhs = noteDetailToSocial(xhsNote, "xhs:explore", 1) as any
ok(!!xhs?.images?.[0]?.liveVideo, "xhs 实况第一张应有 liveVideo")
ok(
  String(xhs?.images?.[0]?.liveVideo).startsWith("https://"),
  `xhs liveVideo 应 https，得 ${xhs?.images?.[0]?.liveVideo}`,
)
ok(String(xhs?.images?.[0]?.liveVideo).includes("sign=1&t=2"), "xhs 签名参数应原样保留")
ok(xhs?.images?.[1] && !xhs.images[1].liveVideo, "xhs 非实况图不应有 liveVideo")
ok(xhs?.images?.[2] && !xhs.images[2].liveVideo, "xhs livePhoto 但无 stream 时不应有 liveVideo")
ok(xhs?.images?.[0]?.url?.startsWith("https://"), "xhs 静态图仍应是 https")

// ── 微博：pics[].type + videoSrc（顶层 live_photo 与 pics 下标不对应，不用它） ──
const mblog = {
  id: "wb1",
  text_raw: "实况微博",
  created_at: "Wed Oct 22 10:00:00 +0800 2026",
  pics: [
    {
      type: "livephoto",
      url: "http://wx1.sinaimg.cn/orj360/a.jpg",
      large: { url: "http://wx1.sinaimg.cn/mw2000/a.jpg" },
      videoSrc: "http://video.weibo.com/media/play?livephoto=a.mov",
    },
    { type: "pic", url: "http://wx1.sinaimg.cn/orj360/b.jpg", large: { url: "http://wx1.sinaimg.cn/mw2000/b.jpg" } },
  ],
}
const wb = mblogToSocial(mblog, "weibo:user", 1) as any
ok(!!wb?.images?.[0]?.liveVideo, "微博实况应带 liveVideo")
ok(
  String(wb?.images?.[0]?.liveVideo).startsWith("https://"),
  `微博 liveVideo 应 https，得 ${wb?.images?.[0]?.liveVideo}`,
)
ok(wb?.images?.[1] && !wb.images[1].liveVideo, "微博普通图不应有 liveVideo")

if (failed === 0) console.log("实况图映射：全部通过")
process.exit(failed === 0 ? 0 : 1)
