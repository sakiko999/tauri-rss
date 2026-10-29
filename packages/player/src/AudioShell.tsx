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
 * 状态与键盘**复用视频那套**：`useVideoElement`（state/ops 单一契约，不再自造第二份
 * 媒体状态机）+ `useContainerInteractions`（Space/K 播放暂停、←/→ ±5s、↑/↓ 音量、
 * M 静音；F 全屏对音频无义，传空实现）。焦点在进度条上时方向键归 sliders 自己。
 *
 * ⚠️ 配色写死黑底白字（与 VideoShell/MediaState 同契约）：这是播放器表面，不随主题
 * 翻——浅色主题下白底控件贴在纯黑面板上会割裂。也**不带圆角**（播放器一贯方角）。
 */

import { useEffect, useRef, useState } from "react"

import { useContainerInteractions } from "./hooks/useContainerInteractions.ts"
import { useVideoElement } from "./hooks/useVideoElement.ts"
import { PauseIcon, PlayIcon } from "./icons.tsx"

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
  const shellRef = useRef<HTMLDivElement | null>(null)
  // 媒体错误统一由 useVideoElement 上报（含日志）。
  const { state, ops } = useVideoElement(mediaRef, false, (code, msg) =>
    onError?.(new Error(msg || `audio error(code=${code ?? "?"})`)),
  )
  // 键盘与视频页同语义；全屏对音频无意义 → 空实现。单击播放不接（控件面不是画面）。
  useContainerInteractions(shellRef, state, ops, () => {})

  const [menu, setMenu] = useState<null | "speed" | "sleep">(null)
  const [sleepMin, setSleepMin] = useState(0)
  const [sleepLeft, setSleepLeft] = useState(0)

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

  const { currentTime: current, duration, paused, playbackRate: rate } = state

  const ctrl = "rounded-full border border-white/25 px-3 py-1 text-xs tabular-nums transition hover:bg-white/10"
  const menuBtn = "block w-full px-3 py-1.5 text-left hover:bg-white/15"

  return (
    <div
      ref={shellRef}
      tabIndex={0}
      className={["w-full max-w-[560px] bg-black px-5 py-4 text-white outline-none", className]
        .filter(Boolean)
        .join(" ")}
    >
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
        onChange={(e) => ops.seek(Number(e.currentTarget.value))}
        aria-label="播放进度"
        className="w-full accent-white"
      />
      <div className="mt-1 flex justify-between text-[11px] text-white/60 tabular-nums">
        <span>{fmt(current)}</span>
        <span>{duration > 0 ? `-${fmt(Math.max(0, duration - current))}` : "--:--"}</span>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4">
        <button type="button" className={ctrl} onClick={() => ops.seek(current - 15)} aria-label="后退 15 秒">
          −15
        </button>
        <button
          type="button"
          onClick={ops.togglePlay}
          aria-label={paused ? "播放" : "暂停"}
          className="grid h-14 w-14 place-items-center rounded-full bg-white text-black transition hover:bg-white/85"
        >
          {paused ? <PlayIcon className="h-6 w-6 translate-x-0.5" /> : <PauseIcon className="h-6 w-6" />}
        </button>
        <button type="button" className={ctrl} onClick={() => ops.seek(current + 30)} aria-label="前进 30 秒">
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
                      onClick={() => {
                        ops.changeRate(s)
                        setMenu(null)
                      }}
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
