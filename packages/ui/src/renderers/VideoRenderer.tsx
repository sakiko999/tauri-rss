/**
 * VideoRenderer — 视频条目标题/封面(poster)/频道/时长/摘要。
 * 播放直链需懒解析(deadline 签名),此处只显示链接。
 */
import type { CSSProperties } from "react"
import type { VideoItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"

function fmtDuration(sec?: number): string {
  if (sec === undefined) return ""
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function VideoRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: VideoItem } & RendererCallbacks) {
  return (
    <article style={styles.card} onClick={() => item.url && onOpen?.(item.url)}>
      <div style={styles.body}>
        {item.poster && <img src={item.poster} alt="" style={styles.poster} loading="lazy" referrerPolicy="no-referrer" />}
        <div style={styles.info}>
          <div style={styles.head}>
            <h3 style={styles.title}>{item.title}</h3>
            <span style={styles.kind}>video</span>
          </div>
          <div style={styles.meta}>
            {item.channel?.name && <span>{item.channel.name}</span>}
            {fmtDuration(item.duration) && <span>{fmtDuration(item.duration)}</span>}
            {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString()}</span>}
          </div>
          {item.summary && <p style={styles.summary}>{item.summary}</p>}
          {item.stream?.url && (
            <a href={item.stream.url} onClick={(e) => e.stopPropagation()}>▶ 播放</a>
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
  poster: { width: 120, height: 68, objectFit: "cover", borderRadius: 4, flexShrink: 0 },
  info: { flex: 1 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { margin: 0, fontSize: 16 },
  kind: { fontSize: 12, color: "#888", border: "1px solid #ccc", borderRadius: 4, padding: "0 6px" },
  meta: { display: "flex", gap: 12, fontSize: 12, color: "#888", marginTop: 4 },
  summary: { fontSize: 14, color: "#555", margin: "8px 0 0" },
  actions: { display: "flex", gap: 8, marginTop: 8 },
}
