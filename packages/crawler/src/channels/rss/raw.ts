/**
 * RawRssChannel — 原生 RSS/Atom feed 直链,fetch 直接透传上游 XML。
 * 无需 serialize(上游已经是 XML),所以用 createSource 只做直通、不做装配。
 */
import type { Kind, RssChannel, SourceInfo } from "../../index.ts"
import { createSource } from "../factory.ts"
import { httpText } from "../../host.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export class RawRssChannel implements RssChannel {
  readonly key: string
  readonly name: string
  readonly kind: Kind
  readonly sourceInfoTpl = [{ key: "url", label: "Feed URL", required: true }]
  readonly defaultUrl?: string
  /** 无状态纯函数:每次 getSource 返回新 RssSource 实例(唯一性归 core 编排)。 */
  getSource = createSource((info) => this.fetchXml(info))

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

  private async fetchXml(info: SourceInfo): Promise<string> {
    const url = info.url ?? this.defaultUrl ?? ""
    if (!url) throw new Error(`raw rss channel "${this.key}": url is required`)
    return httpText(url, { "user-agent": UA })
  }
}
