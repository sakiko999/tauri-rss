/**
 * MediaStore — in-memory store of `MediaItem`s, queryable and observable.
 *
 * The app layer reads content from here; source adapters write to it on
 * refresh. "Smart feeds" (today / unread / starred) are *queries* over all
 * items, not special nodes — which is why subscriptions and items are separate.
 *
 * Phase 1 keeps the store in-memory. A cache/persistence layer can sit in
 * front of it later without changing this contract.
 */
import type { MediaItem } from "@tauri-playground/producer"

export type MediaStoreListener = () => void

export interface MediaQuery {
  /** Limit to one subscription. Omit for all. */
  subscriptionId?: string
  today?: boolean
  unreadOnly?: boolean
  starredOnly?: boolean
  /** Lexicographic on publishedAt desc (newest first); ties broken by id. */
}

export interface MediaStore {
  /** All items (snapshot copy). */
  all(): MediaItem[]
  /** Filtered, newest-first view per `query`. */
  query(query?: MediaQuery): MediaItem[]
  /** Replace a subscription's items with a fresh fetch. */
  replace(subscriptionId: string, items: MediaItem[]): void
  /** Patch a single item (e.g. mark read, star) by id. */
  patch(id: string, patch: Partial<MediaItem>): void
  /** Subscribe to store changes; returns an unsubscribe function. */
  subscribe(listener: MediaStoreListener): () => void
  /** Drop all items for a subscription (e.g. on unsubscribe). */
  clear(subscriptionId: string): void
}

function dayStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function createMediaStore(now: () => number = Date.now): MediaStore {
  let items: MediaItem[] = []
  const listeners = new Set<MediaStoreListener>()

  function emit(): void {
    for (const l of listeners) l()
  }

  return {
    all() {
      return [...items]
    },

    query(query = {}) {
      const startOfDay = query.today ? dayStart(now()) : -Infinity
      return items
        .filter((it) => {
          if (query.subscriptionId && it.subscriptionId !== query.subscriptionId) return false
          if (query.today && (it.publishedAt ?? 0) < startOfDay) return false
          if (query.unreadOnly && !it.isUnread) return false
          if (query.starredOnly && !it.isStarred) return false
          return true
        })
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    },

    replace(subscriptionId, next) {
      items = [...items.filter((it) => it.subscriptionId !== subscriptionId), ...next]
      emit()
    },

    patch(id, patch) {
      let changed = false
      items = items.map((it) => {
        if (it.id !== id) return it
        changed = true
        return { ...it, ...patch } as MediaItem
      })
      if (changed) emit()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    clear(subscriptionId) {
      const before = items.length
      items = items.filter((it) => it.subscriptionId !== subscriptionId)
      if (items.length !== before) emit()
    },
  }
}
