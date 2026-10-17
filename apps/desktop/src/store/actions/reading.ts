/**
 * 阅读/星标/续播动作:已读、星标、播放位置、文章滚动比例、播放解析入口。
 *
 * 从 store/index.ts 拆出;只依赖 StoreCtx + core 的 reading 判据。
 */
import { findItem, positionDecision, readingKey } from "@amoeba/core"
import type { DesktopState, StoreCtx } from "../types.ts"

type ReadingActions = Pick<
  DesktopState,
  | "markRead"
  | "markAllRead"
  | "toggleStar"
  | "savePosition"
  | "saveScrollRatio"
  | "resolvePlay"
  | "resolveLivePlay"
>

export function createReadingActions(ctx: StoreCtx): ReadingActions {
  const { get } = ctx

  return {
    markRead(item) {
      const dl = get().dl
      if (!dl) return
      // ⚠️ 两个语义别混:内存 store 的 `isUnread`(取反得 next),持久层 `reading.read`
      // 是「**已读**」——写入的应是取反后的 `!next`(= 标记前的 isUnread 语义:原来未读
      // = 现在已读)。曾把 `next`(未读语义)直接传给 markRead → 持久层 read 恒反:
      // 标已读存 read=false → applyReadingState 不回填 → 刷新后回到未读。
      const next = !item.isUnread
      dl.store.patch(item.subscriptionId, item.id, { isUnread: next })
      void dl.reading.markRead(item.subscriptionId, item.id, !next)
    },

    markAllRead(items) {
      const dl = get().dl
      if (!dl) return
      // ⚠️ 收的是**条目**(不是 id 数组):reading 键要带 subscriptionId
      // (见 core types/reading.ts 的 readingKey)——只传 id 就丢了订阅维度。
      for (const it of items) dl.store.patch(it.subscriptionId, it.id, { isUnread: false })
      // ⚠️ 必须一次性批量落库:逐条 `void markRead` 会并发读-改-写同一张 reading blob,
      // 后写者用旧快照覆盖前者 —— N 条只落 1 条,且整张表的既有记录被抹掉。
      void dl.reading.markManyRead(items.map((it) => readingKey(it.subscriptionId, it.id)), true)
    },

    toggleStar(item) {
      const dl = get().dl
      if (!dl) return
      const next = !item.isStarred
      dl.store.patch(item.subscriptionId, item.id, { isStarred: next })
      // ⚠️ 必须落库:refresh 会整批重建条目(isStarred 默认 false),只 patch 内存
      // 的话刷新/重启后星标就丢了(core 侧 refresh 会用 reading 回填)。
      void dl.reading.setStarred(item.subscriptionId, item.id, next)
    },

    savePosition(item, sec, durationSec) {
      const dl = get().dl
      if (!dl) return
      // ⚠️ 必须读 store 里的**当前**值,不能用参数 item —— 调用方(播放页)持有的 item
      // 可能是 patch 前的旧对象(高频回调下尤其),用旧值判断会让清除/节流失效。
      // ⚠️ 必须**同时匹配 subscriptionId**:同一个 id 会跨订阅出现(bili:live 与
      // bili:live:hot),只比 id 会拿到**别的订阅**那条的位置,节流/清除全部判错。
      const cur = findItem(get().allItems, item.subscriptionId, item.id) ?? item
      // 判据走 core 的 positionDecision(近片尾清除 / 5s 节流),与 mobile 同一份。
      const d = positionDecision(cur.positionSec ?? 0, sec, durationSec)
      if (d.kind === "clear") {
        if ((cur.positionSec ?? 0) > 0) {
          dl.store.patch(item.subscriptionId, item.id, { positionSec: undefined })
          void dl.reading.setPosition(item.subscriptionId, item.id, 0)
        }
        return
      }
      if (d.kind === "wait") return
      dl.store.patch(item.subscriptionId, item.id, { positionSec: d.next })
      void dl.reading.setPosition(item.subscriptionId, item.id, d.next)
    },

    saveScrollRatio(item, ratio) {
      const dl = get().dl
      if (!dl) return
      const cur = findItem(get().allItems, item.subscriptionId, item.id) ?? item
      // 读到结尾(≥0.95)清除记录 —— 否则重开又会跳到文章底部。
      if (ratio >= 0.95) {
        if ((cur.scrollRatio ?? 0) > 0) {
          dl.store.patch(item.subscriptionId, item.id, { scrollRatio: undefined })
          void dl.reading.setScrollRatio(item.subscriptionId, item.id, 0)
        }
        return
      }
      // 节流:变化不足 5%(0.05)不落库(滚动事件高频)。
      if (Math.abs(ratio - (cur.scrollRatio ?? 0)) < 0.05) return
      dl.store.patch(item.subscriptionId, item.id, { scrollRatio: ratio })
      void dl.reading.setScrollRatio(item.subscriptionId, item.id, ratio)
    },

    async resolvePlay(subscriptionId, itemId) {
      const dl = get().dl
      if (!dl) throw new Error("DataLayer 未初始化")
      return dl.resolvePlay(subscriptionId, itemId)
    },

    async resolveLivePlay(subscriptionId, roomId) {
      const dl = get().dl
      if (!dl) throw new Error("DataLayer 未初始化")
      return dl.resolveLivePlay(subscriptionId, roomId)
    },
  }
}
