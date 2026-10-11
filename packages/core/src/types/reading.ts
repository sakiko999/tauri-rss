/**
 * Reading state — user-local read progress + playback position, persisted
 * via a `ReadingRepository` (zustand persist in the app layer).
 */
export interface ReadRecord {
  read: boolean
  /**
   * 星标。⚠️ 必须有持久层:条目在 refresh 时整批重建(deserialize 默认
   * isStarred=false),只 patch 内存 store 的话重启/刷新后星标就丢了。
   */
  starred?: boolean
  /** 音视频续播位置（秒） */
  positionSec?: number
  /** 文章滚动位置（0..1） */
  scrollRatio?: number
  lastReadAt: number
}

export type ReadingMap = Record<string, ReadRecord>
