/**
 * Query types for the app layer's item queries (react-query keys / store queries).
 */
import type { ContentKind } from "./content.ts"

/** Filter for listing items across feeds. */
export interface ItemsQuery {
  feedIds?: string[]
  folderId?: string
  kind?: ContentKind | "mixed"
  unreadOnly?: boolean
  starredOnly?: boolean
  /** Pagination cursor (feed-specific). */
  cursor?: string
  /** Page size for infinite lists. */
  limit?: number
}
