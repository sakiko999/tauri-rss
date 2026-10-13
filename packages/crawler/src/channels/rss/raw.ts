/**
 * RawRssChannel — 原生 RSS/Atom feed 直链,fetch 直接透传上游 XML(无需 serialize)。
 *
 * 能力抽离:只输出上游 XML 基础信息(与 rsshub 一致)。不再声明 VideoPlayable
 * (video 直链的 `format:"web"` 页面流兜底已在 crawler/resolver 之外移除——
 * 播放统一走 resolver by-url,上游只有 watch 链接的 feed 本无可播直链)。
 *
 * kind 是构造时传入的宽 `Kind`(上游 feed 类型运行时才知道),只用于产出描述
 * (deserialize 兜底)。
 */
import type { Item } from "@tauri-playground/xml"
import type { Kind, RssChannel, RssSource, SourceInfo, ItemDetailSource } from "../../index.ts"
import { httpText } from "@tauri-playground/resolve"
import { DESKTOP_CHROME_UA } from "@tauri-playground/resolve"
import { extractArticle, visibleTextLength } from "./extract.ts"

const UA = DESKTOP_CHROME_UA

/** 列表正文**可见文本**达到此长度即视作「feed 已带全文」,不再抓原文(避免把好 HTML
 *  降级成纯文本)。⚠️ 按可见文本算,不按原始 HTML —— 图片密集的短摘要(<a><img></a>)
 *  标签一堆、可见字寥寥,按 HTML 长度会虚高而误跳过补全。 */
const FULLTEXT_HINT = 800

export class RawRssChannel implements RssChannel {
  readonly key: string
  readonly name: string
  readonly kind: Kind
  readonly sourceInfoTpl = [{ key: "url", label: "Feed URL", required: true }]
  readonly defaultUrl?: string

  constructor(key: string, name: string, kind: Kind, defaultUrl?: string) {
    this.key = key
    this.name = name
    this.kind = kind
    this.defaultUrl = defaultUrl
  }

  /** 内置直链自带默认可订阅参数。 */
  get defaultInfo(): SourceInfo | undefined {
    return this.defaultUrl ? { url: this.defaultUrl } : undefined
  }

  /** 纯 fetch:透传上游 XML + 单条详情(抓原文页提正文;feed 已带全文则原样返回)。 */
  getSource(info: SourceInfo): RssSource & ItemDetailSource {
    return { fetch: () => this.fetchXml(info), resolveDetail: (item) => this.resolveDetail(item) }
  }

  private async fetchXml(info: SourceInfo): Promise<string> {
    const url = info.url ?? this.defaultUrl ?? ""
    if (!url) throw new Error(`raw rss channel "${this.key}": url is required`)
    return httpText(url, { "user-agent": UA })
  }

  /**
   * 单条详情补全:**只对 article** 抓 url 原文页提取正文纯文本 + 头图。
   * - feed 本身已带全文(content 长) → 原样返回(不把好 HTML 降级成纯文本);
   * - 提取失败(SPA / 反爬占位页) → 返回 null,调用方回退原摘要(不空窗);
   * - social/video/live **不碰**:social 源(weibo/bili)列表数据已完整,原文页提取纯文本
   *   反而更差;video/live 的 url 是播放页不是文章。
   */
  private async resolveDetail(item: Item): Promise<Item | null> {
    if (item.kind !== "article") return item
    if (visibleTextLength(item.content ?? "") >= FULLTEXT_HINT) return item
    if (!item.url || !/^https?:/i.test(item.url)) return item
    let html: string
    try {
      html = await httpText(item.url, { "user-agent": UA })
    } catch {
      return null // 抓取失败(网络/反爬)→ 调用方回退原摘要
    }
    const ex = extractArticle(html, item.url)
    if (!ex) return null
    return { ...item, content: ex.text, contentFormat: "text", thumbnail: item.thumbnail ?? ex.image }
  }
}