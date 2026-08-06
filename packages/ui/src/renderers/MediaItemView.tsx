/**
 * MediaItemView — 按 item.kind 分发到对应渲染器。
 * social 目前无真实源,走最简 fallback。
 */
import type { CSSProperties } from "react"
import type { MediaItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { ArticleRenderer } from "./ArticleRenderer.tsx"
import { VideoRenderer } from "./VideoRenderer.tsx"
import { AudioRenderer } from "./AudioRenderer.tsx"
import { LiveRenderer } from "./LiveRenderer.tsx"

export function MediaItemView({ item, ...callbacks }: { item: MediaItem } & RendererCallbacks) {
  switch (item.kind) {
    case "article":
      return <ArticleRenderer item={item} {...callbacks} />
    case "video":
      return <VideoRenderer item={item} {...callbacks} />
    case "audio":
      return <AudioRenderer item={item} {...callbacks} />
    case "live":
      return <LiveRenderer item={item} {...callbacks} />
    case "social":
      return (
        <article style={fallbackStyle}>
          <h3>{item.title}</h3>
          <p>{item.content}</p>
        </article>
      )
  }
}

const fallbackStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 12,
  marginBottom: 8,
}
