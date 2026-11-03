/**
 * weibo 用户搜索 —— getIndex 响应解析(cards → 用户卡)。
 *
 * 渠道取数走被动采集(2026-11-03,crawler `weibo:user:search`):导航 m.weibo.cn
 * 搜索页 + capturePage 捕获页面自己发的 `/api/container/getIndex?containerid=
 * 100103type=3&q=<关键词>`(type=3 即用户)。原 HTTP 重放路径已删:应用构造的请求
 * (settings 冷 cookie + 无浏览器指纹)实测被 `ok:-100` 风控;页面自发请求带
 * visitor 身份 + X-XSRF-TOKEN + 真实指纹,**匿名即可**返回用户卡(2026-11-03
 * 实测:20 条/total 34,含粉丝数与认证理由)。
 *
 * 供「搜用户」渠道(`weibo:user:search`)取候选,落地订阅走 `weibo:user`(uid)。
 */

export interface WeiboUserHit {
  uid: string
  screenName: string
  avatar?: string
  /** 关注数(平台给的已格式化串,如 "207.7万")。 */
  followers?: string
  /** 认证理由(黄 V/蓝 V 说明);未认证省略。 */
  verified?: string
}

/**
 * getIndex 响应 → 用户卡列表。`ok` 由调用方检查(被动捕获到 `ok:-100` 要如实
 * 抛风控错误,不能当 0 条吞掉)。
 */
export function weiboUserHitsFromIndex(json: unknown): WeiboUserHit[] {
  const cards = ((json as { data?: { cards?: unknown[] } })?.data?.cards ?? []) as any[]
  const out: WeiboUserHit[] = []
  const seen = new Set<string>()
  // cards → card_group[].user / card.user(两种形态都收;card_type=4 的 tab 头卡无
  // card_group,`item.user` 判据自然跳过)。按 uid 去重。
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
