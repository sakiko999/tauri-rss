/**
 * huya 平台客户端 —— 页面抓取(纯 HTTP,无签名)。
 *
 * 无状态单例。huya 无 JSON API,统一入口是 getHtml(m.huya.com 房间页,
 * HNF_GLOBAL_INIT 由 parseHnfGlobalInit 解析——保留在 play.ts)。
 */
import { httpText } from "../../host.ts"
import { huyaDanmakuStream } from "./danmaku.ts"
import type { PlatformClient, PlatformRequestOptions } from "../types.ts"

const M_HUYA = "https://m.huya.com"
const UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36"

/** satisfies 保留具体类型(getHtml 非可选),同时校验满足 PlatformClient 接口。 */
export const huyaClient = {
  /** 房间页 HTML(带移动 UA)。 */
  async getHtml(url: string, opts?: PlatformRequestOptions): Promise<string> {
    return httpText(url, { "user-agent": UA_MOBILE, ...opts?.headers })
  },
  /** 弹幕流(Tars 进房 + uri1400)。 */
  getDanmaku: (roomId) => huyaDanmakuStream(roomId),
} satisfies PlatformClient

/** 移动端 UA(页面抓取同款;供引用者构造页面 URL 用)。 */
export const HUYA_UA = UA_MOBILE
export { M_HUYA }
