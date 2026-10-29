/**
 * AudioShell —— 音频播放页的**播放面**（播客单集 / 听视频），照原型 podplay 落地。
 *
 * 版式（自下而上）：
 *   封面 + 「正在播放」kicker / 标题 / 节目名 / 元信息
 *   声纹频谱（确定性伪波形，点击或拖动 seek）
 *   当前 / 剩余时间
 *   −15 / 播放键 / +30
 *   倍速、睡眠定时 + 宿主给的次要动作（下一条、打开原文、听⇄看…）
 *
 * ⚠️ 只管**界面与元素操作**：媒体元素的生命周期（引擎 attach、续播跳转、进度上报、
 * 播完回调）全部留给 PlayableMedia —— 它把 `mediaRef` 传进来。续播/进度/播完只有
 * 一份实现（重构候选 B3 说的就是这段曾被两处各写一遍）。
 *
 * 状态与键盘**复用视频那套**：`useVideoElement`（state/ops 单一契约，不再自造第二份
 * 媒体状态机）+ `useContainerInteractions`（Space/K 播放暂停、←/→ −15/+30、↑/↓ 音量、
 * M 静音；F 全屏对音频无义，传空实现）。
 *
 * ⚠️ 配色走**主题 token**（带深色回退值）：这是内容页的卡片，不是视频舞台 ——
 * 原型里 pod-stage 就是一张 `--surface-1` 卡片，浅色主题下也是浅底。
 * 回退值给非桌面宿主（mobile）用，它们在无 token 环境里仍是深色可读。
 */

import { useEffect, useRef, useState } from "react"

