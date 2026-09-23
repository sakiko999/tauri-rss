/**
 * huya 平台客户端 —— 纯 HTTP,无签名。
 *
 * 无状态单例。getHtml 保留给**弹幕**(danmaku.ts 要从 m.huya.com 房间页取
 * subSid/topSid 等进房参数);房间元数据与播放解析已改用 **JSON API**
 * `mp.huya.com/.../profileRoom`(见 play.ts / channels/huya/live.ts,
 * 2026-09 迁移——此前爬 HTML 的 HNF_GLOBAL_INIT 路径已删除)。
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
