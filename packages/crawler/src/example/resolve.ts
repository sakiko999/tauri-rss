/**
 * resolve —— 懒解析播放流(video + live 合一)。
 *
 * 能力抽离后:channel 只输出基础信息,流解析走 crawler/resolver(按 item.url)。
 * fetch → 取首个 item.url → resolvePlayByUrl/resolveLivePlayByUrl(url, info)。
 * bili 注入 core 默认 cookie(登录档位)。
 *
 * Run: bun run packages/crawler/src/example/resolve.ts [channel] [url]
 *   channel  可选:channel key(默认 bili:popular,video)
 *   url      可选:直接指定 item.url(默认取 fetch 首页首个 item)
 */
import { parseFeed, type Stream } from "@tauri-playground/xml"
import { resolveLivePlayByUrl, resolvePlayByUrl } from "@tauri-playground/resolve"
import { getChannel } from "../index.ts"
import { setupBackends, exampleInfo } from "./backend.ts"
import { DEFAULT_BILIBILI_COOKIE } from "../../../core/src/bilibili-cookie.ts"

async function main() {
  setupBackends()
  const key = process.argv[2] ?? "bili:popular"
  const ch = getChannel(key)
  if (!ch) throw new Error(`unknown channel: ${key}`)
  const cookie = key.startsWith("bili:") ? DEFAULT_BILIBILI_COOKIE : undefined
  const info = { ...exampleInfo(key), ...(cookie ? { cookie } : {}) }
  console.log(`channel: ${key}  ${ch.name}`)

  // 取待解析 url:显式传参 > fetch 首页首个 item.url。
  const explicitUrl = process.argv[3]
  const xml = await ch.getSource(info).fetch()
  const items = parseFeed(xml).channel.item
  const url = explicitUrl ?? items[0]?.link ?? ""
  if (!url) throw new Error(`channel ${key}: no item url`)
  console.log(`item:    ${items[0]?.title ?? "(untitled)"}`)
  console.log(`url:     ${url}`)

  // 统一走 resolver(按 url 路由 kind,自动分流 video/live)。
  const r = ch.kind === "live" ? await resolveLivePlayByUrl(url, info) : await resolvePlayByUrl(url, info)
  return printStreams(r.streams)
}

function printStreams(streams: Stream[]): void {
  console.log(`streams: ${streams.length} 条`)
  for (const [i, s] of streams.entries()) {
    const q = s.quality ? `${s.quality} ` : ""
    const u = s.url ?? ""
    console.log(`  [${i}] ${q}${s.format ?? ""} ${u.slice(0, 110)}${u.length > 110 ? "…" : ""}`)
    if (s.headers) console.log(`      headers: ${JSON.stringify(s.headers)}`)
  }
}

main().catch((err) => {
  console.error("❌ example failed:", err)
  process.exit(1)
})