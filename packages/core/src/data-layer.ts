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
import {
  getChannel,
  isDanmakuPlayable,
  isHotWordSource,
  isPageable,
  isRssLiveSource,
  isRssVideoSource,
  listChannels as listCrawlerChannels,
  registerAllChannels,
} from "@tauri-playground/crawler"
import { serializeFeed } from "@tauri-playground/xml"
import { deserializeFeed } from "./xml/deserialize.ts"
import { NoChannelError } from "./errors.ts"
import type { ChannelInfo } from "./types/channel-info.ts"
import type { ResolvePlayback } from "./types/playback.ts"
import type { RefreshResult } from "./types/refresh-result.ts"
import type { MediaQuery } from "./types/query.ts"
import type { MediaItem, MediaKind } from "./types/media-item.ts"
import type { AppSettings } from "./types/settings.ts"
import {
  createSubscriptionRepository,
  type SubscriptionRepository,
} from "./repo/subscription-repo.ts"
import { createReadingRepository, type ReadingRepository } from "./repo/reading-repo.ts"
import { createSettingsRepository, type SettingsRepository } from "./repo/settings-repo.ts"
import { createMediaStore } from "./store/media-store.ts"

export interface DataLayer {
  /** 可用渠道列表(添加订阅对话框;core 收敛 crawler 注册表,apps 不直接碰 crawler)。 */
  listChannels(): ChannelInfo[]
  /** 订阅的 channel kind(UI 按 kind 分发用;channelKey 来自 Subscription)。 */
  channelKind(channelKey: string): MediaKind | undefined
  /** 创建订阅(channelKey + info)并刷新,返回新订阅 id。 */
  addSubscription(channelKey: string, title: string, info: Record<string, string>): Promise<string>
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
  /** 懒解析某条 video item 的可播流(播放时调用;URL 带 deadline 签名,不缓存)。
   *  返回流 + 弹幕能力(source 具备 DanmakuPlayable 时附带,一次拿齐)。 */
  resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback>
  /** 懒解析某直播房间的可播流(播放时调用;playUrls 带 expiry 签名,不缓存)。 */
  resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback>
  /** 热搜词 → 该词下内容流(desktop 热搜三栏右栏;不持久,直接返回 MediaItem[])。 */
  resolveHotWord(subscriptionId: string, word: string): Promise<MediaItem[]>
  /** 订阅是否支持分页加载更多(hot 发现流;UI 据此显隐「加载更多」)。 */
  canLoadMore(subscriptionId: string): Promise<boolean>
  /** 加载更多:翻一页追加进 store。游标由 DataLayer 内部维护,refresh 后重置。 */
  loadMore(subscriptionId: string): Promise<{ addedCount: number; hasMore: boolean }>
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
  /** 分页游标:订阅 → 当前翻到的位置(refresh 重置;UI 无感,由 loadMore 内部维护)。 */
  const pageCursors = new Map<string, string>()

  /** 按 channelKey 前缀匹配的 core 层默认 cookie(bili/weibo/xhs)。订阅显式 info.cookie 永远优先。 */
  function cookieFor(channelKey: string, s: AppSettings): string | undefined {
    if (channelKey.startsWith("bili:")) return s.bilibiliCookie
    if (channelKey.startsWith("weibo:")) return s.weiboCookie
    if (channelKey.startsWith("xhs:")) return s.xhsCookie
    return undefined
  }

  /** 合并 core 层默认 cookie 到订阅 info。 */
  async function sourceInfoFor(sub: { channelKey: string; info: Record<string, string> }): Promise<Record<string, string>> {
    const s = await settings.get()
    const cookie = cookieFor(sub.channelKey, s)
    if (!cookie || sub.info["cookie"]) return sub.info
    return { ...sub.info, cookie }
  }

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
      const info = await sourceInfoFor(sub)
      const xml = await channel.getSource(info).fetch()
      const items = deserializeFeed(xml, { subscriptionId, kind: channel.kind, now: now() })
      store.replace(subscriptionId, items)
      pageCursors.delete(subscriptionId) // 新首页 → 分页游标重置(从头翻)
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

  async function resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback> {
    const sub = await repo.get(subscriptionId)
    if (!sub) throw new Error("subscription not found")
    const channel = getChannel(sub.channelKey)
    if (!channel) throw new NoChannelError(sub.channelKey)
    // 能力在 source 上:实例化源 → 探测是否有 resolvePlay(不依赖 kind)。
    const info = await sourceInfoFor(sub)
    const source = channel.getSource(info)
    if (!isRssVideoSource(source)) {
      throw new Error(`channel ${sub.channelKey} does not support video play resolution`)
    }
    const streams = await source.resolvePlay(itemId)
    // 弹幕能力随解析结果一并给(同一 source 同 implements DanmakuPlayable 时)。
    const danmaku = isDanmakuPlayable(source) ? source.getDanmaku(itemId) : undefined
    return { streams, danmaku }
  }

