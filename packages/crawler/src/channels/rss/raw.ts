/**
 * RawRssChannel — 原生 RSS/Atom feed 直链,fetch 直接透传上游 XML。
 * 无需 serialize(上游已经是 XML),所以不继承 BaseChannel。
 */
import { canonicalSourceKey, type AnyRssSource, type Kind, type RssChannel, type SourceInfo } from "../../index.ts"
import { httpText } from "../../host.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export class RawRssChannel implements RssChannel {
  readonly key: string
  readonly name: string
  readonly kind: Kind
  readonly sourceInfoTpl = [{ key: "url", label: "Feed URL", required: true }]
  readonly defaultUrl?: string

  /** 按参数缓存的 source 实例:相同参数复用同一实例。 */
  private readonly sourceCache = new Map<string, AnyRssSource>()

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

  /** 相同参数返回同一实例。 */
  getSource(info: SourceInfo): AnyRssSource {
    const key = canonicalSourceKey(info)
    let src = this.sourceCache.get(key)
    if (!src) {
      const url = info.url ?? this.defaultUrl ?? ""
      const selfKey = this.key
      src = {
        async fetch() {
          if (!url) throw new Error(`raw rss channel "${selfKey}": url is required`)
          return httpText(url, { "user-agent": UA })
        },
      }
      this.sourceCache.set(key, src)
    }
    return src
  }
}
