/**
 * opml 映射自检(desktop 侧)—— `bun apps/desktop/src/lib/opml.check.ts`
 *
 * 覆盖:分组路径拼装(嵌套)、只导出带 url 的 rss 订阅(rsshub/直播渠道排除)、
 * 导入去重(同 xmlUrl 跳过)。
 */
import { exportOpml, pendingImports } from "./opml.ts"
import { parseOpml } from "@amoeba/xml"

let fails = 0
const ok = (cond: unknown, label: string) => {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

const groups = [
  { id: "g1", title: "视频" },
  { id: "g2", title: "科技", parentId: "g1" }, // 嵌套:视频 > 科技
]
const subs = [
  { id: "s1", channelKey: "rss:url", title: "A", info: { url: "https://a.com/rss" }, groupId: "g2" },
  { id: "s2", channelKey: "rss:hn", title: "B", info: { url: "https://b.com/rss" }, groupId: null },
  { id: "s3", channelKey: "bili:popular", title: "C", info: {}, groupId: null }, // 无 url → 排除
  { id: "s4", channelKey: "rsshub:feed", title: "D", info: { url: "https://rh/x" }, groupId: null }, // rsshub → 排除
] as any

console.log("导出:")
const doc = parseOpml(exportOpml(subs, groups))
ok(doc.feeds.length === 2, `只导出带 url 的非 rsshub 订阅(得 ${doc.feeds.length})`)
ok(JSON.stringify(doc.feeds.find((f) => f.title === "A")?.groupPath) === '["视频","科技"]', "嵌套分组路径")
ok(doc.feeds.find((f) => f.title === "B")?.groupPath.length === 0, "未分组 → 顶层")

console.log("导入去重:")
const incoming = parseOpml(`<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline type="rss" text="A" xmlUrl="https://a.com/rss"/>
  <outline type="rss" text="新源" xmlUrl="https://new.com/rss"/>
</body></opml>`)
const { feeds, skipped } = pendingImports(incoming, subs as any)
ok(feeds.length === 1 && feeds[0].xmlUrl === "https://new.com/rss", "已订阅的被跳过,新源保留")
ok(skipped === 1, `跳过计数 = 1(得 ${skipped})`)

// 等价 URL 视为重复:尾斜杠 + host 大小写;http/https 不合并(可能是不同 feed)
const equiv = parseOpml(`<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline type="rss" text="A2" xmlUrl="https://A.com/rss/"/>
  <outline type="rss" text="新源2" xmlUrl="https://new.com/rss/"/>
  <outline type="rss" text="新源3" xmlUrl="https://new.com/rss"/>
</body></opml>`)
const e2 = pendingImports(equiv, subs as any)
ok(e2.feeds.length === 1 && e2.feeds[0].xmlUrl === "https://new.com/rss/", "尾斜杠+大小写归一后判重(新源2 保留,新源3 视为同一条)")
ok(e2.skipped === 2, `等价归一 + 批内去重:跳过 2(得 ${e2.skipped})`)

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
