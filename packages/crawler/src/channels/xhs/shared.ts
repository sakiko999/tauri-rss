/**
 * xhs 渠道共享的**浏览器策略层**。
 *
 * 设计目标:渠道只描述「抓哪个页面、怎么从页面/HTML 取数据」,不再各自实现
 * 导航就绪、登录判定、风控框检测、passive/fetch 分流。所有 xhs 页面操作都经过
 * 这里,避免 explore/user 的防御逻辑逐渐漂移。
 *
 * 策略(2026-10-20):
 *   - 登录态 → **passive**:导航后读页面 `__INITIAL_STATE__`,不构造任何请求;
 *   - `xhs:explore` 匿名也 **passive**:匿名推荐流 SSR 本身有 feeds,首屏与
 *     fetchMore 用同一份页面 state,不再多抓一次 HTML;
 *   - `xhs:user` 匿名 → **fetch**:匿名 profile SSR 抹空 noteId,走页面内 fetch
 *     (Chrome TLS 指纹,reqwest 会被 WAF 判空壳),产出 `anon-*` 虚拟条目;
 *   - `passiveOnly`(core 的 L9 闸门)→ 匿名时不 fetch,返回 null 让 core 回退缓存。
 *
 * ⚠️ 登录判据是 `isXhsLoggedIn`(页面 loggedIn + 侧栏「我」+ user_id cookie),
 * **不是 `web_session`** —— 小红书对游客也会立即签发 web_session。
 */
import type { Item, Social } from "@amoeba/xml"
import type { LoginResult, Loginable } from "../../index.ts"
import {
  XHS_BASE,
  extractNoteDetail,
  isXhsLoggedIn,
  isXhsOrigin,
  noteDetailStateExpr,
  noteDetailToSocial,
  now,
  reportXhsRisk,
  xhsClient,
  xhsFetchPage,
  xhsScanLogin,
} from "@amoeba/resolve"
import { cdpEvaluate, cdpNavigate, waitUntil, withBrowserMode } from "@amoeba/resolve"

/**
 * xhs 渠道公共基类。
 *
 * 扫码登录是**平台级**操作(同一个 Edge profile),explore/user 只是两个入口;
 * 放在基类里,避免每个渠道复制「检查 browser → 委托 xhsScanLogin」的样板。
 */
export class XhsChannelBase implements Loginable {
  /** 两个 xhs 渠道都支持 L9(浏览器被动)。 */
  readonly supportsL9 = true

  scanLogin(
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error("扫码登录需 Tauri 桌面环境(未注入 appHost.browser)")
    return xhsScanLogin(browser, emitQr, opts)
  }
}

/** 滚动翻页每次返回的窗口大小(仅 `xhs:user`;explore 一次整批返回)。 */
export const XHS_FETCH_MORE_WINDOW = 30

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 等 xhs 页面 SSR 挂载;登录重定向也算「有结果」,由调用方决定怎么处理。 */
async function waitXhsSsr(browser: BrowserBackend, message: string): Promise<void> {
  await waitUntil(
    browser,
    `typeof window.__INITIAL_STATE__ !== 'undefined' || location.pathname.startsWith('/login')`,
    15_000,
    message,
  )
}

/** 当前页面是否被重定向到登录页。 */
export async function isXhsLoginPage(browser: BrowserBackend): Promise<boolean> {
  const path = await cdpEvaluate<string>(browser, `location.pathname`)
  return typeof path === "string" && path.startsWith("/login")
}

/**
 * 风控验证框(.fe-verify-box)= 明确的平台拦截信号。
 * 上报后抛错,不要静默当成 0 条。
 */
export async function assertXhsNotBlocked(browser: BrowserBackend): Promise<void> {
  if (await cdpEvaluate<boolean>(browser, `!!document.querySelector('.fe-verify-box')`)) {
    reportXhsRisk("verify-box")
    throw new Error("小红书风控校验(.fe-verify-box)出现——请稍后再试或重新扫码登录")
  }
}

/**
 * 滚动触发平台自己的懒加载,直到列表条数超过 `startIdx` 或确认到底。
 *
 * 这是 explore / user 两条翻页路径的公共部分:
 *   - 只做 `scrollTo`(页面自然行为),数据由平台自己发请求加载;
 *   - 小步滚动 + 随机抖动,避免固定节奏被识别为自动化;
 *   - `platformActive` = 滚动后 scrollHeight 仍在增长(平台还在追加内容),
 *     用于区分「真到底」与「加载慢/未触发」。
 *
 * ⚠️ 必须在 `interactive` 窗口模式下调用:hidden(SW_HIDE)下滚动不派发事件、
 * IntersectionObserver 与 lazy 加载不触发(见 docs/crawler-risk-control.md §3.9)。
 */
