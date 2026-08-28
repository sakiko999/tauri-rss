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
import { isHotWordSource, isLoginable, isPageable, registerAllChannels } from "@tauri-playground/crawler"
import { getDanmakuByUrl, resolveLivePlayByUrl as resolveLiveByUrl, resolvePlayByUrl as resolveVideoByUrl } from "@tauri-playground/resolve"
import { getChannel, listChannels as listAllChannels } from "./source/index.ts"
import { serializeFeed } from "@tauri-playground/xml"
import { deserializeFeed, deserializeFeedWithTotal } from "./processing/deserialize.ts"
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
import { createContentCacheRepo } from "./repo/content-cache-repo.ts"
import { createReadingRepository, type ReadingRepository } from "./repo/reading-repo.ts"
import { createSettingsRepository, type SettingsRepository } from "./repo/settings-repo.ts"
import { createMediaStore } from "./store/media-store.ts"

/**
 * 扫码登录结果(core 本地声明,不依赖 crawler 类型——只透传 channel.scanLogin,不解析字段)。
 * 形状与 crawler LoginResult 一致(结构兼容),保持「core 不 import crawler 类型」边界。
 */
export interface LoginResult {
  cookie: string
  user_id?: string
  /** 原本就已登录(未触发扫码即检测到),UI 据此提示而非展示新二维码。 */
  alreadyLoggedIn?: boolean
}

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
  /** 刷新一次订阅,把内容写入 store。opts.force=true 跳过 TTL 缓存强制抓取(手动刷新)。
   *  默认(force=false)走 TTL:TTL 内命中持久化缓存则跳过网络抓取。 */
  refresh(subscriptionId: string, opts?: { force?: boolean }): Promise<RefreshResult>
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
  /** 渠道真实总数(翻页渠道,如 weibo cardlistInfo.total;refresh/loadMore 时更新)。无则 undefined。 */
  totalOf(subscriptionId: string): number | undefined
  /** 扫码登录(channel 级能力 Loginable)。emitQr 回调把二维码 data URL 推给 UI
   *  (可空=还没出码);成功后 cookie 已落浏览器 profile,并按 channelKey 平台前缀写
   *  settings 对应 cookie 字段(HTTP 降级路径复用)。 */
  scanLogin(
    channelKey: string,
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult>
}

