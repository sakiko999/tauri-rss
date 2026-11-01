/**
 * douyin:user:search —— 搜/查抖音用户(搜索渠道,不直接订阅)。
 *
 * 两条路径:
 *   1. **按抖音号/主页链接查号**(无浏览器也能用):旧版资料接口换 sec_uid(匿名,
 *      见 resolve `resolveDouyinSecUid`)—— 输入好记,查号成本最低;
 *   2. **按关键词搜用户**(被动采集):导航 `douyin.com/search/<kw>?type=user`,
 *      捕获页面自己发的搜索响应(`/aweme/v1/web/{discover,general}/search/…`
 *      或 `/aweme/v1/web/search/user/`,实测 2026-11 页面自发 200 JSON——
 *      接口重放/自签与 `douyin:user` 同一套结论:会被拦)。
 *
 * 两条路径都产 Video item,url = 用户主页 —— 候选提取从 url 解析 sec_uid。
 * 关键词路径**需要登录**:匿名搜索页被登录/验证弹窗接管,页面不会发搜索请求。
 *
 * 下游订阅走 `douyin:user`(sec_uid 参数),本渠道只作「搜索添加」的取数源。
 */

import {
  cdpNavigate,
  fetchDouyinUserByUniqueId,
  now,
  readDouyinLoginCookie,
  releaseLaneTab,
  withBrowserOp,
} from "@amoeba/resolve"
import type { Item, Video } from "@amoeba/xml"

import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { passiveBuffer } from "../../passive/buffer.ts"
import { capturePage } from "../../passive/capture.ts"
import { apiFetchItems } from "../factory.ts"

/** 被动捕获的 lane(搜索页专属 tab,不与主页列表互踩)。 */
const LANE = "search:douyin"
/** passiveBuffer 的接口键(与 platform 一起定位本渠道的响应)。 */
const ENDPOINT = "user_search"

const NEEDS_BROWSER =
  "抖音关键词搜索需要桌面抓取浏览器：搜索接口只由页面自己发（重放/自签会被拦），无浏览器时只能按抖音号查号"
const NEEDS_LOGIN = "抖音搜索需要登录：匿名搜索页会被登录弹窗接管，页面不会发搜索请求。请到「账号与凭证」扫码登录后重试"
const NO_RESULTS =
  "抖音搜索没有触发结果请求：可能是页面被风控、关键词无结果，或搜索页结构已变（请在浏览器里确认能正常搜索）"

/** 页面自己的搜索接口(只用于匹配,不用于发请求)。 */
function isDouyinSearchApi(u: URL): boolean {
  if (!/(^|\.)douyin\.com$/.test(u.hostname)) return false
  return /\/(discover|general)\/search\//.test(u.pathname) || u.pathname.includes("/search/user/")
}

interface UserHit {
  secUid: string
  nickname: string
  avatar?: string
  uniqueId?: string
  followers?: number
}

