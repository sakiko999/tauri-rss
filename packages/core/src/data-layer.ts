/**
 * DataLayer — app 层与数据层之间的单一公共 seam。
 *
 * app 层通过 `store` 读内容、调 `refresh()` 拉订阅、经 subscriptions/reading/
 * settings 三个 repo 维护配置。宿主能力来自全局 `globalThis.appHost`
 * (注入见根 global.d.ts),无 createDataLayer(host) 参数。
 *
 * 编排:订阅存 `channelKey` + `info`,refresh 时查 crawler 注册表 →
 * `channel.getSource(info).fetch()` 得 RSS XML → `deserializeFeed` → store.replace。
 *
 * 本文件只留「公共接口 + 刷新编排 + 订阅 CRUD + cookie 快照同步」;无状态的邻接职责
 * 拆到 `internal/`(2026-11-01):
 *   net-policy(等级投影) · cookies(取值/合并) · reading-state(阅读态回填)
 *   playback(播放/详情/热搜/可翻页探测) · pagination(翻页) · async(串行/取消)
 * ⚠️ refresh 与 pagination 共享游标/墓碑/串行链,所以两者仍在本闭包内装配 ——
 * 只把「翻一页」的编排交出去,避免为一个文件行数把 6 个可变状态穿参到各处。
 */

import { isLoginable, registerAllChannels } from "@amoeba/crawler"
import {
  errorKindOf,
  ResolveError,
  setPlatformCookieLookup,
  withBrowserGlobal,
  withBrowserOpSlot,
} from "@amoeba/resolve"

