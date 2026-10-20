/**
 * xhs:user —— 小红书用户笔记 channel(kind: social)。
 *
 * ⚠️ 2026-08-16 修正(RSSHub 新版 getUserWithCookie 对照):**登录态下 profile 页
 * SSR 完整渲染笔记**——`__INITIAL_STATE__.user.notes` 为分组数组,flat 后每项
 * `{ id, noteCard, xsecToken }`,noteCard 含标题/封面/点赞。**不走 `user_posted` API**
 * (需签名 + 参数 image_formats/xsec_token/xsec_source,触发 300011 账号风控;
 * 「Edge 内正常浏览无风控」的根因:SSR 导航 = 正常浏览,页面内 fetch API = 额外 XHR)。
 *
 * ⚠️ 2026-08-28 匿名实测修正(此前误记「匿名时空分组」):匿名 SSR **渲染 32 条卡片**
 * (标题/封面/点赞/作者/xsecToken 全有),但平台把 noteId 定向抹空(外层 `id` 与
 * `noteCard.noteId` 全空串,DOM 亦零笔记链接)——无法构造笔记 URL、无稳定 id,
 * noteCardToSocial 按「无 noteId → null」全过滤 → 自然空结果。即 user 笔记流
 * **完整数据必须登录态**(explore 推荐流匿名可用)。
 *
 * 抓取策略统一在 `shared.ts`:
 *   - 登录态 → passive(导航后读页面 SSR);
 *   - 匿名访客 → fetch(页面内抓匿名 profile HTML,noteId 抹空 → 虚拟 ID 兜底);
 *   - L9 刷新 → `fetchPassive`(匿名不 fetch,返回 null 让 core 回退缓存)。
 *
 * 翻页是**滚动驱动**(页面自己发 user_posted),属于被动;匿名无法翻页。
 */
