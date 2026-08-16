/**
 * 验证 m.weibo.cn 容器分页方式(page 参数 vs since_id 游标)。
 * 用 playwright 连临时 Edge profile(weibo 匿名可访问),fetch 首页 + 两种翻页,打印结果。
 *
 * 用法:
 *   ./node_modules/.bin/tsx packages/crawler/src/example/weibo-paging-check.ts [uid]
 */
import { chromium } from "playwright-core"
import { cdpJson, cdpNavigate } from "../browser/cdp.ts"
import { makePlaywrightBackend } from "./backend.ts"

const UID = process.argv[2] ?? "1195230310"

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: false })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const bb = makePlaywrightBackend(page, () => ctx.close())

  await cdpNavigate(bb, "https://m.weibo.cn/")

  const base = "https://m.weibo.cn/api/container/getIndex"
  const s1 = await cdpJson<{ ok?: number; data?: any }>(bb, `${base}?type=uid&value=${UID}`)
  const containerId = s1?.data?.tabsInfo?.tabs?.find((t: any) => t.tab_type === "weibo")?.containerid
  console.log("[weibo-paging] containerId:", containerId)

  // 首页(crawler 第二步:带 containerid 无 page)
  const s2 = await cdpJson<{ ok?: number; data?: any }>(
    bb,
    `${base}?type=uid&value=${UID}&containerid=${containerId}`,
  )
  console.log("[weibo-paging] 首页 cards:", s2?.data?.cards?.length, "cardlistInfo:", JSON.stringify(s2?.data?.cardlistInfo))

  // since_id 游标(标准滚动翻页):取首页最后一张 mblog 的 mid 作游标
  const homeCards = (s2?.data?.cards ?? []) as any[]
  const lastMblog = [...homeCards].reverse().find((c) => c.mblog)
  const sinceMid = lastMblog?.mblog?.mid ?? lastMblog?.mblog?.idstr
  console.log("[weibo-paging] 首页最后 mblog mid:", sinceMid)
  if (sinceMid) {
    const p3 = await cdpJson<{ ok?: number; data?: any }>(
      bb,
      `${base}?type=uid&value=${UID}&containerid=${containerId}&since_id=${sinceMid}`,
    )
    console.log("[weibo-paging] since_id=mid cards:", p3?.data?.cards?.length, "cardlistInfo:", JSON.stringify(p3?.data?.cardlistInfo)?.slice(0, 150))
    const p3Cards = (p3?.data?.cards ?? []) as any[]
    for (const c of p3Cards.slice(0, 3)) {
      console.log("[weibo-paging]   p3卡 type:", c.card_type, "hasMblog:", !!c.mblog, c.mblog?.id_str ?? "")
    }
  }

  // page=1(试起始页)
  const p1 = await cdpJson<{ ok?: number; data?: any }>(
    bb,
    `${base}?type=uid&value=${UID}&containerid=${containerId}&page=1`,
  )
  console.log("[weibo-paging] page=1 cards:", p1?.data?.cards?.length, "cardlistInfo:", JSON.stringify(p1?.data?.cardlistInfo)?.slice(0, 120))

  await bb.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("[weibo-paging] 失败:", e)
  process.exit(1)
})