export async function scrollXhsUntilGrown(
  browser: BrowserBackend,
  readCount: () => Promise<number>,
  startIdx: number,
): Promise<{ grown: boolean; platformActive: boolean }> {
  let platformActive = false
  for (let round = 0; round < 3; round++) {
    await assertXhsNotBlocked(browser)
    const hBefore = await cdpEvaluate<number>(browser, `document.body.scrollHeight`)
    await cdpEvaluate(browser, `(async () => {
      const dist = document.body.scrollHeight - window.scrollY;
      for (let i = 1; i <= 3; i++) {
        window.scrollTo(0, window.scrollY + dist * (i / 3));
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
      }
    })()`)
    // 轮询等待列表增长(平台网络+渲染耗时 > 固定 sleep,实测 1.4~2.4s 不够)。
    // 只读数量,确认到位后再由调用方完整读一次状态。
    let grown = false
    for (let i = 0; i < 6; i++) {
      await sleep(500 + Math.floor(Math.random() * 300))
      if ((await readCount()) > startIdx) {
        grown = true
        break
      }
    }
    const hAfter = await cdpEvaluate<number>(browser, `document.body.scrollHeight`)
    if (hAfter > hBefore) platformActive = true
    if (grown) return { grown: true, platformActive }
  }
  return { grown: false, platformActive }
}

/**
 * 确保停在某个 xhs 路径上(**只比 pathname,忽略 query/hash**)。
 *
 * ⚠️ 不能靠 `cdpNavigate` 的「同址不重载」判据:它比的是完整 `location.href`,而
 * 小红书 SPA 会往地址栏写 query(`/explore?channel_id=...`)→ 永远不相等 → 每次
 * 翻页都**整页重载** → `__INITIAL_STATE__` 回到首屏,`slice(已返回)` 切出来的
 * 又是上次那批内容(store 按 id 去重后一条都不新增)。现象 = 「加载更多一直同一页」。
 */
export async function ensureXhsPath(browser: BrowserBackend, path: string): Promise<void> {
  const norm = (p: string) => p.replace(/\/+$/, "") || "/"
  let current = ""
  try {
    current = (await cdpEvaluate<string>(browser, `location.pathname`)) ?? ""
  } catch {
    // 导航过渡/context destroyed → 当作不同址,走正常导航。
  }
  if (norm(current) === norm(path)) {
    // 不重载也要确认 SSR 还在(幂等:已挂载立即返回)。
    await waitXhsSsr(browser, "xhs SSR 状态未挂载")
    return
  }
  await cdpNavigate(browser, `${XHS_BASE}${path}`, true)
  await waitXhsSsr(browser, "xhs SSR 状态未挂载")
}

/**
 * 导航到目标 xhs 页面并确认没被重定向到登录页(翻页/被动入口共用)。
 * `notLoggedInMsg` 由调用方给(各渠道的可操作文案不同)。
 */
export async function ensureXhsPageReady(
  browser: BrowserBackend,
  path: string,
  notLoggedInMsg: string,
): Promise<void> {
  await ensureXhsPath(browser, path)
  if (await isXhsLoginPage(browser)) throw new Error(notLoggedInMsg)
}

/** 页面内 fetch 要求同源;不在 xhs 域时先落到 /explore。 */
async function ensureXhsOrigin(browser: BrowserBackend): Promise<void> {
  if (await isXhsOrigin(browser)) return
  await cdpNavigate(browser, `${XHS_BASE}/explore`, true)
  await waitXhsSsr(browser, "xhs 页面未就绪")
}

/** 一个列表页(explore 推荐流 / user 笔记流)的抓取配方。 */
export interface XhsListPage<T> {
  /** 列表页 URL(导航落点)。 */
  url: string
  /** 登录态:从页面 SSR 读列表。 */
  readPage(browser: BrowserBackend): Promise<T>
  /**
   * 匿名态:解析页面内 fetch 回来的 HTML。不提供 = 匿名也读页面 SSR
   * (`xhs:explore`:匿名推荐流本身就有 feeds,导航已加载同一份 feed,再 fetch 纯属重复;
   * `xhs:user` 必须提供:匿名 profile SSR 抹空 noteId,读 SSR 无意义)。
   */
  parseHtml?(html: string): T
  /** L9 被动模式:匿名时不 fetch,返回 null 让 core 回退缓存。 */
  passiveOnly?: boolean
}

