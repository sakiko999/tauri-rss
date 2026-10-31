/**
 * 播放/详情解析(从 data-layer.ts 拆出,2026-11-01)。
 *
 * 只读依赖:订阅 repo、settings、内容 store、正文缓存 + `sourceInfoFor`(cookie 注入)。
 * 与刷新/分页无共享可变状态,因此可以独立成模块。
 *
 * 统一语义:
 *   - resolver 的真实错误(风控/无流/限区/登录失效)**原样透出**,不吞成 null;
 *   - item.id 只在订阅内唯一,查条目一律带 subscriptionId;
 *   - danmaku 是函数,过 RPC(JSON)会丢 → 同时给可序列化的 `danmakuRef`。
 */

import { isHotWordSource, isItemDetailSource, isPageable } from "@amoeba/crawler"
import { getDanmakuByUrl, resolveLivePlayByUrl, resolvePlayByUrl } from "@amoeba/resolve"
import { serializeFeed } from "@amoeba/xml"

import { NoChannelError } from "../errors.ts"
import { coreLog, formatError } from "../log.ts"
import { deserializeFeed } from "../processing/deserialize.ts"
import type { BodyCacheRepo } from "../repo/body-cache-repo.ts"
import type { SubscriptionRepository } from "../repo/subscription-repo.ts"
import { getChannel } from "../source/index.ts"
import type { MediaStore } from "../store/media-store.ts"
import type { MediaItem } from "../types/media-item.ts"
import type { DanmakuStream, ResolvePlayback } from "../types/playback.ts"

/** 单条正文缓存上限（字符；约 4MB UTF-16）。超过不入缓存，每次现取。 */
const MAX_BODY_CACHE_CHARS = 2_000_000

export interface PlaybackDeps {
  now: () => number
  repo: SubscriptionRepository
  store: MediaStore
  bodyCache: BodyCacheRepo
  /** 订阅 info + core 默认 cookie/baseUrl(规则见 internal/cookies.ts)。 */
  sourceInfoFor: (sub: { channelKey: string; info: Record<string, string> }) => Promise<Record<string, string>>
}

export interface PlaybackApi {
  resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback>
  resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback>
  resolveDanmaku(subscriptionId: string, url: string, kind: "vod" | "live"): Promise<DanmakuStream>
  resolveHotWord(subscriptionId: string, word: string): Promise<MediaItem[]>
  resolveDetail(subscriptionId: string, itemId: string): Promise<MediaItem | null>
  canLoadMore(subscriptionId: string): Promise<boolean>
}

