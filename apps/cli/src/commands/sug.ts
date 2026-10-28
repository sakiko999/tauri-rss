/**
 * sug — 搜索联想词探针(输入前缀 → 补全候选)。
 *
 * 抖音联想(`fetchDouyinSuggestions`,匿名可用,实测 2026-10)是「抖音搜索增强」里
 * **不需要登录**的那半:搜索本身(live/search)2483 需登录,但联想词匿名可用,
 * 可独立作为「输入补全」能力(桌面「添加订阅/搜主播」时的输入提示)。
 *
 * 走 resolve 直连(无 cookie/无 DataLayer)——联想的输入只有前缀,无订阅语义。
 */
import { fetchDouyinSuggestions } from "@amoeba/resolve"

import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"

export interface SugOptions {
  json?: boolean
}

export async function runSug(keyword: string, opts: SugOptions): Promise<void> {
  const kw = keyword.trim()
  if (!kw) throw new Error("sug 需要关键词")

  const elapsed = startTimer()
  const words = await fetchDouyinSuggestions(kw)
  const ms = elapsed()

  if (opts.json) {
    printJson({ keyword: kw, platform: "douyin", tookMs: Math.round(ms), count: words.length, words })
    return
  }
  console.log(`抖音联想词「${kw}」— ${words.length} 条,${fmtMs(ms)}`)
  for (const w of words) console.log(`  · ${trunc(w, 60)}`)
}
