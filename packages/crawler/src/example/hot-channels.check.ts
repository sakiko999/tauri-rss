/**
 * 热搜榜单渠道的 kind 归类自检 ——
 * `bun packages/crawler/src/example/hot-channels.check.ts`
 *
 * 热搜词条是**关键词**,不是可读文章。`bili:square` 曾声明 `kind: "article"`:
 * 词条于是混进「阅读」列表、被「一键归类」塞进「文章」分组,点开只有一个词的正文。
 * 三个热搜榜渠道必须同为 social(与 `weibo:hot` / `douyin:trend` 一致)。
 *
 * 第二条是给**新增渠道**的守卫:名字里带「热搜/热点」的渠道若声明成 article,
 * 会以同样的方式静默污染阅读流 —— 这里直接拦下。
 */
import { listChannels } from "../index.ts"
import { squareItems } from "../channels/bili/square.ts"

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

const channels = listChannels()
const byKey = new Map(channels.map((c) => [c.key, c]))

console.log("热搜榜渠道:")
for (const key of ["bili:square", "weibo:hot", "douyin:trend"]) {
  ok(byKey.get(key)?.kind === "social", `${key} kind = social(词条不是文章)`)
}

console.log("新增热搜渠道守卫:")
{
  // 「直播热门」是直播间(live),不受此约束 —— 只按「热搜/热点词」命名判定。
  const keywordChannels = channels.filter((c) => /热搜|热点/.test(c.name))
  ok(keywordChannels.length >= 3, `识别到 ${keywordChannels.length} 条热搜/热点渠道`)
  for (const c of keywordChannels) {
    ok(c.kind === "social", `${c.key}(${c.name}) kind = ${c.kind},应为 social`)
  }
}

console.log("条目级输出(权威 = tpl:kind):")
{
  // 渠道元数据的 kind 只是声明;core 归档看条目(tpl:kind)。这里直接跑映射函数。
  const items = squareItems(
    [
      { keyword: "AI", link: "https://search.bilibili.com/all?keyword=AI", icon: "https://i0.hdslb.com/x.jpg" },
      { keyword: "没有链接" },
    ],
    1_700_000_000_000,
  )
  ok(items.length === 2, "两条词条都产出条目")
  ok(items.every((i) => i.kind === "social"), "条目 kind = social(不是 article)")
  ok(
    items.every((i) => !/[<>]/.test(String((i as { content?: string }).content ?? ""))),
    "正文是纯文本(social 卡片按文本渲染)",
  )
  ok(items[0]?.thumbnail === "https://i0.hdslb.com/x.jpg", "icon → thumbnail")
  ok(items[1]?.url?.includes("search.bilibili.com"), "缺 link 时用关键词拼搜索地址")
  ok(items[0]?.id === "bili-rank-AI", "id 只用词(位次变化不算新条目)")
}

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