export function createPlaybackApi(deps: PlaybackDeps): PlaybackApi {
  const { now, repo, store, bodyCache, sourceInfoFor } = deps

  /** 抓住 resolver 的错误(而非吞成 null),供上层原样透出。 */
  async function catching<T>(p: Promise<T>): Promise<{ ok: T } | { err: Error }> {
    try {
      return { ok: await p }
    } catch (e) {
      return { err: e instanceof Error ? e : new Error(String(e)) }
    }
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
   * 预览条目（`preview:<channelKey>`）没有订阅记录：按渠道前缀补默认 info（cookie / baseUrl）。
   * 二级订阅（播客单集 / 分区房间）的条目就来自 `previewChannel`。
   */
  function previewInfoFor(subscriptionId: string): Promise<Record<string, string> | null> {
    const prefix = "preview:"
    if (!subscriptionId.startsWith(prefix)) return Promise.resolve(null)
    // 复用 sourceInfoFor 的同一套规则(别再写第二份:规则漂移会变成
    // 「抓取能取到、播放解析拿不到凭证」,而错误文案还指向「链接不对」)。
    return sourceInfoFor({ channelKey: subscriptionId.slice(prefix.length), info: {} })
  }

  async function infoFor(subscriptionId: string): Promise<Record<string, string> | null> {
    const sub = await repo.get(subscriptionId)
    return sub ? await sourceInfoFor(sub) : await previewInfoFor(subscriptionId)
  }

  async function resolvePlayByUrlFor(itemId: string, subscriptionId: string): Promise<ResolvePlayback | null> {
    const url = findItemUrl(itemId, subscriptionId)
    if (!url) return null
    // ⚠️ resolver 抛错(平台风控/无流/限区/需登录)**不在此吞成 null** —— 交给外层
    // `resolvePlay` 的 catching 原样透出真实错误。null 只留给「无订阅/无 url」这两种
    // 真正「不可解析」的情形(外层映射为「该条目不指向可解析的视频链接」)。曾把 resolver
    // 错误也吞成 null → 风控失败被误报成「链接不对」,用户去重装/换源(查错方向)。
    const info = await infoFor(subscriptionId)
    if (!info) return null
    const { streams, chapters } = await resolvePlayByUrl(url, info)
    let danmaku
    try {
      danmaku = getDanmakuByUrl(url, { cookie: info.cookie })
    } catch {
      // 无弹幕能力(如纯图文/音频)不阻塞播放。
    }
    // danmaku 是函数,过 RPC(JSON) 会丢 —— 同时给可序列化的 ref 让客户端本地重建
    // (匿名;凭证不过界,见 DanmakuRef 注释)。
    const danmakuRef = danmaku ? { url, kind: "vod" as const } : undefined
    return { streams, danmaku, danmakuRef, chapters }
  }

  /** 直播播放:同上,但 kind=live 路由。 */
  async function resolveLivePlayByUrlFor(roomId: string, subscriptionId: string): Promise<ResolvePlayback | null> {
    const url = findItemUrl(roomId, subscriptionId)
    if (!url) return null
    const info = await infoFor(subscriptionId)
    if (!info) return null
    const { streams } = await resolveLivePlayByUrl(url, info)
    let danmaku
    try {
      danmaku = getDanmakuByUrl(url, { cookie: info.cookie })
    } catch {
      // 无弹幕能力不阻塞播放。
    }
    const danmakuRef = danmaku ? { url, kind: "live" as const } : undefined
    return { streams, danmaku, danmakuRef }
  }

  return {
    /** 解析播放:统一走 crawler/resolver(按 item.url 路由到平台解析函数)。 */
    async resolvePlay(subscriptionId, itemId) {
      // ⚠️ 不要把 null 当成「URL 不可解析」—— resolver 的真实错误(无流/风控/限区)必须
      // 原样透出,否则把「解析/网络失败」误导成「链接不对」,用户查错方向。
      const r = await catching(resolvePlayByUrlFor(itemId, subscriptionId))
      if ("err" in r) throw r.err
      if (r.ok) return r.ok
      throw new Error("该条目不指向可解析的视频链接")
    },

    async resolveLivePlay(subscriptionId, roomId) {
      const r = await catching(resolveLivePlayByUrlFor(roomId, subscriptionId))
      if ("err" in r) throw r.err
      if (r.ok) return r.ok
      throw new Error("该条目不指向可解析的直播链接")
    },

    /**
     * 弹幕订阅（服务端建连）：凭证只在服务进程内使用 —— 抖音直播弹幕要 ttwid，
     * 桌面拿不到也不该拿到。info 规则与播放解析同源（订阅 / `preview:` 前缀）。
     */
    async resolveDanmaku(subscriptionId, url, kind) {
      const info = await infoFor(subscriptionId)
      // 无路由 / 平台不支持 → getDanmakuByUrl 抛错，原样透出（调用方按「没有弹幕」处理）。
      return getDanmakuByUrl(url, { kind, cookie: info?.cookie })
    },

    async resolveHotWord(subscriptionId, word) {
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
    },

    /**
     * 单条详情:store 里找 item → source 探测 ItemDetailSource → 补全。
     * xhs 走 noteDetail(匿名,需列表项 xsec_token);通用 RSS 抓原文页提正文;
     * bili/weibo 列表已完整(无该能力)→ 原样返回。item 不在 store 则返回 null。
     */
    async resolveDetail(subscriptionId, itemId) {
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
      const info = await sourceInfoFor(sub)
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
      // 单条上限：超大正文（服务器把整库塞进一页之类）不入缓存，避免单条撑爆库与备份。
      // 已知上限：没有全局 LRU/条数上限，缓存随「点开过的文章数」增长；退订会清、诊断页可整清。
      if (
        cacheable &&
        resolved.kind === "article" &&
        (resolved.content ?? "").length > before.length &&
        (resolved.content ?? "").length <= MAX_BODY_CACHE_CHARS
      ) {
        await bodyCache
          .set(subscriptionId, itemId, {
            content: resolved.content ?? "",
            contentFormat: resolved.contentFormat ?? "text",
            fetchedAt: now(),
          })
          .catch(() => {})
      }
      return resolved
    },

    /** 订阅是否支持分页加载更多(hot 发现流;UI 据此显隐「加载更多」)。 */
    async canLoadMore(subscriptionId) {
      const sub = await repo.get(subscriptionId)
      if (!sub) return false
      const channel = getChannel(sub.channelKey)
      if (!channel) return false
      const info = await sourceInfoFor(sub)
      return isPageable(channel.getSource(info))
    },
  }
}
