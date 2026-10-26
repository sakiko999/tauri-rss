/**
 * xhs:explore —— 小红书发现页(推荐内容)channel(kind: social)。
 *
 * `/explore` SSR 的 `__INITIAL_STATE__.feed`(可能有 _rawValue 包装)含
 * `feeds[]`,每张 noteCard 即一条推荐笔记(标题/封面带尺寸/点赞)。
 *
 * 抓取策略统一在 `shared.ts`(**全渠道要求登录,匿名态已移除**):
 *   - 读页面 SSR(passive;不构造请求);
 *   - 翻页 = 滚动驱动,读 `feed.feeds` 增量;
 *   - 被动刷新 → `fetchPassive`(CDP Network 捕获页面自己的文档);
 *   - 无浏览器(mobile/CLI)→ **不支持**(登录态 HTTP SSR 是空壳,见 `XHS_EXPLORE_NEEDS_BROWSER`)。
 */
import type { Item, Social } from "@amoeba/xml"
import { serializeFeed, type SerializeOptions } from "@amoeba/xml"
import type { ItemDetailSource, Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { XHS_BASE, noteCardToSocial, now } from "@amoeba/resolve"
import { withBrowserOp } from "@amoeba/resolve"
import {
  ensureXhsPageReady,
  fetchXhsList,
  fetchXhsPassivePage,
  flatXhsStateList,
  readXhsStateList,
  readXhsStateListCount,
  resolveXhsItemDetail,
  scrollXhsUntilGrown,
  waitXhsListNonEmpty,
  XHS_LOGIN_REQUIRED,
} from "./shared.ts"
import { XhsChannelBase } from "./base.ts"

/**
 * 无浏览器(CLI / mobile)时 discover 页不可抓。
 *
 * ⚠️ 登录态 `/explore` 的 HTTP 文档是**空壳**:`feed.feeds` 为 `[]`,列表由页面自己的
 * XHR 在导航后回填(见 `shared.ts` 的 `waitXhsListNonEmpty`)。纯 HTTP 宿主不执行脚本,
 * 只会静默产出 0 条;匿名 HTTP 时代能拿到 feeds 的前提已随匿名态移除一起消失。
 */
const XHS_EXPLORE_NEEDS_BROWSER =
  "小红书发现页需要桌面抓取浏览器：登录态 HTTP SSR 只给空壳，列表由页面脚本回填"

/** 判断滚动前后 feed 头部是否变化的稳定 key(noteId 在展开项外层)。 */
function feedKey(f: any): string {
  return String(f?.id ?? f?.noteCard?.noteId ?? "")
}

export class XhsExploreChannel extends XhsChannelBase implements RssChannel {
  readonly key = "xhs:explore"
  readonly name = "小红书发现页"
  readonly kind = "social" as const
  /** 只读页面 SSR + 页面自然请求,正常路径即被动。 */
  readonly passive = true
  readonly defaultInfo: SourceInfo = {}

  getSource(info: SourceInfo): RssSource & Partial<Pageable> & ItemDetailSource {
    // 保留显式空串语义(强制匿名 → 现在会报「需要登录」),不要用 `||` 抹成 undefined。
    const cookie = info.cookie as string | undefined
    // ⚠️ 显式空串 = 强制匿名（CLI `--kv cookie=`）：匿名态已移除，浏览器路径也不得
    // 绕过。此前浏览器分支直接忽略 info.cookie，`--kv cookie=` 会静默变成「有登录态」。
    if (cookie === "") {
      const denied = () => Promise.reject(new Error(XHS_LOGIN_REQUIRED))
      return { fetch: denied, fetchPassive: denied, fetchMore: denied, resolveDetail: denied }
    }
    const browser = globalThis.appHost?.browser
    const source: RssSource & Partial<Pageable> & ItemDetailSource = {
      fetch: apiFetchItems(
        () =>
          browser
            ? this.fetchViaBrowser(browser)
            : Promise.reject(new Error(XHS_EXPLORE_NEEDS_BROWSER)),
        () => this.channelOptions(),
      ),
      // LX:导航是页面自然行为;响应体从 CDP Network 缓冲取,不构造主动请求。
      fetchPassive: () => this.fetchPassive(),
      // 单条详情:读详情页 SSR(登录态)。
      resolveDetail: (item) =>
        resolveXhsItemDetail({ item, sourceKey: this.key, browser, cookie }),
    }
    // 推荐流是无限滚动:滚到底由页面自己分页,我们只读增量。
    if (browser) {
      source.fetchMore = (cursor?: string, ctx?: { existing: number }) =>
        this.fetchMoreViaBrowser(browser, cursor, ctx?.existing)
    }
    return source
  }

  /** 正常刷新:登录态读页面 SSR(未登录由 fetchXhsList 抛可操作错误)。 */
  private async fetchViaBrowser(browser: BrowserBackend): Promise<Item[]> {
    const items = await fetchXhsList(
      browser,
      {
        url: `${XHS_BASE}/explore`,
        readPage: async (b) => {
          await waitXhsListNonEmpty(b, ["feed", "feeds"])
          return this.toItems(await readXhsStateList(b, ["feed", "feeds"]))
        },
        loginError: "小红书登录已失效或未登录，请到「账号与凭证」重新扫码",
      },
      // 列表 lane:explore 专属 tab,翻页 state 不被详情/登录导航走(§3.13)。
      "list:xhs:explore",
    )
    return items
  }

  /**
   * 翻页(explore 滚动驱动)——推荐流是无限滚动:滚到底后页面自己发分页请求,
   * 我们只读 `__INITIAL_STATE__.feed.feeds` 的增量。
   *
   * cursor = 已返回条数。平台一次滚动通常追加/前插 ~120 条,一次整批返回。
   */
  private async fetchMoreViaBrowser(
    browser: BrowserBackend,
    cursor?: string,
    existing?: number,
  ): Promise<{ xml: string; cursor?: string }> {
    return withBrowserOp(browser, { lane: "list:xhs:explore", mode: "interactive", platform: "xhs" }, async (b) => {
      // 已在 /explore(忽略 query)就**不重载**:页面累计的 feed 与滚动位置是增量
      // 翻页的唯一依据,重载会让 state 回到首屏 → 每次都取到同一批。
      await ensureXhsPageReady(b, "/explore", "小红书登录已失效或未登录，请到「账号与凭证」重新扫码")

      const initial = await readXhsStateList(b, ["feed", "feeds"])
      // cursor = 已返回条数。⚠️ 不能假设新推荐一定追加在尾部:平台可能把新批次
      // **prepend 到 head**(表现为「第一页数据一直往下重复」)。用滚动前后的首条 id
      // 判断增长方向,再决定从头部还是尾部取增量。
      //
      // ⚠️ 也不能把 cursor clamp 到当前页面条数:页面被重载过时(点开笔记等),页面
      // 回到首屏,clamp 会把切片压回**已返回过的前缀** —— 表现为「加载更多点了没反应」。
      // 保持旧 cursor:滚动把页面养到超过它,这轮滚不到就返回空 + 原 cursor 让 core
      // 重试(别标 ended)。首次翻页的起点 = store 已有条数(不是页面当前长度):
      // 页面可能被上次滚动养到几百条,而 store 只有首屏几十条 —— 用页面长度会跳过
      // 中间几百条。页面比 store 还短(被重载回首屏)时只能从页面长度起,靠后续滚动
      // 把页面养过游标。
      const returned =
        cursor !== undefined
          ? Number(cursor) || 0
          : Math.min(existing ?? initial.length, initial.length)
      const headBefore = feedKey(initial[0])
      let after = initial
      let platformActive = false
      if (initial.length <= returned) {
        const r = await scrollXhsUntilGrown(
          b,
          () => readXhsStateListCount(b, ["feed", "feeds"]),
          returned,
        )
        platformActive = r.platformActive
        after = await readXhsStateList(b, ["feed", "feeds"])
      }

      const total = after.length
      const prepended = !!headBefore && feedKey(after[0]) !== headBefore
      // prepend:新旧边界在尾部(total - returned 条新内容在头部);
      // append:边界在 returned 处。两种方向都一次返回整批新内容 —— 分窗口切片在
      // prepend 下会把「已返回/未返回」混在头部,无法用一个索引表达。
      // ⚠️ 已知上限:这只识别「纯前插/纯追加」。头部非纯前插的变动(首卡被替换、
      // 同轮前插+后插)会切到已返回过的旧条目,靠 store 按 id 去重兜底(最多丢一批,
      // 不会重复展示);实测(2026-10-20,862→968 条)平台推荐流是尾部追加。
      const fresh =
        total <= returned
          ? []
          : prepended
            ? after.slice(0, total - returned)
            : after.slice(returned)
      const items = this.toItems(fresh)
      const xml = serializeFeed(items, this.channelOptions())
      if (!fresh.length) {
        // 平台还在追加(scrollHeight 增长)但 state 未到位 → 原样返回 cursor 让 core 重试;
        // 否则视为真到底(hasMore=false)。
        if (platformActive) return { xml, cursor: cursor ?? String(returned) }
        return { xml }
      }
      return { xml, cursor: String(total) }
    })
  }

  /**
   * LX 被动采集:导航 `/explore`(页面自然行为)→ CDP Network 取 SSR 文档 → 解析。
   * 拿不到缓冲返回 null(core 会回退内容缓存,绝不回退主动 `fetch()`)。
   */
  private async fetchPassive(): Promise<string | null> {
    const browser = globalThis.appHost?.browser
    if (!browser?.send || !browser.onEvent) return null
    const feeds = await fetchXhsPassivePage(
      browser,
      {
        path: "/explore",
        endpoint: "explore",
        match: (u) => u.pathname === "/explore",
        notLoggedInMsg: "小红书登录已失效或未登录，请到「账号与凭证」重新扫码",
        readState: (state) => flatXhsStateList(state, ["feed", "feeds"]),
        // A 路线没拿到缓冲时回退页面 SSR(导航已完成 + state 已挂载,仍不构造请求)。
        // ⚠️ 用传入的 lane 句柄 b 读(默认页是 about:blank,读了只会 0 条)。
        // ⚠️ 必须等列表非空:带 web_session 的会话 SSR 只给空壳,feed 由页面 XHR 填。
        readPage: async (b) => {
          await waitXhsListNonEmpty(b, ["feed", "feeds"])
          return readXhsStateList(b, ["feed", "feeds"])
        },
      },
      // 被动捕获与主动刷新同 lane:绑到本 lane 的 tab,事件/响应不串台(§3.13 坑 4)。
      "list:xhs:explore",
    )
    // 缓冲缺失 → null(core 回退缓存);缓冲有但 0 条 → 空 XML(与旧行为一致)。
    if (!feeds) return null
    return serializeFeed(this.toItems(feeds), this.channelOptions())
  }

  /** feeds[] → Item[](noteId 在展开项外层,noteCard 在内层,xsecToken 也在外层)。 */
  private toItems(feeds: any[]): Item[] {
    const t = now()
    return feeds
      .map((f: any): Social | null =>
        f?.noteCard ? noteCardToSocial(f.noteCard, this.key, t, f.id, f.xsecToken) : null,
      )
      .filter((x): x is Social => !!x)
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "小红书发现页", channelLink: `${XHS_BASE}/explore` }
  }
}
