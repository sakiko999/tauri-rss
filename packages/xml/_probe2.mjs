import { XMLBuilder } from "fast-xml-parser"
const b = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", suppressEmptyNode: true, cdataPropName: "__cdata", processEntities: false })
const tree = { rss: { channel: { item: [ { title: "x", enclosure: { "@_url": "https://a.com/x.mp3?a=1&b=2", "@_type": "audio/mpeg" }, "media:thumbnail": { "@_url": "https://img/i.jpg?w=1&h=2" } } ] } } }
console.log(b.build(tree))
