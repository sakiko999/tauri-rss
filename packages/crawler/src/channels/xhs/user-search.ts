/**
 * xhs:user:search —— 搜/查小红书用户(搜索渠道,不直接订阅)。
 *
 * 两条路径:
 *   1. **按用户 ID / 主页链接查号**:导航 profile 页读 SSR(`user.userPageData`,
 *      拿不到时回退首条笔记作者),产单条 Video;
 *   2. **按关键词搜用户**(被动采集):导航 `search_result?keyword=<kw>&type=51`,
 *      再点页面上的「用户」Tab(默认落在「全部」,不点只发 onebox/recommend),
 *      捕获页面自己的 `/api/sns/web/v1/search/usersearch` 响应;拿到结果包之前
 *      不拿 recommend 里的推荐用户充数。应用侧不构造搜索请求、不做签名
 *      (xhs 搜索接口需要签名,签名库在主分支不可用)。
 *
 * 两条路径都产 Video item,url = 主页 —— 候选提取从 url 解析 user_id。
 * ⚠️ xhs 全渠道要求登录(2026-10-22 起,见 shared.ts 文件头):浏览器路径过
 * `assertXhsLoggedIn`,HTTP 路径必须带 cookie。
 *
 * 下游订阅走 `xhs:user`(user_id 参数),本渠道只作「搜索添加」的取数源。
 */

import { cdpEvaluate, cdpNavigate, extractInitialState, now, withBrowserOp, XHS_BASE, xhsClient } from "@amoeba/resolve"
import type { Item, Video } from "@amoeba/xml"

import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { passiveBuffer } from "../../passive/buffer.ts"
import { capturePage } from "../../passive/capture.ts"
import { apiFetchItems } from "../factory.ts"
import {
  assertXhsLoggedIn,
  assertXhsNotBlocked,
  fetchXhsList,
  flatXhsStateList,
  requireXhsCookie,
  XHS_LOGIN_REQUIRED,
  xhsStateValue,
} from "./shared.ts"

/** 关键词搜索的 lane(专属 tab,不与 profile / explore 互踩)。 */
const LANE = "search:xhs"
/** passiveBuffer 的接口键(与 platform 一起定位本渠道的响应)。 */
const ENDPOINT = "user_search"

const NEEDS_BROWSER = "小红书关键词搜索需要桌面抓取浏览器：搜索接口需要页面签名，无浏览器时只能按用户 ID / 主页链接查号"

/** 输入归一:主页链接或裸 ID → 用户 ID;不像 ID 时返回 null(交给关键词搜索)。 */
export function parseXhsUserId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const m = /xiaohongshu\.com\/user(?:_|\/)profile\/([0-9a-f]+)/i.exec(s)
  const id = (m?.[1] ?? s).toLowerCase()
  return /^[0-9a-f]{16,32}$/.test(id) ? id : null
}

/** 点搜索结果页的「用户」Tab(从「全部」切过去才会发 usersearch 请求)。 */
const CLICK_USER_TAB = `(() => {
  const nodes = [...document.querySelectorAll('a,div,span,li,button')];
  const el = nodes.find((e) => e.children.length === 0 && /^用户\\s*[(（]?[\\d.万]*[)）]?$/.test(e.textContent.trim()));
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return true;
})()`

/** 页面自己的搜索接口(用户 Tab / 笔记 Tab 都收,只用于匹配)。 */
function isXhsSearchApi(u: URL): boolean {
  return /(^|\.)xiaohongshu\.com$/.test(u.hostname) && u.pathname.startsWith("/api/sns/web/v1/search/")
}

interface XhsUserHit {
  userId: string
  nickname: string
  avatar?: string
  desc?: string
  descExtra?: string
}

/** URL → pathname(解析失败给空串,便于日志/分组)。 */
function urlPath(u: string): string {
  try {
    return new URL(u).pathname
  } catch {
    return ""
  }
}

