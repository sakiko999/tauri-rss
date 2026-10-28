/**
 * 分区目录条目自检 —— `bun packages/crawler/src/example/category-directory.check.ts`
 *
 * 目录是**一个订阅**（`kind:"category"`），每条必须带完整的目标参数；UI 点开时
 * 原样交给 `previewChannel(categoryChannel, categoryInfo)`。抖音顶层尤其容易漏
 * `partitionType`（应为 4，曾默认成子分区的 1 → 取不到数据）。
 */
import type { Category } from "@amoeba/xml"
import type { DouyinCategory, DouyuCategory, HuyaSubCategory } from "@amoeba/resolve"
import { douyinCategoryItems } from "../channels/douyin/categories.ts"
import { douyuCategoryItems } from "../channels/douyu/categories.ts"
import { huyaCategoryItems } from "../channels/huya/categories.ts"

const FIXED = 1_700_000_000_000
let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

console.log("抖音分区目录条目:")
const douyinTree: DouyinCategory[] = [
  { partition: { id: "101", type: 4, title: "聊天" }, subs: [] },
  {
    partition: { id: "103", type: 4, title: "游戏" },
    subs: [
      { id: "1010017", type: 1, title: "无畏契约" },
      { id: "1010045", type: 1, title: "王者荣耀" },
    ],
  },
]
const dy = douyinCategoryItems("live:douyin:categories", FIXED, douyinTree) as Category[]
ok(dy.length === 4, `顶层 + 子分区全展开（得 ${dy.length}）`)
ok(
  dy.every((i) => i.kind === "category"),
  "全部 kind=category",
)
ok(
  dy.every((i) => i.categoryChannel === "live:douyin:category"),
  "categoryChannel 指向 live:douyin:category",
)
const chat = dy.find((i) => i.title === "聊天")
ok(chat?.categoryInfo.partition === "101", `顶层 partition（得 ${chat?.categoryInfo.partition}）`)
ok(chat?.categoryInfo.partitionType === "4", `顶层 partitionType=4（得 ${chat?.categoryInfo.partitionType}）`)
ok(chat?.summary === "顶层分区", `顶层 summary（得 ${chat?.summary}）`)
const sub = dy.find((i) => i.title === "无畏契约")
ok(sub?.categoryInfo.partition === "1010017", `子分区 partition（得 ${sub?.categoryInfo.partition}）`)
ok(sub?.categoryInfo.partitionType === "1", `子分区 partitionType=1（得 ${sub?.categoryInfo.partitionType}）`)
ok(sub?.summary === "游戏 · 子分区", `子分区 summary（得 ${sub?.summary}）`)
ok(dy.find((i) => i.title === "游戏")?.summary === "2 个子分区", "有子分区时 summary 计数")
ok(
  dy.every((i) => i.fetchedAt === FIXED && i.sourceId === "live:douyin:categories"),
  "sourceId/fetchedAt 透传",
)

console.log("斗鱼分区目录条目:")
const douyuTree: DouyuCategory[] = [
  {
    id: "1",
    name: "网游竞技",
    children: [
      { id: "1", name: "英雄联盟" },
      { id: "270", name: "热门游戏" },
    ],
  },
  { id: "8", name: "手游休闲", children: [{ id: "181", name: "王者荣耀" }] },
]
const dyu = douyuCategoryItems("live:douyu:categories", FIXED, douyuTree) as Category[]
ok(dyu.length === 3, `只列二级分区（得 ${dyu.length}）`)
ok(dyu[0]?.categoryInfo.areaId === "1", `categoryInfo.areaId（得 ${dyu[0]?.categoryInfo.areaId}）`)
ok(dyu[0]?.summary === "网游竞技", `summary = 父级（得 ${dyu[0]?.summary}）`)
ok(
  dyu.every((i) => i.categoryChannel === "live:douyu:category"),
  "categoryChannel 指向斗鱼分区",
)

console.log("虎牙分区目录条目:")
const huyaSubs: HuyaSubCategory[] = [
  { id: "1", name: "英雄联盟", parentId: "1", parentName: "网游" },
  { id: "862", name: "CS2", parentId: "1", parentName: "网游" },
]
const hy = huyaCategoryItems("live:huya:categories", FIXED, huyaSubs) as Category[]
ok(hy.length === 2, "二级分区全量")
ok(hy[0]?.categoryInfo.gameId === "1", `categoryInfo.gameId（得 ${hy[0]?.categoryInfo.gameId}）`)
ok(hy[0]?.summary === "网游", `summary = 父级（得 ${hy[0]?.summary}）`)

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
