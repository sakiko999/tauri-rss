/**
 * xhs:explore —— 小红书发现页(推荐内容)channel(kind: social)。
 *
 * `/explore` SSR 的 `__INITIAL_STATE__.feed`(可能有 _rawValue 包装)含
 * `feeds[]`,每张 noteCard 即一条推荐笔记(标题/封面带尺寸/点赞)。需 cookie。
 *
 * 双路径(与 xhs:user 同构):
 *   - 浏览器(Tauri appHost.browser):导航 `/explore` → 页面内取 feed.feeds。
 *     **实测必要**:匿名 HTTP 下 xhs 按客户端栈区别放行 —— 同一时刻 bun fetch 拿
 *     29 条,而 Rust reqwest / curl 只拿到「有 SSR 结构但 feeds 为空」的壳页
 *     (WAF 指纹判定,非代码问题)。浏览器是真 Chrome 指纹 → 能拿到真实 feeds。
 *   - HTTP(无 browser 门面):xhsClient.getHtml + extractInitialState。
 */
import type { Item, Social } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { ItemDetailSource, LoginResult, Loginable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "@amoeba/resolve"
import { XHS_BASE, extractInitialState, extractNoteDetail, noteCardToSocial, noteDetailToSocial, rawOf, xhsClient, xhsScanLogin } from "@amoeba/resolve"
import { cdpFetch, cdpNavigate, waitUntil, withBrowserLock } from "@amoeba/resolve"

export class XhsExploreChannel implements RssChannel, Loginable {
  readonly key = "xhs:explore"
  readonly name = "小红书发现页"
  readonly kind = "social" as const
  readonly defaultInfo: SourceInfo = {}

  /** 扫码登录(Loginable,channel 级能力)。浏览器路径登录一次,同平台 channel 共享账号。 */
  scanLogin(
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error("扫码登录需 Tauri 桌面环境(未注入 appHost.browser)")
    return xhsScanLogin(browser, emitQr, opts)
  }

  getSource(info: SourceInfo): RssSource & ItemDetailSource {
    const cookie = (info.cookie as string) || undefined
    const browser = globalThis.appHost?.browser
    return {
      fetch: apiFetch(
        () => (browser ? this.fetchViaBrowser(browser) : this.fetchItems(cookie)),
        () => this.channelOptions(),
      ),
      // 单条详情:匿名 GET /explore/<id>?xsec_token= 补全文/多图/tag(video),见 item.url + xsecToken。
      resolveDetail: (item: Item) => this.resolveDetail(item, cookie, browser),
    }
  }

  /**
   * 浏览器路径:导航 `/explore` 取 SSR `feed.feeds`(真 Chrome 指纹,绕开 WAF 对
   * Rust/curl 的空壳响应)。与 xhs:user 的 fetchViaBrowser 同构。
   */
  private async fetchViaBrowser(browser: BrowserBackend): Promise<Item[]> {
    return withBrowserLock(async () => {
      await cdpNavigate(browser, `${XHS_BASE}/explore`, true)
      await waitUntil(browser, `typeof window.__INITIAL_STATE__ !== 'undefined'`, 15_000, "xhs SSR 状态未挂载")
      // 风控验证框出现 = 当前环境被拦,如实报错而非静默 0 条。
      const verify = await browser.evaluate<boolean>(`!!document.querySelector('.fe-verify-box')`)
      if (verify) throw new Error("小红书风控校验(.fe-verify-box)出现——请稍后再试或重新扫码登录")
      const r = await browser.evaluate<{ feeds: any[] }>(
        `(() => {
          const f = window.__INITIAL_STATE__?.feed;
          const raw = f?._rawValue ?? f;
          const feeds = raw?.feeds?._rawValue ?? raw?.feeds;
          return { feeds: Array.isArray(feeds) ? feeds.flat() : [] };
        })()`,
        { awaitPromise: true, returnByValue: true },
      )
      return this.toItems(r?.feeds ?? [])
    })
  }

  /** 单条笔记详情(列表 item 缺全文/多图/标签,详情页补全)。匿名可用(需列表项 xsec_token)。 */
  private async resolveDetail(item: Item, cookie?: string, browser?: BrowserBackend): Promise<Item | null> {
    const noteId = String(item.url ?? "").match(/\/explore\/([^?/?#]+)/)?.[1] ?? ""
    if (!noteId) return null
    const xsec = (item as Social).xsecToken
    const url = `${XHS_BASE}/explore/${noteId}${xsec ? `?xsec_token=${encodeURIComponent(xsec)}&xsec_source=pc_feed` : ""}`
    // ⚠️ 有 browser 时走**页面内 fetch**(Chrome TLS 指纹放行,reqwest 会被 WAF 判成空壳);否则回落 httpText。
    const html = browser
      ? await withBrowserLock(async () => {
          await cdpNavigate(browser, `${XHS_BASE}/explore`, true)
          // ⚠️ credentials: "omit" —— 匿名放行(见 xhs/user.ts 注释);带 cookie 反被 WAF 判空壳。
          const r = await cdpFetch(browser, url, { credentials: "omit" })
          return r.status >= 200 && r.status < 300 ? r.bodyText : ""
        })
      : await xhsClient.getHtml(url, { cookie })
    const note = extractNoteDetail(html, noteId)
    if (!note) return null
    const t = now()
    return noteDetailToSocial(note, this.key, t)
  }

  private async fetchItems(cookie?: string): Promise<Item[]> {
    const html = await xhsClient.getHtml(`${XHS_BASE}/explore`, { cookie })
    const state = extractInitialState(html)
    const feed = rawOf(state.feed)
    return this.toItems(rawOf(feed?.feeds) ?? [])
  }

  /** feeds[] → Item[](两条路径共用:noteId 在展开项外层,noteCard 在内层,xsecToken 也在外层)。 */
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
