/**
 * bili:popular —— bilibili 综合热门(video channel)。
 *
 * `/x/web-interface/popular` 全站热门。getDanmaku 走 bili VOD 弹幕(kind:"vod",
 * 弹幕能力由 resolver 按 url 提供)。另 implements **Loginable**(结构上挂 scanLogin):
 * bili 扫码是纯 HTTP 协议(`passport.bilibili.com/x/passport-login/web/qrcode/*`),
 * 不需要 appHost.browser —— 扫一次所有 bili channel 共享(登录态经 credentials
 * provider 注入)。
 */

import { biliClient, biliQrGenerate, biliScanLogin, now } from "@amoeba/resolve"
import type { Item } from "@amoeba/xml"

import type { LoginResult } from "../../index.ts"
import { makeApiChannel } from "../factory.ts"
import { API, ugc } from "./video-common.ts"

/** `/x/web-interface/popular` 的响应形状（只取用到的字段）。 */
export interface PopularPayload {
  data?: { list?: Array<Record<string, unknown>>; no_more?: boolean }
}

/** 热门列表 payload → Item[]。纯函数：只做字段映射，不发请求。 */
export function parsePopularItems(payload: unknown): Item[] {
  const list = (payload as PopularPayload | null)?.data?.list
  if (!Array.isArray(list)) return []
  const t = now()
  return list.map((raw) =>
    ugc("bili:popular", t, {
      title: raw.title,
      pic: raw.pic,
      desc: raw.desc,
      pubdate: raw.pubdate,
      aid: raw.aid,
      bvid: raw.bvid,
      duration: raw.duration,
      rights: raw.rights,
      owner: (raw.owner as { name?: string }) ?? undefined,
    }),
  )
}

/**
 * 扫码登录(平台级;纯 HTTP,不依赖 appHost.browser)。
 * emitQr 推的是**二维码内容 URL**(不是 data URL)—— 编码在 UI 侧。
 *
 * ⚠️ 必须把生成的 qr **传回** biliScanLogin:否则它会自己再 load 一个码,
 * 而用户扫的是我们推给他的那个 —— 永远登录不上。
 */
async function scanLogin(
  emitQr: (qr: string | null) => void,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<LoginResult> {
  const qr = await biliQrGenerate()
  emitQr(qr.url)
  const result = await biliScanLogin({ timeoutMs: opts?.timeoutMs, signal: opts?.signal, qr })
  emitQr(null)
  return result
}

export const BiliPopularChannel = makeApiChannel({
  key: "bili:popular",
  name: "B站综合热门",
  kind: "video",
  scanLogin,
  channelTitle: () => "B站综合热门",
  channelLink: "https://www.bilibili.com/",
  // pn/ps 翻页(2026-10-27 实测:pn=2 返回 20 条与首页零重叠,深度约 1000 条,
  // pn 越界时 list 空 + no_more=true)。hasMore 直接透上游 no_more —— 热门榜跨
  // 快照翻页必有重叠,不能靠「本页 0 条=到底」(core 的 append 去重会把重叠吞成 0)。
  pageable: { first: 2, step: 1 },
  fetchPage: async (info, page) => {
    // 登录 cookie 从 info 显式取(provider 是 client 兜底,这里显式=kv 覆盖可达)。
    const data = await biliClient.getJson<PopularPayload>(`${API}/x/web-interface/popular?pn=${page}&ps=20`, {
      cookie: info.cookie,
    })
    return { items: parsePopularItems(data), hasMore: data?.data?.no_more !== true }
  },
})
