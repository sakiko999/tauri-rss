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

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
