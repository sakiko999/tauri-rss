/**
 * bili:popular 解析自检 —— `bun packages/crawler/src/example/bili-popular.check.ts`
 *
 * `parsePopularItems` 是主动 `fetch()` 的映射入口，这里用最小 payload 样本
 * 锁住字段映射（不需要真实网络 / 浏览器）。
 */
import type { Video } from "@amoeba/xml"
import { parsePopularItems } from "../channels/bili/popular.ts"

const FIXED = 1_700_000_000_000
// parsePopularItems 内部读宿主时钟；自检只注入 now。
;(globalThis as unknown as { appHost: unknown }).appHost = { now: () => FIXED }

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

const payload = {
  data: {
    list: [
      {
        title: "示例视频一",
        pic: "https://i0.hdslb.com/cover1.jpg",
        desc: "简介一",
        pubdate: 1_700_000_000,
        aid: 123,
        bvid: "BV1xx411c7mD",
        duration: 100,
        owner: { name: "UP主甲" },
      },
      { title: "示例视频二", aid: 789 },
    ],
  },
}

const items = parsePopularItems(payload) as Video[]
ok(items.length === 2, "两条样本都产出 item")
ok(items[0]?.kind === "video" && items[0]?.sourceId === "bili:popular", "kind/sourceId 正确")
ok(items[0]?.id === "BV1xx411c7mD", "id 用 bvid")
ok(items[0]?.url === "https://www.bilibili.com/video/BV1xx411c7mD", "url 走 bvid 路由")
ok(items[0]?.title === "示例视频一", "title 映射")
ok(items[0]?.summary === "简介一", "summary 取 desc")
ok(
  items[0]?.thumbnail === "https://i0.hdslb.com/cover1.jpg" &&
    items[0]?.poster === "https://i0.hdslb.com/cover1.jpg",
  "封面同时写 thumbnail/poster",
)
ok(items[0]?.author?.name === "UP主甲" && items[0]?.channel?.name === "UP主甲", "作者映射")
ok(items[0]?.publishedAt === 1_700_000_000 * 1000, "publishedAt = pubdate * 1000")
ok(items[0]?.duration === 100, "duration 透传")
ok(items[0]?.fetchedAt === FIXED, "fetchedAt 用宿主时钟")

ok(items[1]?.id === "av789" && items[1]?.url === "https://www.bilibili.com/video/av789", "无 bvid 回落 av 路由")
ok(items[1]?.publishedAt === undefined, "无 pubdate 时 publishedAt 留空")
ok(items[1]?.thumbnail === undefined && items[1]?.author === undefined, "缺字段不伪造")

ok(parsePopularItems(null).length === 0, "空 payload → 0 条")
ok(parsePopularItems({ data: {} }).length === 0, "无 list → 0 条")

if (fails) {
  console.error(`\n${fails} 项失败`)
  process.exit(1)
}
console.log("\n全部通过")
