/**
 * douyin:user —— 抖音用户主页「作品」渠道(kind: social)。
 *
 * **被动采集**：导航 `www.douyin.com/user/<sec_uid>`，页面自己的 JS 会请求
 * `aweme/v1/web/aweme/post/`；我们用 `capturePage` 在 `Network.loadingFinished`
 * 后读那份响应体，**应用侧不构造任何接口请求、不做签名**。
 * 不声明 `passive` 是因为这条渠道依赖页面脚本渲染（passive 闸门只认导航文档本身），
 * 且翻页要滚动交互；数据来源仍是页面自己的请求，与 xhs:user 同档。
 *
 * ⚠️ 为什么不能「页面内 fetch」或自签直连（2026-10-30 实测）：页面自己发 200 JSON，
 * **原样重放同一条 URL**（同一份 cookie、页面上下文）返回 835KB HTML 骨架；补 `uifid`
 * 头 / 页面 msToken / 本仓现算 `a_bogus` 全部无效（`a_bogus` 与 HttpOnly 的 msToken
 * cookie 绑定、疑似一次性）；纯 HTTP 自签（ABogus + ttwid）直接 403 并触发平台冷却。
 *
 * ⚠️ **分页依赖登录态**（2026-10-31 实测）：匿名打开主页只发首屏那一次请求
 * （21 条），作品区被登录弹窗（`.douyin_login_new_c`）盖住、滚轮无效；
 * **已登录 profile** 下 `/aweme/post` 随滚动连续追加（实测 57 → 87 → 110 → 140 → 163）。
 * 所以翻页前按 `sessionid`（与登录快照同判据）门控，匿名直接抛可操作错误——
 * 不看 DOM 弹窗：匿名实测时那个 class 不一定在（判据不稳定）。
 *
 * 翻页手法（参照开源实现）：`aweme/post` 的 `max_cursor` 在页面手里，我们只能
 * 「让页面自己往下加载」—— ① 把**最大可滚动容器**滚到底（抖音主页不在 window 上滚，
 * 容器是 class 混淆的内层 div）；② 再在作品卡位置发**真实滚轮**
 * （`Input.dispatchMouseEvent` type=mouseWheel，坐标取卡片的 `getBoundingClientRect`）。
 */

import {
  awemeListToSocial,
  cdpEvaluate,
  cdpNavigate,
  douyinUserUrl,
  now,
  parseDouyinSecUid,
  readAwemeList,
  readDouyinLoginCookie,
  withBrowserOp,
} from "@amoeba/resolve"
import type { Item, Social } from "@amoeba/xml"
import { serializeFeed, type SerializeOptions } from "@amoeba/xml"

import type { Pageable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { passiveBuffer } from "../../passive/buffer.ts"
import { capturePage } from "../../passive/capture.ts"
import { apiFetchItems } from "../factory.ts"

/** 被动捕获的 lane（列表页专属 tab）。 */
const LANE = "list:douyin:user"
/** passiveBuffer 的接口键（与 platform 一起定位「本渠道」的响应）。 */
const ENDPOINT = "user_posts"
/** 页面自己的作品列表接口（只用于判定，不用于发请求）。 */
const POST_PATH = "/aweme/v1/web/aweme/post/"
/** 每轮翻页返回给 core 的条数（与 xhs:user 同值，避免一次塞几百条进镜像）。 */
const WINDOW = 30

const NEEDS_BROWSER =
  "抖音用户主页需要桌面抓取浏览器：作品列表只能由页面自己请求（接口重放会被降级成 HTML，自签直连 403）"

const NO_POSTS =
  "抖音用户主页没有触发作品列表请求：可能是页面被风控、链接无效，或作品为空（请在浏览器里确认主页能正常打开）"

const NEEDS_LOGIN =
  "抖音用户作品翻页需要登录：匿名打开主页会被登录弹窗挡住，页面不会继续加载。请到「账号与凭证」扫码登录后重试"

/** 已捕获的条目（按 secUid 累积；刷新时重置）。 */
const posts = new Map<string, Social[]>()

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 最大可滚动容器（抖音主页不在 window 上滚，class 混淆所以按范围挑）。 */
const SCROLLER_EXPR = `(() => {
  const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight - e.clientHeight > 200);
  els.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  return els[0] ?? document.scrollingElement ?? document.documentElement;
})()`

/**
 * 滚到底让页面自己加载下一页：先滚容器，再在作品卡上发真实滚轮。
 *
 * ⚠️ 只滚容器不够：真实滚轮才带得到「用户输入」语义（开源实现在 playwright 里同样
 * 是 `scrollTop` + `mouse.wheel` 两件套）。坐标必须落在卡片上，不能落在登录弹窗上。
 */
async function scrollForMore(b: BrowserBackend): Promise<void> {
  const send = b.send?.bind(b)
  if (!send) return
  // ⚠️ 滚到底后**首张卡**已在视口上方(rect.top < 0),滚轮坐标必须在视口内才生效
  // —— 挑一张完整落在视口里的卡。
  const box = await cdpEvaluate<string>(
    b,
    `(() => {
      const el = ${SCROLLER_EXPR};
      el.scrollTop = el.scrollHeight;
      const cards = [...document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]')];
      const vis = cards.find((n) => {
        const r = n.getBoundingClientRect();
        return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
      });
      const r = vis ? vis.getBoundingClientRect() : null;
      return JSON.stringify({
        x: r ? Math.round(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2))) : 400,
        y: r ? Math.round(Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))) : 400,
      });
    })()`,
  )
  const { x, y } = JSON.parse(box) as { x: number; y: number }
  for (let i = 0; i < 3; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }).catch(() => {})
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: 800 }).catch(() => {})
    await sleep(400)
  }
}

