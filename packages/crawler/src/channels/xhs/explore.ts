/**
 * xhs:explore —— 小红书发现页(推荐内容)channel(kind: social)。
 *
 * `/explore` SSR 的 `__INITIAL_STATE__.feed`(可能有 _rawValue 包装)含
 * `feeds[]`,每张 noteCard 即一条推荐笔记(标题/封面带尺寸/点赞)。需 cookie。
 */
import type { Item, Social } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { LoginResult, Loginable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { XHS_BASE, extractInitialState, noteCardToSocial, rawOf, xhsClient, xhsScanLogin } from "../../platform/xhs"

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

  getSource(info: SourceInfo): RssSource {
    const cookie = (info.cookie as string) || undefined
    return { fetch: apiFetch(() => this.fetchItems(cookie), () => this.channelOptions()) }
  }

  private async fetchItems(cookie?: string): Promise<Item[]> {
    const html = await xhsClient.getHtml(`${XHS_BASE}/explore`, { cookie })
    const state = extractInitialState(html)
    const feed = rawOf(state.feed)
    const feeds: any[] = feed?.feeds ?? []
    const t = now()
    return feeds
      // noteId 在 feeds[i].id(SSR 结构变更),传入外层 id。
      .map((f: any): Social | null => (f?.noteCard ? noteCardToSocial(f.noteCard, this.key, t, f.id) : null))
      .filter((x): x is Social => !!x)
  }

  private channelOptions(): SerializeOptions {
    return { channelTitle: "小红书发现页", channelLink: `${XHS_BASE}/explore` }
  }
}
