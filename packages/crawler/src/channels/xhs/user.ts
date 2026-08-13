/**
 * xhs:user —— 小红书用户笔记 channel(kind: social)。
 *
 * 小红书已把用户页笔记改为 JS/API 动态加载,SSR 不再内嵌(`user.notes` 空分组)——
 * 走 `user_posted` API(edith.xiaohongshu.com),需 xhshow-js 签名(x-s/x-s-common/x-t)
 * + **登录 cookie(web_session)**。无登录态返回 code:-101。
 */
import type { Item, Social } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { XHS_API_BASE, XHS_BASE, apiJson, apiNoteToSocial, signApiHeaders } from "./client.ts"

export class XhsUserChannel implements RssChannel {
  readonly key = "xhs:user"
  readonly name = "小红书用户笔记"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "user_id", label: "用户 ID(24 位)", required: true }]
  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const userId = String(info.user_id ?? "").trim()
    if (!userId) throw new Error("xhs:user 需要 user_id")
    // 签名种子 a1 来自会话 cookie,无 cookie(匿名)签名无效 → API 406/风控。
    const cookie = (info.cookie as string) || ""
    const uri = "/api/sns/web/v1/user_posted"
    // params 单一数据源:URL query 与签名参数从同一对象推导,保证顺序一致。
    const params: Record<string, string> = { num: "30", cursor: "", user_id: userId }
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&")
    const url = `${XHS_API_BASE}${uri}?${query}`
    const body = await apiJson<{ data?: { notes?: any[] } }>(url, cookie, signApiHeaders(cookie, uri, params))
    const notes = body?.data?.notes ?? []
    const t = now()
    return notes
      .map((n: any): Social | null => apiNoteToSocial(n, this.key, t))
      .filter((x): x is Social => !!x)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `小红书 · ${info.user_id}`,
      channelLink: `${XHS_BASE}/user/profile/${info.user_id}`,
    }
  }
}
