/**
 * 平台 cookie 的取值与注入规则(从 data-layer.ts 拆出,2026-11-01)。
 *
 * 三级语义的唯一实现点:
 *   调用点显式非空 > 显式**空串 = 强制匿名** > settings 快照(provider 兜底)。
 * 渠道层不许再手抄 channelKey → cookie 字段表(见 CLAUDE.md 硬契约)。
 */

import { parseCookieDict, serializeCookieDict } from "@amoeba/resolve"

import { cookieFieldFor } from "../settings-policy.ts"
import type { AppSettings } from "../types/settings.ts"

/**
 * settings cookie 字段的**桌面 HTTP 消费方** —— 只有它们值得为快照同步单独拉起
 * 抓取浏览器(~1GB,空闲 3 分钟回收)。xhsCookie 在桌面没有数据消费方(xhs 全走
 * 浏览器,settings 只剩账号页展示),只在浏览器已因其它字段被拉起时顺带同步。
 */
export const DESKTOP_COOKIE_CONSUMER_FIELDS: ReadonlySet<keyof AppSettings> = new Set(["weiboCookie"])

/** cookie 串 → 按 key 排序的规范形(比较用;快照落库的就是这个形)。 */
export function normalizeCookie(v: unknown): string {
  return serializeCookieDict(parseCookieDict(typeof v === "string" ? v : ""))
}

/** 按 channelKey 前缀取 settings 快照里的 cookie(订阅显式 info.cookie 永远优先)。 */
export function cookieFor(channelKey: string, s: AppSettings): string | undefined {
  const field = cookieFieldFor(channelKey)
  return field ? (s[field] as string | undefined) : undefined
}

/**
 * 合并 core 层默认 cookie 到订阅 info。
 *   crawler 源:按平台前缀注入 cookie(bili/weibo/xhs/douyin)供抓取/解析。
 *   rsshub 外挂源:只注入 baseUrl(供 fetch 请求外部实例),**不注入平台 cookie**
 *     ——外挂只做信息抓取,无需登录态;平台 cookie 也不应泄露给公网实例。
 *
 * ⚠️ 「键存在即尊重」(含空串 = 强制匿名):与 CLI `--kv cookie=` 的探针语义一致
 * (同一语义在两条装配线上曾含义相反——CLI 空串强制匿名、core 空串回落默认)。
 * 渠道没写 cookie 键时,client 侧还有 credentials provider 兜底(同一 settings 源),
 * 所以「漏写键」不再等于「永远匿名」。
 */
export function mergeSourceInfo(
  sub: { channelKey: string; info: Record<string, string> },
  settings: AppSettings,
  /** 兜底 rsshub 实例地址(settings.rsshubBaseUrl)。 */
  rsshubBaseUrl: string,
): Record<string, string> {
  if (sub.channelKey.startsWith("rsshub:")) {
    if (sub.info["baseUrl"]) return sub.info
    return { ...sub.info, baseUrl: rsshubBaseUrl }
  }
  const cookie = cookieFor(sub.channelKey, settings)
  if (sub.info["cookie"] !== undefined || !cookie) return sub.info
  return { ...sub.info, cookie }
}
