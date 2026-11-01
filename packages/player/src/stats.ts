/**
 * 播放器「统计信息」(stats for nerds)的**纯数据层**。
 *
 * ⚠️ 不 import 引擎 / React / DOM 类型实例 —— node 侧自检直接跑本文件
 * (`hooks/player-stats.check.ts`)，判的是格式化逻辑，不是真实播放。
 */

/** 实际承载播放的引擎。 */
export type EngineKind = "hls" | "flv" | "dash" | "native"

/** 引擎上报的档位信息(由 useMediaStream 维护)。 */
export interface EngineStats {
  engine: EngineKind
  /** 当前档位下标(0-based)与档位总数(HLS / DASH)。 */
  levelIndex?: number
  levelCount?: number
  /** 档位高度(px)与码率(bps)。 */
  height?: number
  bitrate?: number
  /** 编解码器(如 `avc1.640028 / mp4a.40.2`);引擎拿不到时省略。 */
  codecs?: string
  /** 直播延迟(秒);点播 / 引擎不提供时省略。 */
  liveLatency?: number
  /** 当前流的 URL 主机(统计面板「流主机」;blob/本地 MPD 时省略)。 */
  host?: string
}

export function engineLabel(engine: EngineKind): string {
  switch (engine) {
    case "hls":
      return "hls.js"
    case "flv":
      return "flv.js"
    case "dash":
      return "dash.js"
    default:
      return "原生 <video>"
  }
}

/** 从流 URL 取主机名(blob:/data:/空 → undefined)。 */
export function streamHost(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : undefined
  } catch {
    return undefined
  }
}

/**
 * 从 MPD 文本提取**静态**流信息(统计面板的兜底):dash.js 不上报逐 rep 档位时,
 * 流主机/码率/编解码器/高度取自 MPD 本身。
 *
 * 口径与 resolve/utils/mpd.ts 的装配形状一致:每 rep 一段 `<BaseURL>` + SegmentBase。
 * 优先取最高带宽 video rep,没有 video 时退回首个 rep(听模式 = 纯音频 MPD)。
 * 模板型 MPD(无逐 rep BaseURL,如某些 YouTube 清单)只返回 undefined。
 */
export function parseDashSummary(mpd: string | undefined): {
  host?: string
  codecs?: string
  bandwidth?: number
  height?: number
} {
  if (!mpd) return {}
  const reps: { mimeType: string; codecs?: string; bandwidth?: number; height?: number; baseUrl?: string }[] = []
  const repRe = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g
  let m: RegExpExecArray | null
  while ((m = repRe.exec(mpd))) {
    const attrs = m[1]
    const base = /<BaseURL>([\s\S]*?)<\/BaseURL>/.exec(m[2])?.[1]?.trim()
    reps.push({
      mimeType: attrOf(attrs, "mimeType") ?? "",
      codecs: attrOf(attrs, "codecs"),
      bandwidth: Number(attrOf(attrs, "bandwidth") ?? 0) || undefined,
      height: Number(attrOf(attrs, "height") ?? 0) || undefined,
      baseUrl: base ? base.replace(/&amp;/g, "&") : undefined,
    })
  }
  if (!reps.length) return {}
  const pick =
    reps.filter((r) => r.mimeType.startsWith("video")).sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0] ??
    reps[0]
  return { host: streamHost(pick.baseUrl), codecs: pick.codecs, bandwidth: pick.bandwidth, height: pick.height }
}

/** MPD 属性批量匹配(`bandwidth` 含 `width`,必须锚定属性名起点)。 */
function attrOf(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|[\\s"])${name}=("[^"]*"|[^,\\s]+)`).exec(attrs)
  if (!m) return undefined
  return m[1].startsWith('"') ? m[1].slice(1, -1) : m[1]
}

/** bps → 人类可读;0 / undefined 返回 "—"。 */
export function formatBitrate(bps?: number): string {
  if (!bps || bps <= 0) return "—"
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

/** 档位摘要:「2/4 · 1080p · 4.5 Mbps」;无信息返回 "—"。 */
export function formatLevel(stats: EngineStats): string {
  const parts: string[] = []
  if (stats.levelIndex !== undefined && stats.levelCount) {
    parts.push(`${stats.levelIndex + 1}/${stats.levelCount}`)
  }
  if (stats.height) parts.push(`${stats.height}p`)
  const br = formatBitrate(stats.bitrate)
  if (br !== "—") parts.push(br)
  return parts.length ? parts.join(" · ") : "—"
}

/** 缓冲末尾离当前播放点多远(秒);当前点不在任何缓冲段内返回 0。 */
export function bufferedAhead(
  ranges: { length: number; start(i: number): number; end(i: number): number },
  currentTime: number,
): number {
  for (let i = ranges.length - 1; i >= 0; i--) {
    const start = ranges.start(i)
    const end = ranges.end(i)
    if (currentTime >= start && currentTime <= end) return Math.max(0, end - currentTime)
  }
  return 0
}

/** 字节数 → 人类可读(近似值,base64 字符串按字符数估)。 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—"
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** 帧率摘要;无有效值返回 "—"。 */
export function formatFps(fps: number | undefined): string {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return "—"
  return `${fps.toFixed(2)} fps`
}

/** 音量摘要:「80%」/「80%（静音）」。 */
export function formatVolume(volume: number, muted: boolean): string {
  const pct = `${Math.round(Math.max(0, Math.min(1, volume)) * 100)}%`
  return muted ? `${pct}（静音）` : pct
}

/** 丢帧摘要:「3 / 1200 (0.3%)」;无帧统计返回 "—"。 */
export function formatDropped(dropped: number, total: number): string {
  if (!total) return "—"
  return `${dropped} / ${total} (${((dropped / total) * 100).toFixed(1)}%)`
}
