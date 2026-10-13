import { serializeFeed } from "./packages/xml/src/serialize.ts"
import { deserializeFeed } from "./packages/core/src/processing/deserialize.ts"
const ctx = { subscriptionId: "s", now: 1700000000000 }

// R. quote/amp in title text node
const r: any = { id: "r", sourceId: "s", kind: "article", title: `he said "hi" & 'bye'`, url: "https://x/r?a=1&b=2", fetchedAt: 1 }
const rxml = serializeFeed([r])
console.log("R xml:", JSON.stringify(rxml.slice(0, 220)))
console.log("R round:", JSON.stringify(deserializeFeed(rxml, ctx)[0].title), JSON.stringify(deserializeFeed(rxml, ctx)[0].url))

// S. thumbnail url with quote + amp (goes into @_url attribute)
const s: any = { id: "s", sourceId: "s", kind: "video", title: "t", url: "https://x/s", fetchedAt: 1, thumbnail: `https://img/x?a=1&b=2"z` }
const sxml = serializeFeed([s])
console.log("S xml:", JSON.stringify(sxml.slice(sxml.indexOf("media:thumbnail") - 3, sxml.indexOf("media:thumbnail") + 90)))
console.log("S thumb round:", JSON.stringify(deserializeFeed(sxml, ctx)[0].thumbnail))

// T. control char 0x0B in content (illegal in XML 1.0)
const t: any = { id: "t", sourceId: "s", kind: "article", title: "t", url: "https://x/t", fetchedAt: 1, content: "a\u000Bb" }
try {
  const txml = serializeFeed([t])
  const back = deserializeFeed(txml, ctx)[0]
  console.log("T control-char content round:", JSON.stringify(back.content), "hasBEL:", txml.includes("\u000B"))
} catch (e: any) { console.log("T threw:", e.message) }

// U. empty title
const u: any = { id: "u", sourceId: "s", kind: "article", title: "", url: "https://x/u", fetchedAt: 1 }
const uxml = serializeFeed([u])
console.log("U empty-title xml has <title/>:", /<title\s*\/>/.test(uxml) || /<title><\/title>/.test(uxml), "-> round:", JSON.stringify(deserializeFeed(uxml, ctx)[0].title))

// V. summary with newline / tabs
const v: any = { id: "v", sourceId: "s", kind: "article", title: "t", url: "https://x/v", fetchedAt: 1, summary: "line1\nline2\ttab" }
console.log("V summary round:", JSON.stringify(deserializeFeed(serializeFeed([v]), ctx)[0].summary))
