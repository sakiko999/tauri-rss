import {
  cdpEvaluate,
  cdpNavigate,
  extractInitialState,
  extractNoteDetail,
  isXhsLoggedIn,
  isXhsOrigin,
  noteDetailStateExpr,
  noteDetailToSocial,
  now,
  rawOf,
  reportXhsRisk,
  resolveCookie,
  waitUntil,
  withBrowserOp,
  XHS_BASE,
  xhsClient,
} from "@amoeba/resolve"
/**
 * xhs 渠道共享的**浏览器策略层**。
 *
 * 策略(2026-10-22):**xhs 全渠道要求登录,匿名态已移除**。
 *   - 列表 / 详情:导航后必须通过 `assertXhsLoggedIn`(登录页优先于残留 cookie);
 *   - 无浏览器(mobile / CLI):HTTP 路径必须拿到 cookie(显式或 provider),
 *     否则抛可操作错误,不再退回匿名 SSR;
 *   - `xhs:explore` 仍是被动渠道(只读页面自然产生的 SSR,不构造请求);
 *   - `xhs:user` 刻意不声明 `passive`(翻页要滚动交互,但数据仍只读页面 state)。
 *
 * 为什么移除匿名:匿名数据路径不可靠且形态各异 —— user 页把 noteId 抹空,
 * explore 在带 `web_session` 的会话里 SSR 只给空壳,连续滚动还会累积
 * 300011/300012 风控;详情登录墙后的匿名 fetch 兜底也只够「看见封面」。
 * 统一登录后只剩一条可验证的数据路径。
 *
 * ⚠️ 登录判据是 `isXhsLoggedIn`(页面 loggedIn + 侧栏「我」+ user_id cookie),
 * **不是 `web_session`** —— 小红书对游客也会立即签发 web_session。
 */
import type { Item } from "@amoeba/xml"

import { passiveBuffer } from "../../passive/buffer.ts"
import { capturePage } from "../../passive/capture.ts"

/** 滚动翻页每次返回的窗口大小(仅 `xhs:user`;explore 一次整批返回)。 */
export const XHS_FETCH_MORE_WINDOW = 30

/** 统一的「没有登录态」文案(各渠道可按场景覆盖,但不要退回匿名)。 */
export const XHS_LOGIN_REQUIRED = "小红书需要登录：请到「账号与凭证」扫码登录"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 等 xhs 页面 SSR 挂载;登录重定向也算「有结果」,由登录闸门给出可操作错误。 */
async function waitXhsSsr(browser: BrowserBackend, message: string): Promise<void> {
  await waitUntil(
    browser,
    `typeof window.__INITIAL_STATE__ !== 'undefined' || location.pathname.startsWith('/login')`,
    15_000,
    message,
  )
}

/** 当前页面是否被重定向到登录页(必须同时确认在 xhs origin,共享 page 可能停在别的域)。 */
export async function isXhsLoginPage(browser: BrowserBackend): Promise<boolean> {
  return cdpEvaluate<boolean>(
    browser,
    `location.origin === ${JSON.stringify(XHS_BASE)} && location.pathname.startsWith('/login')`,
  )
}

/**
 * 登录闸门:**登录页优先于页面登录位**。
 *
 * 失效会话跳登录页时,页面里的 loggedIn 可能仍是残留的 true;只信登录位会把
 * 登录页的空 SSR 当成正常数据(静默 0 条)。先判登录页,再判真实登录态。
 */
export async function assertXhsLoggedIn(browser: BrowserBackend, message: string = XHS_LOGIN_REQUIRED): Promise<void> {
  if (await isXhsLoginPage(browser)) throw new Error(message)
  if (!(await isXhsLoggedIn(browser))) throw new Error(message)
}

/**
 * HTTP 路径(mobile / CLI,无浏览器门面)的登录闸门。
 *
 * `explicit` 原样交给 credentials 语义:显式非空 > 显式空串(强制匿名,现在会
 * 直接报错)> provider(settings 登录态)。返回**可用的 cookie**,后续请求必须带上。
 */
