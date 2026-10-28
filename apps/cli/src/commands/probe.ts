/**
 * probe — CLI 原始探针的远端路径（`--via-service`）。
 *
 * fetch/item/play/dm 默认仍走本地（只读探针，不碰桌面库）；加 `--via-service` 后
 * 这些调用打到数据服务的 `probe.*` RPC —— 与订阅抓取同一 cookie 注入、同一被动
 * 规则、同一 governor 配额（桌面服务的），适合验证「应用真实路径」而不是 CLI 直连。
 */
import type { DanmakuItem, ResolveRoute } from "@amoeba/resolve"
import { ServiceClient } from "@amoeba/service-client"
import type { Stream } from "@amoeba/xml"

import { resolveEndpoint } from "./attach.ts"

export interface ProbeOptions {
  viaService?: boolean
  endpoint?: string
}

export function probeClient(endpoint?: string): ServiceClient {
  return new ServiceClient(resolveEndpoint(endpoint))
}

export async function probeFetch(
  key: string,
  info: Record<string, string>,
  endpoint?: string,
): Promise<{ xml: string; tookMs: number }> {
  return probeClient(endpoint).rpc("probe.fetch", { channelKey: key, info })
}

export async function probeResolve(
  url: string,
  endpoint?: string,
): Promise<{ route: ResolveRoute; streams: Stream[]; tookMs: number }> {
  const r = await probeClient(endpoint).rpc("probe.resolve", { url })
  return { route: r.route as ResolveRoute, streams: r.streams as Stream[], tookMs: r.tookMs }
}

export async function probeDanmaku(
  url: string,
  opts: { seconds?: number; n?: number },
  endpoint?: string,
): Promise<{ route: ResolveRoute; kind: "vod" | "live"; items: DanmakuItem[]; tookMs: number }> {
  const r = await probeClient(endpoint).rpc("probe.danmaku", {
    url,
    ...(opts.seconds !== undefined ? { seconds: opts.seconds } : {}),
    ...(opts.n !== undefined ? { n: opts.n } : {}),
  })
  return {
    route: r.route as ResolveRoute,
    kind: r.kind,
    items: r.items as DanmakuItem[],
    tookMs: r.tookMs,
  }
}
