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
import { serializeFeed } from "@amoeba/xml"
import type { Item } from "@amoeba/xml"
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
  duration: 459, poster: "http://x/p.jpg", membersOnly: true,
  channel: { name: "UP主", avatar: "http://x/a.jpg" },
}
const videoBack = deserializeFeed(serializeFeed([video]), ctx)[0] as any
console.log("Video 往返:")
ok(videoBack.duration === 459, `duration(得 ${videoBack.duration})`)
ok(videoBack.poster === "http://x/p.jpg", `poster(得 ${videoBack.poster})`)
ok(videoBack.channel?.name === "UP主", `channel.name(得 ${videoBack.channel?.name})`)
ok(videoBack.membersOnly === true, `membersOnly(得 ${videoBack.membersOnly})`)

// 2b. Stream 全字段：enclosure 只能装 url+type，headers/quality/rate/dashManifest
// 必须走 tpl:streamJson，否则 hls/dash 直链过边界即静默丢。
const streamVideo: Item = {
  id: "BV-stream", sourceId: "bili:popular", kind: "video", title: "带流视频",
  url: "https://www.bilibili.com/video/BV-stream", fetchedAt: 1,
  stream: {
    url: "https://cdn.example/v.m3u8",
    format: "hls",
    headers: { Referer: "https://www.bilibili.com/", Origin: "https://www.bilibili.com" },
    quality: "1080P",
    rate: 80,
    dashManifest: '<MPD><Period id="p0"/></MPD>',
  },
}
const streamBack = deserializeFeed(serializeFeed([streamVideo]), ctx)[0] as any
console.log("Stream 往返:")
ok(streamBack.stream?.url === "https://cdn.example/v.m3u8", `url(得 ${streamBack.stream?.url})`)
ok(streamBack.stream?.format === "hls", `format(得 ${streamBack.stream?.format})`)
ok(streamBack.stream?.headers?.Referer === "https://www.bilibili.com/", `headers.Referer(得 ${JSON.stringify(streamBack.stream?.headers)})`)
ok(streamBack.stream?.quality === "1080P", `quality(得 ${streamBack.stream?.quality})`)
ok(streamBack.stream?.rate === 80, `rate(得 ${streamBack.stream?.rate})`)
ok(streamBack.stream?.dashManifest === '<MPD><Period id="p0"/></MPD>', `dashManifest(得 ${streamBack.stream?.dashManifest})`)

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

// 4b. Social.images 带宽高的对象要完整到 core
const socialImg: Item = {
  id: "n2", sourceId: "xhs:explore", kind: "social", title: "带图", fetchedAt: 1, content: "正文",
  images: [
    { url: "https://i/a.jpg", width: 5, height: 6, liveVideo: "https://v/a.mp4?sign=1&t=2" },
    { url: "https://i/b.jpg", width: 10, height: 20 },
  ],
} as Item
const socialImgBack = deserializeFeed(serializeFeed([socialImg]), ctx)[0] as any
console.log("Social.images 往返:")
ok(Array.isArray(socialImgBack.images) && socialImgBack.images.length === 2, `两张图都在(得 ${JSON.stringify(socialImgBack.images)}）`)
ok(socialImgBack.images?.some((i: any) => i?.url === "https://i/a.jpg" && i?.width === 5), "第一张 URL/宽高未丢")
ok(socialImgBack.images?.some((i: any) => i?.url === "https://i/b.jpg"), "对象 URL 未丢")
ok(
  socialImgBack.images?.some((i: any) => i?.liveVideo === "https://v/a.mp4?sign=1&t=2"),
  `实况视频直链未丢（得 ${JSON.stringify(socialImgBack.images?.map((i: any) => i?.liveVideo))}）`,
)

// 4c. Category(分区目录条目):categoryChannel + categoryInfo(JSON)必须完整往返
const category: Item = {
  id: "douyin-partition:101",
  sourceId: "live:douyin:categories",
  kind: "category",
  title: "聊天",
  summary: "顶层分区",
  fetchedAt: 1,
  categoryChannel: "live:douyin:category",
  categoryInfo: { partition: "101", partitionType: "4" },
}
const categoryBack = deserializeFeed(serializeFeed([category]), ctx)[0] as any
console.log("Category 往返:")
ok(categoryBack.kind === "category", `kind(得 ${categoryBack.kind})`)
ok(categoryBack.categoryChannel === "live:douyin:category", `categoryChannel(得 ${categoryBack.categoryChannel})`)
ok(categoryBack.categoryInfo?.partition === "101", `categoryInfo.partition(得 ${categoryBack.categoryInfo?.partition})`)
ok(categoryBack.categoryInfo?.partitionType === "4", `categoryInfo.partitionType(得 ${categoryBack.categoryInfo?.partitionType})`)

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

// 6b. Article.media[]：image/video/audio 三种附件 + 宽高时长必须全保真
const artMedia: Item = {
  id: "a2", sourceId: "rss:x", kind: "article", title: "带附件文章",
  url: "https://x/y", fetchedAt: 1, content: "<p>正文</p>", contentFormat: "html",
  media: [
    { kind: "image", url: "https://x/i.jpg", mimeType: "image/jpeg", title: "图", width: 800, height: 600 },
    { kind: "video", url: "https://x/v.mp4", mimeType: "video/mp4", durationSec: 42, width: 1920, height: 1080 },
    { kind: "audio", url: "https://x/a.mp3", mimeType: "audio/mpeg", durationSec: 300 },
  ],
} as Item
const artMediaBack = deserializeFeed(serializeFeed([artMedia]), ctx)[0] as any
console.log("Article.media 往返:")
ok(artMediaBack.media?.length === 3, `三个附件都在(得 ${artMediaBack.media?.length})`)
ok(artMediaBack.media?.some((m: any) => m.kind === "image" && m.url === "https://x/i.jpg" && m.width === 800 && m.height === 600 && m.title === "图"), "image 附件 URL/宽高/标题未丢")
ok(artMediaBack.media?.some((m: any) => m.kind === "video" && m.durationSec === 42 && m.width === 1920), "video 附件时长/宽高未丢")
ok(artMediaBack.media?.some((m: any) => m.kind === "audio" && m.url === "https://x/a.mp3" && m.durationSec === 300), "audio 附件未丢")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
