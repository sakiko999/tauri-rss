/**
 * PlayableMedia —— 可播放媒体容器(video/live 用)。
 *
 * 封装"懒解析 + 播放"两个阶段:
 *   - 有初始流(refresh 已带,如 audio 的 stream)→ 直接内嵌 MediaPlayer;
 *   - 无流 → 显示「播放」按钮,点击调 `resolve()` 拿 MediaStream[] 再播。
 *   resolve 由宿主(App 层)注入——它绑定 DataLayer 的 resolvePlay/resolveLivePlay。
 */
import { useState } from "react"
import type { MediaStream } from "@tauri-playground/core"
import { MediaPlayer } from "./MediaPlayer.tsx"

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
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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
}: {
  /** refresh 已带的可播流(可选)。 */
  streams?: MediaStream[]
  /** 懒解析函数:点击播放时调用,返回可播流。 */
  resolve?: () => Promise<MediaStream[]>
  className?: string
  onError?: (err: unknown) => void
}) {
  const [resolved, setResolved] = useState<MediaStream[] | null>(null)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // 最终播放用的流:初始流或懒解析结果。
  const playStreams = resolved ?? streams ?? []
  const hasPlayable = playStreams.length > 0

  async function handlePlay() {
    if (!resolve) return
    // 用户手势内解锁 autoplay,resolve 完成后 video 才能带声音自动播。
    unlockAudioPlayback()
    setResolving(true)
    setError(null)
    try {
      const result = await resolve()
      setResolved(result)
    } catch (err) {
      console.warn("[PlayableMedia] resolve 失败:", err)
      setError(err)
      onError?.(err)
    } finally {
      setResolving(false)
    }
  }

  if (error) {
    return (
      <div className="rounded border border-red-300 p-2 text-sm text-red-600">
        解析失败:{error instanceof Error ? error.message : String(error)}
      </div>
    )
  }

  if (!hasPlayable) {
    return (
      <div>
        <button
          onClick={handlePlay}
          disabled={!resolve || resolving}
          className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50"
        >
          {resolving ? "解析中…" : "▶ 播放"}
        </button>
      </div>
    )
  }

  // resolved !== null = 用户点过「播放」按钮 → resolve 成功后自动播
  // (原生 mp4 带声起播,unlockAudioPlayback 已解除 policy;live 仍静音起播)。
  // 有初始流(未点击)不自动播。
  return <MediaPlayer streams={playStreams} className={className} onError={onError} autoPlay={resolved !== null} />
}
