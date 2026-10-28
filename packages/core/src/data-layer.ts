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

import { isHotWordSource, isItemDetailSource, isLoginable, isPageable, registerAllChannels } from "@amoeba/crawler"
import { cookieFieldForChannelKey, cookieFieldOf, platformOfChannelKey } from "@amoeba/platform"
import {
  errorKindOf,
  getDanmakuByUrl,
  parseCookieDict,
  ResolveError,
  resolveLivePlayByUrl as resolveLiveByUrl,
  resolvePlayByUrl as resolveVideoByUrl,
  serializeCookieDict,
  setPlatformCookieLookup,
  withBrowserGlobal,
  withBrowserOpSlot,
} from "@amoeba/resolve"
import { serializeFeed } from "@amoeba/xml"

import { STORAGE_SCHEMA } from "./db/schema.ts"
import { NoChannelError } from "./errors.ts"
import { coreLog, formatError } from "./log.ts"
import { deserializeFeed, deserializeFeedWithTotal } from "./processing/deserialize.ts"
import { createBodyCacheRepo } from "./repo/body-cache-repo.ts"
import { createContentCacheRepo } from "./repo/content-cache-repo.ts"
import { createReadingRepository, type ReadingRepository } from "./repo/reading-repo.ts"
import { createSettingsRepository, type SettingsRepository } from "./repo/settings-repo.ts"
import { createSubscriptionRepository, type SubscriptionRepository } from "./repo/subscription-repo.ts"
import { getChannel, listChannels as listAllChannels, type LoginCookieSnapshot } from "./source/index.ts"
import { createMediaStore } from "./store/media-store.ts"
import type { ChannelInfo } from "./types/channel-info.ts"
import type { MediaItem, MediaKind } from "./types/media-item.ts"
import type { ResolvePlayback } from "./types/playback.ts"
import type { MediaQuery } from "./types/query.ts"
import { findRecord } from "./types/reading.ts"
import type { RefreshResult } from "./types/refresh-result.ts"
import { type AppSettings, DEFAULT_SETTINGS, type NetLevel } from "./types/settings.ts"

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
  /**
   * 创建订阅(channelKey + info)并立即刷新。
   *
   * 返回 `{ id, refresh }`：`refresh.error` 是首刷的真实结果，调用方据此提示
   * 「已订阅但首次抓取失败」，而不是用成功 toast 掩盖空列表。
   */
  addSubscription(
    channelKey: string,
    title: string,
    info: Record<string, string>,
    meta?: { groupId?: string | null; refreshIntervalSec?: number },
  ): Promise<{ id: string; refresh: RefreshResult }>
  /** 预览一次渠道(不建订阅、不落 store、不写缓存):发现页的分区浏览/搜索据此取真实数据。
   *  info 里没给 cookie/baseUrl 时按 channelKey 前缀补 core 层默认值。 */
  previewChannel(channelKey: string, info: Record<string, string>): Promise<{ items: MediaItem[]; total?: number }>
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
    /** ⚠️ 必须带 subscriptionId —— 同一个 item.id 会跨订阅出现(见 media-store.patch)。 */
    patch(subscriptionId: string, id: string, patch: Partial<MediaItem>): void
    subscribe(listener: () => void): () => void
    /** 丢弃某订阅全部条目（退订/完全重置；服务端用）。 */
    clear(subscriptionId: string): void
  }
  /** 刷新一次订阅,把内容写入 store。opts.force=true 跳过 TTL 缓存强制抓取(手动刷新)。
   *  默认(force=false)走 TTL:TTL 内命中持久化缓存则跳过网络抓取。
   *  opts.signal 取消本次抓取：在途请求结果丢弃，返回 `error: "刷新已取消"`，不覆盖 store/缓存。 */
  refresh(subscriptionId: string, opts?: { force?: boolean; signal?: AbortSignal }): Promise<RefreshResult>
  /**
   * 只从持久化内容缓存重建 store，**不发网络**。
   * 数据服务 boot 时调用，保证首次快照就有内容；桌面/移动的 init 仍走
   * `refreshAll(false)`（TTL 命中时同样零网络）。
   */
  hydrate(): Promise<void>
  /** 懒解析某条 video item 的可播流(播放时调用;URL 带 deadline 签名,不缓存)。
   *  返回流 + 弹幕能力(source 具备 DanmakuPlayable 时附带,一次拿齐)。 */
  resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback>
  /** 单条详情补全(阅读视图看全文 / 社交弹窗看多图)。走 crawler ItemDetailSource,
   *  无详情能力的源原样返回 item;抓失败也回退 item(不空窗)。 */
  resolveDetail(subscriptionId: string, itemId: string): Promise<MediaItem | null>
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
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<LoginResult>
  /**
   * 启动时把 settings 里的浏览器登录 cookie 快照对齐到抓取浏览器 profile。
   *
   * 只处理**有启用订阅**的平台;桌面 HTTP 消费方(weiboCookie)优先,其余平台只在
   * 浏览器已被拉起时顺带同步。浏览器无登录标记时**不清空**;compare-and-set 防住
   * 与用户保存/扫码的并发覆盖。返回实际更新的 settings 字段。
   */
  syncBrowserCookies(): Promise<Array<keyof AppSettings>>
  /** 存储/浏览器诊断（桌面设置页用；远端模式走服务端点，不直连 storage/browser）。 */
  readonly diagnostics: DataLayerDiagnostics
}

export interface DataLayerDiagnostics {
  /** 内容缓存条目数与近似字节数（UTF-16）。 */
  cacheStats(): Promise<{ keys: number; bytes: number }>
  /** 删除全部 `content:` 缓存，返回删除条数。已加载的 store 条目不动。 */
  clearContentCache(): Promise<number>
  /** 删除全部库数据并清空内存条目（调用方负责 reload）。 */
  clearAll(): Promise<void>
  /** 清理指定域名的浏览器 cookie（账号页「清除凭证」；远端走服务浏览器）。 */
  clearCookies(hosts: string[]): Promise<void>
  /** 清理抓取浏览器 profile（cookie/缓存），返回 profile 目录。 */
  resetBrowserProfile(): Promise<string>
}

/**
 * 带 LX 被动采集能力的 source(crawler 的 `RssSource` 已声明 `fetchPassive?`;
 * core 的镜像接口只列 `fetch`,这里按结构类型取——可选能力不进镜像契约)。
 */
type FetchableSource = {
  fetch(): Promise<string>
  /** LX:从被动缓冲取最近一份页面响应;null/缺失 = 无可用数据(绝不回退 fetch)。 */
  fetchPassive?(): Promise<string | null>
}

/**
 * channelKey 前缀 → settings 里存的 cookie 字段。
 * **单一权威 = `@amoeba/platform` 的 PLATFORMS 表**（R9）：sourceInfoFor 注入 /
 * scanLogin 写回 / CLI 探针 / desktop 账号页全部经此，禁止再手抄前缀表。
 */
export function cookieFieldFor(channelKey: string): keyof AppSettings | undefined {
  return cookieFieldForChannelKey(channelKey) as keyof AppSettings | undefined
}

