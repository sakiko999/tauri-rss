/**
 * MediaItemView — 按 item.kind 分发到对应渲染器。
 * social 目前无真实源,走最简 fallback。
 *
 * **memo + 自定义比较器**:虚拟列表(MediaList VirtuosoGrid)每个可见 item 都渲染
 * MediaItemView,若父级每次 render 传新回调引用会全量重渲染。比较器只比较
 * `item` + onOpen/onToggleRead/onToggleStar(宿主侧稳定引用:onOpen 是模块级函数,
 * onToggleRead/onToggleStar 是 store action 终身稳定)。
 *
 * ⚠️ **不变量**(依赖此比较器正确性):onResolvePlay/onResolveLivePlay/onPlayBig
 * 的行为**完全由 item 决定**(内部只用 item 的字段 + 宿主稳定函数),因此 item 引用
 * 相同 → 这三个回调行为必然相同,可安全跳过比较。若未来某回调额外依赖其他可变
 * state,必须把它纳入比较器,否则 memo 会吞掉更新(陈旧 UI)。
 */
import { memo } from "react"
import type { MediaItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { ArticleRenderer } from "./ArticleRenderer.tsx"
import { VideoRenderer } from "./VideoRenderer.tsx"
import { AudioRenderer } from "./AudioRenderer.tsx"
import { LiveRenderer } from "./LiveRenderer.tsx"
import { SocialRenderer } from "./SocialRenderer.tsx"

export const MediaItemView = memo(function MediaItemView({
  item,
  ...callbacks
}: { item: MediaItem } & RendererCallbacks) {
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
      return <SocialRenderer item={item} {...callbacks} />
  }
}, areMediaItemPropsEqual)

/**
 * 自定义比较器:item 相同 + 宿主稳定回调引用相同 → 跳过重渲染。
 * onResolvePlay/onResolveLivePlay/onPlayBig 不参与比较(见组件头不变量说明)。
 */
function areMediaItemPropsEqual(
  prev: { item: MediaItem } & RendererCallbacks,
  next: { item: MediaItem } & RendererCallbacks,
): boolean {
  return (
    prev.item === next.item &&
    prev.onOpen === next.onOpen &&
    prev.onToggleRead === next.onToggleRead &&
    prev.onToggleStar === next.onToggleStar
  )
}