import { STORAGE_SCHEMA } from "./db/schema.ts"
import { NoChannelError } from "./errors.ts"
import { createSerialized, withSignal } from "./internal/async.ts"
import { DESKTOP_COOKIE_CONSUMER_FIELDS, mergeSourceInfo, normalizeCookie } from "./internal/cookies.ts"
import { foldChannelLevels, syncNetPolicy } from "./internal/net-policy.ts"
import { createPagination } from "./internal/pagination.ts"
import { createPlaybackApi } from "./internal/playback.ts"
import { applyReadingState } from "./internal/reading-state.ts"
import { coreLog, formatError } from "./log.ts"
import { deserializeFeedWithTotal } from "./processing/deserialize.ts"
import { createBodyCacheRepo } from "./repo/body-cache-repo.ts"
import { createContentCacheRepo } from "./repo/content-cache-repo.ts"
import { createReadingRepository, type ReadingRepository } from "./repo/reading-repo.ts"
import { createSettingsRepository, type SettingsRepository } from "./repo/settings-repo.ts"
import { createSubscriptionRepository, type SubscriptionRepository } from "./repo/subscription-repo.ts"
import { contentTtlMs, cookieFieldFor, cookieFieldForPlatform } from "./settings-policy.ts"
import { getChannel, listChannels as listAllChannels, type LoginCookieSnapshot } from "./source/index.ts"
import { createMediaStore, type MediaStoreChange } from "./store/media-store.ts"
import type { ChannelInfo } from "./types/channel-info.ts"
import type { MediaItem, MediaKind } from "./types/media-item.ts"
import type { DanmakuStream, ResolvePlayback } from "./types/playback.ts"
import type { MediaQuery } from "./types/query.ts"
import type { RefreshResult } from "./types/refresh-result.ts"
import { type AppSettings, DEFAULT_SETTINGS } from "./types/settings.ts"

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
    /** `progress` = 只有续播进度变了（原地更新）；消费方据此跳过全量视图重算。 */
    subscribe(listener: (change: MediaStoreChange) => void): () => void
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
  /**
   * 开一路弹幕订阅(播放器 unmount 时调返回的 unsubscribe)。
   *
   * 与 `resolvePlay().danmaku` 同源,但**在数据服务进程内**建连:弹幕握手要用订阅
   * 凭证(抖音直播要 ttwid),凭证不过界 —— 服务端订阅 + 推送是唯一解。
   * 无弹幕能力时抛错(调用方按「该条目没有弹幕」处理)。
   */
  resolveDanmaku(subscriptionId: string, url: string, kind: "vod" | "live"): Promise<DanmakuStream>
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
  /** 删除全部库数据并清空内存条目，返回受影响的 subscriptionId（服务端据此清投影/广播）。 */
  clearAll(): Promise<string[]>
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
      replaceIfLive(subscriptionId, await applyReadingState(items, reading))
      return { subscriptionId, itemCount: items.length, fetchedAt: cached.fetchedAt }
    } catch {
      return null // 缓存损坏 → 视为无可用数据
    }
  }

  /**
   * 合并 core 层默认 cookie 到订阅 info(规则实现见 `internal/cookies.ts`)。
   * `s` 让 doRefresh 复用同一次 settings 读取。
   */
  async function sourceInfoFor(
    sub: { channelKey: string; info: Record<string, string> },
    s?: AppSettings,
  ): Promise<Record<string, string>> {
    const cfg = s ?? (await settings.get())
    return mergeSourceInfo(sub, cfg, cfg.rsshubBaseUrl)
  }

  /**
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
          replaceIfLive(subscriptionId, await applyReadingState(items, reading))
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
          const ttlMs = contentTtlMs(sub, s)
          if (now() - cached.fetchedAt < ttlMs) {
            const { items, total } = deserializeFeedWithTotal(cached.xml, {
              subscriptionId,
              kind,
              now: now(),
            })
            if (total !== undefined) pageTotals.set(subscriptionId, total)
            else pageTotals.delete(subscriptionId)
            replaceIfLive(subscriptionId, await applyReadingState(items, reading))
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
      replaceIfLive(subscriptionId, await applyReadingState(items, reading))
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
          replaceIfLive(subscriptionId, await applyReadingState(items, reading))
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

  /** 按订阅串行化(不同订阅仍可并发;refreshAll 的并行不受影响)。实现见 internal/async.ts。 */
  const serialized = createSerialized()

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
      // ⚠️ 必须同时算 `body:`（点开过的文章补全正文）。只算 content: 时诊断页显示
      // 「缓存很小」，而用户长期阅读后库和备份持续变大（2026-11-01 评审）。
      const [contentKeys, bodyKeys] = await Promise.all([storage.keys("content:"), storage.keys("body:")])
      let bytes = 0
      for (const key of [...contentKeys, ...bodyKeys]) {
        const value = await storage.get(key)
        bytes += (value?.length ?? 0) * 2
      }
      return { keys: contentKeys.length + bodyKeys.length, bytes }
    },
    async clearContentCache() {
      const keys = [...(await storage.keys("content:")), ...(await storage.keys("body:"))]
      for (const key of keys) await storage.delete(key)
      return keys.length
    },
    async clearAll() {
      // 删库前取受影响订阅：服务端据此清 diff 投影并广播 items.cleared。
      const ids = new Set<string>((await repo.list().catch(() => [])).map((s) => s.id))
      const keys = await storage.keys()
      for (const key of keys) await storage.delete(key)
      for (const it of store.all()) ids.add(it.subscriptionId)
      for (const id of ids) store.clear(id)
      // 内存态一并回零：退订墓碑/分页游标/总数/凭证快照 —— 漏一个就会带着旧状态继续跑
      // (典型:netLevels 仍按登录态限流、loadMore 从已删的游标续翻)。
      removedSubs.clear()
      pageCursors.clear()
      pageTotals.clear()
      cookieSnapshot = { ...DEFAULT_SETTINGS }
      syncNetPolicy(cookieSnapshot)
      return [...ids]
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

  // 播放/详情解析:只读依赖(订阅/store/正文缓存),独立模块(见 internal/playback.ts)。
  const playback = createPlaybackApi({ now, repo, store, bodyCache, sourceInfoFor })
  // 分页与 refresh 共用游标/墓碑/串行链,由本闭包持有并注入。
  const pagination = createPagination({
    now,
    repo,
    reading,
    store,
    sourceInfoFor,
    pageCursors,
    pageTotals,
    removedSubs,
    serialized,
  })

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
    ...playback,
    ...pagination,
    scanLogin,
    syncBrowserCookies,
    diagnostics,
  }
}
