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
import { isHotWordSource, isItemDetailSource, isLoginable, isPageable, registerAllChannels } from "@tauri-playground/crawler"
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
import { createBodyCacheRepo } from "./repo/body-cache-repo.ts"
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
  addSubscription(
    channelKey: string,
    title: string,
    info: Record<string, string>,
    meta?: { groupId?: string | null; refreshIntervalSec?: number },
  ): Promise<string>
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
    patch(id: string, patch: Partial<MediaItem>): void
    subscribe(listener: () => void): () => void
  }
  /** 刷新一次订阅,把内容写入 store。opts.force=true 跳过 TTL 缓存强制抓取(手动刷新)。
   *  默认(force=false)走 TTL:TTL 内命中持久化缓存则跳过网络抓取。 */
  refresh(subscriptionId: string, opts?: { force?: boolean }): Promise<RefreshResult>
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
  const bodyCache = createBodyCacheRepo(storage)
  const reading = createReadingRepository(storage, now)
  const settings = createSettingsRepository(storage)
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
      const rec = map[it.id]
      if (!rec) return it
      const next: Partial<MediaItem> = {}
      if (rec.read && it.isUnread) next.isUnread = false
      if (rec.starred && !it.isStarred) next.isStarred = true
      if (rec.positionSec && !it.positionSec) next.positionSec = rec.positionSec
      if (rec.scrollRatio && !it.scrollRatio) next.scrollRatio = rec.scrollRatio
      return Object.keys(next).length ? ({ ...it, ...next } as MediaItem) : it
    })
  }

  /**
   * 刷新一次订阅。TTL 缓存语义(2026-08-28 接入):
   *   - 未 force 且有缓存且未过期 → 从缓存 deserializeFeedWithTotal 重建喂 store,
   *     跳过网络抓取(减少反爬源被打频率);fetchedAt 回缓存时间。
   *   - 抓取失败 → 回退旧缓存(即便过期)喂 store,error 字段保留(UI 可见失败不空窗)。
   *   - TTL = 订阅级 refreshIntervalSec 优先,否则全局 settings.refreshIntervalMin。
   */
  async function doRefresh(subscriptionId: string, opts?: { force?: boolean }): Promise<RefreshResult> {
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
        } catch {
          /* 缓存坏了 → 保持现状,不报错(停用不是错误) */
        }
      }
      return { subscriptionId, itemCount: 0, fetchedAt: now() }
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
            replaceIfLive(subscriptionId, await applyReadingState(items))
            pageCursors.delete(subscriptionId)
            return { subscriptionId, itemCount: items.length, fetchedAt: cached.fetchedAt }
          }
        }
      }

      // ── 正常抓取 + 回写缓存 ──
      const xml = await channel.getSource(info).fetch()
      const { items, total } = deserializeFeedWithTotal(xml, { subscriptionId, kind: channel.kind, now: now() })
      // ⚠️ 抓取「成功」但解析出 0 条(源临时故障 / 反爬返回空壳页)= 不能当成功处理:
      //   往下走会用空数组 replace(清空列表) 并把空 XML 写进缓存,内容在内存和磁盘上
      //   一起消失,直到源恢复。已有内容时保留原样并如实报错。
      // ⚠️ 判据**同时看 store 与持久缓存**:只看 store 时,若启动 refreshAll 对该订阅
      //   抛错/超时(未水化),store 为空但磁盘缓存仍在 —— 空抓取会清 store 并覆盖缓存,
      //   旧内容双丢。缓存也在则一并保护。
      if (items.length === 0 && ((await contentCache.get(subscriptionId).catch(() => null)) !== null || store.query({ subscriptionId }).length > 0)) {
        return { subscriptionId, itemCount: 0, error: "本次抓取解析出 0 条,已保留原有内容", fetchedAt: now() }
      }
      if (total !== undefined) pageTotals.set(subscriptionId, total)
      else pageTotals.delete(subscriptionId) // 渠道不再带 total → 清残留旧值
      replaceIfLive(subscriptionId, await applyReadingState(items))
      pageCursors.delete(subscriptionId) // 新首页 → 分页游标重置(从头翻)
      // 缓存写失败(磁盘满/IO)只记日志,不能触发下面的 catch —— 那会把刚写好的新内容
      // 用旧缓存 replace 回去,用户看到「刷新失败」却其实是抓取成功了。
      try {
        await contentCache.set(subscriptionId, { fetchedAt: now(), xml })
      } catch (e) {
        log.log("warn", "content cache write failed", { subscriptionId, error: String(e) })
      }
      return { subscriptionId, itemCount: items.length, fetchedAt: now() }
    } catch (err) {
      log.log("error", "refresh failed", { subscriptionId, error: String(err) })
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
        fetchedAt: now(),
      }
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
  function refresh(subscriptionId: string, opts?: { force?: boolean }): Promise<RefreshResult> {
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
   * ⚠️ 按 **id 或 roomId** 命中:直播条目的两者不同
   * (bilibili 房间 → `id: "bilibili:6"`、`roomId: "6"`、`url: "https://live.bilibili.com/6"`),
   * 而历史调用方(ui 包的 UnifiedCard)传的是 `item.roomId`、新调用方传 `item.id`
   * ——两种都接受,免得各调用方各踩一遍。
   *
   * 兜底:入参本身就是 URL(`://`)时直接用它(如条目已不在 store 里)。
   */
  function findItemUrl(itemId: string): string | null {
    const items = store.all()
    const hit =
      items.find((it) => it.id === itemId) ??
      items.find((it) => (it as { roomId?: string }).roomId === itemId)
    const url = hit?.url ?? (itemId.includes("://") ? itemId : null)
    return url || null
  }

  /**
   * 视频播放:crawler/resolver 按 item.url 路由解析。info 用订阅的 sourceInfoFor
   * (cookie 注入;rsshub 源注入 baseUrl)。
   */
  async function resolvePlayByUrl(itemId: string, subscriptionId: string): Promise<ResolvePlayback | null> {
    const sub = await repo.get(subscriptionId)
    if (!sub) return null
    const url = findItemUrl(itemId)
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
    const url = findItemUrl(roomId)
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

  /** 单条详情:store 里找 item → source 探测 ItemDetailSource → 补全。
   *  xhs 走 noteDetail(匿名,需列表项 xsec_token);通用 RSS 抓原文页提正文;
   *  bili/weibo 列表已完整(无该能力)→ 原样返回。item 不在 store 则返回 null。 */
  async function resolveDetail(subscriptionId: string, itemId: string): Promise<MediaItem | null> {
    const sub = await repo.get(subscriptionId)
    if (!sub) return null
    const item = store.all().find((it) => it.id === itemId)
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
    const info = await sourceInfoFor(sub)
    const source = channel.getSource(info)
    if (!isItemDetailSource(source)) return item // 无详情能力(bili/weibo 列表已完整)→ 原样返回
    // 传**完整 item**(不是仅 url/id):通用 RSS 的 resolveDetail 是增量补全(先 spread 原
    // item 再填 content),只给三字段会序列化出残缺条目。xhs 只读 url/xsecToken,多传无损。
    const detailItem = await source.resolveDetail(item as never).catch(() => null)
    if (!detailItem) return item // 详情失败回退原 item(不空窗)
    // crawler Item(含完整图文)→ XML → core MediaItem(复用 XML 契约,不新增序列化面)。
    const xml = serializeFeed([detailItem], { channelTitle: channel.name })
    const [detail] = deserializeFeed(xml, { subscriptionId, kind: channel.kind, now: now() })
    const resolved = detail ?? item
    // 正文确有增长才落缓存(否则会把「无补全能力原样返回」也写进去)。
    const before = item.kind === "article" ? item.content ?? "" : ""
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
      const { xml, cursor: nextCursor } = await source.fetchMore(cursor)
      const { items, total } = deserializeFeedWithTotal(xml, { subscriptionId, kind: channel.kind, now: now() })
      if (removedSubs.has(subscriptionId)) return { addedCount: 0, hasMore: false } // 已退订:丢弃
      if (total !== undefined) pageTotals.set(subscriptionId, total)
      else pageTotals.delete(subscriptionId) // 渠道不再带 total → 清残留旧值
      store.append(subscriptionId, await applyReadingState(items))
      if (nextCursor) pageCursors.set(subscriptionId, nextCursor)
      else pageCursors.delete(subscriptionId)
      return { addedCount: items.length, hasMore: !!nextCursor }
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

  /** 创建订阅并刷新(拼 id + add + refresh 的编排收敛进 core)。meta 可选带分组与独立 TTL。 */
  async function addSubscription(
    channelKey: string,
    title: string,
    info: Record<string, string>,
    meta?: { groupId?: string | null; refreshIntervalSec?: number },
  ): Promise<string> {
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
    await refresh(id)
    return id
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
    // 与 sourceInfoFor 同规则:rsshub 只补 baseUrl;其余按平台前缀补 cookie。
    let merged = info
    if (channelKey.startsWith("rsshub:")) {
      if (!info["baseUrl"]) merged = { ...info, baseUrl: s.rsshubBaseUrl }
    } else if (!info["cookie"]) {
      const cookie = cookieFor(channelKey, s)
      if (cookie) merged = { ...info, cookie }
    }
    const xml = await channel.getSource(merged).fetch()
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
        await contentCache.delete(id).catch(() => {})
        await bodyCache.deleteAll(id).catch(() => {})
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
    resolveDetail,
    canLoadMore,
    loadMore,
    totalOf: (id) => pageTotals.get(id),
    scanLogin,
  }
}
