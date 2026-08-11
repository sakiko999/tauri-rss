/**
 * Item — crawler 的 channel 内部中间态,最终由 `serializeFeed` 序列化成
 * RSS 2.0(+ `tpl:` 扩展)XML。
 *
 * 它不是应用渲染模型(没有 unread/starred/subscriptionId——那些由下游 core
 * 注入),是 channel 把上游数据(API JSON / 解析后的 RSS)归一成的、贴 XML
 * 形态的协议对象。原生 RSS channel 可以跳过它,直接 fetch 透传上游 XML。
 *
 * `tpl:` 扩展承载标准 RSS 装不下的字段(live 状态 / 多清晰度可播流 /
 * 视频附件 / 社交互动数 …),标准 RSS 阅读器忽略它,本项目自定义解析器读全。
 */

export type Kind = "article" | "social" | "video" | "audio" | "live"

export interface Author {
  name: string
  avatar?: string
  handle?: string
}

export type StreamingFormat = "hls" | "dash" | "progressive"

export interface Stream {
  url: string
  format?: string
  headers?: Record<string, string>
  /** 档位名(直播多清晰度流,如 douyu 的「原画2K60/蓝光8M」;单流无)。 */
  quality?: string
  /**
   * 档位原始值(直播平台切档参数,如 douyu 的 rate)。存 headers 同款理由:
   * 切档重解析时按它重发请求。UI 层透传,不解析语义。
   */
  rate?: number
  /**
   * DASH manifest(MPD XML 字符串)——B 站视频音视频分离(video+audio 两轨),
   * 需合成播放。crawler 把 playurl 的 dash.video/audio 构造成 MPD 存这里,
   * 播放器(dash.js)用 `format:"dash"` + dashManifest 播。单流无。
   */
  dashManifest?: string
}

export type AttachmentKind = "image" | "video" | "audio" | "live"

export interface Attachment {
  kind: AttachmentKind
  url: string
  title?: string
  mimeType?: string
  poster?: string
  width?: number
  height?: number
  aspectRatio?: number
  durationSec?: number
  bitrate?: number
  streamingFormat?: StreamingFormat
  isLiveNow?: boolean
  lang?: string
}

/** 公共字段(channel 产出时填写;不带 app 层语义)。 */
export interface Base {
  id: string
  sourceId: string
  kind: Kind
  title: string
  url?: string
  summary?: string
  thumbnail?: string
  author?: Author
  publishedAt?: number
  fetchedAt: number
  raw?: unknown
  mimeType?: string
  poster?: string
  width?: number
  height?: number
  aspectRatio?: number
  durationSec?: number
  bitrate?: number
  streamingFormat?: StreamingFormat
  isLiveNow?: boolean
  lang?: string
}

export interface Article extends Base {
  kind: "article"
  content?: string
  contentFormat?: "html" | "markdown" | "text"
  media?: Attachment[]
}

/** 社交图片,带可选宽高(瀑布流 span 用)。宽高未知时省略,UI 退化默认比例。 */
export interface SocialImage {
  url: string
  width?: number
  height?: number
}

export interface Social extends Base {
  kind: "social"
  content: string
  /** 图片列表;每个可带宽高(协议向后兼容纯文本 URL)。 */
  images?: (string | SocialImage)[]
  likes?: number
  reposts?: number
  replies?: number
  isLiked?: boolean
}

export interface Video extends Base {
  kind: "video"
  duration?: number
  stream?: Stream
  channel?: { name: string; avatar?: string }
}

export interface Audio extends Base {
  kind: "audio"
  duration?: number
  artist?: string
  album?: string
  stream?: Stream
}

export type LiveStatus = "live" | "offline" | "unknown"
export type LivePlatformId = "bilibili" | "douyu" | "huya" | "douyin"

export interface Live extends Base {
  kind: "live"
  platform: LivePlatformId
  roomId: string
  liveStatus: LiveStatus
  online?: number
  isRecord?: boolean
  introduction?: string
  notice?: string
  showTime?: string
  /** 懒解析填充(`resolveLivePlay`),带 expiry 签名,过期须重解析。 */
  playUrls?: string[]
  playHeaders?: Record<string, string>
  quality?: string
  playUrlsExpiresAt?: number
}

export type Item = Article | Social | Video | Audio | Live
