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

  return <MediaPlayer streams={playStreams} className={className} onError={onError} />
}
