/**
 * xhs 公共 —— UA / headers / SSR 状态提取 / 签名 API / note→Social 归一。
 *
 * 小红书数据双通道(2026-08 起拆分):
 *   - SSR 页面:`/explore` / `/user/profile/<id>` 内嵌 `window.__INITIAL_STATE__`,
 *     fetchHtml + extractInitialState(2026-10-22 起**必须登录**,匿名态已移除);
 *   - 签名 API:`user_posted` 等需 x-s/x-s-common/x-t 签名 —— ⚠️ 已降级
 *     (签名库 xhshow 已移至 feat/xhs-rustpython 分支,见 signApiHeaders)→ user 暂不可用。
 *
 * cookie 由 core 层经 info.cookie / credentials provider(settings)注入;
 * 显式空串 = 强制匿名 —— 匿名态已移除,渠道层会直接报「需要登录」。
 */
import type { Social, SocialImage } from "@amoeba/xml"
import { httpJson, httpText } from "../../host.ts"
import { cdpEvaluate } from "../../browser/cdp.ts"
import { extractInlineJson } from "../../utils/inline-json.ts"
import { toHttps } from "../../utils/url.ts"
import { parseCount } from "../../utils/count.ts"
import { resolveCookie } from "../credentials.ts"
import type { PlatformClient, PlatformRequestOptions } from "../types.ts"

export const XHS_BASE = "https://www.xiaohongshu.com"
/** API 域名(edith.* 承载全部 web API)。 */
export const XHS_API_BASE = "https://edith.xiaohongshu.com"

/** 桌面 Chrome UA。 */
export const XHS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

/**
 * 生成小红书 API 签名请求头(x-s/x-s-common/x-t/...) —— ⚠️ 已降级。
 *
 * 2026-07 底小红书升级签名算法,签名库 xhshow 已移至 feat/xhs-rustpython 分支
 * (Python 上游 + RustPython 兼容补丁,随 RustPython 签名 crate 在专门分支维护)。
 * 主分支不维护签名 API → 所有签名 API(user_posted 等)当前不可用;
 * explore/user 走 SSR(要求登录)。若需恢复签名,合并 feat/xhs-rustpython 分支。
 */
export function signApiHeaders(_cookie: string, _uri: string, _params: Record<string, string>): Record<string, string> {
  throw new Error("xhs 签名已降级:签名库在 feat/xhs-rustpython 分支,主分支不维护")
}

/** 调小红书 API(GET),返回解析后 body(签名 headers + cookie 并入)。 */
export function apiJson<T>(url: string, cookie: string, headers: Record<string, string>): Promise<T> {
  return httpJson<T>(url, cookie ? { ...headers, Cookie: cookie } : headers)
}

/**
 * 统一 getJson/getHtml 入口(PlatformClient)。
 * getJson 从 URL 反向提取签名参数(uri = path+search,params = searchParams 保序对象,
 * 与 channel 显式构造的签名参数同源);无额外 header 需求时内部 signApiHeaders。
 */
/** satisfies 保留具体类型(getHtml 非可选),同时校验满足 PlatformClient 接口。 */
export const xhsClient = {
  async getJson<T = any>(url: string, opts?: PlatformRequestOptions): Promise<T> {
    const u = new URL(url)
    const uri = u.pathname + u.search
    const params = Object.fromEntries(u.searchParams)
    // cookie 三级(credentials):显式 > 空串强制匿名 > provider(settings)。
    const cookie = resolveCookie(opts?.cookie, "xhs") ?? ""
    const headers = opts?.headers ?? signApiHeaders(cookie, uri, params)
    return apiJson<T>(url, cookie, headers)
  },
  async getHtml(url: string, opts?: PlatformRequestOptions): Promise<string> {
    return fetchHtml(url, resolveCookie(opts?.cookie, "xhs"))
  },
} satisfies PlatformClient

