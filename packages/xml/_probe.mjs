import { XMLParser } from "fast-xml-parser"
const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })
const rss = `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><item><title>Ep</title><enclosure url="https://a.com/a.mp3" type="audio/mpeg" length="123"/><enclosure url="https://a.com/b.mp3" type="audio/mpeg" length="456"/><itunes:duration>12:34</itunes:duration><itunes:image href="https://img/x.jpg"/></item></channel></rss>`
const out = p.parse(rss)
console.log(JSON.stringify(out.rss.channel.item, null, 2))
