/**
 * xhs:user:search —— 查小红书用户(搜索渠道,不直接订阅)。
 *
 * 输入 **用户 ID(24 位)或主页链接**,导航/请求 profile 页读 SSR 的用户资料
 * (`user.userPageData`,拿不到时回退首条笔记的作者)。产出单条 Video item,
 * url = 主页 —— 候选提取从 url 解析 user_id。
 *
 * ⚠️ xhs 全渠道要求登录(2026-10-22 起,见 shared.ts 文件头):浏览器路径走
 * `assertXhsLoggedIn`,HTTP 路径必须带 cookie —— 与 `xhs:user` 同一套策略。
 * ⚠️ 是「查号」不是「按昵称搜」:小红书搜索 API 需要签名(签名库在
 * feat/xhs-rustpython 分支,主分支不可用),昵称搜索无法提供。
 *
 * 下游订阅走 `xhs:user`(user_id 参数),本渠道只作「搜索添加」的取数源。
 */

import { cdpEvaluate, extractInitialState, now, XHS_BASE, xhsClient } from "@amoeba/resolve"
import type { Item, Video } from "@amoeba/xml"

import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { fetchXhsList, flatXhsStateList, requireXhsCookie, xhsStateValue } from "./shared.ts"

/** 输入归一:主页链接或裸 ID → 24 位用户 ID。 */
export function parseXhsUserId(raw: string): string {
  const s = raw.trim()
  if (!s) throw new Error("xhs:user:search 需要 24 位用户 ID 或主页链接")
  // 主页链接两种写法都收：web 端 `/user/profile/<id>`（xhs:user 导航的就是它），
  // 分享链接出现过 `/user_profile/<id>`。
  const m = /xiaohongshu\.com\/user(?:_|\/)profile\/([0-9a-f]+)/i.exec(s)
  const id = (m?.[1] ?? s).toLowerCase()
  if (!/^[0-9a-f]{16,32}$/.test(id)) {
    throw new Error("不是有效的用户 ID：应为 24 位十六进制串，或形如 xiaohongshu.com/user_profile/<id> 的主页链接")
  }
  return id
}

export class XhsUserSearchChannel implements RssChannel {
  readonly key = "xhs:user:search"
  readonly name = "小红书查用户"
  readonly kind = "video" as const
  readonly sourceInfoTpl = [
    { key: "keyword", label: "用户 ID 或主页链接", placeholder: "24 位用户 ID", required: true },
  ]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(
        () => this.fetchItems(info),
        () => ({
          channelTitle: `小红书查用户 ${String(info.keyword ?? "").slice(0, 24)}`,
          channelLink: `${XHS_BASE}/`,
        }),
      ),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const userId = parseXhsUserId(String(info.keyword ?? ""))
    const browser = globalThis.appHost?.browser
    const raw = browser
      ? await fetchXhsList(
          browser,
          {
            url: `${XHS_BASE}/user/profile/${userId}`,
            // 资料块拿不到时回退首条笔记的作者(有的账号 userPageData 不渲染)。
            readPage: (b) => this.readSummaryViaBrowser(b),
            loginError: "小红书查用户需要登录：请到「账号与凭证」扫码后重试",
          },
          // 与 xhs:user 共用列表 lane(查号是低频操作,不值得独立 tab)。
          "list:xhs:user",
        )
      : await this.fetchViaHttp(userId, info.cookie as string | undefined)
    if (!raw) throw new Error(`没有读到该用户的资料（ID ${userId}）：可能用户不存在或页面结构已变`)
    const t = now()
    return [
      {
        id: `xu-${userId}`,
        sourceId: this.key,
        kind: "video",
        title: raw.nickname,
        url: `${XHS_BASE}/user/profile/${userId}`,
        thumbnail: raw.avatar,
        summary: raw.desc || undefined,
        fetchedAt: t,
      } satisfies Video,
    ]
  }

  /**
   * 浏览器侧读用户资料 —— **逐字段在页面内取值**,不要把整棵 `state.user` 序列化回来:
   * 登录态 profile 的 notes 挂着 60+ 条笔记(含循环引用),CDP returnByValue 会失败返回空。
   */
  private async readSummaryViaBrowser(b: BrowserBackend): Promise<UserSummary | null> {
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
    return nickname ? { nickname, avatar: o.avatar || undefined, desc: String(o.desc ?? "").trim() } : null
  }

  /** HTTP 路径(无浏览器):带登录 cookie 请求 profile 页 HTML → 解析 SSR。 */
  private async fetchViaHttp(userId: string, cookie?: string): Promise<UserSummary | null> {
    const ck = requireXhsCookie(cookie, "小红书查用户需要登录：请到「账号与凭证」扫码后重试")
    const html = await xhsClient.getHtml(`${XHS_BASE}/user/profile/${userId}`, { cookie: ck })
    return this.readSummary(xhsStateValue(extractInitialState(html), ["user"]))
  }

  /** SSR `user` 块 → {昵称, 头像, 简介}(userPageData 优先,回退首条笔记作者)。 */
  private readSummary(user: any): UserSummary | null {
    const basic = user?.userPageData?.basicInfo
    const nickname = String(basic?.nickname ?? "").trim()
    if (nickname) {
      return {
        nickname,
        avatar: String(basic?.imageb ?? basic?.imagesb ?? "") || undefined,
        desc: String(basic?.desc ?? "").trim(),
      }
    }
    const note = flatXhsStateList(user, ["notes"]).find((n: any) => n?.noteCard?.user?.nickname)
    const u = note?.noteCard?.user ?? {}
    const name = String(u.nickname ?? "").trim()
    return name ? { nickname: name, avatar: String(u.avatar ?? "") || undefined, desc: "" } : null
  }
}

interface UserSummary {
  nickname: string
  avatar?: string
  desc: string
}