/**
 * settings cookie 字段的**桌面 HTTP 消费方** —— 只有它们值得为快照同步单独拉起
 * 抓取浏览器(~1GB,空闲 3 分钟回收)。xhsCookie 在桌面没有数据消费方(xhs 全走
 * 浏览器,settings 只剩账号页展示),只在浏览器已因其它字段被拉起时顺带同步。
 */
const DESKTOP_COOKIE_CONSUMER_FIELDS: ReadonlySet<keyof AppSettings> = new Set(["weiboCookie"])

/** cookie 串 → 按 key 排序的规范形(比较用;快照落库的就是这个形)。 */
function normalizeCookie(v: unknown): string {
  return serializeCookieDict(parseCookieDict(typeof v === "string" ? v : ""))
}

/** 平台名（governor 分类语义）→ settings cookie 字段（同一张 `@amoeba/platform` 表）。 */
export function cookieFieldForPlatform(platform: string): keyof AppSettings | undefined {
  return cookieFieldOf(platform) as keyof AppSettings | undefined
}

export function createDataLayer(): DataLayer {
  // DDL 唯一权威仍在 core：把 schema 注入 SQL 型后端。host 因此不需要反向 import
  // core（旧的 `host → core` 是包级运行时环的一边，见 docs/architecture/system/05-risks.md R2）。
  globalThis.appHost.storage.setSchema?.(STORAGE_SCHEMA)
  registerAllChannels()
  // ── 平台 cookie provider 注册(credentials 收口)────────────────────────────
  // cookie 链「渠道 → client 调用点」一跳靠人肉传参,曾三次漏传(user_video 412 /
  // favlist 私有夹 / douyinCookie 死键)。注册后 client 在调用点未显式传 cookie 时
  // 自动回落本表(settings 快照);显式空串 = 强制匿名(不回落)。
  // ⚠️ provider 是进程级单钩子:多 DataLayer 实例(测试)后注册者生效。
  let cookieSnapshot: AppSettings | null = null
  setPlatformCookieLookup((platform) => {
    const field = cookieFieldForPlatform(platform)
    const v = field ? cookieSnapshot?.[field] : undefined
    return typeof v === "string" && v ? v : undefined
  })
  // 全局 appHost 门面(getter 校验未注入抛清晰错误;now/log 兜底)。
  const storage = globalThis.appHost.storage
  const now = globalThis.appHost.now!
  const repo = createSubscriptionRepository(storage, now)
  const contentCache = createContentCacheRepo(storage)
  const bodyCache = createBodyCacheRepo(storage)
  const reading = createReadingRepository(storage, now)
  const settings = createSettingsRepository(storage)
  // 启动时把网络策略同步给宿主 governor,并把旧版 channelKey 覆盖折叠成平台键
  // (best-effort;不阻塞 DataLayer 创建)。顺带初始化 cookie 快照(provider 读)。
  void settings
    .get()
    .then(async (s) => {
      // ⚠️ 只在尚未被写入时填充:启动同步/扫码可能已先一步把更新的快照写进来,
      // 这里的初始读取落地更晚时不能把它覆盖回旧值。
      if (!cookieSnapshot) cookieSnapshot = s
      const folded = foldChannelLevels(s.netLevels)
      if (!folded) {
        syncNetPolicy(s)
        return
      }
      const next = await settings.set({ netLevels: folded })
      syncNetPolicy(next)
    })
    .catch(() => {})
  const store = createMediaStore(now)
  /** 分页游标:订阅 → 当前翻到的位置(refresh 重置;UI 无感,由 loadMore 内部维护)。 */
  const pageCursors = new Map<string, string>()
  /** 渠道真实总数:订阅 → 平台总数(weibo cardlistInfo.total;refresh/loadMore 时更新)。 */
  const pageTotals = new Map<string, number>()
  /** 已退订 id(墓碑):在途 refresh 完成后若订阅已退订,不再写回内容(防复活竞态)。 */
  const removedSubs = new Set<string>()

  /** 写回抓取结果前检查墓碑:订阅在抓取途中被退订 → 丢弃结果(不复活已退订内容)。 */
  function replaceIfLive(id: string, items: MediaItem[]): void {
    if (removedSubs.has(id)) return
    store.replace(id, items)
  }

  /**
   * 从内容缓存重建喂 store(**即使已过期**)——「本轮不发网络」的路径共用:
   * 自动刷新关闭 / LX 无被动数据。返回 null = 无可用缓存(调用方按各自语义处理)。
   * ⚠️ 缓存总是首页 → 一并清分页游标,否则 loadMore 会从旧位置续翻跳页。
   */
  async function restoreFromCache(
    subscriptionId: string,
    kind: MediaKind | undefined,
  ): Promise<{ subscriptionId: string; itemCount: number; fetchedAt: number } | null> {
    const cached = await contentCache.get(subscriptionId).catch(() => null)
    if (!cached) return null
    try {
      const { items, total } = deserializeFeedWithTotal(cached.xml, { subscriptionId, kind, now: now() })
      if (total !== undefined) pageTotals.set(subscriptionId, total)
      else pageTotals.delete(subscriptionId)
      pageCursors.delete(subscriptionId)
      replaceIfLive(subscriptionId, await applyReadingState(items))
      return { subscriptionId, itemCount: items.length, fetchedAt: cached.fetchedAt }
    } catch {
      return null // 缓存损坏 → 视为无可用数据
    }
  }

  /**
   * 把网络策略同步给宿主 governor(best-effort)。
   * host 未注入 `net`(浏览器/CLI/旧宿主)时静默跳过 —— doRefresh 内的等级闸门仍生效。
   */
  function syncNetPolicy(s: AppSettings): void {
    // governor 按 URL host 只认**平台名**;旧版 channelKey 覆盖先折叠成平台键(正常
    // 启动时已迁移,这里兜底任何尚未迁移的写入)。
    const levels = foldChannelLevels(s.netLevels) ?? s.netLevels
    try {
      // levels 是**整表替换**语义(设置页的完整平台覆盖快照)。
      globalThis.appHost?.net?.configure({ level: s.netLevel, levels })
    } catch {
      /* net 未注入 / 旧宿主:沿用宿主默认策略 */
    }
  }

  /**
   * 旧版 channelKey 覆盖 → 平台键(2026-10-21 设置页改为只按平台)。
   * 返回 null = 无需迁移(没有 channelKey 键)。
   * 规则与旧运行时投影一致:
   *   - **L0 优先**(显式调试直通,覆盖平台档);
   *   - 其余取**更严格**者(不因个别渠道收紧而误放);
   *   - 被动渠道的存量键**丢弃**(它不产生应用构造的请求,等级无意义)。
   */
  function foldChannelLevels(src: Record<string, NetLevel>): Record<string, NetLevel> | null {
    let changed = false
    const levels: Record<string, NetLevel> = { ...src }
    for (const [key, level] of Object.entries(src)) {
      const platform = platformOfChannel(key)
      if (!platform) continue
      delete levels[key]
      changed = true
      if (getChannel(key)?.passive) continue
      const prev = levels[platform]
      if (prev === undefined) levels[platform] = level
      else if (prev === 0 || level === 0) levels[platform] = 0
      else levels[platform] = prev >= level ? prev : level
    }
    return changed ? levels : null
  }

  /** channelKey → 平台名(与 host governor 的 URL 平台分类同源,均来自 `@amoeba/platform`)。 */
  function platformOfChannel(channelKey: string): string | undefined {
    return platformOfChannelKey(channelKey)
  }

  /** 按 channelKey 前缀取 settings 快照里的 cookie(订阅显式 info.cookie 永远优先)。 */
  function cookieFor(channelKey: string, s: AppSettings): string | undefined {
    const field = cookieFieldFor(channelKey)
    return field ? (s[field] as string | undefined) : undefined
  }

  /**
   * 合并 core 层默认 cookie 到订阅 info。
   *   crawler 源:按平台前缀注入 cookie(bili/weibo/xhs/douyin)供抓取/解析。
   *   rsshub 外挂源:只注入 baseUrl(供 fetch 请求外部实例),**不注入平台 cookie**
   *     ——外挂只做信息抓取,无需登录态;平台 cookie 也不应泄露给公网实例。
   *
   * ⚠️ 「键存在即尊重」(含空串 = 强制匿名):与 CLI `--kv cookie=` 的探针语义一致
   * (同一语义在两条装配线上曾含义相反——CLI 空串强制匿名、core 空串回落默认)。
   * 渠道没写 cookie 键时,client 侧还有 credentials provider 兜底(同一 settings 源),
   * 所以「漏写键」不再等于「永远匿名」。
   */
  async function sourceInfoFor(
    sub: { channelKey: string; info: Record<string, string> },
    /** 已读出的 settings 快照(doRefresh 复用同一次读);不传则现读。 */
    s?: AppSettings,
  ): Promise<Record<string, string>> {
    const cfg = s ?? (await settings.get())
    if (sub.channelKey.startsWith("rsshub:")) {
      if (sub.info["baseUrl"]) return sub.info
      return { ...sub.info, baseUrl: cfg.rsshubBaseUrl }
    }
    const cookie = cookieFor(sub.channelKey, cfg)
    if (sub.info["cookie"] !== undefined || !cookie) return sub.info
    return { ...sub.info, cookie }
  }

  /**
   * 把持久化的阅读态(已读/星标/续播位置)回填到刚重建的条目上。
   *
   * ⚠️ 必需的原因:deserialize 每次都按「新条目」处理(isUnread=true、isStarred=false,
   * 无 positionSec),而 refresh 是整批 replace。不回填的话每次刷新/重启,已读、星标、
   * 续播位置都会被抹掉 —— 星标/续播只 patch 内存 store 时尤其明显。
   */
  async function applyReadingState(items: MediaItem[]): Promise<MediaItem[]> {
    if (!items.length) return items
    const map = await reading.getAll().catch(() => null)
    if (!map) return items
    return items.map((it) => {
      // ⚠️ 必须走复合键（带 subscriptionId）——同一条目 id 跨订阅共享已读/星标/续播
      // 是真实存在的（见 types/reading.ts 的 readingKey）。
      const rec = findRecord(map, it.subscriptionId, it.id)
      if (!rec) return it
      const next: Partial<MediaItem> = {}
      if (rec.read && it.isUnread) next.isUnread = false
      if (rec.starred && !it.isStarred) next.isStarred = true
      if (rec.positionSec && !it.positionSec) next.positionSec = rec.positionSec
      if (rec.scrollRatio && !it.scrollRatio) next.scrollRatio = rec.scrollRatio
      // lastReadAt 无条件回填(无「已设则跳过」语义:它就是最近一次时间,应随 reading 更新)。
      if (rec.lastReadAt) next.lastReadAt = rec.lastReadAt
      return Object.keys(next).length ? ({ ...it, ...next } as MediaItem) : it
    })
  }

  /** 取消语义的返回值：与「抓取失败」区分——不触发旧缓存回退，也不写 store/缓存。 */
  function cancelledResult(subscriptionId: string): RefreshResult {
    return {
      subscriptionId,
      itemCount: 0,
      error: "刷新已取消",
      errorKind: "timeout",
      fetchedAt: now(),
    }
  }

  /**
   * 抓取与取消竞速：signal 触发即抛（在途请求的响应被丢弃，不占后续流程）。
   *
   * ⚠️ 不做 socket 级 abort：`appHost.http` 契约里没有 signal，且 governor 的
   * 去重可能把同一请求共享给别的订阅——这里只停「本次刷新的编排」，网络层
   * 自行跑完（结果无人消费）。
   */
  function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return p
    if (signal.aborted) return Promise.reject(new Error("刷新已取消"))
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new Error("刷新已取消"))
      signal.addEventListener("abort", onAbort, { once: true })
      p.then(
        (v) => {
          signal.removeEventListener("abort", onAbort)
          resolve(v)
        },
        (e) => {
          signal.removeEventListener("abort", onAbort)
          reject(e)
        },
      )
    })
  }

  /**
   * 刷新一次订阅。TTL 缓存语义(2026-08-28 接入):
   *   - 未 force 且有缓存且未过期 → 从缓存 deserializeFeedWithTotal 重建喂 store,
   *     跳过网络抓取(减少反爬源被打频率);fetchedAt 回缓存时间。
   *   - 抓取失败 → 回退旧缓存(即便过期)喂 store,error 字段保留(UI 可见失败不空窗)。
   *   - TTL = 订阅级 refreshIntervalSec 优先,否则全局 settings.refreshIntervalMin。
   *   - autoRefresh=false 且非 force → 不发网络,只复用缓存(即使过期);无缓存返回 0 条不报错。
   *   - 渠道 `passive` 且有浏览器 → 只调 source.fetchPassive(),读不到走缓存,
   *     **绝不回退 fetch()**(风控 §2.4/§3.8:应用构造的平台 API 请求正是被动模式要禁的)。
   */
  async function doRefresh(
    subscriptionId: string,
    opts?: { force?: boolean; signal?: AbortSignal },
  ): Promise<RefreshResult> {
    const signal = opts?.signal
    // 已取消（客户端超时/取消先于 RPC 到达）→ 立刻返回，不读库不发网络。
    if (signal?.aborted) return cancelledResult(subscriptionId)
    const sub = await repo.get(subscriptionId)
    if (!sub) {
      return {
        subscriptionId,
        itemCount: 0,
        error: "subscription not found",
        fetchedAt: now(),
      }
    }
    // ── 停用订阅:不抓取、不报错,但**照常从缓存复用内容** ──
    // refreshAll 会遍历全部订阅;没有这一支的话「停用」只是 rail 上的一个徽标,
    // 网络请求照发(设置页那个开关的语义就落空了)。
    if (!sub.enabled) {
      const cached = await contentCache.get(subscriptionId).catch(() => null)
      let itemCount = 0
      if (cached) {
        try {
          const { items, total } = deserializeFeedWithTotal(cached.xml, {
            subscriptionId,
            kind: getChannel(sub.channelKey)?.kind,
            now: now(),
          })
          if (total !== undefined) pageTotals.set(subscriptionId, total)
          // ⚠️ 停用路径把 store 重置回缓存首页,必须**一并清分页游标** —— 否则残留的
          // page-2 游标会让下次 loadMore 追加「第 3 页」,第 2 页内容被静默跳过。
          pageCursors.delete(subscriptionId)
          replaceIfLive(subscriptionId, await applyReadingState(items))
          itemCount = items.length
        } catch {
          /* 缓存坏了 → 保持现状,不报错(停用不是错误) */
        }
      }
      // 停用只表示不抓取,缓存内容仍要如实报条数(否则前端把本地窗口压到 0 → 空视图)。
      return { subscriptionId, itemCount, fetchedAt: now() }
    }

    // 未注册的 channelKey 是配置错误——throw 后由 catch 统一返回 error 结果。
    let kind: MediaKind | undefined
    try {
      const channel = getChannel(sub.channelKey)
      if (!channel) throw new NoChannelError(sub.channelKey)
      kind = channel.kind
      // ⚠️ settings 只读一次:TTL / 自动刷新开关 / LX 闸门 / cookie 注入共用同一快照。
      const s = await settings.get()
      cookieSnapshot = s // provider 快照同步(settings 可能被别的进程/路径改过)
      // 网络策略同步给宿主 governor(best-effort;未注入 net 时由下面的闸门兜底)。
      // 幂等,每次刷新同步一次 —— 设置页改等级后下一轮刷新即生效。
      syncNetPolicy(s)

      // ── 自动刷新关闭(正交开关):非手动刷新不发网络,只复用缓存(即使过期) ──
      // force(手动刷新)不受它约束 —— 否则用户点「刷新」也拿不到新内容。
      if (!s.autoRefresh && !opts?.force) {
        return (
          (await restoreFromCache(subscriptionId, kind)) ?? {
            subscriptionId,
            itemCount: 0,
            fetchedAt: now(),
          }
        )
      }

      const info = await sourceInfoFor(sub, s)

      // ── TTL 短路:未 force 且缓存命中且未过期 → 跳过网络抓取 ──
      if (!opts?.force) {
        const cached = await contentCache.get(subscriptionId)
        if (cached) {
          const ttlMs = sub.refreshIntervalSec ? sub.refreshIntervalSec * 1000 : s.refreshIntervalMin * 60 * 1000
          if (now() - cached.fetchedAt < ttlMs) {
            const { items, total } = deserializeFeedWithTotal(cached.xml, {
              subscriptionId,
              kind,
              now: now(),
            })
            if (total !== undefined) pageTotals.set(subscriptionId, total)
            else pageTotals.delete(subscriptionId)
            replaceIfLive(subscriptionId, await applyReadingState(items))
            pageCursors.delete(subscriptionId)
            return { subscriptionId, itemCount: items.length, fetchedAt: cached.fetchedAt }
          }
        }
      }

      // ── 抓取:被动属性(风控 §2.4 / §3.8) ──
      const source: FetchableSource = channel.getSource(info)
      // 被动采集是**渠道属性**(`RssChannel.passive`,如 xhs:user/explore):有浏览器时
      // 只取页面自然产生的数据,不跟随防御等级 —— 需要它的渠道几乎不会主动降级。
      // 无浏览器(移动端/CLI)回落主动抓取,否则该渠道永远只剩缓存。
      const passiveMode = channel.passive === true && !!globalThis.appHost?.browser
      let xml: string
      if (passiveMode) {
        // 浏览器被动 = 只取页面自然请求的响应体。**绝不回退 fetch()**
        // —— 应用构造的平台 API 调用正是被动模式要禁的行为。
        const passive = (await withSignal(Promise.resolve(source.fetchPassive?.()), signal)) ?? null
        if (!passive) {
          // 无被动数据 → 复用内容缓存(即使过期);连缓存都没有才如实报错。
          const hit = await restoreFromCache(subscriptionId, kind)
          if (hit) return hit
          // 缓存回退是正常降级不记;连缓存都没有才是需要排障的静默失败。
          coreLog.passiveNoData({ subscriptionId, channel: channel.key })
          return {
            subscriptionId,
            itemCount: 0,
            error: "被动采集：没有可用的数据，且无缓存可回退",
            errorKind: "no-data",
            fetchedAt: now(),
          }
        }
        xml = passive
      } else {
        // L0(调试直通)/ L1:L1 严格只是更紧的配额,由宿主 governor 执行,同样走主动抓取。
        xml = await withSignal(source.fetch(), signal)
      }
      // ── 正常抓取 + 回写缓存 ──
      const { items, total } = deserializeFeedWithTotal(xml, { subscriptionId, kind: channel.kind, now: now() })
      // ⚠️ 抓取「成功」但解析出 0 条(源临时故障 / 反爬返回空壳页)= 不能当成功处理:
      //   往下走会用空数组 replace(清空列表) 并把空 XML 写进缓存,内容在内存和磁盘上
      //   一起消失,直到源恢复。已有内容时保留原样并如实报错。
      // ⚠️ 判据**同时看 store 与持久缓存**:只看 store 时,若启动 refreshAll 对该订阅
      //   抛错/超时(未水化),store 为空但磁盘缓存仍在 —— 空抓取会清 store 并覆盖缓存,
      //   旧内容双丢。缓存也在则一并保护。
      if (
        items.length === 0 &&
        ((await contentCache.get(subscriptionId).catch(() => null)) !== null ||
          store.query({ subscriptionId }).length > 0)
      ) {
        return { subscriptionId, itemCount: 0, error: "本次抓取解析出 0 条,已保留原有内容", fetchedAt: now() }
      }
      // 抓取途中被取消 → 新内容不落 store/缓存（取消不该改变可见状态）。
      if (signal?.aborted) return cancelledResult(subscriptionId)
      if (total !== undefined) pageTotals.set(subscriptionId, total)
      else pageTotals.delete(subscriptionId) // 渠道不再带 total → 清残留旧值
      replaceIfLive(subscriptionId, await applyReadingState(items))
      pageCursors.delete(subscriptionId) // 新首页 → 分页游标重置(从头翻)
      // ⚠️ 退订竞态:抓取途中用户退订 → remove 已删 content:<id>,若在途 refresh 在此照写
      // 就留下**无消费者的孤儿缓存**(订阅已删,永不读取/清理)。与 replaceIfLive 同用墓碑拦。
      if (removedSubs.has(subscriptionId)) return { subscriptionId, itemCount: 0, fetchedAt: now() }
      // 缓存写失败(磁盘满/IO)只记日志,不能触发下面的 catch —— 那会把刚写好的新内容
      // 用旧缓存 replace 回去,用户看到「刷新失败」却其实是抓取成功了。
      try {
        await contentCache.set(subscriptionId, { fetchedAt: now(), xml })
      } catch (e) {
        coreLog.cacheWriteFailed({ subscriptionId, error: formatError(e) })
      }
      return { subscriptionId, itemCount: items.length, fetchedAt: now() }
    } catch (err) {
      // 取消不是失败：不回退旧缓存（否则取消会把「已加载更多页」的 store 重置回首页）、
      // 不打 error 日志（取消是正常路径，别把日志刷成红色）。
      if (signal?.aborted) return cancelledResult(subscriptionId)
      coreLog.refreshFailed({ subscriptionId, error: formatError(err) })
      // 失败后总数字段已不可信(是上一次成功抓取的残留),清掉免得 UI 计数与内容不符。
      pageTotals.delete(subscriptionId)
      // 抓取失败回退旧缓存(即便过期):不空窗,error 保留供 UI 提示。
      const cached = await contentCache.get(subscriptionId).catch(() => null)
      if (cached) {
        try {
          const { items } = deserializeFeedWithTotal(cached.xml, {
            subscriptionId,
            kind,
            now: now(),
          })
          replaceIfLive(subscriptionId, await applyReadingState(items))
          // ⚠️ 回退的是**首页**缓存,分页游标必须一并清:否则下次 loadMore 会从残留的
          // 旧游标继续翻(首页已换成缓存、游标却指向更后面 → 中间若干页被静默跳过)。
          pageCursors.delete(subscriptionId)
        } catch {
          /* 缓存也坏 → 保持空,error 已返回 */
        }
      }
      return {
        subscriptionId,
        itemCount: 0,
        error: err instanceof Error ? err.message : String(err),
        errorKind: errorKindOf(err),
        fetchedAt: now(),
      }
    }
  }

  /**
   * 只读缓存水化：服务启动时把各订阅首页塞回 store（零网络）。
   * 停用订阅也照常水化——停用只表示不抓取，不代表不展示旧内容。
   */
  async function hydrate(): Promise<void> {
    const subs = await repo.list().catch(() => [])
    for (const sub of subs) {
      await restoreFromCache(sub.id, getChannel(sub.channelKey)?.kind).catch(() => null)
    }
  }

  /** 按订阅串行化(不同订阅仍可并发;refreshAll 的并行不受影响)。 */
  const chains = new Map<string, Promise<unknown>>()
  function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  /**
   * 刷新一次订阅(同订阅重入排队)。
   *
   * ⚠️ 必须与 loadMore 共用同一条链:两者共享 pageCursors/pageTotals,而 loadMore 的
   * `fetchMore(cursor)` 要 await 网络 —— 若 refresh 在 await 期间完成,`replace` +
   * `pageCursors.delete` 会与 loadMore 的 append/set 交错,第 2 页条目混进新首页、
   * 游标指向已失效的序列,表现为重复或跳过整页。
   */
  function refresh(subscriptionId: string, opts?: { force?: boolean; signal?: AbortSignal }): Promise<RefreshResult> {
    return serialized(`sub:${subscriptionId}`, () => doRefresh(subscriptionId, opts))
  }

  /**
   * 解析播放:统一走 crawler/resolver(按 item.url 路由到平台解析函数)。
   * crawler 与 rsshub 源的条目一样处理("统一生效")。不改 MediaItem,不持久化注记。
   */
  /** 抓住 resolver 的错误(而非吞成 null),供上层原样透出。 */
  async function catching<T>(p: Promise<T>): Promise<{ ok: T } | { err: Error }> {
    try {
      return { ok: await p }
    } catch (e) {
      return { err: e instanceof Error ? e : new Error(String(e)) }
    }
  }

  async function resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback> {
    // ⚠️ 不要把 null 当成「URL 不可解析」—— resolver 的真实错误(无流/风控/限区)必须
    // 原样透出,否则把「解析/网络失败」误导成「链接不对」,用户查错方向。
    const r = await catching(resolvePlayByUrl(itemId, subscriptionId))
    if ("err" in r) throw r.err
    if (r.ok) return r.ok
    throw new Error("该条目不指向可解析的视频链接")
  }

  async function resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback> {
    const r = await catching(resolveLivePlayByUrl(roomId, subscriptionId))
    if ("err" in r) throw r.err
    if (r.ok) return r.ok
    throw new Error("该条目不指向可解析的直播链接")
  }

  /**
   * 入参 → 可路由的 URL。resolver 的 `resolveRoute` **只认 URL**(平台域名 + 路径),
   * 所以这里必须先把条目查出来取 `item.url`,不能把入参直接当 URL 用。
   *
   * 按 `item.id` 命中,取 `item.url`。
   *
   * 兜底:入参本身就是 URL(`://`)时直接用它(如条目已不在 store 里)。
   */
  function findItemUrl(itemId: string, subscriptionId: string): string | null {
    // ⚠️ item.id 只在订阅内唯一(实测同 id 跨订阅撞),裸 id 查全表会拿到别的订阅的 url。
    const hit = store.query({ subscriptionId }).find((it) => it.id === itemId)
    const url = hit?.url ?? (itemId.includes("://") ? itemId : null)
    return url || null
  }

  /**
   * 视频播放:crawler/resolver 按 item.url 路由解析。info 用订阅的 sourceInfoFor
   * (cookie 注入;rsshub 源注入 baseUrl)。
   */
  /**
   * 预览条目（`preview:<channelKey>`）没有订阅记录：按渠道前缀补默认 info（cookie / baseUrl）。
   * 二级订阅（播客单集 / 分区房间）的条目就来自 `previewChannel`。
   */
  async function previewInfoFor(subscriptionId: string): Promise<Record<string, string> | null> {
    const prefix = "preview:"
    if (!subscriptionId.startsWith(prefix)) return null
    // 复用 sourceInfoFor 的同一套规则(别再写第二份:规则漂移会变成
    // 「抓取能取到、播放解析拿不到凭证」,而错误文案还指向「链接不对」)。
    return sourceInfoFor({ channelKey: subscriptionId.slice(prefix.length), info: {} })
  }

  async function resolvePlayByUrl(itemId: string, subscriptionId: string): Promise<ResolvePlayback | null> {
    const url = findItemUrl(itemId, subscriptionId)
    if (!url) return null
    // ⚠️ resolver 抛错(平台风控/无流/限区/需登录)**不在此吞成 null** —— 交给外层
    // `resolvePlay` 的 catching 原样透出真实错误。null 只留给「无订阅/无 url」这两种
    // 真正「不可解析」的情形(外层映射为「该条目不指向可解析的视频链接」)。曾把 resolver
    // 错误也吞成 null → 风控失败被误报成「链接不对」,用户去重装/换源(查错方向)。
    const sub = await repo.get(subscriptionId)
    const info = sub ? await sourceInfoFor(sub) : await previewInfoFor(subscriptionId)
    if (!info) return null
    const { streams } = await resolveVideoByUrl(url, info)
    let danmaku
    try {
      danmaku = getDanmakuByUrl(url, { cookie: info.cookie })
    } catch {
      // 无弹幕能力(如纯图文/音频)不阻塞播放。
    }
    return { streams, danmaku }
  }

  /** 直播播放:同上,但 kind=live 路由。 */
  async function resolveLivePlayByUrl(roomId: string, subscriptionId: string): Promise<ResolvePlayback | null> {
    const url = findItemUrl(roomId, subscriptionId)
    if (!url) return null
    const sub = await repo.get(subscriptionId)
    const info = sub ? await sourceInfoFor(sub) : await previewInfoFor(subscriptionId)
    if (!info) return null
    const { streams } = await resolveLiveByUrl(url, info)
    let danmaku
    try {
      danmaku = getDanmakuByUrl(url, { cookie: info.cookie })
    } catch {
      // 无弹幕能力不阻塞播放。
    }
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

  /** 单条详情:store 里找 item → source 探测 ItemDetailSource → 补全。
   *  xhs 走 noteDetail(匿名,需列表项 xsec_token);通用 RSS 抓原文页提正文;
   *  bili/weibo 列表已完整(无该能力)→ 原样返回。item 不在 store 则返回 null。 */
  async function resolveDetail(subscriptionId: string, itemId: string): Promise<MediaItem | null> {
    const sub = await repo.get(subscriptionId)
    if (!sub) return null
    // ⚠️ 必须带 subscriptionId 查:item.id 只在订阅内唯一,裸 id 会命中别的订阅的同 id
    // 条目(实测 bilibili:<mid> 同时存在于多个订阅),把别人的内容补到这条上。
    const item = store.query({ subscriptionId }).find((it) => it.id === itemId)
    if (!item) return null
    const channel = getChannel(sub.channelKey)
    if (!channel) return item // channel 未知 → 返回原 item(至少给现有数据)
    // 通用 RSS 文章正文是**静态**的,持久缓存可跨会话复用(重开不重抓)。⚠️ 只对
    // **article** 开缓存:xhs social 的补全是多图/标签(不止 content),只缓存正文字符串
    // 会在命中时丢掉图片详情,故 social 一律走实时抓取。
    const cacheable = item.kind === "article"
    if (cacheable) {
      const hit = await bodyCache.get(subscriptionId, itemId).catch(() => null)
      if (hit) return { ...item, content: hit.content, contentFormat: hit.contentFormat }
    }
    // 被动渠道的详情补全同样要遵守「浏览器被动」的承诺(2026-10-19):
    // 把 `{ passive: true }` 交给渠道 —— 走「导航 + 读页面 SSR」,不碰平台 API,
    // 不支持时返回 null → 原样返回列表 item。渠道**抛错**(登录失效/风控)时不再
    // 静默回退:调用方的失败态要能显示原因(见下方 catch)。
    const s = await settings.get()
    const info = await sourceInfoFor(sub, s)
    const source = channel.getSource(info)
    if (!isItemDetailSource(source)) return item // 无详情能力(bili/weibo 列表已完整)→ 原样返回
    // 传**完整 item**(不是仅 url/id):通用 RSS 的 resolveDetail 是增量补全(先 spread 原
    // item 再填 content),只给三字段会序列化出残缺条目。xhs 只读 url/xsecToken,多传无损。
    // ⚠️ 详情失败仍然回退原 item(不空窗),但**必须留下原因**:登录失效、风控冷却、
    // 详情页非 2xx 都从这里经过;静默吞掉会让用户以为「这条笔记本来只有摘要」。
    let detailItem: Awaited<ReturnType<typeof source.resolveDetail>> | null = null
    try {
      // passive 由渠道自己决定怎么降级(被动模式下不得构造 fetch/API);不支持的渠道返回 null。
      detailItem = await source.resolveDetail(item as never, { passive: channel.passive === true })
    } catch (e) {
      coreLog.detailFailed({
        subscriptionId,
        itemId,
        channel: sub.channelKey,
        error: formatError(e),
      })
      // ⚠️ 不能吞掉:桌面 social 详情弹窗靠这个 reject 进入失败态。吞掉会让用户
      // 把列表摘要误认为完整详情(尤其 xhs 登录失效/风控时)。article 调用方
      // (ReaderMain / mobile)自己 catch 并保留摘要,不受影响。
      throw e
    }
    if (!detailItem) return item // 渠道明确不支持(返回 null)→ 原样返回列表 item
    // crawler Item(含完整图文)→ XML → core MediaItem(复用 XML 契约,不新增序列化面)。
    const xml = serializeFeed([detailItem], { channelTitle: channel.name })
    const [detail] = deserializeFeed(xml, { subscriptionId, kind: channel.kind, now: now() })
    const resolved = detail ?? item
    // 正文确有增长才落缓存(否则会把「无补全能力原样返回」也写进去)。
    const before = item.kind === "article" ? (item.content ?? "") : ""
    if (cacheable && resolved.kind === "article" && (resolved.content ?? "").length > before.length) {
      await bodyCache
        .set(subscriptionId, itemId, {
          content: resolved.content ?? "",
          contentFormat: resolved.contentFormat ?? "text",
          fetchedAt: now(),
        })
        .catch(() => {})
    }
    return resolved
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

  /** 加载更多:翻一页追加进 store。游标内部维护(refresh 后重置);本页为空 = 没有更多。
   *  与 refresh 共用同一条链,避免 refresh 在 fetchMore 的 await 期间换掉首页与游标。 */
  function loadMore(subscriptionId: string): Promise<{ addedCount: number; hasMore: boolean }> {
    return serialized(`sub:${subscriptionId}`, async () => {
      const sub = await repo.get(subscriptionId)
      if (!sub) return { addedCount: 0, hasMore: false }
      const channel = getChannel(sub.channelKey)
      if (!channel) return { addedCount: 0, hasMore: false }
      // 停用订阅 = 不抓取(与 refresh 同契约)。否则停用后仍能翻页打网络/反爬源。
      if (!sub.enabled) return { addedCount: 0, hasMore: false }
      const info = await sourceInfoFor(sub)
      const source = channel.getSource(info)
      if (!isPageable(source)) return { addedCount: 0, hasMore: false }
      const cursor = pageCursors.get(subscriptionId)
      let page: { xml: string; cursor?: string; hasMore?: boolean }
      try {
        // existing:游标是页面下标时,首次翻页的起点必须是 store 已有条数(见 Pageable 注释)。
        page = await source.fetchMore(cursor, { existing: store.query({ subscriptionId }).length })
      } catch (e) {
        // 翻页失败此前直接冒泡：调用方只看到错误文本，服务日志里没有「哪个订阅/渠道」。
        coreLog.loadMoreFailed({
          subscriptionId,
          channel: sub.channelKey,
          error: formatError(e),
        })
        throw e
      }
      const { xml, cursor: nextCursor, hasMore: channelHasMore } = page
      const { items, total } = deserializeFeedWithTotal(xml, { subscriptionId, kind: channel.kind, now: now() })
      if (removedSubs.has(subscriptionId)) return { addedCount: 0, hasMore: false } // 已退订:丢弃
      // ⚠️ 分页条目的 fetchedAt 对齐到该订阅已有内容(首屏)的抓取时间。
      // 没有 `publishedAt` 的源(小红书发现页等)排序走 `publishedAt ?? fetchedAt` 兜底;
      // 若保留「本次抓取时间」,新一批会因时间更新而**整体排到列表最前** —— 用户滚到底
      // 点「加载更多」,视口里还是原来那批,新内容全插到顶部(实测 89 → 272 条,顶部换了一屏)。
      // 同一订阅的分页内容视为同一批快照:排序键相同 → 稳定排序保持 append 顺序(新内容在末尾)。
      const batchTime = store.query({ subscriptionId }).reduce((min, it) => Math.min(min, it.fetchedAt), Infinity)
      const aligned = Number.isFinite(batchTime) ? items.map((it) => ({ ...it, fetchedAt: batchTime })) : items
      if (total !== undefined) pageTotals.set(subscriptionId, total)
      else pageTotals.delete(subscriptionId) // 渠道不再带 total → 清残留旧值
      const addedCount = store.append(subscriptionId, await applyReadingState(aligned))
      if (nextCursor) pageCursors.set(subscriptionId, nextCursor)
      else pageCursors.delete(subscriptionId)
      // ⚠️ 游标前进了但一条都没新增 = 上游把已返回过的内容又给了一遍（典型：xhs 页面
      // 被整页重载后 state 回到首屏）。继续 hasMore 会让 UI 反复「加载更多」拿到同一页。
      // 游标没动（或本轮是首次翻页，core 原本无游标，渠道返回的重试游标不算「前进」）
      // 则是「平台还在加载」的 retry 语义，保留 hasMore。
      // ⚠️ 渠道**明确**说「还有下一页」时不要按 0 新增判到底 —— 过滤过条目的渠道
      // (bili:favlist 跳过失效视频)会有整页被滤空的正常情况。
      const cursorMoved = cursor !== undefined && nextCursor !== undefined && nextCursor !== cursor
      const exhausted = cursorMoved && addedCount === 0 && channelHasMore !== true
      return { addedCount, hasMore: !!nextCursor && !exhausted }
    })
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
      passive: c.passive === true,
    }))
  }

  /**
   * 写 settings 并同步运行时投影。
   * ⚠️ 内部写 cookie 也必须走这里:credentials provider 读的是 `cookieSnapshot`,
   * 只写 repo 会让 HTTP 回落路径在下一轮 refresh 前继续用旧 cookie。
   */
  async function applySettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = await settings.set(patch)
    syncNetPolicy(next)
    cookieSnapshot = next
    return next
  }

  /** 扫码登录:校验 Loginable → 委托 channel → 成功按平台前缀落 settings cookie。 */
  async function scanLogin(
    channelKey: string,
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<LoginResult> {
    const channel = getChannel(channelKey)
    if (!channel) throw new NoChannelError(channelKey)
    if (!isLoginable(channel)) throw new Error(`channel ${channelKey} does not support scan login`)
    const result = await channel.scanLogin(emitQr, opts)
    // 按 channelKey 平台前缀落对应 cookie 字段(sourceInfoFor 自动注入后续订阅)。
    const field = cookieFieldFor(channelKey)
    if (field) await applySettings({ [field]: result.cookie } as Partial<AppSettings>)
    return result
  }

  /**
   * compare-and-set 版 applySettings(比对与写入在 repo 同一串行临界区内完成)。
   * `expected` 与当前值不一致(期间用户保存/扫码写过)→ 返回 null,放弃本次写入。
   */
  async function applySettingsIfUnchanged(
    expected: Partial<AppSettings>,
    patch: Partial<AppSettings>,
  ): Promise<AppSettings | null> {
    const next = await settings.setIfUnchanged(expected, patch)
    if (!next) return null
    syncNetPolicy(next)
    cookieSnapshot = next
    return next
  }

  /**
   * 应用启动时的浏览器登录 cookie 快照同步。
   *
   * 扫码只写一次 settings,而浏览器会随访问轮换 cookie;桌面抓取走 profile 不受影响,
   * 但桌面 HTTP 回落路径(weibo 长文展开/热搜词)用的 settings 快照会变旧。
   * 这里在启动后把自己的快照对齐到浏览器。
   *
   * 语义边界(避免静默写错 / 白付资源):
   *   - 只处理**有启用订阅**的平台 —— 停用/无订阅都没有本轮消费方,不为一张残留
   *     快照拉起 ~1GB 的隐藏 WebView2;
   *   - 只有 `DESKTOP_COOKIE_CONSUMER_FIELDS`(weiboCookie)单独值得拉起浏览器;
   *     其余平台(xhsCookie,桌面无数据消费方)只在浏览器已被拉起时**顺带**读一次;
   *   - 浏览器里没有登录标记 → **保留**现有快照(无法区分「登出」与「profile 被重置」,
   *     不能据此清掉用户手填/上次登录的凭证);
   *   - 读浏览器与写 settings 经 `setIfUnchanged` 原子比对写入,并与「清除凭证 /
   *     清理浏览器数据」的独占段互斥(`withBrowserOpSlot`);expected 用循环开始时的
   *     不可变基线,期间用户对任何字段的改动都会让本次写入放弃。
   */
  async function syncBrowserCookies(): Promise<Array<keyof AppSettings>> {
    const browser = globalThis.appHost?.browser
    if (!browser) return []
    const subs = await repo.list()
    const baseline = await settings.get()
    /** 同一字段只取第一个实现(同平台多渠道共享 cookie 字段)。 */
    const candidates = new Map<keyof AppSettings, (b: BrowserBackend) => Promise<LoginCookieSnapshot | null>>()
    for (const ch of listAllChannels()) {
      const read = ch.readLoginCookie?.bind(ch)
      if (!read) continue
      const field = cookieFieldFor(ch.key)
      if (!field || candidates.has(field)) continue
      if (!subs.some((s) => s.enabled && cookieFieldFor(s.channelKey) === field)) continue
      candidates.set(field, read)
    }
    // 桌面消费方排前面(它们单独值得拉起浏览器);其余按「浏览器已开着」顺带。
    const rank = (f: keyof AppSettings) => (DESKTOP_COOKIE_CONSUMER_FIELDS.has(f) ? 0 : 1)
    const ordered = [...candidates.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))

    const updated: Array<keyof AppSettings> = []
    let browserOpened = false
    for (const [field, read] of ordered) {
      if (!DESKTOP_COOKIE_CONSUMER_FIELDS.has(field) && !browserOpened) continue
      try {
        // 与 clearCookies/resetProfile 的独占段互斥:读到的 cookie 与写回 settings 必须原子。
        await withBrowserOpSlot(async () => {
          const snap = await read(browser)
          browserOpened = true
          if (!snap) return
          // 启动以来快照相同 → 不写;用户已改过该字段 → setIfUnchanged 返回 null 放弃。
          if (normalizeCookie(baseline[field]) === normalizeCookie(snap.cookie)) return
          const next = await applySettingsIfUnchanged(
            { [field]: baseline[field] } as Partial<AppSettings>,
            { [field]: snap.cookie } as Partial<AppSettings>,
          )
          if (!next) return
          updated.push(field)
          coreLog.cookieSnapshotSynced({ field, user_id: snap.user_id })
        })
      } catch (e) {
        // 浏览器起不来 / CDP 被回收 / 端口被占:只记录,不影响启动与其它平台。
        coreLog.cookieSnapshotFailed({
          field,
          error: formatError(e),
        })
      }
    }
    return updated
  }

  function channelKind(channelKey: string): MediaKind | undefined {
    return getChannel(channelKey)?.kind
  }

  const diagnostics: DataLayerDiagnostics = {
    async cacheStats() {
      const keys = await storage.keys("content:")
      let bytes = 0
      for (const key of keys) {
        const value = await storage.get(key)
        bytes += (value?.length ?? 0) * 2
      }
      return { keys: keys.length, bytes }
    },
    async clearContentCache() {
      const keys = await storage.keys("content:")
      for (const key of keys) await storage.delete(key)
      return keys.length
    },
    async clearAll() {
      const keys = await storage.keys()
      for (const key of keys) await storage.delete(key)
      const subs = new Set(store.all().map((it) => it.subscriptionId))
      for (const id of subs) store.clear(id)
      removedSubs.clear()
      pageCursors.clear()
      pageTotals.clear()
      cookieSnapshot = { ...DEFAULT_SETTINGS }
      syncNetPolicy(cookieSnapshot)
    },
    async clearCookies(hosts) {
      const browser = globalThis.appHost.browser
      if (!browser?.clearCookies || !hosts.length) return
      await withBrowserGlobal(async () => {
        for (const host of hosts) await browser.clearCookies?.(host)
      })
    },
    async resetBrowserProfile() {
      const browser = globalThis.appHost.browser
      if (!browser?.resetProfile) throw new Error("当前环境不支持清理浏览器数据")
      return withBrowserGlobal(() => browser.resetProfile!())
    },
  }

  /** 创建订阅并刷新(拼 id + add + refresh 的编排收敛进 core)。meta 可选带分组与独立 TTL。 */
  async function addSubscription(
    channelKey: string,
    title: string,
    info: Record<string, string>,
    meta?: { groupId?: string | null; refreshIntervalSec?: number },
  ): Promise<{ id: string; refresh: RefreshResult }> {
    const id = `s-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    // ⚠️ 清退订墓碑:id 是 ms + 4 随机,极短时间退订再订阅有概率撞同一 id;若不清,
    // replaceIfLive 会永久丢弃这条新订阅的每次刷新(stale 墓碑),重启才恢复。
    removedSubs.delete(id)
    const t = now()
    await repo.add({
      id,
      channelKey,
      title,
      enabled: true,
      info,
      createdAt: t,
      updatedAt: t,
      ...(meta?.groupId ? { groupId: meta.groupId } : {}),
      ...(meta?.refreshIntervalSec ? { refreshIntervalSec: meta.refreshIntervalSec } : {}),
    })
    const result = await refresh(id)
    return { id, refresh: result }
  }

  /**
   * 预览一次渠道——发现页「不建订阅先看内容」。
   * 与 refresh 的抓取段同构,但:**不读也不写缓存、不落 store**(预览是临时的,不该污染
   * 订阅内容的 TTL 与分页账本);总数字段照常解析便于显示。
   */
  async function previewChannel(
    channelKey: string,
    info: Record<string, string>,
  ): Promise<{ items: MediaItem[]; total?: number }> {
    const channel = getChannel(channelKey)
    if (!channel) throw new NoChannelError(channelKey)
    const s = await settings.get()
    // 与 sourceInfoFor 同一份规则(rsshub → baseUrl / 其余按前缀补 cookie)——
    // 这里曾是手抄副本,规则漂移的现成温床,改为直接复用。
    const merged = await sourceInfoFor({ channelKey, info }, s)
    const source = channel.getSource(merged)
    // 预览与刷新遵守同一条被动承诺：有浏览器时 passive 渠道只读页面自然产生的数据，
    // 绝不构造主动请求；没有被动数据就明确报错（预览没有订阅缓存可回退）。
    const passiveMode = channel.passive === true && !!globalThis.appHost?.browser
    const xml = passiveMode ? ((await source.fetchPassive?.()) ?? null) : await source.fetch()
    if (!xml) {
      throw new ResolveError("no-data", `被动采集：${channelKey} 预览没有可用数据（页面未产生可读响应）`)
    }
    const { items, total } = deserializeFeedWithTotal(xml, {
      subscriptionId: `preview:${channelKey}`,
      kind: channel.kind,
      now: now(),
    })
    return { items, total }
  }

  return {
    listChannels,
    channelKind,
    addSubscription,
    previewChannel,
    // 订阅 repo 透传;remove 时一并清内容缓存 + 内存条目 + 分页账本。
    // ⚠️ 不清 store 的话,退订后条目仍留在内存里,继续出现在「全部/未读/已星标」视图。
    subscriptions: {
      ...repo,
      async add(sub) {
        removedSubs.delete(sub.id) // 复用同 id 重订阅:清墓碑,否则 refresh 不回填
        return repo.add(sub)
      },
      async remove(id) {
        // 先立墓碑再删:在途 refresh 可能在 remove 的 await 期间完成并 store.replace,
        // 把已退订的内容又写回(rail 消失但条目仍在「全部」——退订不彻底)。
        removedSubs.add(id)
        try {
          await repo.remove(id)
        } catch (e) {
          // ⚠️ 删除失败(存储写失败)→ 订阅其实还在,必须**撤墓碑**,否则此后所有在途
          // refresh 结果被当成「已退订」永久丢弃,一个活着的订阅静默不更新。
          removedSubs.delete(id)
          throw e
        }
        store.clear(id)
        pageCursors.delete(id)
        pageTotals.delete(id)
        // content + body 的多键删除合成一次 batch（R10）：中途失败不会留下
        // 「删了一半」的中间态。不支持 batch 的后端回退逐个删。
        const [contentKeys, bodyKeys] = await Promise.all([
          contentCache.keysOf(id).catch(() => []),
          bodyCache.keysOf(id).catch(() => []),
        ])
        const keys = [...contentKeys, ...bodyKeys]
        if (keys.length) {
          const ops: StorageOp[] = keys.map((key) => ({ type: "delete", key }))
          // 订阅行/内存/索引都已清:这里失败不能再把退订整体抛出去(镜像会留下
          // 幽灵订阅,点开为空)。只记日志,残留键由同 id 重新订阅覆盖或诊断清理。
          try {
            if (storage.batch) await storage.batch(ops)
            else for (const op of ops) await storage.delete(op.key)
          } catch (e) {
            coreLog.unsubscribeCleanupFailed({ subscriptionId: id, error: formatError(e) })
          }
        }
        // 阅读态也按订阅清：否则退订后 reading blob 永久残留孤儿记录。
        await reading.deleteBySubscription(id).catch(() => {})
      },
    },
    reading,
    // 改设置**立即**同步网络策略:doRefresh 每次都会同步,但 loadMore / 详情补全 /
    // 播放解析不经过 doRefresh —— 改完等级后先点「加载更多」仍按旧档执行。
    settings: {
      get: () => settings.get(),
      set: applySettings,
      setIfUnchanged: applySettingsIfUnchanged,
      async reset() {
        const s = await settings.reset()
        syncNetPolicy(s)
        cookieSnapshot = s
        return s
      },
    },
    store: {
      all: () => store.all(),
      query: (q) => store.query(q),
      patch: (subscriptionId, id, patch) => store.patch(subscriptionId, id, patch),
      subscribe: (l) => store.subscribe(l),
      clear: (subscriptionId) => store.clear(subscriptionId),
    },
    refresh,
    hydrate,
    resolvePlay,
    resolveLivePlay,
    resolveHotWord,
    resolveDetail,
    canLoadMore,
    loadMore,
    totalOf: (id) => pageTotals.get(id),
    scanLogin,
    syncBrowserCookies,
    diagnostics,
  }
}
