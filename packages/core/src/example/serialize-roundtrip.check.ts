/**
 * crawler→core 序列化边界回归守卫 —— `bun packages/core/src/example/serialize-roundtrip.check.ts`
 *
 * ⚠️ 守护的 bug(2026-10 修):crawler 产出 Item → serializeFeed 成 XML → core 自解析
 * 重建 MediaItem。此前 serializeFeed 只写 `tpl:kind`,凡 crawler channel 设了、core
 * deserialize 又读的字段(Live 的 liveStatus/online/platform/roomId、Audio 的 artist/
 * album、Video 的 channelName、Social 的 likes…)**全在边界静默丢掉** —— 实测 174 条
 * live 全 liveStatus="unknown"、online 恒 undefined、YouTube 直播 platform 被 URL
 * 兜底误判为 bilibili。
 *
 * 放在 core(它拥有 deserialize 侧 + xml 依赖):任一侧加了新字段而另一侧没跟上,这里立刻红。
 */
import { serializeFeed } from "@tauri-playground/xml"
import type { Item } from "@tauri-playground/xml"
import { deserializeFeed } from "../processing/deserialize.ts"

let fails = 0
const ok = (cond: unknown, label: string) => {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

const ctx = { subscriptionId: "s-chk", now: 1700000000000 }

// 1. Live:全字段往返
const live: Item = {
  id: "douyin:402229884603",
  sourceId: "live:douyin:hot",
  kind: "live",
  title: "测试直播间",
  url: "https://live.douyin.com/402229884603",
  fetchedAt: 1700000000000,
  platform: "douyin",
  roomId: "402229884603",
  liveStatus: "live",
  online: 1628,
  isRecord: false,
  introduction: "简介文本",
}
const liveBack = deserializeFeed(serializeFeed([live], { channelTitle: "t" }), ctx)[0] as any
console.log("Live 往返:")
ok(liveBack.platform === "douyin", `platform(得 ${liveBack.platform})`)
ok(liveBack.roomId === "402229884603", `roomId(得 ${liveBack.roomId})`)
ok(liveBack.liveStatus === "live", `liveStatus(得 ${liveBack.liveStatus})`)
ok(liveBack.online === 1628, `online(得 ${liveBack.online})`)
ok(liveBack.isRecord === false, `isRecord(得 ${liveBack.isRecord})`)
ok(liveBack.introduction === "简介文本", `introduction(得 ${liveBack.introduction})`)

// 2. Video:duration + channel + poster
const video: Item = {
  id: "BV1", sourceId: "bili:popular", kind: "video", title: "视频",
  url: "https://www.bilibili.com/video/BV1", fetchedAt: 1,
  duration: 459, poster: "http://x/p.jpg",
  channel: { name: "UP主", avatar: "http://x/a.jpg" },
}
const videoBack = deserializeFeed(serializeFeed([video]), ctx)[0] as any
console.log("Video 往返:")
ok(videoBack.duration === 459, `duration(得 ${videoBack.duration})`)
ok(videoBack.poster === "http://x/p.jpg", `poster(得 ${videoBack.poster})`)
ok(videoBack.channel?.name === "UP主", `channel.name(得 ${videoBack.channel?.name})`)

// 3. Audio:artist + album
const audio: Item = {
  id: "ep1", sourceId: "rss:podcast", kind: "audio", title: "播客",
  url: "http://f/ep1.mp3", fetchedAt: 1, duration: 300, artist: "主播", album: "专辑",
}
const audioBack = deserializeFeed(serializeFeed([audio]), ctx)[0] as any
console.log("Audio 往返:")
ok(audioBack.artist === "主播", `artist(得 ${audioBack.artist})`)
ok(audioBack.album === "专辑", `album(得 ${audioBack.album})`)

// 4. Social:likes/replies/reposts
const social: Item = {
  id: "n1", sourceId: "xhs:explore", kind: "social", title: "笔记",
  url: "https://www.xiaohongshu.com/explore/n1", fetchedAt: 1, content: "正文",
  likes: 42, replies: 7, reposts: 3,
}
const socialBack = deserializeFeed(serializeFeed([social]), ctx)[0] as any
console.log("Social 往返:")
ok(socialBack.likes === 42, `likes(得 ${socialBack.likes})`)
ok(socialBack.replies === 7, `replies(得 ${socialBack.replies})`)
ok(socialBack.reposts === 3, `reposts(得 ${socialBack.reposts})`)

// 4b. Social.images 允许 string | SocialImage —— 纯字符串 URL 也要到 core(曾静默丢)
const socialImg: Item = {
  id: "n2", sourceId: "xhs:explore", kind: "social", title: "带图", fetchedAt: 1, content: "正文",
  images: ["https://i/a.jpg", { url: "https://i/b.jpg", width: 10, height: 20 }],
} as Item
const socialImgBack = deserializeFeed(serializeFeed([socialImg]), ctx)[0] as any
console.log("Social.images 往返(含纯字符串):")
ok(Array.isArray(socialImgBack.images) && socialImgBack.images.length === 2, `两张图都在(得 ${JSON.stringify(socialImgBack.images)}）`)
ok(socialImgBack.images?.some((i: any) => (i?.url ?? i) === "https://i/a.jpg"), "字符串 URL 未丢")
ok(socialImgBack.images?.some((i: any) => i?.url === "https://i/b.jpg"), "对象 URL 未丢")

// 5. XML 良构:文本/属性里的 & < 必须转义(否则严格解析器拒收,且往返丢数据)
const tricky: Item = {
  id: "amp", sourceId: "s", kind: "article", title: "A & B <tag>",
  url: "https://ex.com/?a=1&b=2", summary: "HTML <b>x</b> & more", fetchedAt: 1,
}
const trickyXml = serializeFeed([tricky])
console.log("XML 转义:")
ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(trickyXml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")), "标签外无裸 &")
ok(trickyXml.includes("&amp;") && trickyXml.includes("&lt;tag&gt;"), "title 的 & < 已转义")
const trickyBack = deserializeFeed(trickyXml, ctx)[0] as any
ok(trickyBack.title === "A & B <tag>", `title 往返保真(得 ${JSON.stringify(trickyBack.title)})`)

// 6. article:fetchedAt 无标准 RSS 字段(走 tpl:)必须透传,否则恒退化成 ctx.now
const art: Item = {
  id: "a1", sourceId: "rss:x", kind: "article", title: "文章",
  url: "https://x/y", fetchedAt: 1699999999123, content: "<p>正文</p>", contentFormat: "html",
  author: { name: "作者", avatar: "http://x/av.jpg", handle: "@handle" },
}
const artBack = deserializeFeed(serializeFeed([art]), ctx)[0] as any
console.log("Article 往返:")
ok(artBack.fetchedAt === 1699999999123, `fetchedAt 透传(得 ${artBack.fetchedAt})`)
ok(artBack.contentFormat === "html", `contentFormat(得 ${artBack.contentFormat})`)
ok(artBack.author?.avatar === "http://x/av.jpg", `author.avatar(得 ${artBack.author?.avatar})`)
ok(artBack.author?.handle === "@handle", `author.handle(得 ${artBack.author?.handle})`)

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
