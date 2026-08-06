/**
 * SubscriptionRepository — 订阅配置(follow 树)持久化,走全局 appHost.storage。
 *
 * 内容(MediaItem)在 MediaStore;本 repo 只维护订阅 + 分组的树。
 */
import type { Subscription, SubscriptionGroup } from "../types/subscription.ts"

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
  update(id: string, patch: Partial<Omit<Subscription, "id">>): Promise<Subscription | undefined>
  remove(id: string): Promise<void>
  addGroup(group: SubscriptionGroup): Promise<void>
  removeGroup(id: string): Promise<void>
}

export function createSubscriptionRepository(
  storage: StorageBackend,
  now: () => number,
): SubscriptionRepository {
  async function load(): Promise<PersistedState> {
    const raw = await storage.get(STORAGE_KEY)
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
    await storage.set(STORAGE_KEY, JSON.stringify(state))
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
      if (!subscription.channelKey) throw new Error("subscription requires channelKey")
      const state = await load()
      state.subscriptions.push(subscription)
      await save(state)
    },

    async update(id, patch) {
      const state = await load()
      const idx = state.subscriptions.findIndex((s) => s.id === id)
      if (idx === -1) return undefined
      const prev = state.subscriptions[idx]!
      const next: Subscription = { ...prev, ...patch, updatedAt: now() }
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