/** fans 可能是数字,也可能是「29.9万」这类展示串。 */
function parseFans(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const m = /^([\d.]+)\s*(万|亿)?$/.exec(String(v ?? "").trim())
  if (!m) return 0
  const n = Number(m[1])
  if (!Number.isFinite(n)) return 0
  return m[2] === "亿" ? n * 1e8 : m[2] === "万" ? n * 1e4 : n
}

/** 一个对象是否是「用户」(带 id + 昵称,且不是笔记)。 */
function userNodeToHit(node: any): XhsUserHit | null {
  const o = node && typeof node === "object" && "_rawValue" in node ? node._rawValue : node
  if (!o || typeof o !== "object") return null
  // usersearch 的 user 对象主键叫 `id`(不是 user_id):用用户侧字段做佐证,避免
  // 把笔记的 `id` 当成用户。
  const userish =
    o.red_id != null || o.fans != null || o.xsec_token != null || o.note_count != null || o.sub_title != null
  const userId = String(o.user_id ?? o.userId ?? o.userid ?? (userish ? o.id : "") ?? "")
  const nickname = String(o.nickname ?? o.name ?? "")
  if (!userId || !nickname) return null
  if (o.note_id || o.noteId) return null
  const redId = String(o.red_id ?? o.redId ?? "")
  const fans = parseFans(o.fans ?? o.follower_count ?? o.fans_count)
  return {
    userId,
    nickname,
    avatar: String(o.image ?? o.avatar ?? o.imageb ?? "") || undefined,
    desc: redId ? `小红书号 ${redId}` : undefined,
    descExtra: fans ? `${fmtCount(fans)} 粉丝` : undefined,
  }
}

/** 深度遍历 JSON,收集所有用户对象(响应形状不稳定时的兜底)。 */
function walkUsers(node: any, depth: number, seen: Set<object>, out: XhsUserHit[]): void {
  const v = node && typeof node === "object" && "_rawValue" in node ? node._rawValue : node
  if (!v || typeof v !== "object" || depth > 10 || seen.has(v)) return
  seen.add(v)
  const hit = userNodeToHit(v)
  if (hit) out.push(hit)
  if (Array.isArray(v)) {
    for (const x of v) walkUsers(x, depth + 1, seen, out)
    return
  }
  for (const k of Object.keys(v)) walkUsers(v[k], depth + 1, seen, out)
}

/** 按 user_id 去重(保留首次出现)。 */
function dedupeUsers(list: XhsUserHit[]): XhsUserHit[] {
  const seen = new Set<string>()
  const out: XhsUserHit[] = []
  for (const u of list) {
    if (!u.userId || !u.nickname || seen.has(u.userId)) continue
    seen.add(u.userId)
    out.push(u)
  }
  return out
}