export function createDataLayer(): DataLayer {
  registerAllChannels()
  // 全局 appHost 门面(getter 校验未注入抛清晰错误;now/log 兜底)。
  const storage = globalThis.appHost.storage
  const now = globalThis.appHost.now!
  const log = globalThis.appHost.log!
  const repo = createSubscriptionRepository(storage, now)
  const contentCache = createContentCacheRepo(storage)
  const reading = createReadingRepository(storage, now)
  const settings = createSettingsRepository(storage)
  const store = createMediaStore(now)
  /** 分页游标:订阅 → 当前翻到的位置(refresh 重置;UI 无感,由 loadMore 内部维护)。 */
  const pageCursors = new Map<string, string>()
  /** 渠道真实总数:订阅 → 平台总数(weibo cardlistInfo.total;refresh/loadMore 时更新)。 */
  const pageTotals = new Map<string, number>()

  /** channelKey 前缀 → settings 里存的 cookie 字段(读 cookieFor / 写 scanLogin 共用一张表)。 */
  function cookieFieldFor(channelKey: string): keyof AppSettings | undefined {
    if (channelKey.startsWith("bili:")) return "bilibiliCookie"
    if (channelKey.startsWith("weibo:")) return "weiboCookie"
    if (channelKey.startsWith("xhs:")) return "xhsCookie"
    return undefined
  }

  /** 按 channelKey 前缀匹配的 core 层默认 cookie(bili/weibo/xhs)。订阅显式 info.cookie 永远优先。 */
  function cookieFor(channelKey: string, s: AppSettings): string | undefined {
    const field = cookieFieldFor(channelKey)
    return field ? (s[field] as string | undefined) : undefined
  }

  /**
   * 合并 core 层默认 cookie 到订阅 info。
   *   crawler 源:按平台前缀注入 cookie(bili/weibo/xhs)供抓取/解析。
   *   rsshub 外挂源:只注入 baseUrl(供 fetch 请求外部实例),**不注入平台 cookie**
   *     ——外挂只做信息抓取,无需登录态;平台 cookie 也不应泄露给公网实例。
   */
  async function sourceInfoFor(sub: { channelKey: string; info: Record<string, string> }): Promise<Record<string, string>> {
    const s = await settings.get()
    if (sub.channelKey.startsWith("rsshub:")) {
      if (sub.info["baseUrl"]) return sub.info
      return { ...sub.info, baseUrl: s.rsshubBaseUrl }
    }
    const cookie = cookieFor(sub.channelKey, s)
    if (!cookie || sub.info["cookie"]) return sub.info
    return { ...sub.info, cookie }
  }

  /**
   * 刷新一次订阅。TTL 缓存语义(2026-08-28 接入):
   *   - 未 force 且有缓存且未过期 → 从缓存 deserializeFeedWithTotal 重建喂 store,
   *     跳过网络抓取(减少反爬源被打频率);fetchedAt 回缓存时间。
   *   - 抓取失败 → 回退旧缓存(即便过期)喂 store,error 字段保留(UI 可见失败不空窗)。
   *   - TTL = 订阅级 refreshIntervalSec 优先,否则全局 settings.refreshIntervalMin。
   */
  async function refresh(subscriptionId: string, opts?: { force?: boolean }): Promise<RefreshResult> {
    const sub = await repo.get(subscriptionId)
    if (!sub) {
      return {
        subscriptionId,
        itemCount: 0,
        error: "subscription not found",
        fetchedAt: now(),
      }
    }
    // 未注册的 channelKey 是配置错误——throw 后由 catch 统一返回 error 结果。
    let kind: MediaKind | undefined
    try {
      const channel = getChannel(sub.channelKey)
      if (!channel) throw new NoChannelError(sub.channelKey)
      kind = channel.kind
      const info = await sourceInfoFor(sub)

      // ── TTL 短路:未 force 且缓存命中且未过期 → 跳过网络抓取 ──
      if (!opts?.force) {
        const cached = await contentCache.get(subscriptionId)
        if (cached) {
          const ttlMs = sub.refreshIntervalSec
            ? sub.refreshIntervalSec * 1000
            : (await settings.get()).refreshIntervalMin * 60 * 1000
          if (now() - cached.fetchedAt < ttlMs) {
            const { items, total } = deserializeFeedWithTotal(cached.xml, {
              subscriptionId,
              kind,
              now: now(),
            })
            if (total !== undefined) pageTotals.set(subscriptionId, total)
            else pageTotals.delete(subscriptionId)
            store.replace(subscriptionId, items)
            pageCursors.delete(subscriptionId)
            return { subscriptionId, itemCount: items.length, fetchedAt: cached.fetchedAt }
          }
        }
      }

      // ── 正常抓取 + 回写缓存 ──
      const xml = await channel.getSource(info).fetch()
      const { items, total } = deserializeFeedWithTotal(xml, { subscriptionId, kind: channel.kind, now: now() })
      if (total !== undefined) pageTotals.set(subscriptionId, total)
      else pageTotals.delete(subscriptionId) // 渠道不再带 total → 清残留旧值
      store.replace(subscriptionId, items)
      pageCursors.delete(subscriptionId) // 新首页 → 分页游标重置(从头翻)
      await contentCache.set(subscriptionId, { fetchedAt: now(), xml })
      return { subscriptionId, itemCount: items.length, fetchedAt: now() }
    } catch (err) {
      log.log("error", "refresh failed", { subscriptionId, error: String(err) })
      // 抓取失败回退旧缓存(即便过期):不空窗,error 保留供 UI 提示。
      const cached = await contentCache.get(subscriptionId).catch(() => null)
      if (cached) {
        try {
          const { items } = deserializeFeedWithTotal(cached.xml, {
            subscriptionId,
            kind,
            now: now(),
          })
          store.replace(subscriptionId, items)
        } catch {
          /* 缓存也坏 → 保持空,error 已返回 */
        }
      }
      return {
        subscriptionId,
        itemCount: 0,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt: now(),
      }
    }
  }

  /**
   * 解析播放:统一走 crawler/resolver(按 item.url 路由到平台解析函数)。
   * crawler 与 rsshub 源的条目一样处理("统一生效")。不改 MediaItem,不持久化注记。
   */
  async function resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback> {
    const routed = await resolvePlayByUrl(itemId, subscriptionId)
    if (routed) return routed
    throw new Error("该条目不指向可解析的视频链接")
  }

  async function resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback> {
    const routed = await resolveLivePlayByUrl(roomId, subscriptionId)
    if (routed) return routed
    throw new Error("该条目不指向可解析的直播链接")
  }

  /** itemId 可能是 store 的 guid/url/真实 id——按 store 查 url;url 无满月新时回退 itemId 本身。 */
  function findItemUrl(itemId: string, _subscriptionId: string): string | null {
    // MediaStore 无按 id 索引 API,用 all().find(首屏)足够验证(B站条目 url 本就是 guid)。
    const hit = store.all().find((it) => it.id === itemId)
    const url = hit?.url ?? itemId
    return url || null
  }

  /**
   * 视频播放:crawler/resolver 按 item.url 路由解析。info 用订阅的 sourceInfoFor
   * (cookie 注入;rsshub 源注入 baseUrl)。
   */
  async function resolvePlayByUrl(itemId: string, subscriptionId: string): Promise<ResolvePlayback | null> {
    const sub = await repo.get(subscriptionId)
    if (!sub) return null
    const url = findItemUrl(itemId, subscriptionId)
    if (!url) return null
    try {
      const info = await sourceInfoFor(sub)
      const { streams } = await resolveVideoByUrl(url, info)
      let danmaku
      try {
        danmaku = getDanmakuByUrl(url, { cookie: info.cookie })
      } catch {
        // 无弹幕能力(如纯图文/音频)不阻塞播放。
      }
      return { streams, danmaku }
    } catch (e) {
      // resolver 抛错(url 不可路由/平台解析失败)——返回 null 让上层如实报错。
      void e
      return null
    }
  }

  /** 直播播放:同上,但 kind=live 路由。 */
  async function resolveLivePlayByUrl(roomId: string, subscriptionId: string): Promise<ResolvePlayback | null> {
    const sub = await repo.get(subscriptionId)
    if (!sub) return null
    const url = findItemUrl(roomId, subscriptionId)
    if (!url) return null
    try {
      const info = await sourceInfoFor(sub)
      const { streams } = await resolveLiveByUrl(url, info)
      let danmaku
      try {
        danmaku = getDanmakuByUrl(url, { cookie: info.cookie })
      } catch {
        // 无弹幕能力不阻塞播放。
      }
      return { streams, danmaku }
    } catch (e) {
      void e
      return null
    }
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
    return isPageable(channel.getSource(info))
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
    const { xml, cursor: nextCursor } = await source.fetchMore(cursor)
    const { items, total } = deserializeFeedWithTotal(xml, { subscriptionId, kind: channel.kind, now: now() })
    if (total !== undefined) pageTotals.set(subscriptionId, total)
    else pageTotals.delete(subscriptionId) // 渠道不再带 total → 清残留旧值
    store.append(subscriptionId, items)
    if (nextCursor) pageCursors.set(subscriptionId, nextCursor)
    else pageCursors.delete(subscriptionId)
    return { addedCount: items.length, hasMore: !!nextCursor }
  }

  /** 渠道列表投影(source 聚合层 RssChannel → core ChannelInfo,不透 source 装配)。 */
  function listChannels(): ChannelInfo[] {
    return listAllChannels().map((c) => ({
      key: c.key,
      name: c.name,
      kind: c.kind,
      sourceInfoTpl: c.sourceInfoTpl,
      defaultInfo: c.defaultInfo,
      loginable: isLoginable(c),
    }))
  }

  /** 扫码登录:校验 Loginable → 委托 channel → 成功按平台前缀落 settings cookie。 */
  async function scanLogin(
    channelKey: string,
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    const channel = getChannel(channelKey)
    if (!channel) throw new NoChannelError(channelKey)
    if (!isLoginable(channel)) throw new Error(`channel ${channelKey} does not support scan login`)
    const result = await channel.scanLogin(emitQr, opts)
    // 按 channelKey 平台前缀落对应 cookie 字段(sourceInfoFor 自动注入后续订阅)。
    const field = cookieFieldFor(channelKey)
    if (field) await settings.set({ [field]: result.cookie } as Partial<AppSettings>)
    return result
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
    // 订阅 repo 透传;remove 时一并删内容缓存(订阅没了缓存没意义)。
    subscriptions: {
      ...repo,
      async remove(id) {
        await repo.remove(id)
        await contentCache.delete(id).catch(() => {})
      },
    },
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
    totalOf: (id) => pageTotals.get(id),
    scanLogin,
  }
}
