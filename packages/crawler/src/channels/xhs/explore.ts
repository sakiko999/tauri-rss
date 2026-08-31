/**
 * xhs:explore —— 小红书发现页(推荐内容)channel(kind: social)。
 *
 * `/explore` SSR 的 `__INITIAL_STATE__.feed`(可能有 _rawValue 包装)含
 * `feeds[]`,每张 noteCard 即一条推荐笔记(标题/封面带尺寸/点赞)。需 cookie。
 */
import type { Item, Social } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { ItemDetailSource, LoginResult, Loginable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "@tauri-playground/resolve"
import { XHS_BASE, extractInitialState, extractNoteDetail, noteCardToSocial, noteDetailToSocial, rawOf, xhsClient, xhsScanLogin } from "@tauri-playground/resolve"

export class XhsExploreChannel implements RssChannel, Loginable {
  readonly key = "xhs:explore"
  readonly name = "小红书发现页"
  readonly kind = "social" as const
  readonly defaultInfo: SourceInfo = {}

  /** 扫码登录(Loginable,channel 级能力)。浏览器路径登录一次,同平台 channel 共享账号。 */
  scanLogin(
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error("扫码登录需 Tauri 桌面环境(未注入 appHost.browser)")
    return xhsScanLogin(browser, emitQr, opts)
  }

  getSource(info: SourceInfo): RssSource & ItemDetailSource {
    const cookie = (info.cookie as string) || undefined
    return {
      fetch: apiFetch(() => this.fetchItems(cookie), () => this.channelOptions()),
      // 单条详情:匿名 GET /explore/<id>?xsec_token= 补全文/多图/tag(video),见 item.url + xsecToken。
      resolveDetail: (item: Item) => this.resolveDetail(item, cookie),
    }
  }

  /** 单条笔记详情(列表 item 缺全文/多图/标签,详情页补全)。匿名可用(需列表项 xsec_token)。 */
  private async resolveDetail(item: Item, cookie?: string): Promise<Item | null> {
    const noteId = String(item.url ?? "").match(/\/explore\/([^?/?#]+)/)?.[1] ?? ""
    if (!noteId) return null
    const xsec = (item as Social).xsecToken
    const url = `${XHS_BASE}/explore/${noteId}${xsec ? `?xsec_token=${encodeURIComponent(xsec)}&xsec_source=pc_feed` : ""}`
    const html = await xhsClient.getHtml(url, { cookie })
    const note = extractNoteDetail(html, noteId)
    if (!note) return null
    const t = now()
    return noteDetailToSocial(note, this.key, t)
  }

  private async fetchItems(cookie?: string): Promise<Item[]> {
    const html = await xhsClient.getHtml(`${XHS_BASE}/explore`, { cookie })
    const state = extractInitialState(html)
    const feed = rawOf(state.feed)
    const feeds: any[] = feed?.feeds ?? []
    const t = now()
    return feeds
      // noteId 在 feeds[i].id(SSR 结构变更),传入外层 id;xsecToken 在外层(详情开关)。
      .map((f: any): Social | null =>
        f?.noteCard ? noteCardToSocial(f.noteCard, this.key, t, f.id, f.xsecToken) : null,
      )
      .filter((x): x is Social => !!x)
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "小红书发现页", channelLink: `${XHS_BASE}/explore` }
  }
}
