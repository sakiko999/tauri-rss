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
  /** 改组名/图标;返回更新后的组。 */
  updateGroup(id: string, patch: Partial<Omit<SubscriptionGroup, "id">>): Promise<SubscriptionGroup | undefined>
  removeGroup(id: string): Promise<void>
}

export function createSubscriptionRepository(
  storage: StorageBackend,
  now: () => number,
): SubscriptionRepository {
  /**
   * 读-改-写串行化:订阅树是单个 KV blob,任意两个并发变更(快速连点编辑 /
   * add 撞上 toggle / 删除分组时批量迁移成员)都会各自读到同一份旧快照,后写者
   * 覆盖前者 —— 表现为「改了没保存」。
   */
  let serial: Promise<unknown> = Promise.resolve()
  function run<T>(fn: () => Promise<T>): Promise<T> {
    const next = serial.then(fn, fn)
    serial = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async function load(): Promise<PersistedState> {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return { subscriptions: [], groups: [] }
    try {
      const parsed = JSON.parse(raw) as PersistedState
      // save() 恒写完整结构;缺字段只可能是坏数据 → 走 catch 的留证/重建流程。
      if (!Array.isArray(parsed?.subscriptions) || !Array.isArray(parsed?.groups)) {
        throw new Error("invalid persisted subscriptions blob")
      }
      return parsed
    } catch {
      // ⚠️ 解析失败不能静默返回空树:下一次 add/update 就会把空树写回去,用户的订阅
      // 与分组永久消失。先留证再让调用方按「无订阅」继续。
      try {
        await storage.set(`${STORAGE_KEY}:corrupt`, raw)
        await storage.delete(STORAGE_KEY)
      } catch {
        /* 留存失败也继续,不能在加载路径上抛。 */
      }
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
      return run(async () => {
        const state = await load()
        // ⚠️ 按 id 去重:重复 add 同 id 会留下两条,而 get/update 只命中首个、remove 删全部
        // → 语义不一致(更新只改一条、删却删两条)。存在则原地覆盖。
        const existing = state.subscriptions.findIndex((s) => s.id === subscription.id)
        if (existing !== -1) state.subscriptions[existing] = subscription
        else state.subscriptions.push(subscription)
        await save(state)
      })
    },

    async update(id, patch) {
      return run(async () => {
        const state = await load()
        const idx = state.subscriptions.findIndex((s) => s.id === id)
        if (idx === -1) return undefined
        const prev = state.subscriptions[idx]!
        // ⚠️ 不许把 channelKey 改空:空了之后 refresh 抛 NoChannelError,订阅静默失效。
        const next: Subscription = { ...prev, ...patch, id, updatedAt: now() }
        if (!next.channelKey) next.channelKey = prev.channelKey
        state.subscriptions[idx] = next
        await save(state)
        return next
      })
    },

    async remove(id) {
      return run(async () => {
        const state = await load()
        state.subscriptions = state.subscriptions.filter((s) => s.id !== id)
        await save(state)
      })
    },

    async addGroup(group) {
      return run(async () => {
        const state = await load()
        // ⚠️ 按 id 去重(与 add 同款):重复 addGroup 同 id 会留两条,updateGroup/removeGroup
        // 只命中首个 → 改名/删除后另一条残留,指向它的订阅落到孤儿分组。存在则原地覆盖。
        const existing = state.groups.findIndex((g) => g.id === group.id)
        if (existing !== -1) state.groups[existing] = group
        else state.groups.push(group)
        await save(state)
      })
    },

    async updateGroup(id, patch) {
      return run(async () => {
        const state = await load()
        const idx = state.groups.findIndex((g) => g.id === id)
        if (idx === -1) return undefined
        const next: SubscriptionGroup = { ...state.groups[idx]!, ...patch, id }
        state.groups[idx] = next
        await save(state)
        return next
      })
    },

    async removeGroup(id) {
      return run(async () => {
        const state = await load()
        state.groups = state.groups.filter((g) => g.id !== id)
        await save(state)
      })
    },
  }
}