export class DouyinUserSearchChannel implements RssChannel {
  readonly key = "douyin:user:search"
  readonly name = "抖音搜用户"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [
    {
      key: "keyword",
      label: "昵称或抖音号",
      placeholder: "如:pvcyinse，或直接搜昵称",
      required: true,
    },
  ]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(
        () => this.fetchItems(info),
        () => ({
          channelTitle: `抖音搜用户 ${String(info.keyword ?? "").slice(0, 24)}`,
          channelLink: "https://www.douyin.com/",
        }),
      ),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const raw = String(info.keyword ?? "").trim()
    if (!raw) throw new Error("douyin:user:search 需要关键词")
    // 像抖音号/主页链接 → 先按号查(匿名、快);查不到再按关键词搜(需要登录)。
    const hit = await this.lookupByAccount(raw)
    if (hit) return [this.toItem(hit)]
    return this.searchByKeyword(raw)
  }

  /** 抖音号 / 主页链接 / sec_uid → 单条(失败返回 null,交给关键词路径)。 */
  private async lookupByAccount(raw: string): Promise<UserHit | null> {
    const s = raw.replace(/^@+/, "").replace(/^抖音号[：:]\s*/, "")
    // 主页链接 / 裸 sec_uid:不用再查,昵称拿不到就回落 id 尾段。
    const m = /douyin\.com\/user\/(MS4wLjAB[\w-]+)/i.exec(s)
    const sec = m?.[1] ?? (/^MS4wLjAB[\w-]+$/.test(s) ? s : "")
    if (sec) return { secUid: sec, nickname: sec.slice(-8) }
    if (/\s/.test(s)) return null // 带空格的一定是关键词
    // 抖音号 → 资料接口(匿名,进程内有缓存)。
    const u = await fetchDouyinUserByUniqueId(s).catch(() => null)
    return u ? { secUid: u.secUid, nickname: u.nickname, avatar: u.avatar, uniqueId: u.uniqueId } : null
  }

  /** 关键词 → 导航搜索页 → 捕获页面自己的搜索响应。 */
  private async searchByKeyword(keyword: string): Promise<Item[]> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error(NEEDS_BROWSER)
    // 搜索页是一次性的（下一轮搜索本来就会重新导航）：用完立即关 target 释放
    // renderer（抖音搜索页同样会累积大量卡片/视频壳），不等 5 分钟空闲回收。
    const hits = await withBrowserOp(browser, { lane: LANE, mode: "interactive", platform: "douyin" }, async (b) => {
      if (!(await readDouyinLoginCookie(b))) throw new Error(NEEDS_LOGIN)
      const url = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=user`
      // 缓冲是进程级的:只读本次捕获窗口内写入的响应,否则会把上一次关键词的结果
      // 混进来(同一次运行里连续搜两次就能看到)。
      const since = now()
      // 页面可能同时发多条搜索请求;捕获窗口收全,再统一解析。
      await capturePage(b, {
        platform: "douyin",
        endpoint: ENDPOINT,
        match: isDouyinSearchApi,
        trigger: (x) => cdpNavigate(x, url, true),
        idleMs: 1200,
        timeoutMs: 20_000,
      })
      return this.readCaptured(since)
    }).finally(() => releaseLaneTab(browser, LANE))
    if (!hits.length) throw new Error(NO_RESULTS)
    return hits.map((h) => this.toItem(h))
  }

  /**
   * 收集本次捕获的 `user_list[]`(兼容 discover/search 与 general/search 两种形状:
   * 前者顶层是 `user_list`,后者包在 `data[]` 的条目里)。按 sec_uid 去重。
   */
  private readCaptured(since: number): UserHit[] {
    const out: UserHit[] = []
    const seen = new Set<string>()
    for (const e of passiveBuffer.list("douyin", ENDPOINT)) {
      if (e.at < since) continue
      let json: any
      try {
        json = JSON.parse(e.body)
      } catch {
        continue
      }
      const lists: any[][] = []
      if (Array.isArray(json?.user_list)) lists.push(json.user_list)
      if (Array.isArray(json?.data)) {
        for (const d of json.data) if (Array.isArray(d?.user_list)) lists.push(d.user_list)
      }
      for (const entry of lists.flat()) {
        const u = entry?.user_info ?? entry
        const secUid = String(u?.sec_uid ?? "").trim()
        if (!secUid || seen.has(secUid)) continue
        seen.add(secUid)
        out.push({
          secUid,
          nickname: String(u?.nickname ?? "").trim() || secUid.slice(-8),
          avatar: String(u?.avatar_thumb?.url_list?.[0] ?? u?.avatar_medium?.url_list?.[0] ?? "") || undefined,
          uniqueId: String(u?.unique_id ?? "").trim() || undefined,
          followers: Number(u?.follower_count) || undefined,
        })
      }
    }
    return out
  }

  private toItem(h: UserHit): Video {
    return {
      id: `dyu-${h.secUid.slice(-12)}`,
      sourceId: this.key,
      kind: "video",
      title: h.nickname,
      url: `https://www.douyin.com/user/${h.secUid}`,
      thumbnail: h.avatar,
      summary:
        [h.uniqueId ? `抖音号 ${h.uniqueId}` : "", h.followers ? `${fmtCount(h.followers)} 粉丝` : ""]
          .filter(Boolean)
          .join(" · ") || undefined,
      fetchedAt: now(),
    }
  }
}

/** 粉丝数缩写:1.2万 / 3.4亿。 */
function fmtCount(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, "")}万`
  return String(n)
}
