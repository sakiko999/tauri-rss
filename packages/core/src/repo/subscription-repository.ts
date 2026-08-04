/**
 * SubscriptionRepository — owns subscription *config* (what you follow),
 * persisted via the host's storage backend.
 *
 * Content (MediaItem) lives in the MediaStore; this repo is only the tree of
 * subscriptions + groups. Phase 1: load/save + CRUD against `host.storage`.
 */
import type { PlatformHost } from "../types/platform.ts"
import type {
  Subscription,
  SubscriptionGroup,
  SubscriptionKind,
} from "@tauri-playground/producer"

const STORAGE_KEY = "subscriptions"

interface PersistedState {
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
}

export interface SubscriptionRepository {
  list(): Promise<Subscription[]>
  listGroups(): Promise<SubscriptionGroup[]>
  get(id: string): Promise<Subscription | undefined>
  add(subscription: Subscription): Promise<void>
  update(id: string, patch: Partial<Omit<Subscription, "id" | "kind">>): Promise<Subscription | undefined>
  remove(id: string): Promise<void>
  addGroup(group: SubscriptionGroup): Promise<void>
  removeGroup(id: string): Promise<void>
}

export function createSubscriptionRepository(host: PlatformHost): SubscriptionRepository {
  async function load(): Promise<PersistedState> {
    const raw = await host.storage.get(STORAGE_KEY)
    if (!raw) return { subscriptions: [], groups: [] }
    try {
      const parsed = JSON.parse(raw) as PersistedState
      return {
        subscriptions: parsed.subscriptions ?? [],
        groups: parsed.groups ?? [],
      }
    } catch {
      return { subscriptions: [], groups: [] }
    }
  }

  async function save(state: PersistedState): Promise<void> {
    await host.storage.set(STORAGE_KEY, JSON.stringify(state))
  }

  return {
    async list() {
      return (await load()).subscriptions
    },

    async listGroups() {
      return (await load()).groups
    },

    async get(id) {
      return (await load()).subscriptions.find((s) => s.id === id)
    },

    async add(subscription) {
      const state = await load()
      state.subscriptions.push(subscription)
      await save(state)
    },

    async update(id, patch) {
      const state = await load()
      const idx = state.subscriptions.findIndex((s) => s.id === id)
      if (idx === -1) return undefined
      const prev = state.subscriptions[idx]!
      const next: Subscription = { ...prev, ...patch, updatedAt: host.now() }
      state.subscriptions[idx] = next
      await save(state)
      return next
    },

    async remove(id) {
      const state = await load()
      state.subscriptions = state.subscriptions.filter((s) => s.id !== id)
      await save(state)
    },

    async addGroup(group) {
      const state = await load()
      state.groups.push(group)
      await save(state)
    },

    async removeGroup(id) {
      const state = await load()
      state.groups = state.groups.filter((g) => g.id !== id)
      await save(state)
    },
  }
}

/**
 * Type guard helpers for narrowing subscriptions by kind. Useful for adapters
 * and tests; cheap to keep here next to the persistence layer.
 */
export function isSubscription<S extends Subscription>(
  s: Subscription,
  kind: SubscriptionKind,
): s is S {
  return s.kind === kind
}
