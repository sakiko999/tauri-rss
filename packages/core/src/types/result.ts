/**
 * Result types shared across source adapters and the data layer.
 */

/**
 * A resolved live play URL set. Live URLs expire and are resolved on demand
 * (see `DataLayer.resolveLivePlay`), so this is a *result*, not stored state.
 */
export interface LivePlayUrl {
  urls: string[]
  headers?: Record<string, string>
  quality?: string
}

/** Outcome of a single subscription refresh. */
export interface RefreshResult {
  subscriptionId: string
  itemCount: number
  /** Present when the refresh failed (the subscription stays, items untouched). */
  error?: string
  fetchedAt: number
}
