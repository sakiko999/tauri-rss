/**
 * AudioRenderer — 音频/播客条目标题/封面/艺术家/时长 + 播放链接。
 * 播放直链可直接用(播客 mp3 无签名),此处显示 <audio> 或链接。
 */
import type { CSSProperties } from "react"
import type { AudioItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"

function fmtDuration(sec?: number): string {
  if (sec === undefined) return ""
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function AudioRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: AudioItem } & RendererCallbacks) {
  return (
    <article style={styles.card} onClick={() => item.url && onOpen?.(item.url)}>
      <div style={styles.body}>
        {item.thumbnail && <img src={item.thumbnail} alt="" style={styles.cover} loading="lazy" referrerPolicy="no-referrer" />}
        <div style={styles.info}>
          <div style={styles.head}>
            <h3 style={styles.title}>{item.title}</h3>
            <span style={styles.kind}>audio</span>
          </div>
          <div style={styles.meta}>
            {(item.artist || item.author?.name) && <span>{item.artist ?? item.author?.name}</span>}
            {fmtDuration(item.duration) && <span>{fmtDuration(item.duration)}</span>}
            {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString()}</span>}
          </div>
          {item.stream?.url && (
            <audio controls src={item.stream.url} preload="none" style={styles.audio} onClick={(e) => e.stopPropagation()} />
          )}
          <div style={styles.actions}>
            <button onClick={(e) => { e.stopPropagation(); onToggleRead?.(item) }}>{(item.isUnread ?? true) ? "标已读" : "标未读"}</button>
            <button onClick={(e) => { e.stopPropagation(); onToggleStar?.(item) }}>{item.isStarred ? "★" : "☆"}</button>
          </div>
        </div>
      </div>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  card: { border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 8, cursor: "pointer" },
  body: { display: "flex", gap: 12 },
  cover: { width: 80, height: 80, objectFit: "cover", borderRadius: 4, flexShrink: 0 },
  info: { flex: 1 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { margin: 0, fontSize: 16 },
  kind: { fontSize: 12, color: "#888", border: "1px solid #ccc", borderRadius: 4, padding: "0 6px" },
  meta: { display: "flex", gap: 12, fontSize: 12, color: "#888", marginTop: 4 },
  audio: { width: "100%", marginTop: 8 },
  actions: { display: "flex", gap: 8, marginTop: 8 },
}
