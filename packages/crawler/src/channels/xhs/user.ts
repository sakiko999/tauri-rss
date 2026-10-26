/**
 * xhs:user —— 小红书用户笔记 channel(kind: social)。
 *
 * ⚠️ 2026-08-16 修正(RSSHub 新版 getUserWithCookie 对照):**登录态下 profile 页
 * SSR 完整渲染笔记**——`__INITIAL_STATE__.user.notes` 为分组数组,flat 后每项
 * `{ id, noteCard, xsecToken }`,noteCard 含标题/封面/点赞。**不走 `user_posted` API**
 * (需签名 + 参数 image_formats/xsec_token/xsec_source,触发 300011 账号风控;
 * 「浏览器内正常浏览无风控」的根因:SSR 导航 = 正常浏览,页面内 fetch API = 额外 XHR)。
 *
 * 匿名态已移除(2026-10-22):匿名 profile SSR 虽然渲染卡片,但平台把 noteId 定向
 * 抹空(外层 `id` 与 `noteCard.noteId` 全空串),既没有可打开的链接也没有稳定 id。
 *
 * 抓取策略统一在 `shared.ts`:
 *   - 导航后读页面 SSR(不构造请求),登录态由 `fetchXhsList` / `ensureXhsPageReady` 保证;
 *   - 翻页是**滚动驱动**(页面自己发 user_posted),属于被动交互;
 *   - 无浏览器(mobile/CLI)→ HTTP SSR,但必须带登录 cookie。
 *
 * ⚠️ 本渠道**不声明** `passive`:翻页要 interactive 滚动,不是纯导航采集。
 */
