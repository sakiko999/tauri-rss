/**
 * fetch — 单渠道抓取探针(★ 高频)。
 * 计时 + 条数 + 样本;--xml 看原始输出;--json 进管道配 jq;失败完整堆栈。
 */
import pc from "picocolors"
import { getChannel } from "@tauri-playground/crawler"
import { parseFeed } from "@tauri-playground/xml"
import { buildInfo, parseKvPairs } from "../info.ts"
import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"

export interface FetchOptions {
  xml?: boolean
  json?: boolean
  n?: number
  /** k=v 覆盖(可重复传 --kv;空值 `cookie=` 合法 = 强制匿名)。 */
  kv?: string | string[]
}

export async function runFetch(key: string, opts: FetchOptions): Promise<void> {
  const ch = getChannel(key)
  if (!ch) throw new Error(`unknown channel: ${key}(rss channels 查看全部)`)
  const info = await buildInfo(key, parseKvPairs(opts.kv))

  const elapsed = startTimer()
  const xml = await ch.getSource(info).fetch()
  const ms = elapsed()

  if (opts.xml) {
    process.stdout.write(xml)
    return
  }
  const items = parseFeed(xml).channel.item
  const n = opts.n ?? 5
  if (opts.json) {
    printJson({ channel: key, tookMs: Math.round(ms), count: items.length, items: items.slice(0, n) })
    return
  }
  console.log(`${ch.key} (${ch.name}) — ${items.length} 条,${fmtMs(ms)}`)
  for (const it of items.slice(0, n)) {
    console.log(`  · ${trunc(it.title ?? "(untitled)", 64)}${pc.dim(`  ${it.link ?? ""}`)}`)
  }
}
