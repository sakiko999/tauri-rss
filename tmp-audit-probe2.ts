import { serializeFeed } from "./packages/xml/src/serialize.ts"
import { deserializeFeed } from "./packages/core/src/processing/deserialize.ts"
import { parseOpml, serializeOpml } from "./packages/xml/src/opml.ts"

const ctx = { subscriptionId: "s", now: 1700000000000 }
const rt = (x: any) => { try { return JSON.stringify(deserializeFeed(serializeFeed([x]), ctx)[0]) } catch (e: any) { return "ERR " + e.message } }

// G. content containing CDATA terminator "]]>"
const g: any = { id: "g", sourceId: "s", kind: "article", title: "t", url: "https://x/g", fetchedAt: 1, content: "before ]]> after & more" }
try {
  const xml = serializeFeed([g])
  console.log("G xml snippet:", JSON.stringify(xml.slice(xml.indexOf("content:encoded"), xml.indexOf("content:encoded") + 80)))
  console.log("G content round-trip:", JSON.stringify(deserializeFeed(xml, ctx)[0].content))
} catch (e: any) { console.log("G threw:", e.message) }

// H. article media[] with kind image only
const h: any = {
  id: "h", sourceId: "s", kind: "article", title: "t", url: "https://x/h", fetchedAt: 1,
  content: "body", media: [
    { kind: "image", url: "https://img/1.jpg", width: 10, height: 20 },
    { kind: "image", url: "https://img/2.jpg" },
  ],
}
const hb: any = deserializeFeed(serializeFeed([h]), ctx)[0]
console.log("H article image media round-trip:", JSON.stringify(hb.media))

// I. guid/id with XML special char (id is #text of guid element)
const i: any = { id: "id&<>\"'", sourceId: "s", kind: "article", title: "t", url: "https://x", fetchedAt: 1 }
const ib: any = deserializeFeed(serializeFeed([i]), ctx)[0]
console.log("I id round-trip:", JSON.stringify(ib.id), "expected:", JSON.stringify("id&<>\"'"))

// J. title / summary with leading trailing whitespace
const j: any = { id: "j", sourceId: "s", kind: "article", title: "  padded  ", url: "https://x", fetchedAt: 1, summary: " s " }
const jb: any = deserializeFeed(serializeFeed([j]), ctx)[0]
console.log("J title/summary whitespace:", JSON.stringify(jb.title), JSON.stringify(jb.summary))

// K. OPML: feed title contains xmlUrl-like or group title collides / empty group name
const kfeed = { title: "A", xmlUrl: "https://a/x", groupPath: ["G", "", "H"] }
const kd = serializeOpml({ title: "T", feeds: [kfeed] })
console.log("K opml with empty group segment -> groupPath:", JSON.stringify(parseOpml(kd).feeds[0]?.groupPath))

// L. OPML: two sibling groups, feed at group + feed at top with SAME title
const l = serializeOpml({ title: "T", feeds: [
  { title: "same", xmlUrl: "https://x/1", groupPath: [] },
  { title: "same", xmlUrl: "https://x/2", groupPath: [] },
]})
console.log("L opml dup top feeds:", parseOpml(l).feeds.map(f => f.xmlUrl).join(", "))

// M. OPML title with newline (format:true indentation) — textOf trims
const m = serializeOpml({ title: "T", feeds: [{ title: "line1\nline2", xmlUrl: "https://x/m", groupPath: [] }] })
console.log("M opml newline title round-trip:", JSON.stringify(parseOpml(m).feeds[0].title))

// N. live online = 0 (falsy) round-trip
const n: any = { id: "n", sourceId: "s", kind: "live", title: "t", url: "https://live.douyu.com/9", fetchedAt: 1, platform: "douyu", roomId: "9", liveStatus: "live", online: 0 }
const nb: any = deserializeFeed(serializeFeed([n]), ctx)[0]
console.log("N live online=0 round-trip:", nb.online)

// O. social likes = 0
const o: any = { id: "o", sourceId: "s", kind: "social", title: "t", url: "https://x/o", fetchedAt: 1, content: "c", likes: 0, replies: 0, reposts: 0 }
const ob: any = deserializeFeed(serializeFeed([o]), ctx)[0]
console.log("O social 0-counters round-trip:", ob.likes, ob.replies, ob.reposts)

// P. video duration = 0
const p: any = { id: "p", sourceId: "s", kind: "video", title: "t", url: "https://x/p", fetchedAt: 1, duration: 0 }
const pb: any = deserializeFeed(serializeFeed([p]), ctx)[0]
console.log("P video duration=0 round-trip:", pb.duration)

// Q. summary containing only "&" bare or CDATA-only
const q: any = { id: "q", sourceId: "s", kind: "article", title: "t", url: "https://x/q", fetchedAt: 1, summary: "a & b <c> d" }
const qb: any = deserializeFeed(serializeFeed([q]), ctx)[0]
console.log("Q summary html-ish round-trip:", JSON.stringify(qb.summary))
