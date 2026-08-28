/**
 * item — by-url 一站式探针(★ 高频)。
 * resolveRoute 命中 → streams 全档位表(format/quality/rate/headers/dashManifest)
 * → 弹幕元信息。play 命令共用 resolveByUrl/printStreams。
 */
import pc from "picocolors"
import type { Stream } from "@tauri-playground/xml"
import {
  resolveLivePlayByUrl,
  resolvePlayByUrl,
  resolveRoute,
  type ResolveRoute,
  type SourceInfo,
} from "@tauri-playground/resolve"
import { cookieForUrl, loadSettings } from "../info.ts"
import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"

export interface ResolvedItem {
  route: ResolveRoute
  streams: Stream[]
  tookMs: number
}

/** 路由 + 平台 cookie 的统一装载(item/dm 共用;settings 按 url 域注入 bili 登录 cookie)。 */
export async function routeWithCookie(url: string): Promise<{ route: ResolveRoute; cookie?: string }> {
  const route = resolveRoute(url)
  if (!route) {
    throw new Error(`url 未命中 resolver 路由(支持 bili 视频/直播、youtube、douyu/huya/douyin 直播): ${url}`)
  }
  const settings = await loadSettings()
  return { route, cookie: cookieForUrl(url, settings) }
}

/** route → 解析(settings 按 url 域自动注入 bili 登录 cookie,解锁登录档位)。 */
export async function resolveByUrl(url: string): Promise<ResolvedItem> {
  const { route, cookie } = await routeWithCookie(url)
  const info: SourceInfo = {}
  if (cookie) info.cookie = cookie

  const elapsed = startTimer()
  const { streams } =
    route.kind === "live" ? await resolveLivePlayByUrl(url, info) : await resolvePlayByUrl(url, info)
  return { route, streams, tookMs: elapsed() }
}

/** 弹幕能力一行注(平台 × kind;与 resolver/danmaku.ts 对齐)。 */
export function danmakuNote(route: ResolveRoute): string {
  if (route.platform === "youtube") return route.kind === "live" ? "有(live chat 轮询)" : "无(VOD 无弹幕)"
  return `有 · ${route.kind === "video" ? "vod" : "live"}(${route.platform})`
}

/** streams 全档位表(item/play 共用渲染)。 */
export function printStreams(streams: Stream[]): void {
  console.log(`streams: ${streams.length} 条`)
  streams.forEach((s, i) => {
    const tags = [s.quality, s.format && `${s.format}`, s.rate !== undefined && `rate=${s.rate}`]
      .filter(Boolean)
      .join(" ")
    const u = s.url ?? ""
    console.log(`  [${i}] ${pc.cyan(tags)} ${trunc(u, 100)}${u.length > 100 ? pc.dim(` (+${u.length - 100})`) : ""}`)
    if (s.dashManifest) console.log(pc.dim(`      dashManifest: ${s.dashManifest.length} chars`))
    if (s.headers) console.log(pc.dim(`      headers: ${JSON.stringify(s.headers)}`))
  })
}

export interface ItemOptions {
  json?: boolean
}

/** 解析结果人读输出(item/play 共用)。 */
export function printResolved(r: ResolvedItem): void {
  console.log(`route:   ${r.route.platform} ${r.route.kind} ${r.route.id}`)
  console.log(`resolve: ${fmtMs(r.tookMs)}`)
  printStreams(r.streams)
  console.log(`danmaku: ${danmakuNote(r.route)}`)
}

export async function runItem(url: string, opts: ItemOptions): Promise<void> {
  const r = await resolveByUrl(url)
  if (opts.json) {
    printJson({
      url,
      route: r.route,
      tookMs: Math.round(r.tookMs),
      danmaku: { kind: r.route.kind === "video" ? "vod" : "live", note: danmakuNote(r.route) },
      streams: r.streams,
    })
    return
  }
  printResolved(r)
}
