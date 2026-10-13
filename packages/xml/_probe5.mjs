import { XMLBuilder, XMLParser } from "fast-xml-parser"
const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })
for (const pe of [false, true]) {
  const b = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", suppressEmptyNode: true, cdataPropName: "__cdata", processEntities: pe })
  const title = "AT&T beats Q3 <estimates>"
  const tree = { rss: { channel: { item: [ { title, guid: { "@_isPermaLink": "false", "#text": "g1" }, enclosure: { "@_url": "https://a.com/x.mp3?a=1&b=2" } } ] } } }
  const xml = b.build(tree)
  console.log(`\n=== processEntities=${pe} ===`)
  console.log(xml)
  const out = p.parse(xml)
  const item = out.rss.channel.item
  console.log("title parsed:", JSON.stringify(item.title))
  console.log("url parsed:", JSON.stringify(item.enclosure?.["@_url"]))
}
