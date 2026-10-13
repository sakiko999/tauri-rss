/**
 * opml 编解码自检 —— `bun packages/xml/src/example/opml.check.ts`
 *
 * 覆盖:往返保真(分组层级)、分组子树嵌套、跳过非 rss / 无 xmlUrl 轮廓、
 * 单元素不塌成数组。
 */
import { parseOpml, serializeOpml } from "../opml.ts"

let fails = 0
function ok(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

// 1. 往返:两条顶层 + 一个分组(两条) + 嵌套子分组(一条)
const doc = {
  title: "My Feeds",
  feeds: [
    { title: "Hacker News", xmlUrl: "https://hnrss.org/frontpage", htmlUrl: "https://news.ycombinator.com", groupPath: [] },
    { title: "阮一峰", xmlUrl: "https://www.ruanyifeng.com/blog/atom.xml", groupPath: [] },
    { title: "BBC World", xmlUrl: "https://feeds.bbci.co.uk/news/world/rss.xml", groupPath: ["新闻"] },
    { title: "NYT Home", xmlUrl: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", groupPath: ["新闻"] },
    { title: "TED", xmlUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC0RhatS1pyxInC00YKjjBqQ", groupPath: ["视频", "YouTube"] },
  ],
}
const xml = serializeOpml(doc)
const back = parseOpml(xml)

console.log("往返:")
ok(back.feeds.length === 5, `5 条 feed(得 ${back.feeds.length})`)
ok(back.feeds[0].xmlUrl === doc.feeds[0].xmlUrl, "顶层 1 保真")
ok(JSON.stringify(back.feeds[2].groupPath) === '["新闻"]', "一层分组保真")
ok(JSON.stringify(back.feeds[4].groupPath) === '["视频","YouTube"]', "两层嵌套分组保真")
ok(back.feeds.find((f) => f.title === "Hacker News")?.htmlUrl === "https://news.ycombinator.com", "htmlUrl 保真")

// 2. 解析外部 OPML:纯分组节点(xmlUrl 空)当层级、非 rss 轮廓跳过、单 outline 不成数组
const external = `<?xml version="1.0"?>
<opml version="2.0"><head><title>X</title></head><body>
  <outline text="科技">
    <outline type="rss" text="V2EX" xmlUrl="https://www.v2ex.com/index.xml"/>
    <outline text="音乐" type="rss" title="网易云" xmlUrl="http://music.163.com/x"/>
  </outline>
  <outline text="只有分组没有源"/>
  <outline type="link" text="某博客" url="https://example.com"/>
</body></opml>`
const ext = parseOpml(external)
console.log("外部 OPML:")
ok(ext.feeds.length === 2, `2 条 feed(得 ${ext.feeds.length})`)
ok(JSON.stringify(ext.feeds[0].groupPath) === '["科技"]', "xmlUrl 空的父节点当分组名")
ok(ext.feeds[1].title === "音乐", "text 优先于 title(OPML text = 显示名)")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