import { WaveformSeek } from "./controls/WaveformSeek.tsx"
import { useContainerInteractions } from "./hooks/useContainerInteractions.ts"
import { useVideoElement } from "./hooks/useVideoElement.ts"
import { ForwardIcon, PauseIcon, PlayIcon, RewindIcon } from "./icons.tsx"

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
  ownElement = true,
  seed,
  artwork,
  kicker,
  title,
  subtitle,
  meta,
  actions,
  chapters,
  className,
  onError,
}: {
  /** 由 PlayableMedia 持有并接线（引擎/续播/进度/播完都在那边）。 */
  mediaRef: React.RefObject<HTMLAudioElement | null>
  /** 渐进式直链；DASH（听视频）由 PlayableMedia 的 useMediaStream attach，这里不传。 */
  src?: string
  /**
   * 元素是否由本组件渲染。宿主持有跨路由存活的媒体元素时传 `false`
   * ——此壳只做控制面，`mediaRef` 指向外面那个元素。
   */
  ownElement?: boolean
  /** 波形指纹（条目稳定 id）：换集换形状。 */
  seed: string
  /** 封面。 */
  artwork?: string
  /** 上标，如「正在播放 · 播客单集」。 */
  kicker?: string
  title?: string
  /** 节目 / UP 主名（一行，无则省略）。 */
  subtitle?: string
  /** 元信息行（日期 · 时长 …，由宿主组装，避免播放器包知道数据模型）。 */
  meta?: React.ReactNode
  /** utils 行右侧的次要动作（下一条 / 打开原文 / 听⇄看）。 */
  actions?: React.ReactNode
  /** 章节起点（目前只有视频源可能带；为空就不画刻度）。 */
  chapters?: { t: number }[]
  className?: string
  onError?: (e: unknown) => void
}) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  // 媒体错误统一由 useVideoElement 上报（含日志）。
  const { state, ops } = useVideoElement(mediaRef, false, (code, msg) =>
    onError?.(new Error(msg || `audio error(code=${code ?? "?"})`)),
  )
  // 键盘与视频页同语义，步长换成原型的 −15 / +30。单击播放不接（控件面不是画面）。
  useContainerInteractions(shellRef, state, ops, () => {}, { back: 15, forward: 30 })

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

  // token + 深色回退：见文件头注释。
  const card =
    "border-[var(--color-border,#2a2b30)] bg-[var(--color-card,#131418)] text-[var(--color-foreground,#e8e6e1)]"
  const dim = "text-[var(--color-dim,#85878f)]"
  const pill =
    "inline-flex items-center gap-1.5 rounded-[var(--r-sm,8px)] border border-[var(--color-border,#2a2b30)] bg-[var(--color-surface-2,#191b21)] px-2.5 py-1 text-xs text-[var(--color-muted-foreground,#c8c6c0)] transition-colors hover:border-[var(--color-border-strong,#3a3b42)] hover:text-[var(--color-foreground,#e8e6e1)]"
  const menuItem = "block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-surface-hover,#23252b)]"

  return (
    <div
      ref={shellRef}
      tabIndex={0}
      className={["relative overflow-hidden rounded-[var(--r-lg,12px)] border p-6 outline-none", card, className]
        .filter(Boolean)
        .join(" ")}
    >
      {/* preload=metadata：起播由 PlayableMedia 直接 play() 驱动，这里只求总时长/波形
          立刻有值（none 要等 play 才出时长，卡片先空一段）。
          宿主带会话级元素（ownElement=false）时不渲染，避免出现两份媒体源。 */}
      {ownElement ? <audio ref={mediaRef} src={src} preload="metadata" className="hidden" /> : null}

      <div className="grid [grid-template-columns:190px_minmax(0,1fr)] items-center gap-6 max-sm:[grid-template-columns:108px_minmax(0,1fr)]">
        {artwork ? (
          <span className="block aspect-square overflow-hidden rounded-[var(--r-md,10px)] border border-[var(--color-border,#2a2b30)] bg-[var(--color-surface-2,#191b21)]">
            <img src={artwork} alt="" className="block h-full w-full object-cover" />
          </span>
        ) : null}
        <div className="min-w-0">
          {kicker ? (
            <span className="text-[11px] tracking-[0.14em] text-[var(--color-primary-text,#f0946c)] uppercase">
              {kicker}
            </span>
          ) : null}
          {title ? <h2 className="mt-2 mb-1.5 text-[26px] leading-[1.32] font-semibold">{title}</h2> : null}
          {subtitle ? (
            <span className="block text-[13px] text-[var(--color-muted-foreground,#c8c6c0)]">{subtitle}</span>
          ) : null}
          {meta ? (
            <div className={["mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[10.5px]", dim].join(" ")}>
              {meta}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-7">
        <div
          className={["mb-2.5 flex items-center gap-3 font-mono text-[9.5px] tracking-[0.2em] uppercase", dim].join(
            " ",
          )}
        >
          <span className="text-xs tracking-[0.08em] text-[var(--color-muted-foreground,#c8c6c0)] normal-case">
            声纹频谱
          </span>
          <span>WAVEFORM</span>
          <span className="h-px flex-1 bg-[var(--color-border,#2a2b30)]" />
        </div>
        <WaveformSeek
          mediaRef={mediaRef}
          currentTime={current}
          duration={duration}
          playing={!paused}
          seed={seed}
          chapters={chapters}
          onSeek={ops.seek}
          className="h-[68px]"
        />
        <div className={["mt-2 flex justify-between font-mono text-[11px]", dim].join(" ")}>
          <span>{fmt(current)}</span>
          <span>{duration > 0 ? `-${fmt(Math.max(0, duration - current))}` : "--:--"}</span>
        </div>
      </div>

      <div className="my-[18px] flex items-center justify-center gap-[26px]">
        <button
          type="button"
          onClick={() => ops.seek(current - 15)}
          aria-label="后退 15 秒"
          className="grid h-12 w-12 place-items-center gap-0 rounded-full border border-[var(--color-border,#2a2b30)] bg-[var(--color-surface-2,#191b21)] text-[var(--color-muted-foreground,#c8c6c0)] transition-colors hover:border-[var(--color-border-strong,#3a3b42)] hover:text-[var(--color-foreground,#e8e6e1)]"
        >
          <RewindIcon className="h-[18px] w-[18px]" />
          <b className={["font-mono text-[8.5px] leading-none font-normal", dim].join(" ")}>15</b>
        </button>
        <button
          type="button"
          onClick={ops.togglePlay}
          aria-label={paused ? "播放" : "暂停"}
          className="grid h-[66px] w-[66px] place-items-center rounded-full border border-[var(--color-primary,#ff5c38)] bg-[var(--color-primary,#ff5c38)] text-[var(--color-primary-foreground,#2b1207)] transition hover:bg-[var(--color-primary-hover,#ff6f4d)] active:scale-[.97]"
        >
          {paused ? (
            <PlayIcon className="h-[30px] w-[30px] translate-x-0.5" />
          ) : (
            <PauseIcon className="h-[30px] w-[30px]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => ops.seek(current + 30)}
          aria-label="前进 30 秒"
          className="grid h-12 w-12 place-items-center gap-0 rounded-full border border-[var(--color-border,#2a2b30)] bg-[var(--color-surface-2,#191b21)] text-[var(--color-muted-foreground,#c8c6c0)] transition-colors hover:border-[var(--color-border-strong,#3a3b42)] hover:text-[var(--color-foreground,#e8e6e1)]"
        >
          <ForwardIcon className="h-[18px] w-[18px]" />
          <b className={["font-mono text-[8.5px] leading-none font-normal", dim].join(" ")}>30</b>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border,#2a2b30)] pt-4">
        <div className="relative">
          <button
            type="button"
            className={pill}
            aria-haspopup="menu"
            aria-expanded={menu === "speed"}
            onClick={() => setMenu((m) => (m === "speed" ? null : "speed"))}
          >
            {rate}×
          </button>
          {menu === "speed" ? (
            <>
              <Overlay onClose={() => setMenu(null)} />
              <div
                role="menu"
                className="absolute bottom-9 left-0 z-50 w-28 rounded-[var(--r-sm,8px)] border border-[var(--color-border,#2a2b30)] bg-[var(--color-popover,#191b21)] py-1 text-[var(--color-foreground,#e8e6e1)] shadow-[var(--shadow-pop,0_12px_32px_rgba(0,0,0,.45))]"
              >
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={s === rate}
                    className={menuItem}
                    onClick={() => {
                      ops.changeRate(s)
                      setMenu(null)
                    }}
                  >
                    {s}×{s === rate ? " ✓" : ""}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            className={pill}
            aria-haspopup="menu"
            aria-expanded={menu === "sleep"}
            onClick={() => setMenu((m) => (m === "sleep" ? null : "sleep"))}
          >
            {sleepMin ? `睡眠 ${Math.ceil(sleepLeft / 60)} 分` : "定时"}
          </button>
          {menu === "sleep" ? (
            <>
              <Overlay onClose={() => setMenu(null)} />
              <div
                role="menu"
                className="absolute bottom-9 left-0 z-50 w-32 rounded-[var(--r-sm,8px)] border border-[var(--color-border,#2a2b30)] bg-[var(--color-popover,#191b21)] py-1 text-[var(--color-foreground,#e8e6e1)] shadow-[var(--shadow-pop,0_12px_32px_rgba(0,0,0,.45))]"
              >
                {SLEEPS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={m === sleepMin}
                    className={menuItem}
                    onClick={() => {
                      setSleepMin(m)
                      setMenu(null)
                    }}
                  >
                    {m === 0 ? "关闭定时" : `${m} 分钟后暂停`}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {actions ? (
          <>
            <span className="flex-1" />
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** 菜单外点关闭的透明遮罩（与 VideoShell 的档位菜单同款）。 */
function Overlay({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" tabIndex={-1} aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
  )
}
