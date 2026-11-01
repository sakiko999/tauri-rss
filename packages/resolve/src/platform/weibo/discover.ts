/**
 * weibo 用户搜索 —— m.weibo.cn container `100103type=3&q=<关键词>`(type=3 即用户)。
 *
 * ⚠️ **必须登录**(2026-11-01 实测):匿名请求 `ok:-100`(请求频繁风控码,0 条);
 * 带完整登录 cookie(含 SUB)返回用户卡(id/screen_name/followers/认证理由)。
 * cookie 三级语义由 `resolveCookie` 处理;无 cookie 时直接抛「需要登录」,不发请求
 * —— 匿名打一次会触发 weibo 平台冷却,不值得。
 *
 * 供「搜用户」渠道(`weibo:user:search`)取候选,落地订阅走 `weibo:user`(uid)。
 */

import { ResolveError } from "../../errors.ts"
import { resolveCookie } from "../credentials.ts"
import { WB_BASE, wbJson } from "./client.ts"

export interface WeiboUserHit {
  uid: string
  screenName: string
  avatar?: string
  /** 关注数(平台给的已格式化串,如 "207.7万")。 */
  followers?: string
  /** 认证理由(黄 V/蓝 V 说明);未认证省略。 */
  verified?: string
}

/** 按昵称搜微博用户(需登录 cookie)。 */
export async function searchWeiboUsers(keyword: string, cookie?: string): Promise<WeiboUserHit[]> {
  const kw = keyword.trim()
  if (!kw) throw new Error("微博搜用户需要关键词")
  const ck = resolveCookie(cookie, "weibo")
  if (!ck) {
    throw new ResolveError("auth", "微博搜用户需要登录：请到「账号与凭证」扫码登录（或填入 cookie）后重试")
  }

  const qs = new URLSearchParams({ containerid: `100103type=3&q=${kw}`, page_type: "searchall" })
  const { status, body } = await wbJson(`${WB_BASE}/api/container/getIndex?${qs.toString()}`, ck, {
    Referer: `${WB_BASE}/search?weibo=${encodeURIComponent(kw)}`,
  })
  if (status !== 200 || typeof body === "string" || body?.ok !== 1) {
    const msg = typeof body === "string" ? body.slice(0, 60) : (body?.msg ?? `ok=${body?.ok}`)
    throw new Error(`微博用户搜索失败: ${msg}`)
  }

  // cards → card_group[].user / card.user(两种形态都收)。
  const cards = (body?.data?.cards ?? []) as any[]
  const out: WeiboUserHit[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    const group = Array.isArray(card?.card_group) ? card.card_group : [card]
    for (const item of group) {
      const u = item?.user
      const uid = String(u?.id ?? "").trim()
      const name = String(u?.screen_name ?? "").trim()
      if (!uid || !name || seen.has(uid)) continue
      seen.add(uid)
      out.push({
        uid,
        screenName: name,
        avatar: String(u?.avatar_hd ?? u?.profile_image_url ?? "") || undefined,
        followers: String(u?.followers_count ?? "") || undefined,
        verified: String(u?.verified_reason ?? "").trim() || undefined,
      })
    }
  }
  return out
}
