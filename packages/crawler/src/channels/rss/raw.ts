/**
 * RawRssChannel — 原生 RSS/Atom feed 直链,fetch 直接透传上游 XML(无需 serialize)。
 *
 * kind 是构造时传入的宽 `Kind`(上游 feed 类型运行时才知道),只用于产出描述
 * (deserialize 兜底),**不决定能力**。是否实现 VideoPlayable 由构造参数
 * `video: boolean` 显式声明——kind 与能力正交(见 index.ts 注释)。
 *
 *   - video 直链(如 YouTube 官方 RSS):声明 video=true,resolvePlay 返回
 *     `format:"web"` 页面流(上游只有 watch 链接,无可播直链);
 *   - 非 video:不声明能力,source 仅 { fetch }——`isRssVideoSource` 返回 false,
 *     消费侧如实知道「无可播放力」(旧实现对非 video 挂了抛错的 resolveLivePlay,
 *     反而让谓词谎报 true;现在如实没有更诚实)。
 */
import type { Kind, RssChannel, RssSource, SourceInfo, Stream, VideoPlayable } from "../../index.ts"
import { httpText } from "../../host.ts"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export class RawRssChannel implements RssChannel {
  readonly key: string
  readonly name: string
  readonly kind: Kind
  readonly sourceInfoTpl = [{ key: "url", label: "Feed URL", required: true }]
  readonly defaultUrl?: string
  /** 该直链 feed 是否提供视频可播放力(决定 source 是否 implements VideoPlayable)。与 kind 正交。 */
  private readonly video: boolean

  constructor(key: string, name: string, kind: Kind, defaultUrl?: string, video = false) {
    this.key = key
    this.name = name
    this.kind = kind
    this.defaultUrl = defaultUrl
    this.video = video
  }

  /** 内置直链自带默认可订阅参数。 */
  get defaultInfo(): SourceInfo | undefined {
    return this.defaultUrl ? { url: this.defaultUrl } : undefined
  }

  /**
   * video 直链:implements VideoPlayable,resolvePlay 返回 `format:"web"` 页面流。
   * 否则仅返回 { fetch }——不声明能力。
   */
  getSource(info: SourceInfo): RssSource {
    if (!this.video) return { fetch: () => this.fetchXml(info) }
    const source: RssSource & VideoPlayable = {
      fetch: () => this.fetchXml(info),
      resolvePlay: (itemId) => this.resolvePlayImpl(itemId),
    }
    return source
  }

  /** 懒解析可播流:返回 `format:"web"` 页面流(item 链接)。 */
  private async resolvePlayImpl(itemId: string): Promise<Stream[]> {
    return [{ url: itemId, format: "web", headers: { "user-agent": UA } }]
  }

  private async fetchXml(info: SourceInfo): Promise<string> {
    const url = info.url ?? this.defaultUrl ?? ""
    if (!url) throw new Error(`raw rss channel "${this.key}": url is required`)
    return httpText(url, { "user-agent": UA })
  }
}
