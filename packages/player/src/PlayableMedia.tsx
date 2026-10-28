/**
 * PlayableMedia —— 可播放媒体容器(video/audio/live 共用)。
 *
 * 封装「懒解析 + 播放」两阶段 + 按格式分发渲染:
 *   - 有初始流(refresh 已带,如 audio 的 stream)→ 直接内嵌播放;
 *   - 无流 → 显示「播放」按钮,点击调 `resolve()` 拿 MediaStream[] 再播。
 *   resolve 由宿主(App 层)注入——它绑定 DataLayer 的 resolvePlay/resolveLivePlay。
 *
 * 渲染分发(单流,stream 由 useStreamSelection 选出):
 *   - mp4/webm → VideoShell 原生 <video>;  m3u8/flv/dash → VideoShell + useMediaStream;
 *   - mp3/aac/ogg → AudioShell 原生 <audio>(无画面,保留浏览器控件);
 *   - rtmp:// 协议 → 浏览器播不了,占位提示。
 *
 * 注意:原生 <video>/<audio> 无法带自定义 header(如 bilibili 直链的 referer)。
 * 带 headers 的 mp4 原生播可能 403 —— 当前如实提示;hls.js 经 xhrSetup 可带。
 */

import type { MediaStream, ResolvePlayback } from "@amoeba/core"
import { ERROR_KIND_LABEL, errorKindOf } from "@amoeba/resolve/errors"
import { useEffect, useRef, useState } from "react"

import { AudioShell } from "./AudioShell.tsx"
import { useMediaStream } from "./hooks/useMediaStream.ts"
import {
  isProgressiveAudio,
  isProgressiveVideo,
  isRtmp,
  isStreamingStream,
  useStreamSelection,
} from "./hooks/useStreamSelection.ts"
import { SpinnerIcon } from "./icons.tsx"
import { log } from "./log/index.ts"
import type { EngineStats } from "./stats.ts"
import { attemptPlayWithMuteFallback } from "./utils/attemptPlay.ts"
import { VideoShell } from "./VideoShell.tsx"

/**
 * 状态块内的次要按钮。
 *
 * ⚠️ 颜色是**写死的白系**,不是主题变量:它只出现在 bg-black 的播放舞台上
 * (见 MediaState),浅色主题的 `--surface-1` 会是近白色按钮,在纯黑上突兀。
 */
const MS_BTN =
  "rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/20"

/**
 * 播放器内的加载 / 失败 / 空态统一样式块。
 *
 * 为什么不用 desktop 的 StateBlock:player 是独立包(desktop 依赖它,不能反向依赖)。
 * 这里给一份同形的最小实现 —— 关键是**自身撑出 16:9**,这样解析完成后画面接管,
 * 舞台高度不跳(旧实现是 48px 空白环,左上角,解析完整个区域突然撑开)。
 *
 * ⚠️ **配色写死黑底白字,不走主题变量**(2026-10-14 用户反馈「浅色很怪」)：
 * 这是**播放舞台**的占位。浅色主题下 `--surface-2` 是近白色,整块舞台突然白闪一下
 * 才切到画面,和播放器本身的观感断裂;而且本文件末尾的未知流兜底分支本来就是
 * `bg-black` —— 舞台一贯是黑的,加载态不该是唯一例外。
 * 与 VideoShell/PlayerControls 的方角契约无关,这里说的是**配色**。
 */
