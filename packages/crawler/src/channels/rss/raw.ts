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
import type { Kind, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { httpText } from "../../host.ts"
import { DESKTOP_CHROME_UA } from "../../utils/ua.ts"

const UA = DESKTOP_CHROME_UA

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

  /** 纯 fetch:透传上游 XML。 */
  getSource(info: SourceInfo): RssSource {
    return { fetch: () => this.fetchXml(info) }
  }

  private async fetchXml(info: SourceInfo): Promise<string> {
    const url = info.url ?? this.defaultUrl ?? ""
    if (!url) throw new Error(`raw rss channel "${this.key}": url is required`)
    return httpText(url, { "user-agent": UA })
  }
}