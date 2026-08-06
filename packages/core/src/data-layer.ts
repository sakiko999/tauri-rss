/**
 * DataLayer — app 层与数据层之间的单一公共 seam。
 *
 * app 层通过 `store` 读内容、调 `refresh()` 拉订阅、经 subscriptions/reading/
 * settings 三个 repo 维护配置。宿主能力来自全局 `globalThis.appHost`
 * (注入见根 global.d.ts),无 createDataLayer(host) 参数。
 *
 * 编排:订阅存 `channelKey` + `info`,refresh 时查 crawler 注册表 →
 * `channel.getSource(info).fetch()` 得 RSS XML → `deserializeFeed` → store.replace。
 */
import { getChannel, registerAllChannels } from "@tauri-playground/crawler"
import { deserializeFeed } from "./xml/deserialize.ts"
import { NoChannelError } from "./errors.ts"
import type { RefreshResult } from "./types/refresh-result.ts"
import type { MediaQuery } from "./types/query.ts"
import type { MediaItem } from "./types/media-item.ts"
import {
  createSubscriptionRepository,
  type SubscriptionRepository,
} from "./repo/subscription-repo.ts"
import { createReadingRepository, type ReadingRepository } from "./repo/reading-repo.ts"
import { createSettingsRepository, type SettingsRepository } from "./repo/settings-repo.ts"
import { createMediaStore } from "./store/media-store.ts"

export interface DataLayer {
  /** 订阅配置(CRUD + 分组)。 */
  readonly subscriptions: SubscriptionRepository
  /** 阅读状态(已读 / 续播位置)。 */
  readonly reading: ReadingRepository
  /** app 设置。 */
  readonly settings: SettingsRepository
  /** 内容 store(查询 + 订阅)。 */
  readonly store: {
    all(): MediaItem[]
    query(query?: MediaQuery): MediaItem[]
    patch(id: string, patch: Partial<MediaItem>): void
    subscribe(listener: () => void): () => void
  }
  /** 刷新一次订阅,把内容写入 store。 */
  refresh(subscriptionId: string): Promise<RefreshResult>
}

export function createDataLayer(): DataLayer {
  registerAllChannels()
  // 全局 appHost 门面(getter 校验未注入抛清晰错误;now/log 兜底)。
  const storage = globalThis.appHost.storage
  const now = globalThis.appHost.now!
  const log = globalThis.appHost.log!
  const repo = createSubscriptionRepository(storage, now)
  const reading = createReadingRepository(storage, now)
  const settings = createSettingsRepository(storage)
  const store = createMediaStore(now)

  async function refresh(subscriptionId: string): Promise<RefreshResult> {
    const sub = await repo.get(subscriptionId)
    if (!sub) {
      return {
        subscriptionId,
        itemCount: 0,
        error: "subscription not found",
        fetchedAt: now(),
      }
    }
    try {
      // 未注册的 channelKey 是配置错误——throw 后由 catch 统一返回 error 结果。
      const channel = getChannel(sub.channelKey)
      if (!channel) throw new NoChannelError(sub.channelKey)
      const xml = await channel.getSource(sub.info).fetch()
      const items = deserializeFeed(xml, { subscriptionId, kind: channel.kind, now: now() })
      store.replace(subscriptionId, items)
      return { subscriptionId, itemCount: items.length, fetchedAt: now() }
    } catch (err) {
      log.log("error", "refresh failed", { subscriptionId, error: String(err) })
      return {
        subscriptionId,
        itemCount: 0,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt: now(),
      }
    }
  }

  return {
    subscriptions: repo,
    reading,
    settings,
    store: {
      all: () => store.all(),
      query: (q) => store.query(q),
      patch: (id, patch) => store.patch(id, patch),
      subscribe: (l) => store.subscribe(l),
    },
    refresh,
  }
}
