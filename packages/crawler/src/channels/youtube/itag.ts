/**
 * itag —— YouTube itag → 格式/编码/清晰度 静态映射表(参照 NewPipe 的 ItagItem)。
 *
 * itag 是 YouTube 特有的格式代号,比从 URL/字段猜类型可靠得多:
 *   - AUDIO     音轨(m4a/opus)
 *   - VIDEO     渐进式(音视频合一,mp4)
 *   - VIDEO_ONLY 纯视频(无音轨,DASH adaptive)
 *
 * 本项目播放栈:WebView2/浏览器原生播 mp4(aac/avc),hls.js 播 m3u8。
 * 因此只维护 H.264 + AAC 的 itag;vp9/av1(opu)初期不支持(编解码器无 H.264 普适)。
 */
export type ItagType = "audio" | "video" | "video_only"

export interface ItagInfo {
  id: number
  type: ItagType
  /** 容器(media-item 的 format 语义):mp4 / webm / m4a / opus。 */
  container: string
  /** 视频编码(avc1=H.264 / vp9 / av01)。音频无。 */
  codec?: string
  /** 音频编码(aac / opus)。视频无。 */
  audioCodec?: string
  /** 分辨率标签(360p/720p/1080p/1440p60)。音频无。 */
  resolution?: string
  /** 高度像素(选流排序用)。 */
  height?: number
  /** 帧率(>30 时分辨率标签带 60)。 */
  fps?: number
}

/**
 * 常用 itag 映射(覆盖本项目能播的 H.264/AAC 子集)。
 * 未知 itag 返回 undefined——上层跳过(不播不代表不能拿,只是不建模)。
 */
const ITAGS: Record<number, ItagInfo> = {
  // ── 渐进式(mp4,音视频合一)────────────────────────────────────
  18: { id: 18, type: "video", container: "mp4", codec: "avc1", audioCodec: "mp4a", resolution: "360p", height: 360, fps: 30 },
  22: { id: 22, type: "video", container: "mp4", codec: "avc1", audioCodec: "mp4a", resolution: "720p", height: 720, fps: 30 },
  37: { id: 37, type: "video", container: "mp4", codec: "avc1", audioCodec: "mp4a", resolution: "1080p", height: 1080, fps: 30 },
  38: { id: 38, type: "video", container: "mp4", codec: "avc1", audioCodec: "mp4a", resolution: "1080p", height: 1080, fps: 30 },

  // ── 纯视频(DASH,无音轨)───────────────────────────────────────
  160: { id: 160, type: "video_only", container: "mp4", codec: "avc1", resolution: "144p", height: 144, fps: 30 },
  133: { id: 133, type: "video_only", container: "mp4", codec: "avc1", resolution: "240p", height: 240, fps: 30 },
  134: { id: 134, type: "video_only", container: "mp4", codec: "avc1", resolution: "360p", height: 360, fps: 30 },
  135: { id: 135, type: "video_only", container: "mp4", codec: "avc1", resolution: "480p", height: 480, fps: 30 },
  136: { id: 136, type: "video_only", container: "mp4", codec: "avc1", resolution: "720p", height: 720, fps: 30 },
  137: { id: 137, type: "video_only", container: "mp4", codec: "avc1", resolution: "1080p", height: 1080, fps: 30 },
  298: { id: 298, type: "video_only", container: "mp4", codec: "avc1", resolution: "720p60", height: 720, fps: 60 },
  299: { id: 299, type: "video_only", container: "mp4", codec: "avc1", resolution: "1080p60", height: 1080, fps: 60 },
  266: { id: 266, type: "video_only", container: "mp4", codec: "avc1", resolution: "2160p", height: 2160, fps: 30 },

  // ── 音频(DASH,无视频)─────────────────────────────────────────
  140: { id: 140, type: "audio", container: "m4a", audioCodec: "mp4a" },
  141: { id: 141, type: "audio", container: "m4a", audioCodec: "mp4a" },
}

/** 查 itag;未知返回 undefined。 */
export function getItag(id: number): ItagInfo | undefined {
  return ITAGS[id]
}

/** 该 itag 是否在播放栈支持范围内(H.264 视频 / aac 音频 / mp4)。 */
export function isPlayableItag(itag: ItagInfo): boolean {
  return (
    itag.type === "video" ||
    itag.type === "video_only" || // 纯视频浏览器能播,但无声——上层决定是否用
    (itag.type === "audio" && itag.audioCodec === "mp4a")
  )
}