function MediaState({
  tone = "neutral",
  title,
  detail,
  action,
}: {
  tone?: "neutral" | "error" | "loading"
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  // ⚠️ 无圆角(与 VideoShell/PlayerControls 同契约):播放器满幅方角,是产品设计。
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2.5 overflow-hidden bg-black p-6 text-center">
      {tone === "loading" ? (
        <SpinnerIcon className="h-8 w-8 animate-spin text-white/70" />
      ) : (
        <span
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-base font-semibold text-white/70"
          aria-hidden
        >
          {tone === "error" ? "!" : "∅"}
        </span>
      )}
      <p className="text-sm font-medium text-white">{title}</p>
      {detail ? <p className="max-w-[46ch] text-xs leading-relaxed text-white/60">{detail}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/**
 * 在用户手势内解锁浏览器 autoplay policy(带声音自动播放)。
 *
 * Chromium/WebView2 只允许「用户手势触发」的带声音自动播放;我们点「播放」
 * 按钮后 resolve 是异步的,video 在结果返回后才渲染,手势已过期 → 被拦。
 * 解法:点击瞬间(手势内)resume 一个 AudioContext,把文档标记为已获授权,
 * 之后同文档的 `<video>.play()` 带声音即可通过。幂等(只解锁一次)。
 */
let audioUnlocked = false
export function unlockAudioPlayback(): void {
  if (audioUnlocked) return
  audioUnlocked = true
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    if (ctx.state === "suspended") void ctx.resume()
    // 持有引用防 GC 后 context 被回收导致授权丢失。
    ;(window as unknown as { __unlockCtx?: AudioContext }).__unlockCtx = ctx
  } catch {
    // 环境无 AudioContext(罕见),放弃解锁——play() 会被拦,降级静音。
  }
}

export function PlayableMedia({
  streams,
  resolve,
  className,
  onError,
  autoResolve = true,
  showDanmaku = true,
  onToggleDanmaku,
  startAtSec,
  onProgress,
  onEnded,
}: {
  /** refresh 已带的可播流(可选)。 */
  streams?: MediaStream[]
  /** 懒解析函数:点击播放时调用,返回可播流 + 弹幕能力(core 探测 DanmakuPlayable 附带)。 */
  resolve?: () => Promise<ResolvePlayback>
  className?: string
  onError?: (err: unknown) => void
  /** 挂载后立即懒解析起播(默认开启,无需点「播放」按钮)。 */
  autoResolve?: boolean
  /** 是否渲染弹幕层(设置总开关;false 时解析结果里的 danmaku 直接丢弃)。 */
  showDanmaku?: boolean
  /**
   * 弹幕开关(播放页的临时覆盖)。只有解析结果确实带弹幕时才把按钮渲染进控件栏;
   * enabled 跟随 showDanmaku,所以关掉后按钮仍在、可再次打开。
   */
  onToggleDanmaku?: () => void
  /** 起播跳转到的秒数(续播)。URL 无参数即可;越界由 seek 侧 clamp。 */
  startAtSec?: number
  /** 播放中进度回调(秒;节流由宿主侧决定)。宿主据此持久化续播位置。 */
  onProgress?: (currentSec: number, durationSec: number) => void
  /**
   * 播放结束(播到片尾)。
   * ⚠️ 直接听 video 元素的 `ended`,不走 VideoShell 的 state —— 未知流兜底分支的
   * 裸 `<video>` 没有 VideoShell,只挂 state 会漏掉那条路径。直播不触发(无 duration)。
   */
  onEnded?: () => void
}) {
  const [resolved, setResolved] = useState<ResolvePlayback | null>(null)
  const [error, setError] = useState<unknown>(null)
  // 切档后仍要传 error 给 useMediaStream;error 展示由 error state 管。
  const [playError, setPlayError] = useState<unknown>(null)
  const [retryKey, setRetryKey] = useState(0)

  // 最终播放用的流:初始流或懒解析结果。弹幕随解析结果附带(resolve 前 undefined)。
  const playStreams = resolved?.streams ?? streams ?? []
  // ⚠️ 可播 = 有 url(原生/HLS/FLV)**或**有 dashManifest(bili DASH 流 url 恒为空串,
  // 靠 dashManifest 生成 MPD blob 喂 dash.js —— 空 url 对 DASH 是**正常**的)。
  // 只判 !!url 会把 bili 视频全判成无可播(卡在「正在解析」)。
  const hasPlayable = playStreams.some((s) => !!s.url || !!s.dashManifest)
  // 弹幕总开关关闭时不把流交给弹幕层(不建连接,而非建了再隐藏)。
  const danmaku = showDanmaku ? resolved?.danmaku : undefined
  // 控件栏里的开关:解析结果带弹幕才出现。enabled 用 showDanmaku(而不是 danmaku),
  // 关闭时流被丢弃但仍保留能力,按钮不会随流一起消失。
  const danmakuControl =
    resolved?.danmaku && onToggleDanmaku ? { enabled: showDanmaku, onToggle: onToggleDanmaku } : undefined

  async function handlePlay() {
    if (!resolve) return
    // 解锁 autoplay(手势内调用最有效;autoResolve 非手势调用时被拦 → attemptPlay 降级静音)。
    unlockAudioPlayback()
    setError(null)
    try {
      const result = await resolve()
      // 空数组 = 无可播流,按失败处理(resolveFailed 而非「成功 0 条」误导)。
      if (!result.streams.length) throw new Error("无可播流")
      setResolved(result)
    } catch (err) {
      log.resolveFailed({ err })
      setError(err)
      onError?.(err)
    }
  }

  /** 重试解析:清错误后重跑一次(解析失败/无可播流两个态的出口)。 */
  function retryResolve() {
    setError(null)
    log.userRetry()
    void handlePlay()
  }

  // autoResolve(默认开启):挂载即自动懒解析起播,无「播放」按钮。
  // 用 ref 持 resolve,effect 只跑一次(StrictMode 双挂载幂等:第二次挂载 resolved 已非空直接播)。
  const startedRef = useRef(false)
  useEffect(() => {
    if (!autoResolve) return
    if (startedRef.current || resolved) return
    // ⚠️ props 已带可播流(如播客 stream 直链)时**免解析**:这类 item.url 是网页
    // (hubermanlab.com/episode/…)不可 by-url 路由,resolve 必失败;流已在手直接用。
    if (streams?.some((s) => s.url || s.dashManifest)) return
    startedRef.current = true
    void handlePlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResolve])

  // 选流 + 档位。
  const { stream, qualityOptions, switchQuality } = useStreamSelection(playStreams)

  // 引擎/档位(统计信息面板)。HLS/FLV/DASH 由 useMediaStream 上报;原生 mp4 在这里定。
  const [engineStats, setEngineStats] = useState<EngineStats | null>(null)

  // 流媒体驱动(hls/flv/dash)→ useMediaStream 接管 video;原生 src 由 VideoShell 写。
  const needsStreamPlayer = !!stream && isStreamingStream(stream)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // autoPlay 语义:用户点过「播放」(resolved !== null)→ 自动带声起播;初始流未点击不自动播。
  // ⚠️ props 已带可播流(播客直链,免 resolve)时 resolved 恒 null,但流已在手 → 也应自动播。
  const hasPropStreams = !!streams?.some((s) => s.url || s.dashManifest)
  const autoPlay = resolved !== null || hasPropStreams

  useMediaStream({
    stream: needsStreamPlayer ? stream : null,
    videoRef,
    autoPlay,
    // retryKey 变化强制 useMediaStream 重建播放实例(错误重试)。
    retryKey,
    onStats: setEngineStats,
    onError: (e) => {
      setPlayError(e)
      onError?.(e)
    },
  })

  // 原生 mp4 分支的自动播放:与 HLS 对齐,**等媒体可播(canplay)后**带声 play。
  // ⚠️ 不能 src 刚设就立即 play:此时媒体未加载,autoplay policy 判定不稳定,
  // 带声 play 易被拦 → 降级静音(实测 video 静音、live 有声即因此——live 走 HLS
  // 在 canplay 才 play,媒体已就绪)。canplay 时媒体已加载,带声 play 最可能放行。
  // 被拦降级静音(保底可播);StrictMode 双挂载:第一个 video 被移除,检查 isConnected。
  const isNativeStream = !!stream && !needsStreamPlayer && isProgressiveVideo(stream)
  useEffect(() => {
    if (!autoPlay || !isNativeStream) return
    const el = videoRef.current
    if (!el) return
    const attemptUnmuted = () => {
      if (!el.isConnected) return
      // ⚠️ 保留用户当前静音态(el.muted 跨 src 变化持续) —— 曾无条件 `el.muted=false`,
      // 切档/换条目会把用户点过的静音强行打开。冷挂载时 el.muted 默认 false(=带声起播)。
      // 起点若为静音(用户偏好或静音降级)→ 保持静音、不调 attemptPlay(避免无谓的带声尝试)。
      if (!el.muted) {
        attemptPlayWithMuteFallback(el, () => el.play(), { autoPlay, onFail: (e) => setPlayError(e) })
      } else {
        el.play().catch(() => {}) // 静音播放(恒允许),无需降级链
      }
    }
    // 只等 canplay(媒体可播)再带声 play——**不要立即 play**:src 刚设媒体未
    // 加载,立即 play 易被判失败 → 降级静音(YouTube video 静音即因此)。
    el.addEventListener("canplay", attemptUnmuted, { once: true })
    return () => el.removeEventListener("canplay", attemptUnmuted)
  }, [autoPlay, isNativeStream, stream?.url])

  // ── 续播:起播跳转 + 进度上报 ──────────────────────────────────────────────
  // 跳转只做**一次**(resumedRef;≤3s 视为「从头看」不跳 —— 否则片头几秒的进度会被
  // 当成续播点,每次进来都卡在开头)。
  // ⚠️ **不要**随 stream?.url 变化重置 resumedRef:切档会换 stream → useMediaStream 重建
  // 媒体实例 → 若重置,就会跳回 startAtSec(用户切个清晰度被弹回旧进度)。换条目时
  // PlayerPage 用 key={item.id} 重挂整个组件 → resumedRef 自然为 false,无需手动重置。
  const resumedRef = useRef(false)
  useEffect(() => {
    const at = startAtSec ?? 0
    if (!stream || resumedRef.current || at <= 3) return
    const el = videoRef.current
    if (!el) return
    const apply = () => {
      if (resumedRef.current) return
      resumedRef.current = true
      try {
        el.currentTime = at
      } catch {
        // 个别状态(未加载完)抛 InvalidStateError,忽略——不跳也能从头播。
      }
    }
    // 元数据就绪才可 seek;已就绪(切档回来)直接跳。
    if (el.readyState >= 1) apply()
    else el.addEventListener("loadedmetadata", apply, { once: true })
    return () => el.removeEventListener("loadedmetadata", apply)
  }, [stream, startAtSec])

  // 进度上报:timeupdate(4Hz)触发,宿主侧决定节流/落库。直播无义(duration 0)不报。
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  useEffect(() => {
    if (!onProgress) return
    const el = videoRef.current
    if (!el) return
    const handle = () => {
      const dur = Number.isFinite(el.duration) ? el.duration : 0
      if (dur <= 0) return
      onProgressRef.current?.(el.currentTime, dur)
    }
    el.addEventListener("timeupdate", handle)
    return () => el.removeEventListener("timeupdate", handle)
  }, [stream?.url])

  // 播完上报(自动播下一条)。与 onProgress 同款:直接听元素事件,覆盖全部播放分支
  // (含没有 VideoShell 的兜底裸 <video>)。ref 存回调,避免每次渲染重挂监听。
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  useEffect(() => {
    if (!onEnded) return
    const el = videoRef.current
    if (!el) return
    const handle = () => onEndedRef.current?.()
    el.addEventListener("ended", handle)
    return () => el.removeEventListener("ended", handle)
  }, [stream?.url])

  // 解析失败展示。
  if (error) {
    const msg = error instanceof Error ? error.message : String(error)
    // 失败分类由 resolve 统一给出（auth / risk / rate-limit / network / …），
    // 不再用正则把 403 一律误判成「需要登录」。
    const kind = errorKindOf(error)
    const needLogin = kind === "auth"
    const title = needLogin ? "需要登录" : kind === "unknown" ? "解析失败" : ERROR_KIND_LABEL[kind]
    return (
      <MediaState
        tone="error"
        title={title}
        detail={
          needLogin
            ? "这个源需要登录态。到「账号与凭证」扫码或粘贴 cookie 后重试。"
            : kind === "rate-limit"
              ? `平台正在限流/冷却，稍后重试。\n${msg}`
              : msg
        }
        action={
          <button type="button" className={MS_BTN} onClick={retryResolve}>
            重试
          </button>
        }
      />
    )
  }

  if (!hasPlayable) {
    if (!resolve) return null
    // ⚠️ 设置里关掉「自动播放」时 autoResolve=false → 不自动解析,resolved 恒 null。
    // 必须给一个**播放按钮**触发 handlePlay,否则用户永久卡在「正在解析…」且无出路
    // (VideoShell 的大播放键要求 hasPlayable 为真,这里永远到不了)。
    if (!autoResolve) {
      return (
        <MediaState
          title="准备播放"
          detail="已关闭自动播放。点下方按钮开始解析并播放。"
          action={
            <button type="button" className={MS_BTN} onClick={() => void handlePlay()}>
              播放
            </button>
          }
        />
      )
    }
    // autoResolve:挂载即解析。解析中占住 16:9 —— 旧实现是无样式 div 里的 48px
    // 空白环,挤在舞台左上角,解析完成后画面撑开导致整页跳一下。
    return <MediaState tone="loading" title="正在解析…" detail="正在向平台取直链。" />
  }

  if (!stream) {
    return (
      <MediaState
        title="暂时没有可播流"
        detail="房间可能未开播,或该内容已下架。稍后重试,或到订阅里刷新一次。"
        action={
          <button type="button" className={MS_BTN} onClick={retryResolve}>
            重试
          </button>
        }
      />
    )
  }

  // ⚠️ 这两块也走 MediaState(黑底 + 写死配色):它们同样是**舞台占位**,原来的
  // red-300/zinc-300 是浅底深字,在纯黑舞台上比加载态还突兀,且三处配色互不相同。
  if (playError) {
    return (
      <MediaState
        tone="error"
        title="播放失败"
        detail={playError instanceof Error ? playError.message : String(playError)}
        action={
          <button
            type="button"
            className={MS_BTN}
            onClick={() => {
              log.userRetry()
              setPlayError(null)
              setRetryKey((k) => k + 1)
            }}
          >
            重试
          </button>
        }
      />
    )
  }

  // 真 rtmp 播不了。
  if (isRtmp(stream)) {
    return <MediaState title="无法直接播放" detail="该流为 rtmp 协议,当前浏览器无法直接播放。" />
  }

  // 渐进式视频 / HLS / FLV / DASH → VideoShell 外壳(自定义控件)。
  if (isProgressiveVideo(stream) || needsStreamPlayer) {
    return (
      <VideoShell
        videoRef={videoRef}
        isStreaming={needsStreamPlayer}
        src={isProgressiveVideo(stream) ? stream.url : undefined}
        autoPlay={autoPlay}
        qualityOptions={qualityOptions}
        activeQuality={stream.rate}
        stats={needsStreamPlayer ? engineStats : { engine: "native" }}
        onQuality={switchQuality}
        onMediaError={(code, msg) => {
          setPlayError(new Error(`原生媒体错误(code=${code ?? "?"}): ${msg}`))
          onError?.(new Error(msg))
        }}
        danmaku={danmaku}
        danmakuControl={danmakuControl}
      />
    )
  }

  // 渐进式音频(mp3/aac/ogg)→ AudioShell 原生 <audio>。
  if (isProgressiveAudio(stream)) {
    return (
      <AudioShell
        src={stream.url}
        autoPlay={autoPlay}
        startAtSec={startAtSec}
        onProgress={onProgress}
        onEnded={onEnded}
        onError={(e) => {
          setPlayError(e)
          onError?.(e)
        }}
        qualityOptions={qualityOptions}
        activeQuality={stream.rate}
        onQuality={switchQuality}
        className={className}
      />
    )
  }

  // ⚠️ 既无 url 又无 dashManifest 才真是无流(dash 流 url 为空但靠 dashManifest 播)。
  // 不判的话兜底 video 会是永不加载的黑框,且原生 video 无 src 不触发 onError。
  if (!stream.url && !stream.dashManifest) {
    return <MediaState title="暂时没有可播流" detail="平台未返回可解析的直链(可能是拼装失败或需要登录)。" />
  }

  // 未知流类型:兜底原生 <video>(如 youtube 直链失败兜底的 format:"web")。
  // 统一自撑 16:9(与 VideoShell 对齐):容器 padding-top 撑高,video absolute 填满,
  // 未初始化的 video 不会以默认 300x150 尺寸悬浮。
  return (
    <div className="relative w-full bg-black" style={{ paddingTop: "56.25%" }}>
      <video
        ref={videoRef}
        src={stream.url}
        controls
        autoPlay={autoPlay}
        className="absolute inset-0 h-full w-full object-contain"
        onError={() => {
          // 兜底分支也必须报错：否则未知格式/失效直链表现为「永久黑框、无提示、无重试」。
          onError?.(new Error(`媒体加载失败：${stream.url || "DASH manifest"}`))
        }}
        onLoadedMetadata={(e) => {
          // 兜底分支(未知流类型)的原生 <video>:续播跳转在这里做(duration 已知)。
          const el = e.currentTarget
          const at = startAtSec ?? 0
          if (at > 3 && !resumedRef.current) {
            resumedRef.current = true
            try {
              el.currentTime = at
            } catch {
              /* ignore */
            }
          }
        }}
      />
    </div>
  )
}
