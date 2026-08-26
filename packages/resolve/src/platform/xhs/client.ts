/**
 * xhs 公共 —— UA / headers / SSR 状态提取 / 签名 API / note→Social 归一。
 *
 * 小红书数据双通道(2026-08 起拆分):
 *   - SSR 页面:`/explore` 等仍内嵌 `window.__INITIAL_STATE__`(推荐流 feeds),
 *     fetchHtml + extractInitialState,匿名可用 → explore 用;
 *   - 签名 API:`user_posted` 等需 x-s/x-s-common/x-t 签名 —— ⚠️ 已降级
 *     (签名库 xhshow 已移至 feat/xhs-rustpython 分支,见 signApiHeaders)→ user 暂不可用。
 *
 * cookie 由 core 层 DEFAULT_XHS_COOKIE 经 info.cookie 注入。
 */
import type { Social, SocialImage } from "@tauri-playground/xml"
import { httpJson, httpText } from "../../host.ts"
import { extractInlineJson } from "../../utils/inline-json.ts"
import { toHttps } from "../../utils/url.ts"
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
 * explore(SSR 匿名)保留。若需恢复,合并 feat/xhs-rustpython 分支。
 */
export function signApiHeaders(
  _cookie: string,
  _uri: string,
  _params: Record<string, string>,
): Record<string, string> {
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
    const cookie = opts?.cookie ?? ""
    const headers = opts?.headers ?? signApiHeaders(cookie, uri, params)
    return apiJson<T>(url, cookie, headers)
  },
  async getHtml(url: string, opts?: PlatformRequestOptions): Promise<string> {
    return fetchHtml(url, opts?.cookie)
  },
} satisfies PlatformClient

/** 完整浏览器 headers(SSR 页面需要像真实浏览器请求才返回完整 HTML)。 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": XHS_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${XHS_BASE}/`,
}

/** 抓页面 HTML(带 cookie)。复用 httpText(2xx 校验 + body 归一)。 */
export async function fetchHtml(url: string, cookie?: string): Promise<string> {
  return httpText(url, cookie ? { ...BROWSER_HEADERS, Cookie: cookie } : BROWSER_HEADERS)
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
function parseCount(s: unknown): number | undefined {
  if (s === undefined || s === null) return undefined
  const m = String(s).match(/^([\d.]+)\s*(万|w|k)?/i)
  if (!m) return undefined
  const n = parseFloat(m[1])
  const unit = (m[2] ?? "").toLowerCase()
  if (unit === "万" || unit === "w") return Math.round(n * 10000)
  if (unit === "k") return Math.round(n * 1000)
  return Number.isFinite(n) ? n : undefined
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
  }
}

/**
 * SSR noteCard → Social。
 * 封面用 cover.urlDefault(原图),SSR 自带宽高 → 无需 Range 预取。content 用标题+摘要。
 */
export function noteCardToSocial(noteCard: any, sourceId: string, t: number, noteIdFromOuter?: string): Social | null {
  // noteId 已从 noteCard 内移到外层(feeds[i].id / note.id)——小红书 SSR 结构变更(2026-08)。
  const noteId = String(noteIdFromOuter ?? noteCard?.noteId ?? "").trim()
  if (!noteId) return null
  const title = String(noteCard?.displayTitle ?? "").trim()
  const desc = noteCard?.desc ? String(noteCard.desc).trim() : ""
  const cover = noteCard?.cover ?? {}
  const user = noteCard?.user ?? {}
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
      publishedAtMs: noteCard?.time ? Number(noteCard.time) * 1000 : undefined,
    },
    sourceId,
    t,
  )
}
