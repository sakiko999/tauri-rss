/**
 * xhs:explore —— 小红书发现页(推荐内容)channel(kind: social)。
 *
 * `/explore` SSR 的 `__INITIAL_STATE__.feed`(可能有 _rawValue 包装)含
 * `feeds[]`,每张 noteCard 即一条推荐笔记(标题/封面带尺寸/点赞)。
 *
 * 抓取策略统一在 `shared.ts`:
 *   - 登录/匿名都读页面 SSR(passive;匿名推荐流本身有 feeds,不再多抓 HTML);
 *   - 翻页 = 滚动驱动,读 `feed.feeds` 增量,登录/匿名共用;
 *   - L9 刷新 → `fetchPassive`(CDP Network 捕获页面自己的文档)。
 */
import type { Item, Social } from "@amoeba/xml"
import { serializeFeed, type SerializeOptions } from "@amoeba/xml"
import type { ItemDetailSource, Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { capturePage } from "../../passive/capture.ts"
import { passiveBuffer } from "../../passive/buffer.ts"
import { XHS_BASE, extractInitialState, noteCardToSocial, now, rawOf, xhsClient } from "@amoeba/resolve"
import { cdpEvaluate, cdpNavigate, withBrowserMode } from "@amoeba/resolve"
import {
  assertXhsNotBlocked,
  ensureXhsPageReady,
  fetchXhsList,
  resolveXhsItemDetail,
  scrollXhsUntilGrown,
  XhsChannelBase,
} from "./shared.ts"

/** 判断滚动前后 feed 头部是否变化的稳定 key(noteId 在展开项外层)。 */
function feedKey(f: any): string {
  return String(f?.id ?? f?.noteCard?.noteId ?? "")
}

export class XhsExploreChannel extends XhsChannelBase implements RssChannel {
  readonly key = "xhs:explore"
  readonly name = "小红书发现页"
  readonly kind = "social" as const
  readonly defaultInfo: SourceInfo = {}

  getSource(info: SourceInfo): RssSource & Partial<Pageable> & ItemDetailSource {
    const cookie = (info.cookie as string) || undefined
    const browser = globalThis.appHost?.browser
    const source: RssSource & Partial<Pageable> & ItemDetailSource = {
      fetch: apiFetchItems(
        () => (browser ? this.fetchViaBrowser(browser) : this.fetchViaHttp(cookie)),
        () => this.channelOptions(),
      ),
      // LX:导航是页面自然行为;响应体从 CDP Network 缓冲取,不构造主动请求。
      fetchPassive: () => this.fetchPassive(),
      // 单条详情:登录态读详情页 SSR,匿名 fetch 详情 HTML;passive 来自 core 的 L9 闸门。
      resolveDetail: (item, opts) =>
        resolveXhsItemDetail({
          item,
          sourceKey: this.key,
          browser,
          cookie,
          passiveOnly: opts?.passive,
        }),
    }
    // 推荐流是无限滚动:滚到底由页面自己分页,我们只读增量(登录/匿名都适用)。
    if (browser) source.fetchMore = (cursor?: string) => this.fetchMoreViaBrowser(browser, cursor)
    return source
  }

  /** 正常刷新:登录/匿名都读页面 SSR。 */
  private async fetchViaBrowser(browser: BrowserBackend): Promise<Item[]> {
    const items = await fetchXhsList(browser, {
      url: `${XHS_BASE}/explore`,
      readPage: async (b) => this.toItems((await this.readFeeds(b)).list),
    })
    return items ?? []
  }

  /** 页面内读当前 explore feed(解 _rawValue + flat)。 */
  private async readFeeds(browser: BrowserBackend): Promise<{ list: any[] }> {
    const r = await cdpEvaluate<{ list: any[] }>(
      browser,
      `(() => {
        const f = window.__INITIAL_STATE__?.feed;
        const raw = f?._rawValue ?? f;
        const feeds = raw?.feeds?._rawValue ?? raw?.feeds;
        return { list: Array.isArray(feeds) ? feeds.flat() : [] };
      })()`,
    )
    return r ?? { list: [] }
  }

  /** 只读 feed.feeds 数量(滚动轮询用;整棵序列化只为判增长太贵)。 */
  private async readFeedsCount(browser: BrowserBackend): Promise<number> {
    const n = await cdpEvaluate<number>(
      browser,
      `(() => {
        const f = window.__INITIAL_STATE__?.feed;
        const raw = f?._rawValue ?? f;
        const feeds = raw?.feeds?._rawValue ?? raw?.feeds;
        return Array.isArray(feeds) ? feeds.flat().length : 0;
      })()`,
    )
    return n ?? 0
  }

  /**
   * 翻页(explore 滚动驱动)——推荐流是无限滚动:滚到底后页面自己发分页请求,
   * 我们只读 `__INITIAL_STATE__.feed.feeds` 的增量。**登录/匿名都有效**:
   * 匿名推荐流本身可读,区别只在首屏取法(登录读 SSR / 匿名 fetch HTML)。
   *
   * cursor = 已返回条数。平台一次滚动通常追加/前插 ~120 条,一次整批返回。
   */
  private async fetchMoreViaBrowser(
    browser: BrowserBackend,
    cursor?: string,
  ): Promise<{ xml: string; cursor?: string }> {
    return withBrowserMode(
      browser,
      "interactive",
      async () => {
        // 已在 /explore(忽略 query)就**不重载**:页面累计的 feed 与滚动位置是增量
        // 翻页的唯一依据,重载会让 state 回到首屏 → 每次都取到同一批。
        await ensureXhsPageReady(
          browser,
          "/explore",
          "小红书登录已失效或未登录，请到「账号与凭证」重新扫码",
        )
        await assertXhsNotBlocked(browser)

        const initial = await this.readFeeds(browser)
        // cursor = 已返回条数。⚠️ 不能假设新推荐一定追加在尾部:平台可能把新批次
        // **prepend 到 head**(表现为「第一页数据一直往下重复」)。用滚动前后的首条 id
        // 判断增长方向,再决定从头部还是尾部取增量。
        //
        // ⚠️ 也不能把 cursor clamp 到当前页面条数:页面被重载过时(点开笔记、刷新别的
        // xhs 订阅都会把共享 Edge 导航走),页面回到首屏,clamp 会把切片压回**已返回过的
        // 前缀** —— 表现为「加载更多点了没反应」。保持旧 cursor:滚动把页面养到超过它,
        // 这轮滚不到就返回空 + 原 cursor 让 core 重试(别标 ended)。
        const returned = cursor ? Number(cursor) || 0 : initial.list.length
        const headBefore = feedKey(initial.list[0])
        let after = initial
        let platformActive = false
        if (initial.list.length <= returned) {
          const r = await scrollXhsUntilGrown(browser, () => this.readFeedsCount(browser), returned)
          platformActive = r.platformActive
          after = await this.readFeeds(browser)
        }

        const total = after.list.length
        const prepended = !!headBefore && feedKey(after.list[0]) !== headBefore
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
              ? after.list.slice(0, total - returned)
              : after.list.slice(returned)
        const items = this.toItems(fresh)
        const xml = serializeFeed(items, this.channelOptions())
        if (!fresh.length) {
          // 平台还在追加(scrollHeight 增长)但 state 未到位 → 原样返回 cursor 让 core 重试;
          // 否则视为真到底(hasMore=false)。
          if (platformActive) return { xml, cursor: cursor ?? String(returned) }
          return { xml }
        }
        return { xml, cursor: String(total) }
      },
      "xhs",
    )
  }

  /**
   * LX 被动采集:导航 `/explore`(页面自然行为)→ CDP Network 取 SSR 文档 → 解析。
   * 拿不到缓冲返回 null(core 会回退内容缓存,绝不回退主动 `fetch()`)。
   */
  private async fetchPassive(): Promise<string | null> {
    const browser = globalThis.appHost?.browser
    if (!browser?.send || !browser.onEvent) return null
    return withBrowserMode(
      browser,
      "hidden",
      async () => {
        await capturePage(browser, {
          platform: "xhs",
          endpoint: "explore",
          match: (u) => u.pathname === "/explore",
          trigger: (b) => cdpNavigate(b, `${XHS_BASE}/explore`, true),
        })
        // 被动路径同样要识别风控/登录重定向,否则会被当成「无被动数据」静默回退缓存。
        await ensureXhsPageReady(
          browser,
          "/explore",
          "小红书登录已失效或未登录，请到「账号与凭证」重新扫码",
        )
        await assertXhsNotBlocked(browser)
        const entry = passiveBuffer.getLatest("xhs", "explore")
        if (!entry) return null
        const items = this.toItems(this.feedsFromState(extractInitialState(entry.body)))
        return serializeFeed(items, this.channelOptions())
      },
      "xhs",
    )
  }

  private async fetchViaHttp(cookie?: string): Promise<Item[]> {
    const html = await xhsClient.getHtml(`${XHS_BASE}/explore`, { cookie })
    return this.toItems(this.feedsFromState(extractInitialState(html)))
  }

  /** 解 `state.feed.feeds`(_rawValue 包装 + flat)。 */
  private feedsFromState(state: any): any[] {
    const feed = rawOf(state.feed)
    const feeds = feed?.feeds?._rawValue ?? feed?.feeds
    return Array.isArray(feeds) ? feeds.flat() : []
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