/** 合并新捕获的条目（按 id 去重，保持首次出现顺序）。 */
function mergeUnique(into: Social[], fresh: Social[]): void {
  const seen = new Set(into.map((i) => i.id))
  for (const item of fresh) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    into.push(item)
  }
}

export class DouyinUserChannel implements RssChannel {
  readonly key = "douyin:user"
  readonly name = "抖音用户主页"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [
    {
      key: "sec_uid",
      label: "用户主页链接或 sec_uid",
      required: true,
      placeholder: "https://www.douyin.com/user/MS4wLj…",
    },
  ]

  getSource(info: SourceInfo): RssSource & Partial<Pageable> {
    const secUid = parseDouyinSecUid(String(info.sec_uid ?? ""))
    const browser = globalThis.appHost?.browser
    const source: RssSource & Partial<Pageable> = {
      // 无浏览器（mobile / CLI 未加 --browser）没有被动采集通道：抖音的 HTTP 直连
      // 需要自签 a_bogus + 真实 msToken，已实测 403（且会触发平台冷却），不提供该路径。
      fetch: apiFetchItems(
        () => (browser ? this.fetchFirstPage(browser, secUid) : Promise.reject(new Error(NEEDS_BROWSER))),
        () => this.channelOptions(secUid),
      ),
    }
    if (browser) {
      source.fetchMore = (cursor?: string, ctx?: { existing: number }) =>
        this.fetchMoreViaBrowser(browser, secUid, cursor, ctx?.existing)
    }
    return source
  }

  /**
   * 首屏：导航主页 → 捕获页面自己的 `/aweme/post/` → 映射。
   *
   * ⚠️ 必须 interactive：lane 的 tab 是**后台 target**，hidden 下渲染/水合被节流，
   * 页面连首屏那发 `/aweme/post/` 都不会发（2026-10-30 实测：默认页上会发，lane tab
   * 上不发，passiveBuffer 恒空、作品区 0 张卡）。xhs 的被动捕获能留在 hidden，是因为
   * 它读的是导航文档本身，不依赖页面脚本再发请求。
   */
  private async fetchFirstPage(browser: BrowserBackend, secUid: string): Promise<Item[]> {
    const awemes = await withBrowserOp(browser, { lane: LANE, mode: "interactive", platform: "douyin" }, async (b) => {
      // 页面那发请求偶尔没在捕获窗口内落地（实测重跑就正常）→ 重载再试一次。
      for (let attempt = 0; attempt < 2; attempt++) {
        await capturePage(b, {
          platform: "douyin",
          endpoint: ENDPOINT,
          match: (u) => u.pathname === POST_PATH,
          trigger: (x) => cdpNavigate(x, douyinUserUrl(secUid), true),
        })
        const list = this.readCaptured(secUid)
        if (list.length) return list
      }
      throw new Error(NO_POSTS)
    })
    const items = awemeListToSocial(awemes, this.key, now())
    posts.set(secUid, [...items])
    return items
  }

