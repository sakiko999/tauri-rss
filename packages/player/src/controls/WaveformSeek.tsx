/**
 * WaveformSeek —— 声纹波形进度条（原型 pod 播放页的「声纹频谱」）。
 *
 * ⚠️ 波形是**确定性伪频谱**：FNV-1a 哈希条目 id 得到 seed，四组正弦叠加 × 拱形包络 ×
 * 脉动，按当前播放时间演化。不做真实音频分析 —— `<audio>` 拿不到解码前的 PCM，真分析
 * 要多开一个 AudioContext + AnalyserNode（还会把整个文件转成实时音源），对「看得见的
 * 进度」没有收益。同一集每次画出来形状一致，换条目才变。
 *
 * ⚠️ 时间**不进 React state**：rAF 里直接读 `mediaRef.current.currentTime` 画；暂停时靠
 * timeupdate 重画一次。否则 4Hz 的 state 更新会让条形一顿一顿地跳。
 *
 * 交互与原生 range 同语义：点击/拖动 seek、←/→ ±5s、Home/End 首尾、
 * `role="slider"` + aria-valuenow（进度条本身也在 useContainerInteractions 的键盘域内，
 * 焦点在这条上时方向键归它）。
 */

import { useCallback, useEffect, useRef } from "react"

/** 波形上的章节刻度（只有起点有意义）。 */
export interface WaveChapter {
  t: number
}

interface Palette {
  accent: string
  idle: string
  hairline: string
}

/** 主题切换时重读一次；读不到 token（非桌面宿主）时用深色回退值。 */
let paletteCache: { theme: string; palette: Palette } | null = null
function palette(): Palette {
  const theme = (document.documentElement.dataset.theme ?? "dark") + "|" + document.documentElement.className
  if (paletteCache?.theme === theme) return paletteCache.palette
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  const p: Palette = {
    accent: v("--color-primary", "#ff5c38"),
    idle: v("--color-dim", "#85878f"),
    hairline: v("--color-border-strong", "rgba(255,255,255,.16)"),
  }
  paletteCache = { theme, palette: p }
  return p
}

/** FNV-1a → [0,1)：条目的稳定指纹（换集换形状，同一集恒定）。 */
function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

/** 第 i 根条的高度系数 [0.07,1]（原型同款公式）。 */
function ampAt(i: number, n: number, t: number, seed: number): number {
  const x = i / Math.max(1, n - 1)
  const p = i * 0.62 + seed * 9.7
  const v =
    Math.sin(t * 2.35 + p) * 0.34 +
    Math.sin(t * 1.27 + p * 0.63 + 1.4) * 0.26 +
    Math.sin(t * 3.9 + p * 1.7 + seed * 5.3) * 0.18 +
    Math.sin(t * 0.53 + x * 2.6 + seed * 3.1) * 0.2
  const arch = 0.55 + 0.45 * Math.sin(Math.PI * x)
  const pulse = 0.86 + 0.14 * Math.sin(t * 0.77 + seed * 6.1)
  return Math.max(0.07, Math.min(1, (0.2 + Math.abs(v) * 0.9) * arch * pulse))
}

function drawWave(
  canvas: HTMLCanvasElement,
  time: number,
  opts: { duration: number; playing: boolean; seed: string; chapters?: WaveChapter[] },
) {
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const pal = palette()
  const dur = opts.duration > 0 ? opts.duration : 0
  const ratio = dur > 0 ? Math.max(0, Math.min(1, time / dur)) : 0
  const playX = ratio * w
  const mid = h / 2
  const maxH = h * 0.42
  const n = Math.max(36, Math.min(80, Math.round(w / 8.5)))
  const slot = w / n
  const barW = Math.max(1.5, Math.min(5, slot * 0.38))
  const seed = seedOf(opts.seed)
  const dim = opts.playing ? 1 : 0.55

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  // 章节刻度：上下各 6px 的短竖线（与原型一致，只有起点画）
  if (dur > 0 && opts.chapters?.length) {
    ctx.globalAlpha = 0.45 * (opts.playing ? 1 : 0.7)
    ctx.fillStyle = pal.idle
    for (const c of opts.chapters) {
      if (!c.t) continue
      const x = Math.round((c.t / dur) * w) + 0.5
      ctx.fillRect(x, 0, 1, 6)
      ctx.fillRect(x, h - 6, 1, 6)
    }
  }

  // 中线
  ctx.globalAlpha = 0.2 * dim
  ctx.fillStyle = pal.hairline
  ctx.fillRect(0, Math.round(mid), w, 1)

  // 条
  for (let i = 0; i < n; i++) {
    const x = i * slot + slot / 2
    const half = Math.max(2.5, ampAt(i, n, time, seed) * maxH)
    const played = x <= playX
    ctx.globalAlpha = (played ? 0.95 : 0.38) * dim
    ctx.fillStyle = played ? pal.accent : pal.idle
    const bx = x - barW / 2
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(bx, mid - half, barW, half * 2, barW / 2)
    else ctx.rect(bx, mid - half, barW, half * 2)
    ctx.fill()
  }

  // 播放头
  ctx.globalAlpha = 0.92 * dim
  ctx.fillStyle = pal.accent
  ctx.fillRect(playX - 1, 0, 2, h)
  ctx.beginPath()
  ctx.arc(playX, mid, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

export function WaveformSeek({
  mediaRef,
  currentTime,
  duration,
  playing,
  seed,
  chapters,
  onSeek,
  className,
}: {
  /** 时间来源（rAF 直接读元素，平滑推进）。 */
  mediaRef: React.RefObject<HTMLMediaElement | null>
  /** 仅用于 aria-valuenow / valuetext。 */
  currentTime: number
  duration: number
  playing: boolean
  /** 条目稳定 id（决定波形形状）。 */
  seed: string
  chapters?: WaveChapter[]
  onSeek: (sec: number) => void
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const liveRef = useRef({ duration, playing, seed, chapters })
  liveRef.current = { duration, playing, seed, chapters }

  // 画：播放中 rAF 连续推进；暂停时只在 timeupdate/resize/参数变化时画一帧。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => drawWave(canvas, mediaRef.current?.currentTime ?? 0, liveRef.current)
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    const el = mediaRef.current
    el?.addEventListener("timeupdate", draw)
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    let raf = 0
    if (playing && !reduced) {
      const loop = () => {
        draw()
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el?.removeEventListener("timeupdate", draw)
    }
  }, [playing, duration, seed, chapters, mediaRef])

  const seekFrom = useCallback(
    (clientX: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !(duration > 0)) return
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      onSeek(ratio * duration)
    },
    [duration, onSeek],
  )

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    seekFrom(e.clientX, e.currentTarget)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1) return
    seekFrom(e.clientX, e.currentTarget)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = e.shiftKey ? 30 : 5
    let next: number | null = null
    if (e.key === "ArrowLeft") next = currentTime - step
    else if (e.key === "ArrowRight") next = currentTime + step
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = duration
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onSeek(next)
  }

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      role="slider"
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${fmtClock(currentTime)} / ${fmtClock(duration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      className={["block w-full cursor-pointer touch-none select-none outline-none", className]
        .filter(Boolean)
        .join(" ")}
    />
  )
}

/** 秒 → `m:ss` / `h:mm:ss`（与 AudioShell 的时间显示同格式）。 */
function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00"
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  return `${h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m)}:${String(s).padStart(2, "0")}`
}
