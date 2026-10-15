/**
 * 流的**格式判据** —— 纯函数,零依赖。
 *
 * ⚠️ 与 `useMediaStream.ts` 分开的原因:那个文件 import 了 hls.js / flv.js / dashjs,
 * 模块一加载就要 `window`(dashjs 在 ESM 顶层就摸 window)。判据本身是纯的,
 * 跟着它一起进不了 node 侧的自检(`useStreamSelection.check.ts` 曾因此直接崩)。
 * 需要判据的地方(useStreamSelection / 测试)从此引这里,不引引擎模块。
 */
import type { MediaStream } from "@tauri-playground/core"

export function isHlsStream(stream: MediaStream): boolean {
  return stream.format === "hls" || /\.m3u8(\?|#|$)/i.test(stream.url)
}

/** 仅 http-flv(douyu 等);真 `rtmp://` 协议 flv.js 也播不了,故要求 http(s)。 */
export function isFlvStream(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  const isHttpFlv = /^https?:\/\//i.test(stream.url) && /\.flv(\?|#|$)/i.test(stream.url)
  return f === "flv" && isHttpFlv
}

/** 是否为 DASH 流(B 站视频音视频分离,带 dashManifest 拼的 MPD → dash.js 合成播放)。 */
export function isDashStream(stream: MediaStream): boolean {
  return stream.format === "dash"
}

/** 渐进式视频(mp4/webm)→ 原生 <video>。
 *  ⚠️ 不含 ogg:`.ogg` 在本仓库是**音频**(播客);ogg 同属两个判据会让视频分支抢先
 *  命中音频流 → <video> 播不了 → 报错。ogg 归 isProgressiveAudio,两者互斥。 */
export function isProgressiveVideo(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  if (f === "mp4" || f === "webm") return true
  return /\.(mp4|webm)(\?|#|$)/i.test(stream.url)
}

/** 渐进式音频(mp3/aac/ogg)→ 原生 <audio>。 */
export function isProgressiveAudio(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  if (f === "mp3" || f === "aac" || f === "ogg") return true
  return /\.(mp3|aac|ogg)(\?|#|$)/i.test(stream.url)
}

/** 真 rtmp 协议(rtmp://),浏览器 / flv.js 都播不了。 */
export function isRtmp(stream: MediaStream): boolean {
  return /^rtmp:\/\//i.test(stream.url)
}

/** 流媒体驱动(hls/flv/dash)→ useMediaStream 接管,非原生 src。 */
export function isStreamingStream(stream: MediaStream): boolean {
  return isHlsStream(stream) || isFlvStream(stream) || isDashStream(stream)
}

/**
 * 默认选流 —— **取 `streams[0]`**。
 *
 * crawler 契约:各 channel 产流处保证数组**最高清晰度排最前**(bili/youtube/douyin/
 * huya 显式按 rate 降序;douyu 保留服务端 multirates 顺序 —— 它的 rate 是档位 ID
 * 不是清晰度等级)。player 因此**不做二次排序**,取首档即可。
 *
 * ⚠️ 曾经按**格式族**挑(`find(isProgressiveVideo) ?? find(hls) ?? find(flv) ?? [0]`),
 * 以为「原生可播的最稳」。那会在首档不是渐进式、后面却有的时候**静默降画质**:
 * 首档 1080p dash 后面若跟一条 360p mp4,`find(isProgressiveVideo)` 就会跳过首档
 * 去取 360p;huya/douyu 出现 hls/flv 混排时同理。契约既然保证了顺序就不该再挑拣。
 */
export function pickDefaultStream(streams: MediaStream[]): MediaStream | undefined {
  return streams[0]
}
