import { XMLBuilder, XMLParser } from "fast-xml-parser"
for (const pe of [false, true]) {
  const b = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", suppressEmptyNode: true, cdataPropName: "__cdata", processEntities: pe })
  const tree = { rss: { channel: { item: [ { title: "a & b <c>", description: { __cdata: "hello <b>&</b> world" }, enclosure: { "@_url": "https://a.com/x.mp3?a=1&b=2" } } ] } } }
  const xml = b.build(tree)
  console.log(`--- processEntities=${pe} ---`)
  console.log(xml)
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })
  console.log("PARSED:", JSON.stringify(p.parse(xml).rss.channel.item[0]))
}
