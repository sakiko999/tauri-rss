/**
 * xhs:user —— 小红书用户笔记 channel(kind: social)。
 *
 * ⚠️ 2026-08-16 修正(RSSHub 新版 getUserWithCookie 对照):**登录态下 profile 页
 * SSR 完整渲染笔记**——`__INITIAL_STATE__.user.notes` 为分组数组,flat 后每项
 * `{ id, noteCard, xsecToken }`,noteCard 含标题/封面/点赞。**不走 `user_posted` API**
 * (需签名 + 参数 image_formats/xsec_token/xsec_source,触发 300011 账号风控;
 * 「Edge 内正常浏览无风控」的根因:SSR 导航 = 正常浏览,页面内 fetch API = 额外 XHR)。
 * 匿名时 SSR `user.notes` 是空分组 `[[],[],…]` → 自然空结果。
 *
 * 双路径(均 SSR,无需签名):
 *   - 浏览器(Tauri appHost.browser,CDP 附加真实 Edge):导航 profile 页 → 页面内取
 *     `__INITIAL_STATE__.user.notes`(浏览器已解析 new Map 等表达式,天然干净)。
 *   - HTTP(无 browser 门面):带 cookie 请求 profile 页 HTML → extractInitialState 解析。
 */
import type { Item, Social } from "@tauri-playground/xml"
import { serializeFeed, type SerializeOptions } from "@tauri-playground/xml"
import type { LoginResult, Loginable, Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { XHS_BASE, extractInitialState, noteCardToSocial, rawOf, xhsClient, xhsScanLogin } from "../../platform/xhs"
import { cdpNavigate, waitUntil, withBrowserLock } from "../../browser/cdp.ts"
import { log } from "../../log.ts"

/** 短延时(滚动翻页等网络/加载)。 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** fetchMore 每次返回的条数(窗口)。平台滚动一次加载 ~120 条,我们只取窗口大小,
 * cursor 用「已返回条数」索引定位——state 缓存命中时零滚动(秒回),缓存耗尽才滚一次。 */
const FETCH_MORE_WINDOW = 30

/** SSR `user.notes` → 扁平笔记数组(每项 { id, noteCard, xsecToken })。解 _rawValue 包装。 */
function extractSsrNotes(state: any): any[] {
  const notes = rawOf(state?.user?.notes)
  return Array.isArray(notes) ? notes.flat() : []
}

export class XhsUserChannel implements RssChannel, Loginable {
  readonly key = "xhs:user"
  readonly name = "小红书用户笔记"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "user_id", label: "用户 ID(24 位)", required: true }]

  /** 扫码登录(Loginable,channel 级能力)。浏览器路径登录一次,同平台 channel 共享账号。 */
  scanLogin(
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error("扫码登录需 Tauri 桌面环境(未注入 appHost.browser)")
    return xhsScanLogin(browser, emitQr, opts)
  }

  getSource(info: SourceInfo): RssSource & Partial<Pageable> {
    const userId = String(info.user_id ?? "").trim()
    const browser = globalThis.appHost?.browser
    const fetch = apiFetch(() => this.fetchItems(info), () => this.channelOptions(info))
    return browser
      ? { fetch, fetchMore: (cursor?: string) => this.fetchMoreViaBrowser(browser, userId, cursor) }
      : { fetch }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const userId = String(info.user_id ?? "").trim()
    if (!userId) throw new Error("xhs:user 需要 user_id")
    const cookie = (info.cookie as string) || ""
    const browser = globalThis.appHost?.browser

    if (browser) {
      return this.fetchViaBrowser(browser, userId)
    }
    // HTTP 降级:带 cookie 请求 profile 页 HTML → 解析 SSR user.notes(RSSHub
    // getUserWithCookie 同路径)。匿名时 SSR notes 空分组 → 自然空结果。
    const html = await xhsClient.getHtml(`${XHS_BASE}/user/profile/${userId}`, { cookie: cookie || undefined })
    return this.notesToItems(extractSsrNotes(extractInitialState(html)))
  }

  /** SSR 扁平笔记数组 → Item[](noteCard → Social,noteId 用外层 id)。 */
  private notesToItems(notes: any[]): Item[] {
    const t = now()
    return notes
      .map((n: any): Social | null => (n?.noteCard ? noteCardToSocial(n.noteCard, this.key, t, n.id) : null))
      .filter((x): x is Social => !!x)
  }

  /**
   * 浏览器路径:导航 profile 页 = 正常浏览行为(SSR 登录态渲染笔记,非 XHR API →
   * 无签名/参数/风控负担)。页面内取 `__INITIAL_STATE__.user.notes`(浏览器已解析
   * new Map 等表达式,天然干净)。与 RSSHub getUserWithCookie 同路径。
   */
  private async fetchViaBrowser(browser: BrowserBackend, userId: string): Promise<Item[]> {
    // withBrowserLock:导航 + 提取原子完成(单 Edge 共享,防并发抢页→跨域)。
    return withBrowserLock(async () => {
      // forceReload:refresh 需整页重载拿最新 SSR——同址不重载(fetchMore 用)会读到旧 SPA state。
      await cdpNavigate(browser, `${XHS_BASE}/user/profile/${userId}`, true)
      // 等 SSR 状态挂载(首个 script 即挂,domcontentloaded 前后都有;超时防结构变化)。
      await waitUntil(browser, `typeof window.__INITIAL_STATE__ !== 'undefined'`, 15_000, "xhs SSR 状态未挂载")

      // 风控检测(RSSHub getUser 同款):验证框出现 = 当前环境被拦。
      if (await this.hasVerifyBox(browser)) {
        throw new Error("小红书风控校验(.fe-verify-box)出现——账号可能被风控,请稍后再试或重新扫码登录")
      }

      // 页面内取 SSR user.notes(统一走 readNotes,不重复手写表达式)。空结果时查登录态区分根因。
      const { list: notes } = await this.readNotes(browser)
      if (!notes.length) {
        const loggedIn = await browser.evaluate<boolean>(`!!window.__INITIAL_STATE__?.user?.loggedIn`)
        log.xhs.userEmpty({ body: `user.notes 空(登录态=${loggedIn}),profile 页 SSR` })
      }
      return this.notesToItems(notes)
    })
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
  ): Promise<{ xml: string; cursor?: string }> {
    // withBrowserLock:滚动 + 读 state 原子(单 Edge 共享,防并发抢页)。
    return withBrowserLock(async () => {
      await cdpNavigate(browser, `${XHS_BASE}/user/profile/${userId}`)
      await waitUntil(browser, `typeof window.__INITIAL_STATE__ !== 'undefined'`, 15_000, "xhs SSR 状态未挂载")

      const initial = await this.readNotes(browser)
      // 已返回条数(索引定位)。无 cursor:跳过当前已加载(含 fetch 首页 32 条,不重复返回)。
      const startIdx = cursor ? Number(cursor) || 0 : initial.list.length

      // state 缓存不足才滚动(平台自己签名加载,我们只触发);缓存够则零滚动直接取窗口(快)。
      let after = initial
      // 平台是否「还在追加内容」(滚动后 scrollHeight 增长)——0 条时据此区分「真到底」vs
      // 「加载慢/未触发」:前者 hasMore false(停),后者返回 cursor 让 core 重试(别标 ended)。
      let platformActive = false
      if (initial.list.length <= startIdx) {
        for (let round = 0; round < 3; round++) {
          if (await this.hasVerifyBox(browser)) {
            throw new Error("小红书风控验证码出现(滚动触发),已停止翻页——请降低刷新频率或稍后再试")
          }
          // 小步滚动(分 3 次,每步 ~400ms)触发平台懒加载——一步滚到底对平台 IntersectionObserver
          // /scroll listener 不敏感(实测连续 loadMore 滚动无增长 → 0 条 → hasMore false)。
          // 步进加随机抖动去机械化(固定节奏易被平台识别为自动化)。
          const hBefore = await browser.evaluate<number>(`document.body.scrollHeight`)
          await browser.evaluate(`(async () => {
            const dist = document.body.scrollHeight - window.scrollY;
            for (let i = 1; i <= 3; i++) {
              window.scrollTo(0, window.scrollY + dist * (i / 3));
              await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
            }
          })()`)
          // 轮询等待 notes 增长(平台 user_posted 网络+渲染耗时 > 固定 sleep,实测 1.4~2.4s 不够)。
          // 只读数量(轻量)判增长,确认到位后再完整 readNotes 一次取窗口——整棵序列化 6 次/轮太贵。
          // 轮询间隔加随机抖动去机械化。
          let grew = false
          for (let i = 0; i < 6; i++) {
            await sleep(500 + Math.floor(Math.random() * 300))
            if ((await this.readNotesCount(browser)) > startIdx) {
              grew = true
              break // 新批已到位(即使平台加载多批,我们只取窗口)
            }
          }
          const hAfter = await browser.evaluate<number>(`document.body.scrollHeight`)
          if (hAfter > hBefore) platformActive = true
          if (grew) break
        }
        after = await this.readNotes(browser)
      }

      // 窗口化:只取 [startIdx, startIdx+WINDOW)——平台一次滚到底加载 120 条,每次只返回 30。
      const page = after.list.slice(startIdx, startIdx + FETCH_MORE_WINDOW)
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

  /** 页面内检测风控验证框(RSSHub getUser 同款选择器)。 */
  private async hasVerifyBox(browser: BrowserBackend): Promise<boolean> {
    return browser.evaluate<boolean>(`!!document.querySelector('.fe-verify-box')`)
  }

  /** 页面内读当前全部 notes(解 _rawValue + flat)。 */
  private async readNotes(browser: BrowserBackend): Promise<{ list: any[] }> {
    const r = await browser.evaluate<{ list: any[] }>(
      `(() => {
        const u = window.__INITIAL_STATE__?.user;
        const raw = u?.notes?._rawValue ?? u?.notes;
        return { list: Array.isArray(raw) ? raw.flat() : [] };
      })()`,
      { awaitPromise: true, returnByValue: true },
    )
    return r ?? { list: [] }
  }

  /** 只读 notes 数量(滚动轮询用——整棵 ~1MB 序列化只为判增长太贵,轻量 evaluate 只返回长度)。 */
  private async readNotesCount(browser: BrowserBackend): Promise<number> {
    const n = await browser.evaluate<number>(
      `(() => {
        const u = window.__INITIAL_STATE__?.user;
        const raw = u?.notes?._rawValue ?? u?.notes;
        return Array.isArray(raw) ? raw.flat().length : 0;
      })()`,
      { awaitPromise: true, returnByValue: true },
    )
    return n ?? 0
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `小红书 · ${info.user_id}`,
      channelLink: `${XHS_BASE}/user/profile/${info.user_id}`,
    }
  }
}
