import { formatError } from "@amoeba/log"

import { deferredStream } from "../../danmaku"
import type { DanmakuOptions } from "../../danmaku"
/**
 * douyin 平台客户端 —— ABogus 签名 + ttwid warmup + JSON 请求。
 *
 * 无状态单例:getJson 统一入口,内部 a_bogus 签名(signDouyinUrl) + 自动 warmup
 * ttwid cookie(模块级 memoize,首次无 cookie 时抓首页 Set-Cookie,兜底默认值)。
 * 从 DouyinLiveChannel 下沉(原 channel 私有 getJson/ensureCookie/abogusUrl)。
 */
import { httpJson } from "../../host.ts"
import { log } from "../../log.ts"
import { platformCookie } from "../credentials.ts"
import type { PlatformClient, PlatformRequestOptions } from "../types.ts"
import { DEFAULT_TTWID, enterRoomParams, signDouyinUrl, UA_ENTER } from "./abogus.ts"
import { douyinDanmakuStream } from "./danmaku.ts"

const LIVE = "https://live.douyin.com"

// ttwid warmup(首页 Set-Cookie),模块级 memoize——「无状态单例」的默认 cookie 兜底。
let cookieJar = ""
let cookiePromise: Promise<void> | null = null

async function ensureCookie(): Promise<void> {
  if (cookieJar) return
  if (!cookiePromise) {
    cookiePromise = (async () => {
      try {
        const res = await globalThis.appHost.http.request({
          url: `${LIVE}/`,
          method: "GET",
          headers: { "user-agent": UA_ENTER },
        })
        const sc = String(res.headers["set-cookie"] ?? "").split("\n")
        const jar = sc
          .map((c) => c.split(";")[0]!.trim())
          .filter((c) => c.includes("="))
          .join("; ")
        if (jar) cookieJar = jar
      } catch {
        cookieJar = DEFAULT_TTWID
      }
    })()
  }
  await cookiePromise
}

/**
 * 取当前 cookie:登录 cookie(credentials provider,settings.douyinCookie)优先,
 * 否则匿名 ttwid warmup。弹幕握手/stream 解析用(缺 ttwid 会 415)。
 *
 * ⚠️ 2026-10-21 前 settings.douyinCookie 是**死键**(落库后零消费,扫码承诺的
 * 「解锁原画」无代码兑现)——provider 接线后抓取/播放/弹幕三条链都经这里取登录态。
 */
export async function douyinCookie(): Promise<string> {
  const login = platformCookie("douyin")
  if (login) return login
  await ensureCookie()
  return cookieJar || DEFAULT_TTWID
}

/** enter API 完整响应(room/user/stream_url 同源)。channel fetch 与流解析共用。 */
export async function fetchRoom(roomId: string, referer?: string): Promise<Record<string, any>> {
  const url = `${LIVE}/webcast/room/web/enter/?${enterRoomParams(roomId)}`
  return douyinClient.getJson(url, { referer: referer ?? `${LIVE}/${roomId}` })
}

/**
 * 风控信号上报(best-effort):宿主未注入 `net` 时静默,不影响请求/返回逻辑。
 * 契约 `appHost.net.reportRisk(platform, signal)` 见 docs/crawler-risk-control.md §2.6。
 */
function reportRisk(signal: string): void {
  // 宿主未注入 net 或调用方未注入 appHost 时静默(best-effort)
  globalThis.appHost?.net?.reportRisk("douyin", signal)
}

export const douyinClient = {
  /** 原始 URL → a_bogus 签名 → 带 ttwid 请求;空 body / status_code 抛清晰错误。 */
  async getJson<T = any>(url: string, opts?: PlatformRequestOptions): Promise<T> {
    await ensureCookie()
    const signed = signDouyinUrl(url, UA_ENTER)
    const json = await httpJson<T>(signed, {
      "user-agent": UA_ENTER,
      referer: opts?.referer ?? LIVE,
      authority: "live.douyin.com",
      // cookie 语义(credentials):显式非空 > **显式空串 = 匿名 ttwid**(douyin 缺
      // ttwid 直接 415,不能真空头发) > douyinCookie()(登录 provider > 匿名 jar)。
      cookie: opts?.cookie !== undefined ? opts.cookie || cookieJar || DEFAULT_TTWID : await douyinCookie(),
      ...opts?.headers,
    })
    if (json == null) throw new Error(`douyin empty body for ${url.slice(0, 80)}`)
    const code = (json as Record<string, any>)?.status_code
    if (code !== undefined && code !== 0) {
      const msg = String(
        (json as Record<string, any>)?.prompts ?? (json as Record<string, any>)?.status_msg ?? `status_code=${code}`,
      )
      // 4031 = verify-center 拦截,2483 = 需登录(抖音明确风控码)
      const riskCode = Number(code)
      if (riskCode === 4031 || riskCode === 2483) reportRisk(String(riskCode))
      throw new Error(`douyin 内容不可用:${msg}(code ${code})`)
    }
    return json
  },
  /** 弹幕流:先 warmup cookie(握手需 ttwid)再建连;deferredStream 拦异步 setup 期间退订。 */
  getDanmaku: (roomId: string, opts?: DanmakuOptions) =>
    deferredStream(
      () => (opts?.cookie ? Promise.resolve(opts.cookie) : douyinCookie()),
      (cookie, onItems) => douyinDanmakuStream(roomId, cookie)(onItems),
      (e) => log.douyin.danmakuInitFailed({ error: formatError(e) }),
    ),
} satisfies PlatformClient