export class XhsUserSearchChannel implements RssChannel {
  readonly key = "xhs:user:search"
  readonly name = "小红书搜用户"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [
    {
      key: "keyword",
      label: "昵称或用户 ID / 主页链接",
      placeholder: "如:美食博主，或 24 位用户 ID",
      required: true,
    },
  ]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(
        () => this.fetchItems(info),
        () => ({
          channelTitle: `小红书搜用户 ${String(info.keyword ?? "").slice(0, 24)}`,
          channelLink: `${XHS_BASE}/`,
        }),
      ),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const raw = String(info.keyword ?? "").trim()
    if (!raw) throw new Error("xhs:user:search 需要关键词")
    const userId = parseXhsUserId(raw)
    if (userId) return [this.toItem(await this.lookupProfile(info, userId))]
    return (await this.searchByKeyword(raw)).map((h) => this.toItem(h))
  }

  /** 已知 user_id:浏览器读 profile SSR(HTTP 兜底,与旧「查号」路径一致)。 */
  private async lookupProfile(info: SourceInfo, userId: string): Promise<XhsUserHit> {
    const browser = globalThis.appHost?.browser
    const raw = browser
      ? await fetchXhsList(
          browser,
          {
            url: `${XHS_BASE}/user/profile/${userId}`,
            readPage: (b) => this.readSummaryViaBrowser(b),
            loginError: "小红书查用户需要登录：请到「账号与凭证」扫码后重试",
          },
          "list:xhs:user",
        )
      : await this.fetchProfileViaHttp(userId, info.cookie as string | undefined)
    if (!raw) throw new Error(`没有读到该用户的资料（ID ${userId}）：可能用户不存在或页面结构已变`)
    return { ...raw, userId }
  }

  /** 关键词:导航搜索页 → 捕获页面自己的搜索响应(用户 Tab 优先,笔记作者兜底)。 */
  private async searchByKeyword(keyword: string): Promise<XhsUserHit[]> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error(NEEDS_BROWSER)
    // ⚠️ 必须 interactive:搜索结果是导航后由页面脚本自己的 XHR 填的,
    // hidden 的后台 tab 会被节流到不发请求(douyin:user 同款结论)。
    const hits = await withBrowserOp(browser, { lane: LANE, mode: "interactive", platform: "xhs" }, async (b) => {
      // 缓冲是进程级的:只读本次捕获窗口内写入的响应,避免连续搜索时混入上一次关键词。
      const since = now()
      await capturePage(b, {
        platform: "xhs",
        endpoint: ENDPOINT,
        match: isXhsSearchApi,
        trigger: (x) =>
          cdpNavigate(
            x,
            `${XHS_BASE}/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes&type=51`,
            true,
          ),
        // 首屏结果常常是 SSR/稍晚才到的 XHR:多等一会儿,别在第一屏 onebox/recommend
        // 之后立刻收工(实测 1.2s 会漏掉结果请求)。
        idleMs: 2500,
        timeoutMs: 20_000,
      })
      // 未登录 / 风控时要报可操作错误,不能当成「无结果」。
      await assertXhsNotBlocked(b)
      await assertXhsLoggedIn(b, XHS_LOGIN_REQUIRED)
      // 搜索页默认落在「全部」:结果来自笔记 SSR,用户列表要切到「用户」Tab 才有
      // `search/usersearch` 响应。点 Tab 是页面自然行为(不构造搜索请求)。
      await capturePage(b, {
        platform: "xhs",
        endpoint: ENDPOINT,
        match: isXhsSearchApi,
        trigger: (x) => cdpEvaluate(x, CLICK_USER_TAB).then(() => undefined),
        // 没有「用户」Tab 时不会触发任何请求:等一个 idle 就返回,不空耗超时。
        idleMs: 2000,
        timeoutMs: 8_000,
      })
      const captured = this.readSearchCaptured(since)
      if (captured.length) return captured
      // 有结果包但 0 用户 = 真的没搜到(不要拿 recommend 的推荐用户充数);
      // 一个结果包都没抓到 → 首屏结果只在 SSR state 里,从页面 state 兜底。
      const hasResultPack = passiveBuffer
        .list("xhs", ENDPOINT)
        .some((e) => e.at >= since && /\/search\/(usersearch|users?|notes)$/.test(urlPath(e.url)))
      return hasResultPack ? [] : this.readSearchStateViaBrowser(b)
    })
    if (!hits.length) {
      throw new Error(`没有搜到与「${keyword}」相关的用户：换个关键词，或确认搜索页能正常打开（可能需要登录）`)
    }
    return hits
  }

  /**
   * 解析捕获的搜索响应。顺序:
   *   1. 用户 Tab 的 `data.users[]` 与笔记 Tab 的 `data.items[].note_card.user`;
   *   2. 上面的形状都没命中(实测首次搜索页先发 onebox / recommend / filter,
   *      结果可能在 SSR 或别的包里)→ **深度遍历** JSON,收集所有带
   *      `user_id + nickname|name` 的对象。字段名新老两套都收。
   */
  private readSearchCaptured(since: number): XhsUserHit[] {
    const entries = passiveBuffer.list("xhs", ENDPOINT).filter((e) => e.at >= since)
    // 结果包(usersearch / notes)优先;onebox/recommend/filter 是搜索页的附属请求,
    // 里面也有用户对象但**不是关键词结果**,只在没有结果包时才兜底。
    const resultEntries = entries.filter((e) => /\/search\/(usersearch|users?|notes)$/.test(urlPath(e.url)))
    const out: XhsUserHit[] = []
    const parseEntry = (e: { body: string }) => {
      let json: any
      try {
        json = JSON.parse(e.body)
      } catch {
        return
      }
      const outer = json?.data ?? {}
      const data = Array.isArray(outer?.users) || Array.isArray(outer?.items) ? outer : (outer?.data ?? outer)
      for (const u of Array.isArray(data?.users) ? data.users : []) {
        const hit = userNodeToHit(u)
        if (hit) out.push(hit)
      }
      for (const it of Array.isArray(data?.items) ? data.items : []) {
        const hit = userNodeToHit(it?.note_card?.user)
        if (hit) out.push(hit)
      }
    }
    for (const e of resultEntries) parseEntry(e)
    // usersearch 的响应形状不稳定(users / data.users / 各种嵌套都见过):
    // 首层字段没解析出来时,对**用户结果包**做同样的深度遍历。
    if (!out.length) {
      for (const e of resultEntries) {
        if (!/\/search\/(usersearch|users?)$/.test(urlPath(e.url))) continue
        try {
          walkUsers(JSON.parse(e.body), 0, new Set(), out)
        } catch {
          /* 非 JSON */
        }
      }
    }
    if (out.length) return dedupeUsers(out)
    if (!resultEntries.length) {
      // 没有结果包(实测首屏只发 onebox/recommend/filter)→ 深度遍历兜底。
      for (const e of entries) {
        try {
          walkUsers(JSON.parse(e.body), 0, new Set(), out)
        } catch {
          /* 非 JSON 文档 */
        }
      }
    }
    return dedupeUsers(out)
  }

  /**
   * SSR state 兜底:搜索首屏结果可能只渲染在 `__INITIAL_STATE__` 里(没有结果 XHR)。
   * 同样用「带 user_id + 昵称」的判据深度遍历,避免依赖具体 state 路径。
   * ⚠️ 返回体只带标量,不序列化整棵 state(循环引用/CDP returnByValue 会失败)。
   */
  private async readSearchStateViaBrowser(b: BrowserBackend): Promise<XhsUserHit[]> {
    const raw = await cdpEvaluate<string>(
      b,
      `(() => {
        const un = (v) => (v && typeof v === "object" && "_rawValue" in v) ? v._rawValue : v;
        const str = (v) => {
          v = un(v);
          return typeof v === "string" ? v : (v && typeof v === "object" ? String(un(v.url ?? v.urlDefault ?? "")) : "");
        };
        const out = [];
        const seen = new Set();
        const visit = (v, d) => {
          v = un(v);
          if (!v || typeof v !== "object" || d > 10 || seen.has(v)) return;
          seen.add(v);
          const userish = v.red_id != null || v.fans != null || v.xsec_token != null || v.note_count != null || v.sub_title != null;
          const id = String(un(v.user_id ?? v.userId ?? v.userid ?? (userish ? v.id : "") ?? ""));
          const name = String(un(v.nickname ?? v.name ?? ""));
          if (id && name && !v.note_id && !v.noteId) {
            out.push({
              userId: id,
              nickname: name,
              avatar: str(v.image ?? v.avatar ?? v.imageb),
              redId: String(un(v.red_id ?? v.redId ?? "")),
              fans: Number(un(v.fans ?? v.follower_count ?? v.fans_count)) || 0,
            });
          }
          if (Array.isArray(v)) { for (const x of v) visit(x, d + 1); return; }
          for (const k of Object.keys(v)) visit(v[k], d + 1);
        };
        visit(window.__INITIAL_STATE__ || {}, 0);
        return JSON.stringify(out.slice(0, 40));
      })()`,
    )
    if (!raw) return []
    return dedupeUsers(
      (
        JSON.parse(raw) as Array<{ userId: string; nickname: string; avatar?: string; redId?: string; fans?: number }>
      ).map((u) => ({
        userId: u.userId,
        nickname: u.nickname,
        avatar: u.avatar || undefined,
        desc: u.redId ? `小红书号 ${u.redId}` : undefined,
        descExtra: u.fans ? `${fmtCount(u.fans)} 粉丝` : undefined,
      })),
    )
  }

  /**
   * 浏览器侧读用户资料 —— **逐字段在页面内取值**,不要把整棵 `state.user` 序列化回来:
   * 登录态 profile 的 notes 挂着 60+ 条笔记(含循环引用),CDP returnByValue 会失败返回空。
   */
  private async readSummaryViaBrowser(b: BrowserBackend): Promise<XhsUserHit | null> {
    const raw = await cdpEvaluate<string>(
      b,
      `(() => {
        const un = (v) => (v && typeof v === "object" && "_rawValue" in v ? v._rawValue : v);
        const st = window.__INITIAL_STATE__ || {};
        const user = un(st.user) || {};
        const page = un(user.userPageData) || {};
        const basic = un(page.basicInfo) || {};
        const notes = un(user.notes);
        const first = (Array.isArray(notes) ? notes : []).flat().find((n) => n?.noteCard?.user?.nickname);
        const author = first?.noteCard?.user || {};
        return JSON.stringify({
          nickname: String(basic.nickname ?? author.nickname ?? ""),
          avatar: String(basic.imageb ?? basic.imagesb ?? author.avatar ?? ""),
          desc: String(basic.desc ?? ""),
        });
      })()`,
    )
    if (!raw) return null
    const o = JSON.parse(raw) as { nickname?: string; avatar?: string; desc?: string }
    const nickname = String(o.nickname ?? "").trim()
    return nickname
      ? {
          userId: "",
          nickname,
          avatar: o.avatar || undefined,
          desc: String(o.desc ?? "").trim() || undefined,
        }
      : null
  }

  /** HTTP 路径(无浏览器):带登录 cookie 请求 profile 页 HTML → 解析 SSR。 */
  private async fetchProfileViaHttp(userId: string, cookie?: string): Promise<XhsUserHit | null> {
    const ck = requireXhsCookie(cookie, "小红书查用户需要登录：请到「账号与凭证」扫码后重试")
    const html = await xhsClient.getHtml(`${XHS_BASE}/user/profile/${userId}`, { cookie: ck })
    return this.readSummary(xhsStateValue(extractInitialState(html), ["user"]))
  }

  /** SSR `user` 块 → {昵称, 头像, 简介}(userPageData 优先,回退首条笔记作者)。 */
  private readSummary(user: any): XhsUserHit | null {
    const basic = user?.userPageData?.basicInfo
    const nickname = String(basic?.nickname ?? "").trim()
    if (nickname) {
      return {
        userId: "",
        nickname,
        avatar: String(basic?.imageb ?? basic?.imagesb ?? "") || undefined,
        desc: String(basic?.desc ?? "").trim() || undefined,
      }
    }
    const note = flatXhsStateList(user, ["notes"]).find((n: any) => n?.noteCard?.user?.nickname)
    const u = note?.noteCard?.user ?? {}
    const name = String(u.nickname ?? "").trim()
    return name ? { userId: "", nickname: name, avatar: String(u.avatar ?? "") || undefined } : null
  }

  private toItem(h: XhsUserHit): Video {
    return {
      id: `xu-${h.userId || h.nickname}`,
      sourceId: this.key,
      kind: "video",
      title: h.nickname,
      url: `${XHS_BASE}/user/profile/${h.userId}`,
      thumbnail: h.avatar,
      summary: [h.desc, h.descExtra].filter(Boolean).join(" · ") || undefined,
      fetchedAt: now(),
    }
  }
}

/** 粉丝数缩写:1.2万 / 3.4亿。 */
function fmtCount(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, "")}万`
  return String(n)
}
