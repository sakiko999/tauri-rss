/**
 * MiniPlayer —— 播客迷你播放条（原型 mini-pod）。
 *
 * 播放本身在 `audio-session.ts` 的单例元素里，所以离开播放页照样能听；这条只是它的
 * 第二个控制面（封面 / 标题 / 进度 / 播放暂停 / 关闭）。点标题回播放页。
 * ⚠️ 正在播的**就是当前播放页那一条**时不渲染 —— 播放页自己有一整张播放面。
 */

import { MediaImage } from "@amoeba/ui"
import { useParams } from "react-router"

import { Icon } from "../../components/Icon.tsx"
import { mediaUrl } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { usePlayNavigate } from "../../router.tsx"
import { useAudioSession } from "./audio-session.ts"

export function MiniPlayer() {
  const item = useAudioSession((s) => s.item)
  const playing = useAudioSession((s) => s.playing)
  const position = useAudioSession((s) => s.position)
  const duration = useAudioSession((s) => s.duration)
  const error = useAudioSession((s) => s.error)
  const toggle = useAudioSession((s) => s.toggle)
  const close = useAudioSession((s) => s.close)
  const params = useParams()
  const playTo = usePlayNavigate()

  if (!item) return null
  if (params.itemId === item.id) return null

  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0
  const fmt = (sec: number) => {
    const s = Math.floor(Math.max(0, sec) % 60)
    const m = Math.floor((Math.max(0, sec) / 60) % 60)
    const h = Math.floor(Math.max(0, sec) / 3600)
    return `${h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m)}:${String(s).padStart(2, "0")}`
  }

  return (
    <div className="mini-player" data-playing={playing ? "on" : undefined} {...overlayBlock("mini-player", "mini")}>
      <button type="button" className="mp-cover" aria-label="打开播放页" onClick={() => playTo(item)}>
        <MediaImage src={mediaUrl(item)} ratio={1} fill />
      </button>
      <div className="mp-body">
        <button type="button" className="mp-title od-truncate" onClick={() => playTo(item)}>
          {item.title}
        </button>
        <span className="mp-sub od-truncate">{error ? `播放失败：${error}` : (item.author?.name ?? "播客")}</span>
        <span className="mp-track" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      <span className="mp-time num">{duration > 0 ? `${fmt(position)} / ${fmt(duration)}` : "--:--"}</span>
      <button
        type="button"
        className="mp-btn"
        aria-label={playing ? "暂停" : "播放"}
        aria-pressed={playing}
        onClick={toggle}
      >
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
      <button type="button" className="mp-btn" aria-label="关闭播客播放器" onClick={close}>
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}
