/**
 * AudioShell —— 音频播放外壳（播客单集 / 听视频），**自绘控件**。
 *
 * 2026-10-29 从「原生 `<audio controls>`」升级（对齐原型的 pod 播放页）：
 * 进度条 + 播放/暂停 + 后退 15s / 前进 30s + 倍速 + 睡眠定时。
 *
 * ⚠️ 只管**界面与元素操作**：媒体元素的生命周期（引擎 attach、续播跳转、进度上报、
 * 播完回调）全部留给 PlayableMedia —— 它把 `mediaRef` 传进来。续播/进度/播完只有
 * 一份实现（重构候选 B3 说的就是这段曾被两处各写一遍）。
 *
 * ⚠️ 配色写死黑底白字（与 VideoShell/MediaState 同契约）：这是播放器表面，不随主题
 * 翻——浅色主题下白底控件贴在纯黑面板上会割裂。也**不带圆角**（播放器一贯方角）。
 */

import { useEffect, useState } from "react"

import { PauseIcon, PlayIcon } from "./icons.tsx"
import { log } from "./log/index.ts"

/** 倍速档位。 */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
/** 睡眠定时档位（分钟，0 = 关闭）。 */
const SLEEPS = [0, 15, 30, 60]

/** 秒 → `m:ss` / `h:mm:ss`。 */
function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00"
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  return `${h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m)}:${String(s).padStart(2, "0")}`
}

