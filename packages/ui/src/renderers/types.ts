/**
 * 渲染器通用回调。desktop/mobile 复用;由宿主注入(打开链接 / 标已读 / 收藏 / 懒解析播放流)。
 */
import type { MediaItem, ResolvePlayback } from "@tauri-playground/core"

export interface RendererCallbacks {
  /** 点击条目时打开 URL(浏览器 / 详情视图)。 */
  onOpen?: (url: string) => void
  /** 切换已读状态。 */
  onToggleRead?: (item: MediaItem) => void
  /** 切换收藏。 */
  onToggleStar?: (item: MediaItem) => void
  /** 懒解析 video 可播流(播放时调用;绑定 DataLayer.resolvePlay;返回流 + 弹幕能力)。 */
  onResolvePlay?: (itemId: string) => Promise<ResolvePlayback>
  /** 懒解析 live 可播流(播放时调用;绑定 DataLayer.resolveLivePlay)。 */
  onResolveLivePlay?: (roomId: string) => Promise<ResolvePlayback>
  /** 打开模态大播放器(有则播放入口改为「大屏」,不再内嵌小播放器)。 */
  onPlayBig?: () => void
}
