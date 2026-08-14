/**
 * xhs:user —— 小红书用户笔记 channel(kind: social)。
 *
 * 小红书已把用户页笔记改为 JS/API 动态加载,SSR 不再内嵌(`user.notes` 空分组)——
 * 走 `user_posted` API(edith.xiaohongshu.com),需签名 + 登录 cookie(web_session)。
 * ⚠️ 已降级(2026-08-15):TS fork 签名过时(461),待 RustPython 接入 —— fetch 会抛
 * 「xhs 签名已降级」错误,不产出条目。
 */
import type { Item, Social } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { XHS_API_BASE, XHS_BASE, apiNoteToSocial, xhsClient } from "../../platform/xhs"

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
    // xhsClient.getJson 从 URL 反向提取签名参数(uri+params 同源)。
    const cookie = (info.cookie as string) || ""
    const url = `${XHS_API_BASE}/api/sns/web/v1/user_posted?num=30&cursor=&user_id=${userId}`
    const body = await xhsClient.getJson<{ data?: { notes?: any[] } }>(url, { cookie })
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