/** 完整浏览器 headers(SSR 页面需要像真实浏览器请求才返回完整 HTML)。 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": XHS_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${XHS_BASE}/`,
}

/**
 * 风控信号上报(best-effort):宿主未注入 `net` 时静默,不影响请求/返回逻辑。
 * 契约 `appHost.net.reportRisk(platform, signal)` 见 docs/crawler-risk-control.md §2.6。
 * 导出供 crawler 的 xhs channel 在 `.fe-verify-box` 检查处复用。
 */
export function reportXhsRisk(signal: string): void {
  // 宿主未注入 net 或调用方未注入 appHost 时静默(best-effort)
  globalThis.appHost?.net?.reportRisk("xhs", signal)
}

/**
 * 页面 SSR 的登录位(解 Vue ref 包装)。返回 null = 读不到(未挂载/导航过渡/结构变化),
 * 调用方自行决定回退判据 —— 登录抓取与扫码登录共用这一份页面判据,避免漂移。
 */
export async function xhsPageLoggedIn(browser: BrowserBackend): Promise<boolean | null> {
  try {
    const v = await cdpEvaluate<boolean | null>(
      browser,
      `(() => {
        const u = window.__INITIAL_STATE__?.user;
        const l = u?.loggedIn?._rawValue ?? u?.loggedIn;
        return typeof l === 'boolean' ? l : null;
      })()`,
    )
    return v ?? null
  } catch {
    return null
  }
}

/** 登录后侧栏有指向自己的「我」入口;匿名页没有(MediaCrawler 同款判据)。 */
export async function xhsDomLoggedIn(browser: BrowserBackend): Promise<boolean> {
  try {
    return await cdpEvaluate<boolean>(
      browser,
      `(() => {
        const a = [...document.querySelectorAll('a[href*="/user/profile/"]')]
          .find((n) => n.textContent && n.textContent.trim() === '我');
        return !!a;
      })()`,
    )
  } catch {
    return false
  }
}

/**
 * 当前页面是否**真的登录**了(不是游客)。
 *
 * ⚠️ 不能用 `web_session` —— 小红书对匿名访客也会立即签发游客 web_session。
 * 优先页面 SSR `user.loggedIn`(导航到 xhs 页面后即可读),读不到再回退 `user_id`
 * cookie(游客 cookie 里没有它;注意短信登录的 Set-Cookie 也可能不带,故只作兜底)。
 *
 * 调用前提:页面已导航到 xhs 域。未导航时 SSR 读不到,只剩 cookie 兜底。
 */
export async function isXhsLoggedIn(browser: BrowserBackend): Promise<boolean> {
  const page = await xhsPageLoggedIn(browser)
  if (page !== null) return page
  if (await xhsDomLoggedIn(browser)) return true
  try {
    const c = await browser.getCookies(XHS_BASE)
    return !!c["user_id"]
  } catch {
    return false
  }
}

/** 当前页面是否已在 xhs origin(页面内 fetch 同源的前提)。 */
export async function isXhsOrigin(browser: BrowserBackend): Promise<boolean> {
  try {
    return await cdpEvaluate<boolean>(browser, `location.origin === ${JSON.stringify(XHS_BASE)}`)
  } catch {
    return false
  }
}

/** 抓页面 HTML(带 cookie)。复用 httpText(2xx 校验 + body 归一)。 */
export async function fetchHtml(url: string, cookie?: string): Promise<string> {
  const html = await httpText(url, cookie ? { ...BROWSER_HEADERS, Cookie: cookie } : BROWSER_HEADERS)
  // 300011 是小红书账号风控码(签名/参数异常)。只认 JSON 键位,避免正文里
  // 恰好出现这串数字时误写 60 分钟冷却(会连带停掉所有 xhs 主动请求)。
  if (/"(?:code|result_code)"\s*:\s*300011\b/.test(html)) reportXhsRisk("300011")
  return html
}

