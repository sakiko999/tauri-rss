/**
 * PlayerStatsOverlay —— 播放器「统计信息」(stats for nerds,B 站右键同名面板)。
 *
 * 视觉对齐 B 站:左上角半透明黑面板、label/value 两列、等宽数字,分三组:
 *   - **会话**:引擎、档位、清晰度、流主机、会话时长;
 *   - **画面**:分辨率、帧率、丢帧、码率、编解码器、播放位置、缓冲健康;
 *   - **音频**:音轨、音量、播放速率、直播延迟。
 *
 * 数据只来自**当前这一条流**:`EngineStats`(useMediaStream 上报)+ 每 500ms 轮询
 * `<video>`。未知项整行不渲染 —— 引擎拿不到的字段(如 FLV 没有码率/编解码器)
 * 显示一排「—」只会让人以为播放坏了。
 * ⚠️ 不读 `appHost.net.governorStats()`:那是**进程级**统计,当前播的是抖音时也会
 * 显示上一次 B 站请求的主机/耗时,已被误读成「直播走隧道」。
 * 纯只读,面板 `pointer-events-none` 不挡画面。
 * ⚠️ 不用桌面端 StateBlock/Menu:player 是独立包,不能反向依赖 desktop。
 */

import { useEffect, useRef, useState } from "react"

import {
  bufferedAhead,
  engineLabel,
  type EngineStats,
  formatBitrate,
  formatDropped,
  formatFps,
  formatLevel,
  formatVolume,
} from "./stats.ts"
import { formatTime } from "./utils/time.ts"

interface LiveInfo {
  resolution?: string
  fps?: string
  bufferAhead: number
  dropped?: string
  audio?: string
  volume: string
  rate: string
  currentTime: number
  duration: number
}

function readAudio(video: HTMLVideoElement): string | undefined {
  // Chromium 未实现 audioTracks(只有 Safari 有),退回解码字节数判断「有没有声音」。
  const tracks = (video as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks
  if (tracks && tracks.length) return `${tracks.length} 条`
  const decoded = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount
  return decoded && decoded > 0 ? "有" : undefined
}

/**
 * 读一次实时状态。帧率用相邻两次采样的 `totalVideoFrames` 差计算
 * (首帧没有参照,不显示;暂停时增量为 0 → 0 fps)。
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
  return {
    resolution: v.videoWidth && v.videoHeight ? `${v.videoWidth}×${v.videoHeight}` : undefined,
    fps: formatFps(fps),
    bufferAhead: bufferedAhead(v.buffered, v.currentTime),
    dropped: q ? formatDropped(q.droppedVideoFrames, q.totalVideoFrames) : undefined,
    audio: readAudio(v),
    volume: formatVolume(v.volume, v.muted),
    rate: `${v.playbackRate.toFixed(2)}×`,
    currentTime: v.currentTime,
    duration: Number.isFinite(v.duration) ? v.duration : 0,
  }
}

/** 值未知(undefined / "—")时整行不渲染 —— 不做「一排破折号」。 */
function Line({ label, value }: { label: string; value?: string }) {
  if (!value || value === "—") return null
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
  live,
  quality,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  stats?: EngineStats | null
  /** 播放会话起点(performance.now());缺省退回面板挂载时刻。 */
  sessionStartedAt?: number
  /**
   * 宿主声明的直播态。直播只显示已播时长(不拼 `/ 总时长`);
   * undefined = 按 duration 判定(直播 HLS 的 duration 可能有限,宿主应尽量显式给)。
   */
  live?: boolean
  /** 当前选中的清晰度名(来自 stream.quality)。 */
  quality?: string
}) {
  const [info, setInfo] = useState<LiveInfo | null>(null)
  const [sessionSec, setSessionSec] = useState(0)
  const prevFrame = useRef<{ frames: number; at: number } | null>(null)

  useEffect(() => {
    // 立即读一次(打开面板就应有数据),之后 500ms 刷新;会话时长同频刷新。
    // ⚠️ 会话时长从**播放会话起点**算,不是面板打开时刻 —— 否则「刚打开就 0:01」。
    const startedAt = sessionStartedAt ?? performance.now()
    setInfo(readLive(videoRef, prevFrame))
    const timer = window.setInterval(() => {
      setInfo(readLive(videoRef, prevFrame))
      setSessionSec((performance.now() - startedAt) / 1000)
    }, 500)
    return () => window.clearInterval(timer)
  }, [videoRef, sessionStartedAt])

  // 「当前 / 最佳分辨率」:元素实际解码尺寸 / 引擎声明的档位高度。
  const resolution = info?.resolution && stats?.height ? `${info.resolution} / ${stats.height}p` : info?.resolution
  // 直播(显式声明,或没有有限时长时的兜底)只显示已播时间。
  const isLive = live ?? (info ? info.duration <= 0 : false)
  const position = info
    ? isLive || info.duration <= 0
      ? formatTime(info.currentTime)
      : `${formatTime(info.currentTime)} / ${formatTime(info.duration)}`
    : undefined

  return (
    <div className="pointer-events-none absolute top-2 left-2 z-20 max-w-[min(26rem,90%)] rounded-[2px] bg-[#141414]/90 p-2.5 font-mono text-[11px] text-white/90">
      <div className="mb-1 text-xs font-semibold text-white">统计信息</div>
      <Section title="会话">
        <Line label="引擎" value={stats ? engineLabel(stats.engine) : undefined} />
        <Line label="档位" value={stats ? formatLevel(stats) : undefined} />
        <Line label="清晰度" value={quality} />
        <Line label="流主机" value={stats?.host} />
        <Line label="会话时长" value={formatTime(sessionSec)} />
      </Section>
      <Section title="画面">
        <Line label="分辨率" value={resolution} />
        <Line label="帧率" value={info?.fps} />
        <Line label="丢帧" value={info?.dropped} />
        <Line label="码率" value={stats ? formatBitrate(stats.bitrate) : undefined} />
        <Line label="编解码器" value={stats?.codecs} />
        <Line label="播放位置" value={position} />
        <Line label="缓冲健康" value={info ? `${info.bufferAhead.toFixed(1)} s` : undefined} />
      </Section>
      <Section title="音频">
        <Line label="音轨" value={info?.audio} />
        <Line label="音量" value={info?.volume} />
        <Line label="播放速率" value={info?.rate} />
        {stats?.liveLatency !== undefined && stats.liveLatency > 0 ? (
          <Line label="直播延迟" value={`${stats.liveLatency.toFixed(1)} s`} />
        ) : null}
      </Section>
    </div>
  )
}
