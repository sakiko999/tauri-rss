/**
 * Reading state — user-local read progress + playback position, persisted
 * via a `ReadingRepository` (zustand persist in the app layer).
 */
export interface ReadRecord {
  read: boolean
  /** 音视频续播位置（秒） */
  positionSec?: number
  /** 文章滚动位置（0..1） */
  scrollRatio?: number
  lastReadAt: number
}

export type ReadingMap = Record<string, ReadRecord>