/**
 * 提取 SSR 状态 window.__INITIAL_STATE__=...JSON(共用 extractInlineJson 平衡括号截取)。
 * 登录态 SSR 的 JSON 混入 JS 表达式:`undefined` / `new Map([])`(空容器构造归一为 {},
 * 语义等价)——单趟 replace 处理两态(RSSHub 只 replaceAll("undefined","null") 救不了
 * new Map;合并一趟也省一次大串全量拷贝)。
 */
export function extractInitialState(html: string): any {
  return extractInlineJson(
    html,
    "window.__INITIAL_STATE__=",
    (s) => s.replace(/undefined|new\s+\w+\s*\(\[\]\)/g, (m) => (m === "undefined" ? "null" : "{}")),
    "小红书 __INITIAL_STATE__",
  )
}

/** 展开 _rawValue(Vue SSR 常包一层 ref)。 */
export function rawOf<T>(v: T | { _rawValue?: T } | undefined): T | undefined {
  if (v === undefined || v === null) return undefined
  return (v as { _rawValue?: T })._rawValue ?? (v as T)
}

/** "10万+" → 100000;纯数字透传。 */
// (parseCount 已抽到 ../../utils/count.ts,与 douyu 等平台共用。)

/**
 * 平台给的时间戳 → epoch **ms**,自动判别秒/毫秒。
 *
 * ⚠️ 别无条件 `* 1000`:小红书结构变更后 `time` 已从**秒**改成**毫秒**,旧假设会把
 * 时间戳放大 1000 倍 → 落到公元 5 万年 → 排序**永久钉在最前**(实测:全部页前 12 条
 * 全是 social,本该置顶的直播被挤到第 112 位开外)。这类错值还会连累 `fmtAgo`(「多久前」)
 * 与 `isToday`(今日/未读口径),不只影响排序。
 *
 * ⚠️ 刻意**不用 `now` 做上限** —— 那会把「刚发布的 1 条未来时间/时钟偏差」误判成秒。
 *
 * ⚠️ **别写成三元**,这里踩过两次都是把分支写反:秒/毫秒的判据方向相反,很容易混。
 * 中间量走具名常量,一眼能看出哪个数属于哪个单位。
 */
const SEC_MIN = 978307200 // 2001-01-01 的**秒**级戳
const MS_MIN = SEC_MIN * 1000 // 同一时刻的**毫秒**级戳
export function toEpochMs(t: unknown): number | undefined {
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return undefined
  // 小于 2001 年的毫秒戳必然是无意义的(小红书 2013 年才成立)→ 一定是秒级。
  if (n < MS_MIN) return n * 1000 // 秒 → 毫秒
  return n // 已经是毫秒
}

/** note 两种形态(SSR noteCard / API note)归一后的共享字段。 */
interface NoteFields {
  noteId: string
  title: string
  content: string
  imgUrl: string
  imgWidth?: number
  imgHeight?: number
  likes?: number
  authorName?: string
  authorAvatar?: string
  /** epoch ms(两适配器各自换算单位)。 */
  publishedAtMs?: number
  /** 小红书笔记详情开关(get /explore/<id> 需带列表项 xsec_token)。 */
  xsecToken?: string
}

/**
 * note → Social 共享骨架(SSR noteCard / user_posted API note 都收敛到这)。
 * 字段差异(displayTitle vs display_title、urlDefault vs url、秒 vs 毫秒)在各自
 * 适配器归一,此处不再重复 id/url/author/images 组装。无 noteId 返回 null
 * (广告位/运营卡,无 url、id 兜底可能同批重复)——调用方过滤。
 */
