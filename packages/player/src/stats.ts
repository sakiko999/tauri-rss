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

/** 丢帧摘要:「3 / 1200 (0.3%)」;无帧统计返回 "—"。 */
export function formatDropped(dropped: number, total: number): string {
  if (!total) return "—"
  return `${dropped} / ${total} (${((dropped / total) * 100).toFixed(1)}%)`
}