  /** 翻页：滚动触发页面自己加载下一页，累积后按窗口切片。 */
  private async fetchMoreViaBrowser(
    browser: BrowserBackend,
    secUid: string,
    cursor?: string,
    existing?: number,
  ): Promise<{ xml: string; cursor?: string; hasMore?: boolean }> {
    return withBrowserOp(browser, { lane: LANE, mode: "interactive", platform: "douyin" }, async (b) => {
      // 匿名态页面只发首屏那一次请求、作品区被登录弹窗盖住（滚轮无效，2026-10-31 实测），
      // 直接给可操作错误；判据与登录快照同源（`sessionid`，ttwid 匿名访客也有，不能用）。
      if (!(await readDouyinLoginCookie(b))) throw new Error(NEEDS_LOGIN)

      const state = posts.get(secUid) ?? []
      posts.set(secUid, state)
      // 起点 = store 已有条数（不是当前内存条数）：服务重启后内存空了但 store 还在，
      // 若从内存长度起算，会把 store 已有的条目再返回一遍（core 去重后 0 新增 + 游标
      // 前进 ⇒ 被误判「到底」）。从 existing 起算则继续往下滚，滚过它才吐新内容。
      const start = cursor !== undefined ? Number(cursor) || 0 : (existing ?? state.length)

      // 服务刚启动 / 页面被导航走：先回到主页并收下首屏那批。
      const href = await cdpEvaluate<string>(b, "location.href").catch(() => "")
      if (!href.startsWith(douyinUserUrl(secUid))) {
        await capturePage(b, {
          platform: "douyin",
          endpoint: ENDPOINT,
          match: (u) => u.pathname === POST_PATH,
          trigger: (x) => cdpNavigate(x, douyinUserUrl(secUid), true),
        })
        mergeUnique(state, awemeListToSocial(this.readCaptured(secUid), this.key, now()))
      }

      let platformActive = false
      // 4 轮：一轮通常只换来一页（~30 条）。内存丢了要补回 existing 那段，多给一轮。
      for (let round = 0; round < 4 && state.length <= start; round++) {
        const before = await cdpEvaluate<number>(
          b,
          `(() => { const el = ${SCROLLER_EXPR}; return el ? el.scrollHeight : 0; })()`,
        ).catch(() => 0)
        await capturePage(b, {
          platform: "douyin",
          endpoint: ENDPOINT,
          match: (u) => u.pathname === POST_PATH,
          trigger: scrollForMore,
          idleMs: 1000,
          timeoutMs: 12_000,
        })
        mergeUnique(state, awemeListToSocial(this.readCaptured(secUid), this.key, now()))
        const after = await cdpEvaluate<number>(
          b,
          `(() => { const el = ${SCROLLER_EXPR}; return el ? el.scrollHeight : 0; })()`,
        ).catch(() => 0)
        if (after > before) platformActive = true
        if (state.length > start) break
        await sleep(600)
      }

      const page = state.slice(start, start + WINDOW)
      const xml = serializeFeed(page, this.channelOptions(secUid))
      if (!page.length) {
        // 平台还在加载(scrollHeight 增长但条目未到,或内存刚丢还在补回 existing 那段)
        // → 原样返回 cursor + hasMore 让 core 保留「加载更多」
        // (core 的「游标前进但 0 新增 ⇒ 到底」启发式会误杀这种情况)。
        // 多次滚动 scrollHeight 无增长才视为真到底(省略 cursor = 没有更多)。
        return platformActive ? { xml, cursor: String(start), hasMore: true } : { xml }
      }
      return { xml, cursor: String(start + page.length) }
    })
  }

  /**
   * 收集本渠道该用户**全部**已捕获的 `aweme_list` 并合并。
   *
   * ⚠️ 必须按 URL 里的 sec_user_id 过滤:缓冲按 (platform, endpoint) 归并,同一次运行里
   * 两个 douyin:user 订阅共用这个键 —— 不过滤就会把上一个号的作品当成这个号的。
   * 分页时每页的 `max_cursor` 不同 → 不同 URL → 各存一份,所以要合并全部条目而不是
   * 只取最新那一份。
   */
  private readCaptured(secUid: string): any[] {
    const entries = passiveBuffer.list("douyin", ENDPOINT).filter((e) => e.url.includes(secUid))
    if (!entries.length) return []
    const out: any[] = []
    for (const e of entries) out.push(...readAwemeList(e.body))
    return out
  }

  private channelOptions(secUid: string): SerializeOptions {
    return {
      channelTitle: `抖音 · ${secUid.slice(-8)}`,
      channelLink: douyinUserUrl(secUid),
    }
  }
}