function noteToSocial(f: NoteFields, sourceId: string, t: number): Social | null {
  if (!f.noteId) return null
  const image: SocialImage = { url: toHttps(f.imgUrl) }
  if (f.imgWidth) image.width = f.imgWidth
  if (f.imgHeight) image.height = f.imgHeight
  return {
    id: `xhs-${f.noteId}`,
    sourceId,
    kind: "social",
    title: f.title || f.content.slice(0, 30) || "小红书笔记",
    url: `${XHS_BASE}/explore/${f.noteId}`,
    content: f.content,
    images: f.imgUrl ? [image] : undefined,
    likes: f.likes,
    author: f.authorName ? { name: f.authorName, avatar: f.authorAvatar } : undefined,
    publishedAt: f.publishedAtMs,
    fetchedAt: t,
    xsecToken: f.xsecToken,
  }
}

/**
 * SSR noteCard → Social。
 * 封面用 cover.urlDefault(原图),SSR 自带宽高 → 无需 Range 预取。content 用标题+摘要。
 * xsecToken 是详情页开关(登录态 get /explore/<id> 的 xsec_token 参数),存进 Social 供详情弹窗用。
 *
 * ⚠️ 没有 noteId 的卡片直接丢弃(广告位/运营卡;匿名态的 `anon-*` 虚拟 ID 兜底
 * 已随匿名支持一起移除 —— 匿名访问本来就拿不到稳定详情)。
 */
export function noteCardToSocial(
  noteCard: any,
  sourceId: string,
  t: number,
  noteIdFromOuter?: string,
  xsecToken?: string,
): Social | null {
  // noteId 已从 noteCard 内移到外层(feeds[i].id / note.id)——小红书 SSR 结构变更(2026-08)。
  const noteId = String(noteIdFromOuter ?? noteCard?.noteId ?? "").trim()
  if (!noteId) return null
  const title = String(noteCard?.displayTitle ?? "").trim()
  const desc = noteCard?.desc ? String(noteCard.desc).trim() : ""
  const cover = noteCard?.cover ?? {}
  const user = noteCard?.user ?? {}
  // ⚠️ `time` 的单位**不固定**,不能无条件 ×1000:小红书结构变更后返回的是**毫秒**,
  // 旧的「秒」假设会把它放大 1000 倍 → 时间戳落到公元 5 万年,排序时**永久钉在最前**
  // (实测:全部页窗口前 12 条全是 social,而本该置顶的直播被挤出首屏)。
  // 判据用「秒级时间戳换算成 ms 后仍早于 2001 年」→ 说明给的本来就是 ms。
  // 注意别用 `now` 做上限:那会把「发布了 1 条未来时间」误判成秒。
  const publishedAtMs = toEpochMs(noteCard?.time)

  return noteToSocial(
    {
      noteId,
      title,
      content: [title, desc].filter(Boolean).join("\n"),
      imgUrl: String(cover.urlDefault || cover.url || ""),
      imgWidth: cover.width ? Number(cover.width) : undefined,
      imgHeight: cover.height ? Number(cover.height) : undefined,
      likes: parseCount(noteCard?.interactInfo?.likedCount),
      authorName: user.nickname ? String(user.nickname) : undefined,
      authorAvatar: user.avatar ? String(user.avatar) : undefined,
      publishedAtMs,
      xsecToken,
    },
    sourceId,
    t,
  )
}

// ── 详情页(单条 note 完整内容):noteDetailMap 解析 ────────────────────────────

/**
 * 从详情页 html 提取单条 note 完整内容。
 * GET /explore/<noteId>?xsec_token=<列表项的>&xsec_source=pc_feed → SSR
 * `note.noteDetailMap[<noteId>].note`。**不带 xsec_token 则 noteDetailMap 为空 {}**。
 * 返回 note 对象(含 title/desc/imageList/tagList/interactInfo/user/video)。
 */
export function extractNoteDetail(html: string, noteId: string): any {
  const noteMap = rawOf(extractInitialState(html)?.note)?.noteDetailMap
  if (!noteMap) return null
  const entry = noteMap[noteId]
  return entry ? (rawOf(entry.note) ?? rawOf(entry)) : null
}

