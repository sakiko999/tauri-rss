/**
 * weibo 公共 —— UA / headers / HTTP 便捷封装 / mblog→Social 归一。
 *
 * 微博移动端 API(m.weibo.cn)数据全、反爬弱;关键是需要**完整登录 cookie**
 * (含 SUB,半登录态 SUBP 会被 432 限流)。cookie 由 core 层经 info.cookie 注入。
 * 参考 RSSHub `routes/weibo/` 的 container/getIndex 两步流程。
 */
import type { Social } from "@tauri-playground/xml"
import { httpGet, now } from "../../host.ts"
import { parseJsonSafe } from "../../utils/inline-json.ts"
import { fillImageSizes } from "../../utils/img-size.ts"
import { toInt } from "../../utils/number.ts"
import { DESKTOP_CHROME_UA } from "../../utils/ua.ts"

export const WB_BASE = "https://m.weibo.cn"

/** 移动端 UA(RSSHub 同款)。 */
export const WB_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1"

/** PC 端 UA(hot_band 等 weibo.com 接口)。 */
export const PC_UA = DESKTOP_CHROME_UA

/** m.weibo.cn API 需要的 header。 */
export const apiHeaders: Record<string, string> = {
  "MWeibo-Pwa": "1",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": WB_UA,
}

/**
 * 打一次 m.weibo.cn JSON API。基于 httpGet(text 响应,非 2xx 不抛)——保留
 * status + 原始 body 供诊断:风控/限流时 body 是 HTML,调用方据此报可读错误。
 * 空 body 或非 `{` 开头(风控 HTML)原样返回 text,调用方 `body?.ok` 判断。
 */
export async function wbJson(
  url: string,
  cookie?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const res = await httpGet(url, { ...apiHeaders, ...(cookie ? { Cookie: cookie } : {}), ...(extraHeaders ?? {}) })
  const text = res.bodyText
  if (res.status !== 200) return { status: res.status, body: text }
  if (!text.trimStart().startsWith("{")) return { status: res.status, body: text }
  return { status: res.status, body: parseJsonSafe(text) }
}

/** 微博时间 "Sat Aug 08 16:14:29 +0800 2026" → epoch ms。 */
export function parseWeiboDate(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : undefined
}

/** 去 HTML 标签(搜索结果等无 text_raw 的 mblog,text 是 HTML)。 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * mblog(m.weibo.cn 微博 JSON)→ Social Item。
 * content/title 取 text_raw(纯文本);无 text_raw 时 text 是 HTML → stripHtml 兜底
 * (避免 title 含 `<a>` 标签破坏 serialize 的 XML)。images = pics 原图(宽高未知,
 * 调用方兜底);转评赞 = attitudes/reposts/comments_count。raw 存 mblogId/isLongText 供 extend。
 */
export function mblogToSocial(m: any, sourceId: string, t: number): Social {
  const id = String(m?.id ?? "")
  const rawText = String(m?.text_raw ?? "").trim()
  const htmlText = String(m?.text ?? "")
  const text = rawText || stripHtml(htmlText)
  const images = (m?.pics ?? [])
    .map((p: any) => ({ url: String(p?.large?.url ?? p?.url ?? "") }))
    .filter((img: { url: string }) => !!img.url)
  return {
    id: `wb-${id}`,
    sourceId,
    kind: "social",
    title: text.replace(/\s+/g, " ").slice(0, 30) || "微博",
    url: id ? `https://m.weibo.cn/status/${id}` : undefined,
    content: text,
    images: images.length ? images : undefined,
    likes: toInt(m?.attitudes_count),
    reposts: toInt(m?.reposts_count),
    replies: toInt(m?.comments_count),
    author: m?.user?.screen_name
      ? { name: String(m.user.screen_name), avatar: m.user.avatar_hd || m.user.profile_image_url }
      : undefined,
    publishedAt: parseWeiboDate(m?.created_at),
    fetchedAt: t,
    raw: { mblogId: id, isLongText: !!m?.isLongText },
  }
}

/** 长微博展开:isLongText 时调 /statuses/extend 拿完整正文(原地改 content)。 */
export async function expandLongText(it: Social, cookie?: string): Promise<void> {
  const raw = (it.raw ?? {}) as { mblogId?: string; isLongText?: boolean }
  if (!raw.isLongText || !raw.mblogId) return
  const e = await wbJson(`${WB_BASE}/statuses/extend?id=${raw.mblogId}`, cookie, {
    Referer: `${WB_BASE}/status/${raw.mblogId}`,
  })
  const longText = e.body?.data?.longTextContent
  if (typeof longText === "string") it.content = longText.trim()
}

/**
 * cards 批处理 → Social[]:过滤 mblog → 归一 → 展开长文 → 补图宽高。
 * 长文展开与图片预取互不依赖,并入同一 Promise.all 并行(单条内不串行)。
 * weibo:user / weibo:hot 共用,不在各 channel 重写后处理流水线。
 */
export async function mblogCardsToItems(cards: any[], sourceId: string, cookie?: string): Promise<Social[]> {
  const t = now()
  const items: Social[] = cards.filter((c: any) => c.mblog).map((c: any) => mblogToSocial(c.mblog, sourceId, t))
  await Promise.all([
    ...items.map((it) => expandLongText(it, cookie)),
    ...items.flatMap((it) => (it.images ? [fillImageSizes(it.images)] : [])),
  ])
  return items
}
