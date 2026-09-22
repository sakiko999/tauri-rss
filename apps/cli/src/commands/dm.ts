/**
 * dm — 弹幕探针(收编 crawler example/test-danmaku.ts 的单 url 版)。
 * VOD:等首批(全量分段)打印前 n 条;live:固定窗口采集 + 连接帧数统计。
 * bili 登录 cookie 由 settings 自动注入(可选;直播弹幕 2026-09 实测**匿名可用**,见
 * resolve/platform/bili/danmaku-live.ts)。
 */
import pc from "picocolors"
import type { DanmakuItem } from "@tauri-playground/resolve"
import { getDanmakuByUrl } from "@tauri-playground/resolve"
import { routeWithCookie } from "./item.ts"
import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"

export interface DmOptions {
  n?: number
  seconds?: number
  json?: boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runDm(url: string, opts: DmOptions): Promise<void> {
  const { route, cookie } = await routeWithCookie(url)
  const kind = route.kind === "video" ? "vod" : "live"

  const elapsed = startTimer()
  const stream = getDanmakuByUrl(url, { cookie, kind })
  const items: DanmakuItem[] = []
  const unsub = stream((batch) => items.push(...batch))

  try {
    if (kind === "vod") {
      // 等首批到位(bili VOD seg 拉取一次全推);10s 上限防挂死。
      const deadline = Date.now() + 10_000
      while (items.length === 0 && Date.now() < deadline) await sleep(100)
    } else {
      await sleep((opts.seconds ?? 5) * 1000)
    }
  } finally {
    unsub() // 一定退订:直播 WS 连接不释放会泄漏
  }
  const ms = elapsed()

  const n = opts.n ?? (kind === "vod" ? 10 : 3)
  if (opts.json) {
    printJson({ url, platform: route.platform, kind, tookMs: Math.round(ms), count: items.length, sample: items.slice(0, n) })
    return
  }
  console.log(`route:   ${route.platform} ${kind} ${route.id}${cookie ? pc.dim("  (带登录 cookie)") : ""}`)
  console.log(`frames:  ${items.length} 条,${fmtMs(ms)}`)
  for (const d of items.slice(0, n)) {
    const who = d.user ? `${d.user}: ` : ""
    const when = d.timeMs !== undefined ? pc.dim(` [${(d.timeMs / 1000).toFixed(1)}s]`) : ""
    console.log(`  · ${who}${trunc(d.text, 60)}${when}`)
  }
}