/**
 * 页面内读取详情状态的表达式(被动详情用)。
 *
 * 与 `extractNoteDetail` 的区别:这里读的是**浏览器里已求值的** `__INITIAL_STATE__`,
 * 所以 `noteDetailMap` 可能是真正的 `Map`(登录态 SSR 里的 `new Map(...)`),不是普通对象;
 * 同时要兼容 Vue 的 `_rawValue` 包装。只读页面已有状态,不构造任何请求。
 */
export function noteDetailStateExpr(noteId: string): string {
  const id = JSON.stringify(noteId)
  return `(() => {
    const n = window.__INITIAL_STATE__?.note;
    const map = n?.noteDetailMap?._rawValue ?? n?.noteDetailMap;
    if (!map) return null;
    const entry = typeof map.get === 'function' ? map.get(${id}) : map[${id}];
    const note = entry?.note?._rawValue ?? entry?.note ?? entry;
    return note ?? null;
  })()`
}

/**
 * note 详情 → 完整 Social(覆盖列表 noteCard 的单图摘要,补全文/多图/标签/视频)。
 * 图片来自 imageList(每项 url/urlDefault),tagList 作 #标签# 并入正文,interactInfo 取赞/评。
 */
/**
 * 实况图的视频直链。
 *
 * ⚠️ `stream` 的 codec 键**不固定**：实测 Web 详情页是 `EF4`（另有空的 EF5/EF6/EF7），
 * 不是网上常见的 `h264` —— 写死键名会静默拿不到。取第一个非空数组，masterUrl 优先
 * （带 sign/t），失败再退 backupUrls[0]（不带签名，活得更久）。
 */
function firstStreamUrl(stream: any): string | undefined {
  for (const arr of Object.values(stream ?? {})) {
    const s = Array.isArray(arr) ? arr[0] : undefined
    const url = s?.masterUrl ?? s?.backupUrls?.[0]
    if (url) return String(url)
  }
  return undefined
}

export function noteDetailToSocial(note: any, sourceId: string, t: number): Social | null {
  const noteId = String(note?.noteId ?? "").trim()
  if (!noteId) return null
  const images: SocialImage[] = (note?.imageList ?? [])
    .map((img: any): SocialImage | null => {
      const url = String(img?.urlDefault || img?.url || "").trim()
      if (!url) return null
      const out: SocialImage = { url: toHttps(url) }
      if (img.width) out.width = Number(img.width)
      if (img.height) out.height = Number(img.height)
      // 实况图：静态图即 poster；非实况的 stream 是 `{}`，所以判定只能看 livePhoto。
      if (img.livePhoto === true) {
        const live = firstStreamUrl(img.stream)
        if (live) out.liveVideo = toHttps(live)
      }
      return out
    })
    .filter((x: SocialImage | null): x is SocialImage => !!x)

  const title = String(note?.title ?? "").trim()
  const desc = String(note?.desc ?? "").trim()
  // tagList 并入正文尾部(RSSHub 同款:tags 以 #话题# 形式展示)。
  const tags = (note?.tagList ?? []).map((tag: any) => `#${String(tag?.name ?? "").trim()}#`).filter(Boolean)
  const content = [desc, ...tags].filter(Boolean).join("\n") || title
  const user = note?.user ?? {}
  const interact = note?.interactInfo ?? {}

  return {
    id: `xhs-${noteId}`,
    sourceId,
    kind: "social",
    title: title || content.slice(0, 30) || "小红书笔记",
    url: `${XHS_BASE}/explore/${noteId}`,
    content,
    images: images.length ? images : undefined,
    likes: parseCount(interact.likedCount),
    reposts: parseCount(interact.shareCount),
    replies: parseCount(interact.commentCount),
    author: user.nickname
      ? { name: String(user.nickname), avatar: user.avatar ? String(user.avatar) : undefined }
      : undefined,
    publishedAt: toEpochMs(note?.time),
    fetchedAt: t,
    xsecToken: note?.xsecToken ?? undefined,
  }
}