export function requireXhsCookie(explicit: string | undefined, message: string = XHS_LOGIN_REQUIRED): string {
  const cookie = resolveCookie(explicit, "xhs")
  if (!cookie) throw new Error(message)
  return cookie
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
 * ⚠️ 必须在 `interactive` 窗口模式下调用:hidden 下滚动不派发事件、
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
    await cdpEvaluate(
      browser,
      `(async () => {
      const dist = document.body.scrollHeight - window.scrollY;
      for (let i = 1; i <= 3; i++) {
        window.scrollTo(0, window.scrollY + dist * (i / 3));
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
      }
    })()`,
    )
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
  // ⚠️ 只比 pathname 不够:共享 page 可能停在别的域,同名路径会读到别的
  // `__INITIAL_STATE__`。不在 xhs origin 时必须重新导航。
  if (norm(current) === norm(path) && (await isXhsOrigin(browser))) {
    // 不重载也要确认 SSR 还在(幂等:已挂载立即返回)。
    await waitXhsSsr(browser, "xhs SSR 状态未挂载")
    return
  }
  await cdpNavigate(browser, `${XHS_BASE}${path}`, true)
  await waitXhsSsr(browser, "xhs SSR 状态未挂载")
}

/**
 * 导航到目标 xhs 页面并确认登录态(翻页/被动入口共用)。
 * `notLoggedInMsg` 由调用方给(各渠道的可操作文案不同)。
 */
export async function ensureXhsPageReady(
  browser: BrowserBackend,
  path: string,
  notLoggedInMsg: string = XHS_LOGIN_REQUIRED,
): Promise<void> {
  await ensureXhsPath(browser, path)
  // ⚠️ 顺序:风控框先判。风控页常常同时缺登录位,先判登录会把「账号风控」
  // 误报成「需要登录」,且不会触发 reportXhsRisk。
  await assertXhsNotBlocked(browser)
  await assertXhsLoggedIn(browser, notLoggedInMsg)
}

/**
 * 页面内读 SSR state 的某个列表路径(如 `["feed","feeds"]` / `["user","notes"]`)。
 * 逐层解 `_rawValue` + flat —— explore/user 共用,避免各自手写解包表达式漂移。
 */
export async function readXhsStateList(browser: BrowserBackend, path: string[]): Promise<any[]> {
  const p = JSON.stringify(path)
  const list = await cdpEvaluate<any[]>(
    browser,
    `(() => {
      const path = ${p};
      let v = window.__INITIAL_STATE__;
      for (let i = 0; i < path.length; i++) {
        v = v?.[path[i]];
        v = v?._rawValue ?? v;
      }
      return Array.isArray(v) ? v.flat() : [];
    })()`,
  )
  return list ?? []
}

/**
 * 等首屏列表**真的**被页面填上,再读 state。
 *
 * ⚠️ `__INITIAL_STATE__` 挂载 ≠ 列表就绪:登录态会话的 `/explore` SSR 文档只给
 * 空壳,`feed.feeds` 为 `[]`,列表由页面自己的 XHR 在导航后约 0.4~1.1s 填回
 * state。不等就会把「空壳」当「0 条」。
 *
 * 尽力而为:超时不抛错(列表可能真的为空),由调用方按 0 条处理。
 */
export async function waitXhsListNonEmpty(browser: BrowserBackend, path: string[], timeoutMs = 8_000): Promise<void> {
  const p = JSON.stringify(path)
  await waitUntil(
    browser,
    `(() => {
      const path = ${p};
      let v = window.__INITIAL_STATE__;
      for (const k of path) { v = v?.[k]; v = v?._rawValue ?? v; }
      return Array.isArray(v) && v.flat().length > 0;
    })()`,
    timeoutMs,
    "xhs 首屏列表未加载",
  ).catch(() => {})
}