  async function resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback> {
    const sub = await repo.get(subscriptionId)
    if (!sub) throw new Error("subscription not found")
    const channel = getChannel(sub.channelKey)
    if (!channel) throw new NoChannelError(sub.channelKey)
    // 能力在 source 上:实例化源 → 探测是否有 resolveLivePlay(不依赖 kind)。
    const info = await sourceInfoFor(sub)
    const source = channel.getSource(info)
    if (!isRssLiveSource(source)) {
      throw new Error(`channel ${sub.channelKey} does not support live play resolution`)
    }
    const streams = await source.resolveLivePlay(roomId)
    // 弹幕能力随解析结果一并给(直播聊天 / 视频 VOD 同一接口)。
    const danmaku = isDanmakuPlayable(source) ? source.getDanmaku(roomId) : undefined
    return { streams, danmaku }
  }

  async function resolveHotWord(subscriptionId: string, word: string): Promise<MediaItem[]> {
    const sub = await repo.get(subscriptionId)
    if (!sub) throw new Error("subscription not found")
    const channel = getChannel(sub.channelKey)
    if (!channel) throw new NoChannelError(sub.channelKey)
    // 能力在 source 上:实例化源 → 探测是否有 resolveHotWord。
    const info = await sourceInfoFor(sub)
    const source = channel.getSource(info)
    if (!isHotWordSource(source)) {
      throw new Error(`channel ${sub.channelKey} does not support hot word resolution`)
    }
    const items = await source.resolveHotWord(word)
    // 复用全链路 XML 契约:crawler Item[] → XML → core MediaItem[]。
    const xml = serializeFeed(items, { channelTitle: channel.name })
    return deserializeFeed(xml, { subscriptionId, kind: channel.kind, now: now() })
  }

  /** 订阅是否支持分页加载更多(hot 发现流;UI 据此显隐「加载更多」)。 */
  async function canLoadMore(subscriptionId: string): Promise<boolean> {
    const sub = await repo.get(subscriptionId)
    if (!sub) return false
    const channel = getChannel(sub.channelKey)
    if (!channel) return false
    const info = await sourceInfoFor(sub)
    const supported = isPageable(channel.getSource(info))
    log.log("debug", "canLoadMore", { subscriptionId, supported })
    return supported
  }

  /** 加载更多:翻一页追加进 store。游标内部维护(refresh 后重置);本页为空 = 没有更多。 */
  async function loadMore(subscriptionId: string): Promise<{ addedCount: number; hasMore: boolean }> {
    const sub = await repo.get(subscriptionId)
    if (!sub) return { addedCount: 0, hasMore: false }
    const channel = getChannel(sub.channelKey)
    if (!channel) return { addedCount: 0, hasMore: false }
    const info = await sourceInfoFor(sub)
    const source = channel.getSource(info)
    if (!isPageable(source)) return { addedCount: 0, hasMore: false }
    const cursor = pageCursors.get(subscriptionId)
    log.log("debug", "loadMore", { subscriptionId, cursor })
    const { xml, cursor: nextCursor } = await source.fetchMore(cursor)
    const items = deserializeFeed(xml, { subscriptionId, kind: channel.kind, now: now() })
    store.append(subscriptionId, items)
    if (nextCursor) pageCursors.set(subscriptionId, nextCursor)
    else pageCursors.delete(subscriptionId)
    log.log("info", "loadMore done", { subscriptionId, addedCount: items.length, hasMore: !!nextCursor })
    return { addedCount: items.length, hasMore: !!nextCursor }
  }

  /** 渠道列表投影(crawler RssChannel → core ChannelInfo,不透 source 装配)。 */
  function listChannels(): ChannelInfo[] {
    return listCrawlerChannels().map((c) => ({
      key: c.key,
      name: c.name,
      kind: c.kind,
      sourceInfoTpl: c.sourceInfoTpl,
      defaultInfo: c.defaultInfo,
    }))
  }

  function channelKind(channelKey: string): MediaKind | undefined {
    return getChannel(channelKey)?.kind
  }

  /** 创建订阅并刷新(拼 id + add + refresh 的编排收敛进 core)。 */
  async function addSubscription(channelKey: string, title: string, info: Record<string, string>): Promise<string> {
    const id = `s-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const t = now()
    await repo.add({ id, channelKey, title, enabled: true, info, createdAt: t, updatedAt: t })
    await refresh(id)
    return id
  }

  return {
    listChannels,
    channelKind,
    addSubscription,
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
    resolvePlay,
    resolveLivePlay,
    resolveHotWord,
    canLoadMore,
    loadMore,
  }
}
