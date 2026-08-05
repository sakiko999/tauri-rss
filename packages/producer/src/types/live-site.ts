/**
 * Live platform types — shared by the per-platform live site adapters
 * (`source/{bilibili,douyu,douyin,huya}/site.ts`).
 *
 * Moved out of the old `live/` layer when live became per-platform sources.
 * `LiveSite` is kept as the internal contract each site implements; it is NOT
 * exported from the producer barrel (sites are implementation details behind
 * their SourceAdapter).
 *
 * Scope per the project decision: **status + play URL only**. The danmaku
 * surface (`getDanmaku()` / `LiveDanmaku`) is intentionally omitted — it
 * belongs to the app layer / a later phase, not the periodic data layer.
 */
import type { FeedLivePlatformId } from "./feed-item.ts"
import type { LivePlayUrl } from "./result.ts"

/** A live platform's top-level category (dart `LiveCategory`). */
export interface LiveCategory {
  id: string
  name: string
  children: LiveSubCategory[]
}

export interface LiveSubCategory {
  id: string
  name: string
  pic?: string
  parentId: string
}

/** A room card in a list (dart `LiveRoomItem`). */
export interface LiveRoomItem {
  roomId: string
  title: string
  cover: string
  userName: string
  online?: number
}

/** A paginated room list (dart `LiveCategoryResult` / search results). */
export interface LiveRoomPage {
  hasMore: boolean
  items: LiveRoomItem[]
}

/** An anchor/room in search results (dart `LiveAnchorItem`). */
export interface LiveAnchorItem {
  roomId: string
  avatar: string
  userName: string
  liveStatus: boolean
}

export interface LiveAnchorPage {
  hasMore: boolean
  items: LiveAnchorItem[]
}

/** Available playback quality for a room (dart `LivePlayQuality`). */
export interface LivePlayQuality {
  quality: string
  /** Opaque site-specific data needed to resolve URLs (e.g. line token). */
  data?: unknown
  sort?: number
}

/**
 * A room's full metadata (dart `LiveRoomDetail`).
 *
 * `data`/`danmakuData` from the Dart version are dropped (the danmaku args
 * were only for the omitted danmaku surface; per-platform play-resolution
 * state rides on `data` as `unknown` when an adapter still needs it).
 */
export interface LiveRoomDetail {
  roomId: string
  title: string
  cover: string
  userName: string
  userAvatar: string
  online: number
  introduction?: string
  notice?: string
  status: boolean
  isRecord?: boolean
  url: string
  showTime?: string
  /** Per-platform state needed for play resolution (opaque, explicit). */
  data?: unknown
}

/**
 * Contract a live platform implements. This is the data-layer subset of dart's
 * `LiveSite`: categories/search/rooms/detail/quality/url/status.
 *
 * Danmaku (`getDanmaku`) is out of scope and omitted here.
 */
export interface LiveSite {
  readonly platform: FeedLivePlatformId
  readonly name: string

  getCategories(): Promise<LiveCategory[]>
  searchRooms(keyword: string, page?: number): Promise<LiveRoomPage>
  searchAnchors(keyword: string, page?: number): Promise<LiveAnchorPage>
  getCategoryRooms(category: LiveSubCategory, page?: number): Promise<LiveRoomPage>
  getRecommendRooms(page?: number): Promise<LiveRoomPage>
  getRoomDetail(roomId: string): Promise<LiveRoomDetail>
  getPlayQualities(detail: LiveRoomDetail): Promise<LivePlayQuality[]>
  getPlayUrls(detail: LiveRoomDetail, quality: LivePlayQuality): Promise<LivePlayUrl>
  getLiveStatus(roomId: string): Promise<boolean>
}
