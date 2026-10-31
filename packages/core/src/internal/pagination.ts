/**
 * 渠道分页(从 data-layer.ts 拆出,2026-11-01)。
 *
 * 游标 / 总数 / 退订墓碑是**可变共享状态**,由 createDataLayer 持有并注入 ——
 * refresh 也要读写它们(新首页 → 游标重置),所以这里只做「翻一页」的编排。
 *
 * ⚠️ 必须与 refresh 共用同一条 `serialized("sub:<id>")` 链:loadMore 的
 * `fetchMore(cursor)` 会 await 网络,其间 refresh 若完成 replace + 游标重置,
 * 第 2 页条目会混进新首页、游标指向已失效的序列(重复或跳过整页)。
 */

import { isPageable } from "@amoeba/crawler"

import { coreLog, formatError } from "../log.ts"
import { deserializeFeedWithTotal } from "../processing/deserialize.ts"
import type { ReadingRepository } from "../repo/reading-repo.ts"
import type { SubscriptionRepository } from "../repo/subscription-repo.ts"
import { getChannel } from "../source/index.ts"
import type { MediaStore } from "../store/media-store.ts"
import { applyReadingState } from "./reading-state.ts"

export interface PaginationDeps {
  now: () => number
  repo: SubscriptionRepository
  reading: ReadingRepository
  store: MediaStore
  sourceInfoFor: (sub: { channelKey: string; info: Record<string, string> }) => Promise<Record<string, string>>
  /** 订阅 → 当前翻到的位置(refresh 重置)。refresh 与 loadMore 共用。 */
  pageCursors: Map<string, string>
  /** 订阅 → 平台总数(weibo cardlistInfo.total;refresh/loadMore 时更新)。 */
  pageTotals: Map<string, number>
  /** 已退订 id(墓碑):在途 fetch 完成后若订阅已退订,丢弃结果。 */
  removedSubs: Set<string>
  /** 与 refresh 共用的 per-subscription 串行链(见 internal/async.ts)。 */
  serialized: <T>(key: string, fn: () => Promise<T>) => Promise<T>
}

export interface PaginationApi {
  loadMore(subscriptionId: string): Promise<{ addedCount: number; hasMore: boolean }>
  totalOf(subscriptionId: string): number | undefined
}

export function createPagination(deps: PaginationDeps): PaginationApi {
  const { now, repo, reading, store, sourceInfoFor, pageCursors, pageTotals, removedSubs, serialized } = deps

  return {
    /** 加载更多:翻一页追加进 store。游标内部维护(refresh 后重置);本页为空 = 没有更多。 */
    loadMore(subscriptionId) {
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
        const addedCount = store.append(subscriptionId, await applyReadingState(aligned, reading))
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
    },

    totalOf(subscriptionId) {
      return pageTotals.get(subscriptionId)
    },
  }
}
