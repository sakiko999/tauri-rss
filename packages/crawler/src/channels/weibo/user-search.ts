/**
 * weibo:user:search —— 搜微博用户(搜索渠道,不直接订阅)。
 *
 * 被动采集(2026-11-03):导航 `m.weibo.cn/search?containerid=100103type=3&q=<昵称>`,
 * 捕获页面自己发的 `/api/container/getIndex`(接口重放实测被 `ok:-100` 风控,与
 * douyin:user 同一套结论)。页面自发请求带 visitor 身份,**匿名即可用**——不设登录
 * 门禁(访客也持 HttpOnly SUB,readWeiboLoginCookie 分不出访客/真人,不能当判据)。
 * 响应解析在 resolve `weiboUserHitsFromIndex`。产出 Video item:每个用户一条,
 * url = `weibo.com/u/<uid>` —— 候选提取从 url 解析 uid。
 *
 * 下游订阅走 `weibo:user`(uid 参数),本渠道只作「搜索添加」的取数源。
 */

import { cdpNavigate, now, weiboUserHitsFromIndex, withBrowserOp } from "@amoeba/resolve"
import type { Video } from "@amoeba/xml"

import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { passiveBuffer } from "../../passive/buffer.ts"
import { capturePage } from "../../passive/capture.ts"
import { apiFetchItems } from "../factory.ts"

/** 被动捕获的 lane(搜索页专属 tab,不与 weibo:user 的列表页互踩)。 */
const LANE = "search:weibo"
/** passiveBuffer 的接口键(与 platform 一起定位本渠道的响应)。 */
const ENDPOINT = "user_search"

const NEEDS_BROWSER = "微博搜用户需要桌面抓取浏览器：搜索接口只由页面自己发（应用重放会触发 -100 风控）"
const NO_RESULTS =
  "微博搜索没有触发结果请求：可能是页面被风控、关键词无结果，或搜索页结构已变（请在浏览器里确认能正常搜索）"

/**
 * 页面自己的用户搜索接口(只用于匹配,不用于发请求)。containerid 解码后形如
 * `100103type=3&q=<kw>`;visitor 流程可能给 query 追加 display/retcode,别匹配完整串。
 */
function isWeiboUserSearchApi(u: URL): boolean {
  if (!/(^|\.)m\.weibo\.cn$/.test(u.hostname)) return false
  if (u.pathname !== "/api/container/getIndex") return false
  return (u.searchParams.get("containerid") ?? "").startsWith("100103type=3")
}

export class WeiboUserSearchChannel implements RssChannel {
  readonly key = "weibo:user:search"
  readonly name = "微博搜用户"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [{ key: "keyword", label: "用户昵称", placeholder: "如:半佛仙人", required: true }]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(
        () => this.fetchItems(info),
        () => ({
          channelTitle: `微博搜用户 ${String(info.keyword ?? "").slice(0, 24)}`,
          channelLink: "https://weibo.com/",
        }),
      ),
    }
  }

  /** 导航搜索页 → 捕获页面自己的 getIndex 响应 → 解析用户卡。 */
  private async fetchItems(info: SourceInfo): Promise<Video[]> {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("weibo:user:search 需要关键词")
    const browser = globalThis.appHost?.browser
    if (!browser?.send || !browser?.onEvent) throw new Error(NEEDS_BROWSER)
    // 搜索页是一次性的（下一次搜索本来就会重新导航）：release 在 lane 锁内关 target，
    // 释放 renderer。同 URL 二次搜索靠 cdpNavigate 的 force 重载兜底。
    const hits = await withBrowserOp(
      browser,
      { lane: LANE, mode: "interactive", platform: "weibo", release: true },
      async (b) => {
        const url = `https://m.weibo.cn/search?containerid=${encodeURIComponent(`100103type=3&q=${kw}`)}`
        // 缓冲是进程级的:只读本次捕获窗口内写入的响应,否则会把上一次关键词的结果
        // 混进来(同一次运行里连续搜两次就能看到)。
        const since = now()
        // visitor 冷启动会先跳 passport 再回搜索页(getIndex 晚于导航返回),idle 放宽到 2s。
        await capturePage(b, {
          platform: "weibo",
          endpoint: ENDPOINT,
          match: isWeiboUserSearchApi,
          trigger: (x) => cdpNavigate(x, url, true),
          idleMs: 2000,
          timeoutMs: 25_000,
        })
        return this.readCaptured(kw, since)
      },
    )
    if (!hits.length) throw new Error(NO_RESULTS)
    const t = now()
    return hits.map((u): Video => ({
      id: `wbu-${u.uid}`,
      sourceId: this.key,
      kind: "video",
      title: u.screenName,
      url: `https://weibo.com/u/${u.uid}`,
      thumbnail: u.avatar,
      // 候选行的次行信息(粉丝数/认证理由)。raw 不穿 XML,summary 是唯一到 UI 的自由字段。
      summary: [u.verified, u.followers ? `${u.followers} 关注者` : ""].filter(Boolean).join(" · ") || undefined,
      fetchedAt: t,
    }))
  }

  /**
   * 收集本次捕获的用户卡。过滤两层:写入时间 `>= since`(上一轮搜索)+ containerid
   * 带本次关键词(缓冲无 lane 过滤,并发渠道操作不串台)。`ok===1` 的响应优先;
   * 全窗口只有 `ok:-100` 时如实抛「请求过于频繁」并上报平台冷却——被风控不能当
   * 「没搜到」吞掉。
   */
  private readCaptured(kw: string, since: number) {
    let risk = false
    for (const e of passiveBuffer.list("weibo", ENDPOINT)) {
      if (e.at < since) continue
      try {
        if (!(new URL(e.url).searchParams.get("containerid") ?? "").includes(`q=${kw}`)) continue
      } catch {
        continue
      }
      let json: any
      try {
        json = JSON.parse(e.body)
      } catch {
        continue
      }
      if (json?.ok === 1) return weiboUserHitsFromIndex(json)
      if (json?.ok === -100) risk = true
    }
    if (risk) {
      // 与 HTTP 时代 wbJson 同语义:-100 = 请求过于频繁,写 30min 平台冷却。
      globalThis.appHost?.net?.reportRisk?.("weibo", "-100")
      throw new Error("微博用户搜索失败: ok=-100 请求过于频繁，请过几分钟再试")
    }
    return []
  }
}
