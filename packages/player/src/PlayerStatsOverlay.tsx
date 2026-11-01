/**
 * PlayerStatsOverlay —— 播放器「统计信息」(stats for nerds,B 站右键同名面板)。
 *
 * 视觉对齐 B 站:左上角半透明黑面板、label/value 两列、等宽数字,分三组:
 *   - **会话**:引擎、档位、清晰度、流主机、会话时长;
 *   - **画面**:分辨率、帧率、丢帧、编解码器、播放位置、缓冲健康;
 *   - **音频/网络**:音轨、音量、播放速率、直播延迟、宿主隧道、累计流量。
 *
 * 数据来源:`EngineStats`(useMediaStream 上报)+ 每 500ms 轮询 `<video>` 的实时值
 * + 宿主 governor 统计。纯只读,面板 `pointer-events-none` 不挡画面。
 * ⚠️ 不用桌面端 StateBlock/Menu:player 是独立包,不能反向依赖 desktop。
 */

import { useEffect, useRef, useState } from "react"

import {
  bufferedAhead,
  engineLabel,
  type EngineStats,
  formatBitrate,
  formatBytes,
  formatDropped,
  formatFps,
  formatLevel,
  formatVolume,
} from "./stats.ts"
import { formatTime } from "./utils/time.ts"

interface LiveInfo {
  resolution: string
  fps: string
  bufferAhead: number
  dropped: string
  audio: string
  volume: string
  rate: string
  position: string
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
  const dur = Number.isFinite(v.duration) ? v.duration : 0
  return {
    resolution: v.videoWidth && v.videoHeight ? `${v.videoWidth}×${v.videoHeight}` : "—",
    fps: formatFps(fps),
    bufferAhead: bufferedAhead(v.buffered, v.currentTime),
    dropped: q ? formatDropped(q.droppedVideoFrames, q.totalVideoFrames) : "—",
    audio: readAudio(v),
    volume: formatVolume(v.volume, v.muted),
    rate: `${v.playbackRate.toFixed(2)}×`,
    position: dur > 0 ? `${formatTime(v.currentTime)} / ${formatTime(dur)}` : formatTime(v.currentTime),
    latency: host.latency,
    network: host.network,
  }
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 leading-5">
      <span className="w-14 shrink-0 text-white/50">{label}</span>
      <span className="min-w-0 break-all text-white/90 tabular-nums">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1 first:mt-0">
      <div className="mt-1.5 mb-0.5 text-[10px] font-medium tracking-wider text-white/40 uppercase">{title}</div>
      {children}
    </div>
  )
}

export function PlayerStatsOverlay({
  videoRef,
  stats,
  sessionStartedAt,
  quality,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  stats?: EngineStats | null
  /** 播放会话起点(performance.now());缺省退回面板挂载时刻。 */
  sessionStartedAt?: number
  /** 当前选中的清晰度名(来自 stream.quality;没有则显示档位信息)。 */
  quality?: string
}) {
  const [live, setLive] = useState<LiveInfo | null>(null)
  const [sessionSec, setSessionSec] = useState(0)
  const prevFrame = useRef<{ frames: number; at: number } | null>(null)

  useEffect(() => {
    // 立即读一次(打开面板就应有数据),之后 500ms 刷新;会话时长同频刷新。
    // ⚠️ 会话时长从**播放会话起点**算,不是面板打开时刻 —— 否则「刚打开就 0:01」。
    const startedAt = sessionStartedAt ?? performance.now()
    setLive(readLive(videoRef, prevFrame))
    const timer = window.setInterval(() => {
      setLive(readLive(videoRef, prevFrame))
      setSessionSec((performance.now() - startedAt) / 1000)
    }, 500)
    return () => window.clearInterval(timer)
  }, [videoRef, sessionStartedAt])

  // 「当前 / 最佳分辨率」:元素实际解码尺寸 / 引擎声明的档位高度。
  const resolution = live ? `${live.resolution}${stats?.height ? ` / ${stats.height}p` : ""}` : "—"

  return (
    <div className="pointer-events-none absolute top-2 left-2 z-20 max-w-[min(26rem,90%)] rounded-[2px] bg-[#141414]/90 p-2.5 font-mono text-[11px] text-white/90">
      <div className="mb-1 text-xs font-semibold text-white">统计信息</div>
      <Section title="会话">
        <Line label="引擎" value={stats ? engineLabel(stats.engine) : "—"} />
        <Line label="档位" value={stats ? formatLevel(stats) : "—"} />
        {quality ? <Line label="清晰度" value={quality} /> : null}
        <Line label="流主机" value={stats?.host || "—"} />
        <Line label="会话时长" value={formatTime(sessionSec)} />
      </Section>
      <Section title="画面">
        <Line label="分辨率" value={resolution} />
        <Line label="帧率" value={live?.fps ?? "—"} />
        <Line label="丢帧" value={live?.dropped ?? "—"} />
        <Line label="码率" value={stats ? formatBitrate(stats.bitrate) : "—"} />
        <Line label="编解码器" value={stats?.codecs || "—"} />
        <Line label="播放位置" value={live?.position ?? "—"} />
        <Line label="缓冲健康" value={live ? `${live.bufferAhead.toFixed(1)} s` : "—"} />
      </Section>
      <Section title="音频 / 网络">
        <Line label="音轨" value={live?.audio ?? "—"} />
        <Line label="音量" value={live?.volume ?? "—"} />
        <Line label="播放速率" value={live?.rate ?? "—"} />
        {stats?.liveLatency !== undefined && stats.liveLatency > 0 ? (
          <Line label="直播延迟" value={`${stats.liveLatency.toFixed(1)} s`} />
        ) : null}
        <Line label="宿主隧道" value={live?.latency ?? "—"} />
        <Line label="网络活动" value={live?.network ?? "—"} />
      </Section>
    </div>
  )
}
