import { XMLBuilder, XMLParser } from "fast-xml-parser"
const b = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", suppressEmptyNode: true, cdataPropName: "__cdata", processEntities: false })
const tree = { rss: { channel: { item: [ { title: "x", enclosure: { "@_url": "https://a.com/x.mp3?a=1&b=2", "@_type": "audio/mpeg" }, "media:thumbnail": { "@_url": "https://img/i.jpg?w=1&h=2" } } ] } } }
const xml = b.build(tree)
console.log("XML:", xml)
const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })
try {
  const out = p.parse(xml)
  console.log("PARSED:", JSON.stringify(out.rss.channel.item))
} catch (e) {
  console.log("PARSE ERROR:", e.message)
}
