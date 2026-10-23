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

export type Kind = "article" | "social" | "video" | "audio" | "live" | "category"

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
  /** crawler 内部溯源(哪个 channel 产出);不过 XML(core 的 guid 用 `id`)。 */
  sourceId: string
  kind: Kind
  title: string
  url?: string
  summary?: string
  thumbnail?: string
  author?: Author
  publishedAt?: number
  fetchedAt: number
  /** channel 原始 payload(crawler 内部再解析/诊断用);不过 XML,core 不消费。 */
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
  /**
   * 实况图（Live Photo）的短视频直链；静态图 `url` 就是它的 poster。
   * 小红书：详情 `imageList[i].livePhoto === true` + `stream.<codec>[0].masterUrl`（实测 codec 是 EF4，
   * 别写死 h264）；微博：`pics[].type === "livephoto"` + `videoSrc`（302 包装器，稳定）。
   * 只存主址。serialize 会写到 media:content 的 `@tpl:liveVideo`，deserialize 对称读回；
   * 小红书详情结果也会直接给 UI。失效就重新解析详情。
   */
  liveVideo?: string
}

export interface Social extends Base {
  kind: "social"
  content: string
  /** 图片列表;每个可带宽高。 */
  images?: SocialImage[]
  likes?: number
  reposts?: number
  replies?: number
  isLiked?: boolean
  /** 小红书笔记详情开关(列表项 xsec_token)。匿名 GET /explore/<id>?xsec_token= 才返回 noteDetailMap。 */
  xsecToken?: string
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
export type LivePlatformId = "bilibili" | "douyu" | "huya" | "douyin" | "youtube" | "twitch"

export interface Live extends Base {
  kind: "live"
  platform: LivePlatformId
  roomId: string
  liveStatus: LiveStatus
  online?: number
  isRecord?: boolean
  introduction?: string
  showTime?: string
  /** ⚠️ 可播流/档位字段一律不在此:`playUrls`/`playHeaders`/`quality` 曾全仓零读
   *  写已删,直播间可播流统一由 `resolveLivePlay` 按 url 懒解析。勿再引入。 */
}

/**
 * 分类目录条目（分区列表订阅的内容）。
 *
 * 它本身**不可播/不可读**：`categoryChannel` + `categoryInfo` 指向一个渠道实例
 * （如 `twitch:category` + `{category:"just-chatting"}`），UI 点开时用
 * `previewChannel` 取该分区的真实内容，并可按同一份参数订阅。
 */
export interface Category extends Base {
  kind: "category"
  /** 点进去预览/订阅的目标渠道 key（如 twitch:category、live:douyin:category）。 */
  categoryChannel: string
  /** 直接传给目标渠道的完整参数（抖音必须同时带 partition + partitionType）。 */
  categoryInfo: Record<string, string>
}

export type Item = Article | Social | Video | Audio | Live | Category