/** 只读列表长度(滚动轮询用:整棵 state 序列化只为判增长太贵)。 */
export async function readXhsStateListCount(browser: BrowserBackend, path: string[]): Promise<number> {
  const p = JSON.stringify(path)
  const n = await cdpEvaluate<number>(
    browser,
    `(() => {
      const path = ${p};
      let v = window.__INITIAL_STATE__;
      for (let i = 0; i < path.length; i++) {
        v = v?.[path[i]];
        v = v?._rawValue ?? v;
      }
      return Array.isArray(v) ? v.flat().length : 0;
    })()`,
  )
  return n ?? 0
}

/** SSR HTML 里的 state → 同一路径的扁平列表(与 readXhsStateList 同一套解包规则)。 */
export function flatXhsStateList(state: any, path: string[]): any[] {
  let v: any = state
  for (const key of path) v = rawOf(v?.[key])
  return Array.isArray(v) ? v.flat() : []
}

/** 一个列表页(explore 推荐流 / user 笔记流)的抓取配方。 */
export interface XhsListPage<T> {
  /** 列表页 URL(导航落点)。 */
  url: string
  /** 从页面 SSR 读列表(调用前已确认登录态)。 */
  readPage(browser: BrowserBackend): Promise<T>
  /** 未登录 / 登录失效时的可操作错误。 */
  loginError: string
}

/**
 * 按登录态抓一个 xhs 列表页。
 *
 * `lane`:列表 lane 名(如 `list:xhs:explore`)——lane 化后按 channelKey 分 tab,
 * 保住翻页累积 state(详情/登录在各自 lane,不再把列表页导航走)。
 */
export async function fetchXhsList<T>(browser: BrowserBackend, page: XhsListPage<T>, lane: string): Promise<T> {
  return withBrowserOp(browser, { lane, platform: "xhs" }, async (b) => {
    await cdpNavigate(b, page.url, true)
    await waitXhsSsr(b, "xhs SSR 状态未挂载")
    await assertXhsNotBlocked(b)
    await assertXhsLoggedIn(b, page.loginError)
    return page.readPage(b)
  })
}

/** LX 路线 A(Network 捕获)的页面配方。 */
export interface XhsPassivePage<T> {
  /** 触发导航的 xhs 路径(如 `/explore`)。 */
  path: string
  /** passiveBuffer 的 endpoint key(与 capturePage 一致)。 */
  endpoint: string
  /** 只收哪些响应 URL(页面自然请求)。 */
  match(url: URL): boolean
  /** 未登录 / 登录失效时的可操作错误。 */
  notLoggedInMsg: string
  /** 从捕获到的 HTML 里解析真正要的数据(通常 flatXhsStateList)。 */
  readState(state: any): T
  /**
   * 缓冲缺失(或为空壳)时的页面 SSR 兜底(仍属被动:导航 + 读页面 state,
   * 不构造请求)。可选;不提供则返回 null 交给 core 回退缓存。
   * ⚠️ 必须用传入的 lane 句柄读(不是闭包外层的 appHost.browser —— 那是默认页,
   * 而 capturePage 刚导航的是本 lane 的 tab;读默认页只会拿到 about:blank/旧页)。
   */
  readPage?(b: BrowserBackend): Promise<T>
}

/**
 * LX 路线 A:导航触发页面自身文档请求 → CDP Network 缓冲取响应体 → 解析。
 * 只观察、不构造请求;拿不到缓冲返回 null(core 会回退内容缓存,绝不回退主动 fetch)。
 * `lane`:列表 lane 名(同 fetchXhsList;被动捕获绑到本 lane 的 tab,不串台)。
 */
export async function fetchXhsPassivePage<T>(
  browser: BrowserBackend,
  page: XhsPassivePage<T>,
  lane: string,
): Promise<T | null> {
  return withBrowserOp(browser, { lane, platform: "xhs" }, async (b) => {
    await capturePage(b, {
      platform: "xhs",
      endpoint: page.endpoint,
      match: page.match,
      trigger: (x) => cdpNavigate(x, `${XHS_BASE}${page.path}`, true),
    })
    // 被动路径同样要识别风控/登录态,否则会被当成「无被动数据」静默回退缓存。
    // (ensureXhsPageReady 内部已按「风控 → 登录」顺序判定。)
    await ensureXhsPageReady(b, page.path, page.notLoggedInMsg)
    const entry = passiveBuffer.getLatest("xhs", page.endpoint)
    if (!entry) return page.readPage ? page.readPage(b) : null
    const captured = page.readState(extractInitialState(entry.body))
    // ⚠️ 缓冲有但列表为空(登录态会话 SSR 只给空壳)→ 同样回退页面 state:
    //   页面自己的 XHR 已经把内容填好了,直接交空 XML 会让 core 当成「0 条」报错。
    if (page.readPage && Array.isArray(captured) && captured.length === 0) {
      return page.readPage(b)
    }
    return captured
  })
}

