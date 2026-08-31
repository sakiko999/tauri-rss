/**
 * hot — 热搜词下微博流探针(收编 core example/verify-new-channels.ts 的 resolveHotWord 部分)。
 *
 * desktop 热搜三栏:点热搜词 → weibo:hot 渠道 resolveHotWord(word) → 该词下微博流。
 * 必须走 DataLayer(非 crawler 直连):resolveHotWord 内部经 sourceInfoFor 从
 * settings 自动注入 weibo cookie(WeiboHotChannel.resolveHotWordImpl 需登录 cookie),
 * crawler 直连绕过 settings 无 cookie 会失败。
 *
 * 依赖:dl.resolveHotWord(subscriptionId, word) 返回 MediaItem[](social,不写 store)。
 */
import pc from "picocolors"
import { createDataLayer } from "@tauri-playground/core"
import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"

export interface HotOptions {
  json?: boolean
  n?: number
}

/** 找既有 weibo:hot 订阅,无则新建(id 生成沿用 DataLayer.addSubscription)。 */
async function ensureHotSubscription(dl: ReturnType<typeof createDataLayer>): Promise<string> {
  const existing = (await dl.subscriptions.list()).find((s) => s.channelKey === "weibo:hot")
  if (existing) return existing.id
  return dl.addSubscription("weibo:hot", "微博实时热搜", {})
}

export async function runHot(word: string, opts: HotOptions): Promise<void> {
  const dl = createDataLayer()
  const subId = await ensureHotSubscription(dl)

  const elapsed = startTimer()
  const items = await dl.resolveHotWord(subId, word)
  const ms = elapsed()
  const n = opts.n ?? 8

  if (opts.json) {
    printJson({ word, tookMs: Math.round(ms), subscriptionId: subId, count: items.length, items: items.slice(0, n) })
    return
  }

  console.log(`热搜词「${word}」— ${items.length} 条,${fmtMs(ms)}${pc.dim(`  (sub:${subId})`)}`)
  for (const it of items.slice(0, n)) {
    const imgCount = it.kind === "social" ? it.images?.length ?? 0 : "-"
    const likes = it.kind === "social" && it.likes !== undefined ? `${it.likes} 赞` : ""
    console.log(`  · ${trunc(it.title ?? "(untitled)", 52)}${pc.dim(`  图:${imgCount} ${likes}`)}`)
  }
}
