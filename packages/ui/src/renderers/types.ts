/**
 * 渲染器通用回调。desktop/mobile 复用;由宿主注入(打开链接 / 标已读 / 收藏)。
 */
import type { MediaItem } from "@tauri-playground/core"

export interface RendererCallbacks {
  /** 点击条目时打开 URL(浏览器 / 详情视图)。 */
  onOpen?: (url: string) => void
  /** 切换已读状态。 */
  onToggleRead?: (item: MediaItem) => void
  /** 切换收藏。 */
  onToggleStar?: (item: MediaItem) => void
}
