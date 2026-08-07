/**
 * RawRssChannel — 原生 RSS/Atom feed 直链,fetch 直接透传上游 XML。
 * 无需 serialize(上游已经是 XML),所以用 createSource 只做直通、不做装配。
 *
 * kind 是构造时传入的宽 `Kind`(上游 feed 类型运行时才知道)。
 * 懒解析能力随 kind 装配进 source:
 *   - kind=video 的直链(如 YouTube 官方 RSS):resolvePlay 返回 `format:"web"`
 *     页面流(上游只有 watch 链接,无可播直链);
 *   - 其它 kind / 直播:resolveLivePlay 抛清晰错误(直传 feed 无可播直链)。
 */
import type { AnyRssSource, Kind, RssChannel, SourceInfo, Stream } from "../../index.ts"
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
  readonly getSource: (info: SourceInfo) => AnyRssSource

  constructor(key: string, name: string, kind: Kind, defaultUrl?: string) {
    this.key = key
    this.name = name
    this.kind = kind
    this.defaultUrl = defaultUrl
    // 懒解析能力随 kind 装配进 source(video 直链 → resolvePlay 页面流;其它 → 抛错)。
    this.getSource = createSource(
      (info) => this.fetchXml(info),
      kind === "video"
        ? { resolvePlay: (itemId: string) => this.resolvePlayImpl(itemId) }
        : { resolveLivePlay: () => Promise.reject(new Error(`raw rss channel "${this.key}" has no live stream`)) },
    )
  }

  /** 内置直链自带默认可订阅参数。 */
  get defaultInfo(): SourceInfo | undefined {
    return this.defaultUrl ? { url: this.defaultUrl } : undefined
  }

  /** 懒解析可播流:kind=video 时返回 `format:"web"` 页面流(item 链接)。 */
  private async resolvePlayImpl(itemId: string): Promise<Stream[]> {
    return [{ url: itemId, format: "web", headers: { "user-agent": UA } }]
  }

  private async fetchXml(info: SourceInfo): Promise<string> {
    const url = info.url ?? this.defaultUrl ?? ""
    if (!url) throw new Error(`raw rss channel "${this.key}": url is required`)
    return httpText(url, { "user-agent": UA })
  }
}
