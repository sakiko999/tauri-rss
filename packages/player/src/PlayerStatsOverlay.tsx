/**
 * PlayerStatsOverlay —— 播放器「统计信息」(stats for nerds)。
 *
 * 对标 YouTube 右键 →「统计信息」的字段分组:
 *   - **引擎侧**(`EngineStats`,useMediaStream 上报):引擎、档位/码率、编解码器、直播延迟;
 *   - **元素侧**(每 500ms 轮询 `<video>`):分辨率、帧率、丢帧、缓冲健康、音量、播放速率;
 *   - **宿主侧**:最近一次 HTTP 端到端耗时(governor 统一计时,含媒体分片)与
 *     进程内累计出站流量/请求数。
 *
 * ⚠️ 面板 `pointer-events-none`:不挡画面点击/控件;内容只读。
 * ⚠️ 不用桌面端 StateBlock/Menu:player 是独立包,不能反向依赖 desktop。
 */
import { useEffect, useRef, useState } from "react"
import {
  bufferedAhead,
  engineLabel,
  formatBytes,
  formatDropped,
  formatFps,
  formatLevel,
  formatVolume,
  type EngineStats,
} from "./stats.ts"

interface LiveInfo {
  resolution: string
  fps: string
  bufferAhead: number
  dropped: string
  audio: string
  volume: string
  rate: string
  latency: string
  network: string
}

/** 宿主侧统计(governor;未注入 net 时返回占位)。 */
function readHost(): { latency: string; network: string } {
  try {
    const stats = globalThis.appHost?.net?.governorStats?.()
    const l = stats?.lastLatency
    const net = stats?.network
    return {
      latency: l ? `${l.ms} ms（${l.platform}）` : "—",
      network: net && net.requests > 0 ? `≈ ${formatBytes(net.bytes)} / ${net.requests} 次` : "—",
    }
  } catch {
    return { latency: "—", network: "—" }
  }
}

function readAudio(video: HTMLVideoElement): string {
  // Chromium 未实现 audioTracks(只有 Safari 有),退回解码字节数判断「有没有声音」。
  const tracks = (video as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks
  if (tracks && tracks.length) return `${tracks.length} 条`
  const decoded = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount
  return decoded && decoded > 0 ? "有" : "—"
}

/**
 * 读一次实时状态。帧率用相邻两次采样的 `totalVideoFrames` 差计算
 * (首帧没有参照,显示 "—";暂停时增量为 0 → 0 fps)。
 */
function readLive(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  prevFrame: React.RefObject<{ frames: number; at: number } | null>,
): LiveInfo | null {
  const v = videoRef.current
  if (!v) return null
  const q = v.getVideoPlaybackQuality?.()
  const now = performance.now()
  let fps: number | undefined
  if (q && prevFrame.current) {
    const dt = (now - prevFrame.current.at) / 1000
    if (dt > 0.2) fps = (q.totalVideoFrames - prevFrame.current.frames) / dt
  }
  if (q) prevFrame.current = { frames: q.totalVideoFrames, at: now }
  const host = readHost()
  return {
    resolution: v.videoWidth && v.videoHeight ? `${v.videoWidth}×${v.videoHeight}` : "—",
    fps: formatFps(fps),
    bufferAhead: bufferedAhead(v.buffered, v.currentTime),
    dropped: q ? formatDropped(q.droppedVideoFrames, q.totalVideoFrames) : "—",
    audio: readAudio(v),
    volume: formatVolume(v.volume, v.muted),
    rate: `${v.playbackRate.toFixed(2)}×`,
    latency: host.latency,
    network: host.network,
  }
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-white/50">{label}</span>
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
  const prevFrame = useRef<{ frames: number; at: number } | null>(null)

  useEffect(() => {
    // 立即读一次(打开面板就应有数据),之后 500ms 刷新。
    setLive(readLive(videoRef, prevFrame))
    const timer = window.setInterval(() => setLive(readLive(videoRef, prevFrame)), 500)
    return () => window.clearInterval(timer)
  }, [videoRef])

  // 「当前 / 最佳分辨率」:元素实际解码尺寸 / 引擎声明的档位高度。
  const resolution = live ? `${live.resolution}${stats?.height ? ` / ${stats.height}p` : ""}` : "—"

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-20 max-w-[min(24rem,90%)] rounded bg-black/80 p-2 font-mono text-[11px] leading-5 text-white/90 shadow-lg">
      <div className="mb-1 text-xs font-semibold text-white">统计信息</div>
      <Line label="引擎" value={stats ? engineLabel(stats.engine) : "—"} />
      <Line label="档位" value={stats ? formatLevel(stats) : "—"} />
      {quality ? <Line label="清晰度" value={quality} /> : null}
      <Line label="分辨率" value={resolution} />
      <Line label="帧率" value={live?.fps ?? "—"} />
      <Line label="丢帧" value={live?.dropped ?? "—"} />
      <Line label="缓冲健康" value={live ? `${live.bufferAhead.toFixed(1)} s` : "—"} />
      {stats?.liveLatency !== undefined && stats.liveLatency > 0 ? (
        <Line label="直播延迟" value={`${stats.liveLatency.toFixed(1)} s`} />
      ) : null}
      <Line label="编解码器" value={stats?.codecs || "—"} />
      <Line label="音轨" value={live?.audio ?? "—"} />
      <Line label="音量" value={live?.volume ?? "—"} />
      <Line label="播放速率" value={live?.rate ?? "—"} />
      <Line label="宿主隧道" value={live?.latency ?? "—"} />
      <Line label="网络活动" value={live?.network ?? "—"} />
    </div>
  )
}
