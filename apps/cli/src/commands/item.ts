/**
 * item — by-url 一站式探针(★ 高频)。
 * resolveRoute 命中 → streams 全档位表(format/quality/rate/headers/dashManifest)
 * → 弹幕元信息。play 命令共用 resolveByUrl/printStreams。
 *
 * cookie:平台登录态由 credentials provider(client 内部兜底)提供,这里不再按
 * url 域手抄注入表(旧表缺 douyin;CLI 入口 main.ts 已注册同源 provider)。
 */

import { resolveLivePlayByUrl, resolvePlayByUrl, type ResolveRoute, resolveRoute } from "@amoeba/resolve"
import type { Stream } from "@amoeba/xml"
import pc from "picocolors"

import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"
import { probeResolve } from "./probe.ts"

export interface ResolvedItem {
  route: ResolveRoute
  streams: Stream[]
  tookMs: number
}

/** 路由统一装载(item/dm 共用)。 */
export function routeWithCookie(url: string): ResolveRoute {
  const route = resolveRoute(url)
  if (!route) {
    throw new Error(`url 未命中 resolver 路由(支持 bili 视频/直播、youtube、douyu/huya/douyin/twitch 直播): ${url}`)
  }
  return route
}

/** route → 解析(登录 cookie 由 client 内部 provider 兜底,解锁登录档位)。 */
export async function resolveByUrl(url: string): Promise<ResolvedItem> {
  const route = routeWithCookie(url)
  const elapsed = startTimer()
  const { streams } = route.kind === "live" ? await resolveLivePlayByUrl(url) : await resolvePlayByUrl(url)
  return { route, streams, tookMs: elapsed() }
}

/** 弹幕能力一行注(平台 × kind;与 resolver/danmaku.ts 对齐)。 */
export function danmakuNote(route: ResolveRoute): string {
  if (route.platform === "youtube") return route.kind === "live" ? "有(live chat 轮询)" : "无(VOD 无弹幕)"
  if (route.platform === "twitch") return "无（Twitch 聊天二期）"
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
  viaService?: boolean
  endpoint?: string
}

/** 解析结果人读输出(item/play 共用)。 */
export function printResolved(r: ResolvedItem): void {
  console.log(`route:   ${r.route.platform} ${r.route.kind} ${r.route.id}`)
  console.log(`resolve: ${fmtMs(r.tookMs)}`)
  printStreams(r.streams)
  console.log(`danmaku: ${danmakuNote(r.route)}`)
}

export async function runItem(url: string, opts: ItemOptions): Promise<void> {
  const r = opts.viaService ? await probeResolve(url, opts.endpoint) : await resolveByUrl(url)
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
