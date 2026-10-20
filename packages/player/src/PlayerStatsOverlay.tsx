/**
 * PlayerStatsOverlay —— 播放器「统计信息」(stats for nerds)。
 *
 * 由 VideoShell 的右键菜单打开。分两类数据:
 *   - **引擎侧**(`EngineStats`,由 useMediaStream 上报):引擎、档位下标/总数、高度、码率;
 *   - **元素侧**(每 500ms 轮询 `<video>`):分辨率、缓冲余量、丢帧、音轨;
 *   - **宿主侧**:最近一次 HTTP 端到端耗时(`appHost.net.governorStats().lastLatency`,
 *     由 governor 统一计时,含媒体分片;覆盖 Rust 隧道与浏览器 fetch 两种后端)。
 *
 * ⚠️ 面板 `pointer-events-none`:不挡画面点击/控件;内容只读。
 * ⚠️ 不用桌面端 StateBlock/Menu:player 是独立包,不能反向依赖 desktop。
 */
import { useEffect, useState } from "react"
import { bufferedAhead, engineLabel, formatDropped, formatLevel, type EngineStats } from "./stats.ts"

interface LiveInfo {
  resolution: string
  bufferAhead: number
  dropped: string
  audio: string
  latency: string
}

/** 最近一次 HTTP 耗时(governor 侧记录;宿主未注入 net 时返回 "—")。 */
function readLatency(): string {
  try {
    const l = globalThis.appHost?.net?.governorStats?.().lastLatency
    return l ? `${l.ms} ms（${l.platform}）` : "—"
  } catch {
    return "—"
  }
}

function readAudio(video: HTMLVideoElement): string {
  // Chromium 未实现 audioTracks(只有 Safari 有),退回解码字节数判断「有没有声音」。
  const tracks = (video as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks
  if (tracks && tracks.length) return `${tracks.length} 条`
  const decoded = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number })
    .webkitAudioDecodedByteCount
  return decoded && decoded > 0 ? "有" : "—"
}

function readLive(videoRef: React.RefObject<HTMLVideoElement | null>): LiveInfo | null {
  const v = videoRef.current
  if (!v) return null
  const q = v.getVideoPlaybackQuality?.()
  return {
    resolution: v.videoWidth && v.videoHeight ? `${v.videoWidth}×${v.videoHeight}` : "—",
    bufferAhead: bufferedAhead(v.buffered, v.currentTime),
    dropped: q ? formatDropped(q.droppedVideoFrames, q.totalVideoFrames) : "—",
    audio: readAudio(v),
    latency: readLatency(),
  }
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-white/50">{label}</span>
      <span className="min-w-0 break-all text-white/90">{value}</span>
    </div>
  )
}

export function PlayerStatsOverlay({
  videoRef,
  stats,
  quality,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  stats?: EngineStats | null
  /** 当前选中的清晰度名(来自 stream.quality;没有则显示档位信息)。 */
  quality?: string
}) {
  const [live, setLive] = useState<LiveInfo | null>(null)

  useEffect(() => {
    // 立即读一次(打开面板就应有数据),之后 500ms 刷新。
    setLive(readLive(videoRef))
    const timer = window.setInterval(() => setLive(readLive(videoRef)), 500)
    return () => window.clearInterval(timer)
  }, [videoRef])

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-20 max-w-[min(22rem,85%)] rounded bg-black/80 p-2 font-mono text-[11px] leading-5 text-white/90 shadow-lg">
      <div className="mb-1 text-xs font-semibold text-white">统计信息</div>
      <Line label="引擎" value={stats ? engineLabel(stats.engine) : "—"} />
      <Line label="档位" value={stats ? formatLevel(stats) : "—"} />
      {quality ? <Line label="清晰度" value={quality} /> : null}
      <Line label="分辨率" value={live?.resolution ?? "—"} />
      <Line label="缓冲" value={live ? `+${live.bufferAhead.toFixed(1)}s` : "—"} />
      <Line label="丢帧" value={live?.dropped ?? "—"} />
      <Line label="音轨" value={live?.audio ?? "—"} />
      <Line label="宿主隧道" value={live?.latency ?? "—"} />
    </div>
  )
}