/** 单条笔记详情的抓取参数。 */
export interface XhsDetailOptions {
  item: Item
  /** 渠道 key(写进 Social.sourceId)。 */
  sourceKey: string
  browser?: BrowserBackend
  /**
   * 无浏览器门面(mobile / CLI)的 HTTP 凭据。undefined = provider(settings 登录态);
   * 显式空串 = 强制匿名 —— 匿名态已移除,会直接报可操作错误。
   */
  cookie?: string
}

/**
 * 单条笔记详情(explore/user 共用)。
 *
 * 登录态:导航详情页 → 读 `__INITIAL_STATE__.note.noteDetailMap`。
 * 匿名态已移除:登录页 / 未登录统一抛可操作错误。
 */
export async function resolveXhsItemDetail(opts: XhsDetailOptions): Promise<Item | null> {
  const { item, sourceKey, browser, cookie } = opts
  const noteId = String(item.url ?? "").match(/\/explore\/([^?/?#]+)/)?.[1] ?? ""
  if (!noteId) return null
  const xsec = (item as { xsecToken?: string }).xsecToken
  const url = `${XHS_BASE}/explore/${noteId}${xsec ? `?xsec_token=${encodeURIComponent(xsec)}&xsec_source=pc_feed` : ""}`

  if (!browser) {
    // 无浏览器门面(mobile/CLI):只能 HTTP,且必须带登录 cookie。
    const ck = requireXhsCookie(cookie)
    return detailFromHtml(await xhsClient.getHtml(url, { cookie: ck }), noteId, sourceKey)
  }

  // 详情跑在专属 detail lane(`detail:xhs` 的独立 tab):打开详情不再把列表页
  // (explore/user lane 的 tab)导航走,xhs:user 的翻页 state 得以存活(§3.13)。
  return withBrowserOp(browser, { lane: "detail:xhs", platform: "xhs" }, async (b) => {
    await cdpNavigate(b, url, true)
    await waitXhsSsr(b, "xhs 详情页未就绪")
    // 风控框先判:风控页常常同时缺登录位,先判登录会把「账号风控」误报成「需要登录」,
    // 且不会触发 reportXhsRisk。
    await assertXhsNotBlocked(b)
    await assertXhsLoggedIn(b, XHS_LOGIN_REQUIRED)
    let note = await cdpEvaluate<any>(b, noteDetailStateExpr(noteId)).catch(() => null)
    // 兜底:页面状态被前端改写/不可序列化时,从当前 DOM 里的内联 state 重新解析。
    if (!note) {
      const html = await cdpEvaluate<string>(b, `document.documentElement.outerHTML`)
      note = extractNoteDetail(html, noteId)
    }
    return toDetail(note, sourceKey)
  })
}

function detailFromHtml(html: string, noteId: string, sourceKey: string): Item {
  return toDetail(extractNoteDetail(html, noteId), sourceKey)
}

/**
 * 解析结果为空时**抛错**,不返回 null。
 *
 * null 会让 core 当成「渠道不支持详情」而原样返回列表 item,弹窗于是把
 * 「标题+封面摘要」静默当成全文 —— 用户看不到风控/登录/失效原因。
 */
function toDetail(note: any, sourceKey: string): Item {
  const detail = note ? noteDetailToSocial(note, sourceKey, now()) : null
  if (!detail) {
    throw new Error("小红书详情页未返回笔记内容（可能风控或 xsec_token 失效）")
  }
  return detail
}