/**
 * 按登录态抓一个 xhs 列表页。
 * 返回 null 只会在 `passiveOnly && 匿名` 时发生。
 */
export async function fetchXhsList<T>(
  browser: BrowserBackend,
  page: XhsListPage<T>,
): Promise<T | null> {
  return withBrowserMode(
    browser,
    "hidden",
    async () => {
      await cdpNavigate(browser, page.url, true)
      await waitXhsSsr(browser, "xhs SSR 状态未挂载")
      await assertXhsNotBlocked(browser)

      // 登录页优先判匿名:服务端 session 已失效时 user_id cookie 可能还在,
      // 只靠 cookie 会被误判成已登录、随后读到空 SSR。
      const onLogin = await isXhsLoginPage(browser)
      if (!onLogin && (await isXhsLoggedIn(browser))) return page.readPage(browser)
      if (page.passiveOnly) return null
      if (!page.parseHtml) return page.readPage(browser)
      return page.parseHtml(await xhsFetchPage(browser, page.url, "omit"))
    },
    "xhs",
  )
}

/** 单条笔记详情的抓取参数。 */
export interface XhsDetailOptions {
  item: Item
  /** 渠道 key(写进 Social.sourceId)。 */
  sourceKey: string
  browser?: BrowserBackend
  /** 无浏览器时的 HTTP 回落凭据;xhs:user 刻意不传(避免账号 cookie 走 reqwest)。 */
  cookie?: string
  /** L9:禁止 fetch,只导航 + 读页面 SSR。 */
  passiveOnly?: boolean
}

/**
 * 单条笔记详情(explore/user 共用)。
 *
 * - 登录态:导航详情页 → 读 `__INITIAL_STATE__.note.noteDetailMap`;
 * - 匿名:页面内 fetch 详情 HTML;
 * - passiveOnly:即使匿名也只走导航 + 读 SSR,读不到返回 null。
 */
export async function resolveXhsItemDetail(opts: XhsDetailOptions): Promise<Item | null> {
  const { item, sourceKey, browser, cookie, passiveOnly = false } = opts
  const noteId = String(item.url ?? "").match(/\/explore\/([^?/?#]+)/)?.[1] ?? ""
  if (!noteId) return null
  const xsec = (item as Social).xsecToken
  const url = `${XHS_BASE}/explore/${noteId}${xsec ? `?xsec_token=${encodeURIComponent(xsec)}&xsec_source=pc_feed` : ""}`

  if (!browser) {
    // 无浏览器门面(mobile/CLI):只能 HTTP。
    return detailFromHtml(await xhsClient.getHtml(url, { cookie }), noteId, sourceKey)
  }

  return withBrowserMode(
    browser,
    "hidden",
    async () => {
      // 页面内 fetch 需要同源;已在 xhs 域就不重复导航。
      await ensureXhsOrigin(browser)
      await assertXhsNotBlocked(browser)

      // 登录页优先判匿名(同 fetchXhsList):失效会话的残留 user_id 不能当登录。
      const onLogin = await isXhsLoginPage(browser)
      if (passiveOnly || (!onLogin && (await isXhsLoggedIn(browser)))) {
        await cdpNavigate(browser, url, true)
        await waitXhsSsr(browser, "xhs 详情页未就绪")
        if (await isXhsLoginPage(browser)) {
          throw new Error("小红书登录已失效或未登录，请到「账号与凭证」重新扫码")
        }
        await assertXhsNotBlocked(browser)
        let note = await cdpEvaluate<any>(browser, noteDetailStateExpr(noteId)).catch(() => null)
        // 兜底:页面状态被前端改写/不可序列化时,从当前 DOM 里的内联 state 重新解析。
        if (!note) {
          const html = await cdpEvaluate<string>(browser, `document.documentElement.outerHTML`)
          note = extractNoteDetail(html, noteId)
        }
        return note ? noteDetailToSocial(note, sourceKey, now()) : null
      }

      // 匿名访客:页面内抓详情 HTML。
      return detailFromHtml(await xhsFetchPage(browser, url, "omit"), noteId, sourceKey)
    },
    "xhs",
  )
}

function detailFromHtml(html: string, noteId: string, sourceKey: string): Item | null {
  const note = extractNoteDetail(html, noteId)
  return note ? noteDetailToSocial(note, sourceKey, now()) : null
}
