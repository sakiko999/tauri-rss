import { readFileSync } from "node:fs"
import { parseFeed } from "../../packages/xml/src/xml-parser.ts"

const xml = readFileSync("X:/tauri-rss/tmp/adg.xml", "utf8")
const feed = parseFeed(xml)
const items = feed.channel.item
console.log("total entries:", items.length)
const empty = items.filter((i) => !i.link || i.link === "")
console.log("entries with empty/absent link:", empty.length)
console.log("first 3 links:", items.slice(0, 3).map((i) => i.link))
console.log("first 3 guids:", items.slice(0, 3).map((i) => i.guid))
