/**
 * ArticleRenderer — 文章条目标题/摘要/作者/时间 + 图片附件缩略图。
 */
import type { CSSProperties } from "react"
import type { ArticleItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"

export function ArticleRenderer({
  item,
  onOpen,
  onToggleRead,
  onToggleStar,
}: { item: ArticleItem } & RendererCallbacks) {
  const img = item.media?.find((m) => m.kind === "image")
  return (
    <article style={styles.card} onClick={() => item.url && onOpen?.(item.url)}>
      <div style={styles.head}>
        <h3 style={styles.title}>{item.title}</h3>
        <span style={styles.kind}>article</span>
      </div>
      {img && <img src={img.url} alt="" style={styles.thumb} loading="lazy" referrerPolicy="no-referrer" />}
      {/* summary 是 HTML(HN 等链接聚合源的元信息 / 文章正文摘要),按 HTML 渲染使链接可点 */}
      {item.summary && <p style={styles.summary} dangerouslySetInnerHTML={{ __html: item.summary }} />}
      <div style={styles.meta}>
        {item.author?.name && <span>{item.author.name}</span>}
        {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleString()}</span>}
        <button onClick={(e) => { e.stopPropagation(); onToggleRead?.(item) }}>{(item.isUnread ?? true) ? "标已读" : "标未读"}</button>
        <button onClick={(e) => { e.stopPropagation(); onToggleStar?.(item) }}>{item.isStarred ? "★" : "☆"}</button>
      </div>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  card: { border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 8, cursor: "pointer" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { margin: 0, fontSize: 16 },
  kind: { fontSize: 12, color: "#888", border: "1px solid #ccc", borderRadius: 4, padding: "0 6px" },
  thumb: { maxWidth: 120, maxHeight: 80, objectFit: "cover", borderRadius: 4, marginTop: 8 },
  summary: { fontSize: 14, color: "#555", margin: "8px 0 0" },
  meta: { display: "flex", gap: 12, fontSize: 12, color: "#888", marginTop: 8, alignItems: "center" },
}