import type { Item, Social } from "@amoeba/xml"
import { serializeFeed, type SerializeOptions } from "@amoeba/xml"
import type { ItemDetailSource, Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { XHS_BASE, extractInitialState, log, noteCardToSocial, now, xhsClient } from "@amoeba/resolve"
import { withBrowserOp } from "@amoeba/resolve"
import {
  ensureXhsPageReady,
  fetchXhsList,
  flatXhsStateList,
  readXhsStateList,
  readXhsStateListCount,
  requireXhsCookie,
  resolveXhsItemDetail,
  scrollXhsUntilGrown,
  XHS_FETCH_MORE_WINDOW,
  XHS_LOGIN_REQUIRED,
} from "./shared.ts"
import { XhsChannelBase } from "./base.ts"

export class XhsUserChannel extends XhsChannelBase implements RssChannel {
  readonly key = "xhs:user"
  readonly name = "小红书用户笔记"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "user_id", label: "用户 ID(24 位)", required: true }]

  getSource(info: SourceInfo): RssSource & Partial<Pageable> & ItemDetailSource {
    const userId = String(info.user_id ?? "").trim()
    // 显式空串 = 强制匿名（CLI `--kv cookie=`）：匿名态已移除，浏览器路径也不得绕过。
    if (info.cookie === "") {
      const denied = () => Promise.reject(new Error(XHS_LOGIN_REQUIRED))
      return { fetch: denied, fetchPassive: denied, fetchMore: denied, resolveDetail: denied }
    }
    const browser = globalThis.appHost?.browser
    const fetch = apiFetchItems(() => this.fetchItems(info), () => this.channelOptions(info))
    const base = (browser
      ? {
          fetch,
          fetchMore: (cursor?: string, ctx?: { existing: number }) =>
            this.fetchMoreViaBrowser(browser, userId, cursor, ctx?.existing),
        }
      : { fetch }) as RssSource & Partial<Pageable> & ItemDetailSource
    // 详情与 explore 共用同一套策略。刻意不传 info.cookie:桌面有浏览器时详情走浏览器栈
    // (reqwest 带账号 cookie 既拿不到数据——xhs WAF 按客户端栈判定——又让凭据走非浏览器栈
    // 出站);无浏览器门面(mobile/CLI)会回落 provider 登录态,这是登录态必需的。
    base.resolveDetail = (item) => resolveXhsItemDetail({ item, sourceKey: this.key, browser })
    return base
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const userId = String(info.user_id ?? "").trim()
    if (!userId) throw new Error("xhs:user 需要 user_id")
    const cookie = info.cookie as string | undefined
    const browser = globalThis.appHost?.browser
    if (browser) return this.fetchViaBrowser(browser, userId)
    return this.fetchViaHttp(userId, cookie)
  }

  /** 正常刷新:登录态读页面 SSR(未登录由 fetchXhsList 抛可操作错误)。 */
  private async fetchViaBrowser(browser: BrowserBackend, userId: string): Promise<Item[]> {
    const items = await fetchXhsList(
      browser,
      {
        url: `${XHS_BASE}/user/profile/${userId}`,
        readPage: async (b) => {
          const list = await readXhsStateList(b, ["user", "notes"])
          if (!list.length) log.xhs.userEmpty({ body: "user.notes 空(已登录),profile 页 SSR" })
          return this.notesToItems(list)
        },
        loginError: "小红书登录已失效或未登录：用户主页需要登录，请到「账号与凭证」重新扫码",
      },
      // 列表 lane:user 专属 tab——explore/详情在各自 lane,翻页累积的 notes 不被清(§3.13)。
      "list:xhs:user",
    )
    return items
  }

  /** HTTP 路径:带登录 cookie 请求 profile 页 HTML → 解析 SSR user.notes(RSSHub getUserWithCookie 同路径)。 */
  private async fetchViaHttp(userId: string, cookie?: string): Promise<Item[]> {
    const ck = requireXhsCookie(cookie)
    const html = await xhsClient.getHtml(`${XHS_BASE}/user/profile/${userId}`, { cookie: ck })
    return this.notesToItems(flatXhsStateList(extractInitialState(html), ["user", "notes"]))
  }

  /** SSR 扁平笔记数组 → Item[](noteCard → Social,noteId 用外层 id,xsecToken 在外层)。 */
  private notesToItems(notes: any[]): Item[] {
    const t = now()
    return notes
      .map((n: any): Social | null =>
        n?.noteCard ? noteCardToSocial(n.noteCard, this.key, t, n.id, n.xsecToken) : null,
      )
      .filter((x): x is Social => !!x)
  }

  /**
   * 翻页(fetchMore,浏览器路径)——**滚动驱动分页**:页面滚到底,小红书自己发
   * user_posted 请求(完整签名 x-s/x-s-common/x-rap-param/x-b3-traceid,平台前端
   * 生成),我们只读更新后的 `__INITIAL_STATE__.user.notes` 增量。
   *
   * ⚠️ 为什么不用页面内 fetch user_posted:手拼签名只有 _webmsxyw 的 X-s/X-t 两个头,
   * 缺 x-s-common/x-rap-param/x-xray-traceid → 300011 账号风控。滚动驱动 = 真实浏览
   * 行为,平台自己签名,无风控(实测:滚动前 32 条 → 滚动后 807 条)。
   *
   * cursor 无外部语义(滚动基于页面 state 自足迹);返回 count 作游标防 core 判空。
   * 每次调用从「当前已加载」继续往下滚 → 增量。滚动到底无更多 = 空结果 = hasMore false。
   */
  private async fetchMoreViaBrowser(
    browser: BrowserBackend,
    userId: string,
    cursor?: string,
    existing?: number,
  ): Promise<{ xml: string; cursor?: string }> {
    // 滚动 + 读 state 原子(user 专属 lane tab,防并发抢页)。
    // ⚠️ 滚动驱动必须 interactive：hidden（SW_HIDE）下渲染管线停摆，
    // window.scrollTo 只改 scrollTop、不派发 scroll 事件，IntersectionObserver
    // 与 lazy 加载也不触发（2026-10-19 实测，见 docs/crawler-risk-control.md §3.9）。
    // renderLease 在最后一个租约释放时才切回 hidden（多 lane 不互掐滚动）。
    // ⚠️ 滚动前 activate 本 tab(withBrowserOp 内做):非激活 tab 的 rAF/IO 同样停摆。
    return withBrowserOp(browser, { lane: "list:xhs:user", mode: "interactive", platform: "xhs" }, async (b) => {
      // 已在 profile 页(忽略 query)就不重载:滚动驱动的增量依赖页面累计的 notes,
      // 重载会让 state 回到首屏,`slice(startIdx)` 又切到已返回过的条目。
      // 未登录 / 登录失效在这里抛可操作错误(不再有匿名翻页)。
      await ensureXhsPageReady(
        b,
        `/user/profile/${userId}`,
        "小红书登录已失效或未登录：用户主页需要登录，请到「账号与凭证」重新扫码",
      )

      const initial = await readXhsStateList(b, ["user", "notes"])
      // 已返回条数(索引定位)。首次翻页用 store 已有条数(同 explore:页面可能
      // 被养到几百条,页面长度 ≠ store 已返回数,用它会跳过中间几百条)。
      // ⚠️ 不能 clamp 到当前页面条数:页面被重载过时(点开笔记会把 detail lane
      // 之外的本 tab 导航走),clamp 会把窗口压回**已返回过的前缀** —— 「加载更多
      // 点了没反应」。保持旧 cursor:滚动把页面养到超过它;这轮滚不到就返回空 +
      // 原 cursor 让 core 重试(别标 ended)。
      const startIdx =
        cursor !== undefined
          ? Number(cursor) || 0
          : Math.min(existing ?? initial.length, initial.length)

      // state 缓存不足才滚动(平台自己签名加载,我们只触发);缓存够则零滚动直接取窗口(快)。
      let after = initial
      // 平台是否「还在追加内容」(滚动后 scrollHeight 增长)——0 条时据此区分「真到底」vs
      // 「加载慢/未触发」:前者 hasMore false(停),后者返回 cursor 让 core 重试(别标 ended)。
      let platformActive = false
      if (initial.length <= startIdx) {
        const r = await scrollXhsUntilGrown(
          b,
          () => readXhsStateListCount(b, ["user", "notes"]),
          startIdx,
        )
        platformActive = r.platformActive
        after = await readXhsStateList(b, ["user", "notes"])
      }

      // 窗口化:只取 [startIdx, startIdx+WINDOW)——平台一次滚到底加载 120 条,每次只返回 30。
      const page = after.slice(startIdx, startIdx + XHS_FETCH_MORE_WINDOW)
      const items = this.notesToItems(page)
      const xml = serializeFeed(items, this.channelOptions({ user_id: userId }))
      if (!page.length) {
        // 0 条:平台还在追加(scrollHeight 增长)但 notes 未渲染到位 → 返回 cursor 让 core 重试
        // (而非 hasMore false → desktop 标 ended → 用户被迫手动刷新)。cursor 不变,desktop
        // onRender 无进展保护(items 不增长)不会自动重复触发,只由用户手动再点「加载更多」。
        if (platformActive) return { xml, cursor: String(startIdx) }
        return { xml } // 真到底:多次滚动 scrollHeight 无增长 = 平台无更多
      }
      return { xml, cursor: String(startIdx + page.length) }
    })
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `小红书 · ${info.user_id}`,
      channelLink: `${XHS_BASE}/user/profile/${info.user_id}`,
    }
  }
}
