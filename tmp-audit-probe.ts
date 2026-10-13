import { serializeFeed } from "./packages/xml/src/serialize.ts"
import { deserializeFeed } from "./packages/core/src/processing/deserialize.ts"

const ctx = { subscriptionId: "s", now: 1700000000000 }

// A. social images as plain string[] (type allows string | SocialImage)
const s1: any = {
  id: "n1", sourceId: "s", kind: "social", title: "t", url: "https://x/n1",
  fetchedAt: 1, content: "body",
  images: ["https://img/a.jpg", { url: "https://img/b.jpg", width: 100, height: 200 }],
}
const s1b: any = deserializeFeed(serializeFeed([s1]), ctx)[0]
console.log("A social images round-trip:", JSON.stringify(s1b.images))

// B. video stream with format hls (direct stream, non-{audio,video}/ mime)
const v1: any = {
  id: "BV1", sourceId: "s", kind: "video", title: "t", url: "https://x/v",
  fetchedAt: 1, stream: { url: "https://cdn/x.m3u8", format: "application/vnd.apple.mpegurl" },
}
const v1b: any = deserializeFeed(serializeFeed([v1]), ctx)[0]
console.log("B video stream.format round-trip:", v1b.stream && v1b.stream.format)

// B2. audio stream (podcast) format = mime (audio/mpeg) - control
const a1: any = {
  id: "ep", sourceId: "s", kind: "audio", title: "t", url: "https://x/ep",
  fetchedAt: 1, stream: { url: "https://cdn/x.mp3", format: "audio/mpeg" },
}
const a1b: any = deserializeFeed(serializeFeed([a1]), ctx)[0]
console.log("B2 audio stream.format round-trip:", a1b.stream && a1b.stream.format)

// C. live quality dropped
const l1: any = {
  id: "r1", sourceId: "s", kind: "live", title: "t", url: "https://live.douyu.com/1",
  fetchedAt: 1, platform: "douyu", roomId: "1", liveStatus: "live", quality: "原画",
}
const l1b: any = deserializeFeed(serializeFeed([l1]), ctx)[0]
console.log("C live.quality round-trip:", l1b.quality)

// D. contentFormat on a non-article kind (contract type requires it)
const v2: any = {
  id: "BV2", sourceId: "s", kind: "video", title: "t", url: "https://x/v",
  fetchedAt: 1, contentFormat: "markdown",
}
console.log("D video contentFormat written to xml:", /tpl:contentFormat/.test(serializeFeed([v2])))

// E. Live showTime/notice round-trip (claimed covered? guard doesn't test them)
const l2: any = {
  id: "r2", sourceId: "s", kind: "live", title: "t", url: "https://live.bilibili.com/2",
  fetchedAt: 1, platform: "bilibili", roomId: "2", liveStatus: "live",
  notice: "公告", showTime: "2026-10-13 20:00",
}
const l2b: any = deserializeFeed(serializeFeed([l2]), ctx)[0]
console.log("E live notice/showTime:", l2b.notice, "/", l2b.showTime)

// F. article with no content (description-only) -> contentFormat inference
const artNoContent: any = {
  id: "a", sourceId: "s", kind: "article", title: "t", url: "https://x/a",
  fetchedAt: 1, summary: "just a summary", contentFormat: "text",
}
const afb: any = deserializeFeed(serializeFeed([artNoContent]), ctx)[0]
console.log("F article content round-trip (desc only):", JSON.stringify(afb.content), "fmt:", afb.contentFormat)