import type { Item, Social } from "@amoeba/xml"
import { serializeFeed, type SerializeOptions } from "@amoeba/xml"
import type { ItemDetailSource, Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { XHS_BASE, extractInitialState, isXhsLoggedIn, log, noteCardToSocial, now, xhsClient } from "@amoeba/resolve"
import { withBrowserMode } from "@amoeba/resolve"
import {
  ensureXhsPageReady,
  fetchXhsList,
  flatXhsStateList,
  readXhsStateList,
  readXhsStateListCount,
  resolveXhsItemDetail,
  scrollXhsUntilGrown,
  XHS_FETCH_MORE_WINDOW,
} from "./shared.ts"
import { XhsChannelBase } from "./base.ts"

export class XhsUserChannel extends XhsChannelBase implements RssChannel {
  readonly key = "xhs:user"
  readonly name = "小红书用户笔记"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "user_id", label: "用户 ID(24 位)", required: true }]

  getSource(info: SourceInfo): RssSource & Partial<Pageable> & ItemDetailSource {
    const userId = String(info.user_id ?? "").trim()
    const browser = globalThis.appHost?.browser
    const fetch = apiFetchItems(() => this.fetchItems(info), () => this.channelOptions(info))
    const base = (browser
      ? {
          fetch,
          fetchMore: (cursor?: string, ctx?: { existing: number }) =>
            this.fetchMoreViaBrowser(browser, userId, cursor, ctx?.existing),
          // LX:只导航 + 读页面 SSR(路线 B),不构造任何请求。
          fetchPassive: () => this.fetchPassive(browser, userId),
        }
      : { fetch }) as RssSource & Partial<Pageable> & ItemDetailSource
    // 详情与 explore 共用同一套策略;刻意不传 cookie —— reqwest 带账号 cookie 既拿不到
    // 数据(xhs WAF 按客户端栈判定),又让会话凭据走非浏览器栈出站。
    base.resolveDetail = (item, opts) =>
      resolveXhsItemDetail({
        item,
        sourceKey: this.key,
        browser,
        passiveOnly: opts?.passive,
      })
    return base
  }

  /**
   * LX 被动采集:导航 profile 页 + 读页面 SSR(路线 B),不构造任何请求。
   * 匿名访客在 L9 下**不 fetch** → 返回 null,让 core 回退内容缓存。
   */
  private async fetchPassive(browser: BrowserBackend, userId: string): Promise<string | null> {
    if (!browser.send || !userId) return null
    const items = await fetchXhsList(browser, {
      url: `${XHS_BASE}/user/profile/${userId}`,
      passiveOnly: true,
      readPage: async (b) => this.notesToItems(await readXhsStateList(b, ["user", "notes"])),
    })
    if (!items?.length) return null
    return serializeFeed(items, this.channelOptions({ user_id: userId }))
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const userId = String(info.user_id ?? "").trim()
    if (!userId) throw new Error("xhs:user 需要 user_id")
    const cookie = (info.cookie as string) || ""
    const browser = globalThis.appHost?.browser
    if (browser) return this.fetchViaBrowser(browser, userId)
    return this.fetchViaHttp(userId, cookie)
  }

  /** 正常刷新:登录态 passive(读页面 SSR),匿名 fetch(匿名 profile HTML → 虚拟 ID)。 */
  private async fetchViaBrowser(browser: BrowserBackend, userId: string): Promise<Item[]> {
    const items = await fetchXhsList(browser, {
      url: `${XHS_BASE}/user/profile/${userId}`,
      readPage: async (b) => {
        const list = await readXhsStateList(b, ["user", "notes"])
        if (!list.length) log.xhs.userEmpty({ body: "user.notes 空(已登录),profile 页 SSR" })
        return this.notesToItems(list)
      },
      parseHtml: (html) => {
        log.xhs.userEmpty({ body: "未登录,回退匿名 fetch" })
        return this.notesToItems(flatXhsStateList(extractInitialState(html), ["user", "notes"]))
      },
    })
    return items ?? []
  }

  /** HTTP 路径:带 cookie 请求 profile 页 HTML → 解析 SSR user.notes(RSSHub getUserWithCookie 同路径)。 */
  private async fetchViaHttp(userId: string, cookie: string): Promise<Item[]> {
    const html = await xhsClient.getHtml(`${XHS_BASE}/user/profile/${userId}`, { cookie: cookie || undefined })
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
    // 滚动 + 读 state 原子(单 Edge 共享,防并发抢页)。
    // ⚠️ 滚动驱动必须 interactive：hidden（SW_HIDE）下渲染管线停摆，
    // window.scrollTo 只改 scrollTop、不派发 scroll 事件，IntersectionObserver
    // 与 lazy 加载也不触发（2026-10-19 实测，见 docs/crawler-risk-control.md §3.9）。
    // wrapper 会在结束后自动切回 hidden（interactive 常驻有 CPU/GPU 开销）。
    return withBrowserMode(
      browser,
      "interactive",
      async () => {
        // 已在 profile 页(忽略 query)就不重载:滚动驱动的增量依赖页面累计的 notes,
        // 重载会让 state 回到首屏,`slice(startIdx)` 又切到已返回过的条目。
        await ensureXhsPageReady(
          browser,
          `/user/profile/${userId}`,
          "小红书登录已失效或未登录：用户主页需要登录，请到「账号与凭证」重新扫码",
        )
        // 匿名 SSR 的 noteId 全被抹空,滚动也加载不出更多 —— 直接给出可操作的错误,
        // 不要静默滚到底再报「已加载全部」。
        if (!(await isXhsLoggedIn(browser))) {
          throw new Error("小红书用户主页翻页需要登录：请先到「账号与凭证」扫码登录")
        }

        const initial = await readXhsStateList(browser, ["user", "notes"])
        // 已返回条数(索引定位)。首次翻页用 store 已有条数(同 explore:共享页面可能
        // 被养到几百条,页面长度 ≠ store 已返回数,用它会跳过中间几百条)。
        // ⚠️ 不能 clamp 到当前页面条数:页面被重载过时(点开笔记会把共享 Edge 导航走),
        // clamp 会把窗口压回**已返回过的前缀** —— 「加载更多点了没反应」。保持旧 cursor:
        // 滚动把页面养到超过它;这轮滚不到就返回空 + 原 cursor 让 core 重试(别标 ended)。
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
            browser,
            () => readXhsStateListCount(browser, ["user", "notes"]),
            startIdx,
          )
          platformActive = r.platformActive
          after = await readXhsStateList(browser, ["user", "notes"])
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
      },
      "xhs",
    )
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `小红书 · ${info.user_id}`,
      channelLink: `${XHS_BASE}/user/profile/${info.user_id}`,
    }
  }
}
