/**
 * LiveRenderer — 直播房间标题/状态/在线人数/介绍。
 * playUrls 懒解析(带 expiry 签名),此处只显示状态。
 */
import type { CSSProperties } from "react"
import type { LiveItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"

const STATUS_LABEL: Record<LiveItem["liveStatus"], string> = {
  live: "● 直播中",
  offline: "已停播",
  unknown: "未知",
}

export function LiveRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: LiveItem } & RendererCallbacks) {
  const isLive = item.liveStatus === "live"
  return (
    <article style={styles.card} onClick={() => item.url && onOpen?.(item.url)}>
      <div style={styles.body}>
        {item.thumbnail && <img src={item.thumbnail} alt="" style={styles.thumb} loading="lazy" referrerPolicy="no-referrer" />}
        <div style={styles.info}>
          <div style={styles.head}>
            <h3 style={styles.title}>{item.title || item.roomId}</h3>
            <span style={isLive ? styles.liveBadge : styles.kind}>{STATUS_LABEL[item.liveStatus]}</span>
          </div>
          <div style={styles.meta}>
            <span>{item.platform}</span>
            <span>房间 {item.roomId}</span>
            {item.online !== undefined && <span>在线 {item.online}</span>}
          </div>
          {item.introduction && <p style={styles.summary}>{item.introduction}</p>}
          {item.playUrls?.[0] && (
            <a href={item.playUrls[0]} onClick={(e) => e.stopPropagation()}>▶ 播放</a>
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
  thumb: { width: 120, height: 68, objectFit: "cover", borderRadius: 4, flexShrink: 0 },
  info: { flex: 1 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { margin: 0, fontSize: 16 },
  kind: { fontSize: 12, color: "#888", border: "1px solid #ccc", borderRadius: 4, padding: "0 6px" },
  liveBadge: { fontSize: 12, color: "#fff", background: "#e11", borderRadius: 4, padding: "0 6px" },
  meta: { display: "flex", gap: 12, fontSize: 12, color: "#888", marginTop: 4 },
  summary: { fontSize: 14, color: "#555", margin: "8px 0 0" },
  actions: { display: "flex", gap: 8, marginTop: 8 },
}
