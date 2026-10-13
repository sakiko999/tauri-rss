import { serializeFeed } from "@tauri-playground/xml"
import type { Item } from "@tauri-playground/xml"
import { deserializeFeed } from "../processing/deserialize.ts"

const ctx = { subscriptionId: "s", now: 1700000000000 }

// Case A: introduction with bare "<"
const liveA: Item = {
  id: "live:A", sourceId: "live:douyin:hot", kind: "live",
  title: "房A", url: "https://live.douyin.com/1111", fetchedAt: 1,
  platform: "douyin", roomId: "1111", liveStatus: "live",
  introduction: "a < b",
}
const xmlA = serializeFeed([liveA], { channelTitle: "t" })
console.log("=== XML A ===")
console.log(xmlA)
const backA = deserializeFeed(xmlA, ctx)
console.log("items back:", backA.length, "introduction:", JSON.stringify((backA[0] as any)?.introduction))

// Case B: two items, live intro with unclosed tag, sibling video after
const liveB: Item = {
  id: "live:B", sourceId: "live:douyin:hot", kind: "live",
  title: "房B", url: "https://live.douyin.com/2222", fetchedAt: 1,
  platform: "douyin", roomId: "2222", liveStatus: "live",
  introduction: "hello <b>bold",
}
const videoB: Item = {
  id: "BV1", sourceId: "bili:popular", kind: "video", title: "视频B",
  url: "https://www.bilibili.com/video/BV1", fetchedAt: 1, duration: 100,
}
const xmlB = serializeFeed([liveB, videoB], { channelTitle: "t" })
console.log("=== XML B ===")
console.log(xmlB)
const backB = deserializeFeed(xmlB, ctx)
console.log("items back:", backB.length, "ids:", backB.map((i) => i.id))