export function AudioShell({
  mediaRef,
  src,
  className,
  onError,
}: {
  /** 由 PlayableMedia 持有并接线（引擎/续播/进度/播完都在那边）。 */
  mediaRef: React.RefObject<HTMLAudioElement | null>
  /** 渐进式直链；DASH（听视频）由 PlayableMedia 的 useMediaStream attach，这里不传。 */
  src?: string
  className?: string
  onError?: (e: unknown) => void
}) {
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)
  const [menu, setMenu] = useState<null | "speed" | "sleep">(null)
  const [sleepMin, setSleepMin] = useState(0)
  const [sleepLeft, setSleepLeft] = useState(0)

  // 元素事件 → 本地状态。DASH 由 dash.js 挂 MSE，事件照常派发。
  useEffect(() => {
    const a = mediaRef.current
    if (!a) return
    const sync = () => {
      setCurrent(a.currentTime)
      setDuration(Number.isFinite(a.duration) ? a.duration : 0)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onErr = () => {
      log.mediaError({ code: a.error?.code, msg: a.error?.message ?? "" })
      onError?.(new Error(a.error?.message ?? `audio error(code=${a.error?.code ?? "?"})`))
    }
    a.addEventListener("timeupdate", sync)
    a.addEventListener("durationchange", sync)
    a.addEventListener("loadedmetadata", sync)
    a.addEventListener("play", onPlay)
    a.addEventListener("pause", onPause)
    a.addEventListener("error", onErr)
    return () => {
      a.removeEventListener("timeupdate", sync)
      a.removeEventListener("durationchange", sync)
      a.removeEventListener("loadedmetadata", sync)
      a.removeEventListener("play", onPlay)
      a.removeEventListener("pause", onPause)
      a.removeEventListener("error", onErr)
    }
    // onError 用 ref 会在播放器包里引入更多样板；这里按 src 重建监听即可（换流频率低）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // 倍速要在元素（重新）挂载后重新应用一次：切听/看会换元素。
  useEffect(() => {
    const a = mediaRef.current
    if (a) a.playbackRate = rate
  }, [rate, src, mediaRef])

  // 睡眠定时：到点暂停并复位；切档/关闭时清掉上一轮的计时。
  useEffect(() => {
    if (!sleepMin) {
      setSleepLeft(0)
      return
    }
    const end = Date.now() + sleepMin * 60_000
    setSleepLeft(sleepMin * 60)
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000))
      setSleepLeft(left)
      if (left <= 0) {
        clearInterval(t)
        mediaRef.current?.pause()
        setSleepMin(0)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [sleepMin, mediaRef])

  const toggle = () => {
    const a = mediaRef.current
    if (!a) return
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }
  const skip = (delta: number) => {
    const a = mediaRef.current
    if (!a) return
    const max = Number.isFinite(a.duration) ? Math.max(0, a.duration - 0.25) : Number.POSITIVE_INFINITY
    a.currentTime = Math.max(0, Math.min(max, a.currentTime + delta))
  }
  const seek = (t: number) => {
    const a = mediaRef.current
    if (a && Number.isFinite(t)) a.currentTime = t
  }
  const setSpeed = (r: number) => {
    setRate(r)
    const a = mediaRef.current
    if (a) a.playbackRate = r
    setMenu(null)
  }

  const ctrl = "rounded-full border border-white/25 px-3 py-1 text-xs tabular-nums transition hover:bg-white/10"
  const menuBtn = "block w-full px-3 py-1.5 text-left hover:bg-white/15"

  return (
    <div className={["w-full max-w-[560px] bg-black px-5 py-4 text-white", className].filter(Boolean).join(" ")}>
      {/* preload=metadata：起播由 PlayableMedia 直接 play() 驱动，这里只求总时长/进度条
          立刻有值（none 要等 play 才出时长，页面先空一段）。 */}
      <audio ref={mediaRef} src={src} preload="metadata" className="hidden" />

      {/* 进度（原生 range，键盘可达；accent-color 让轨道跟随文字色） */}
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 0}
        step={1}
        value={Math.min(current, duration || 0)}
        onChange={(e) => seek(Number(e.currentTarget.value))}
        aria-label="播放进度"
        className="w-full accent-white"
      />
      <div className="mt-1 flex justify-between text-[11px] text-white/60 tabular-nums">
        <span>{fmt(current)}</span>
        <span>{duration > 0 ? `-${fmt(Math.max(0, duration - current))}` : "--:--"}</span>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4">
        <button type="button" className={ctrl} onClick={() => skip(-15)} aria-label="后退 15 秒">
          −15
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
          className="grid h-14 w-14 place-items-center rounded-full bg-white text-black transition hover:bg-white/85"
        >
          {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6 translate-x-0.5" />}
        </button>
        <button type="button" className={ctrl} onClick={() => skip(30)} aria-label="前进 30 秒">
          +30
        </button>
      </div>

      <div className="relative mt-3 flex items-center justify-center gap-2 text-xs">
        <button
          type="button"
          className={ctrl}
          aria-haspopup="menu"
          aria-expanded={menu === "speed"}
          onClick={() => setMenu((m) => (m === "speed" ? null : "speed"))}
        >
          {rate}×
        </button>
        <button
          type="button"
          className={ctrl}
          aria-haspopup="menu"
          aria-expanded={menu === "sleep"}
          onClick={() => setMenu((m) => (m === "sleep" ? null : "sleep"))}
        >
          {sleepMin ? `定时 ${fmt(sleepLeft)}` : "定时"}
        </button>

        {menu ? (
          <>
            {/* 透明遮罩：点空白处关闭（与 VideoShell 的档位菜单同款） */}
            <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setMenu(null)} />
            <div
              role="menu"
              className="absolute bottom-9 left-1/2 z-50 w-28 -translate-x-1/2 rounded-md border border-white/15 bg-black/95 py-1 text-xs shadow-xl"
            >
              {menu === "speed"
                ? SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={s === rate}
                      className={menuBtn}
                      onClick={() => setSpeed(s)}
                    >
                      {s}×{s === rate ? " ✓" : ""}
                    </button>
                  ))
                : SLEEPS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="menuitemradio"
                      aria-checked={m === sleepMin}
                      className={menuBtn}
                      onClick={() => {
                        setSleepMin(m)
                        setMenu(null)
                      }}
                    >
                      {m === 0 ? "关闭定时" : `${m} 分钟`}
                    </button>
                  ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
