/**
 * Mobile store —— 复用 core DataLayer(订阅/抓取/阅读态),只做移动端需要的薄视图状态。
 *
 * 定位与 desktop 分离:mobile 是**极简看内容**闭环 —— 未读列表 → 点开播放/阅读,
 * 外加**基础订阅管理**(RSS 直链添加/移除,见 addFeed/removeSub + subs 页签)。
 * 不做「订阅工作台」全形态(rail/五视图/频道发现/播放器控件) —— 那归 desktop。
 * 内置 crawler 形态(见 CLAUDE.md):移动端不接爬虫服务,仅用有限平台(SSR/HTTP)。
 */
import { create } from "zustand"
import {
  createDataLayer,
  findItem,
  positionDecision,
  type DataLayer,
  type MediaItem,
  type Subscription,
} from "@amoeba/core"

import "@amoeba/core/source/rsshub"

interface MobileState {
  dl: DataLayer | null
  items: MediaItem[]
  subs: Subscription[]
  initError: string | null
  /** 当前打开的条目(播放/阅读),null = 列表页。 */
  open: MediaItem | null
  /** 顶部页签:订阅流 / 订阅管理。 */
  tab: "feed" | "subs"
  init: () => Promise<void>
  openItem: (item: MediaItem) => void
  closeItem: () => void
  refresh: () => Promise<void>
  addFeed: (url: string, title?: string) => Promise<void>
  removeSub: (id: string) => Promise<void>
  setTab: (tab: "feed" | "subs") => void
  /** 记录续播位置(秒)。播完(近片尾)清除记录;不足 5s 的变化不落库(节流)。 */
  savePosition: (item: MediaItem, sec: number, durationSec: number) => void
}

let initPromise: Promise<void> | null = null

export const useMobile = create<MobileState>((set, get) => ({
  dl: null,
  items: [],
  subs: [],
  initError: null,
  open: null,
  tab: "feed",

  async init() {
    if (get().dl) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const dl = createDataLayer()
        set({ dl, initError: null, items: dl.store.query({}), subs: await dl.subscriptions.list() })
        // 全量变更回调:条目/阅读态变化后重算列表。
        dl.store.subscribe(() => set({ items: get().dl!.store.query({}) }))
        // 启动刷新走 TTL 缓存(命中零网络)。逐订阅串行,移动端网络更弱。
        const subs = await dl.subscriptions.list()
        for (const s of subs.filter((x) => x.enabled)) {
          await dl.refresh(s.id, { force: false }).catch(() => {})
        }
      } catch (e) {
        initPromise = null
        set({ initError: e instanceof Error ? e.message : String(e) })
      }
    })()
    return initPromise
  },

  openItem(item) {
    set({ open: item })
    const dl = get().dl
    if (!dl) return
    // ⚠️ 两件事都要做(同 desktop markRead):patch 内存(store.subscribe → 重算列表,
    // 未读项当场从列表消失)+ 落 reading 持久层(下次启动/刷新由 applyReadingState 回填)。
    // 只落库不 patch 的话,打开后条目仍显示未读,直到下次 refresh。
    if (item.isUnread) {
      dl.store.patch(item.subscriptionId, item.id, { isUnread: false })
      void dl.reading.markRead(item.subscriptionId, item.id, true).catch(() => {})
    }
  },
  closeItem() {
    set({ open: null })
  },
  setTab(tab) {
    set({ tab })
  },

  async addFeed(url, title) {
    const dl = get().dl
    if (!dl) return
    const u = url.trim()
    if (!u) return
    // ⚠️ 重复拦截(核心是防「同 feed 的相同 item.id 存两份」):同 URL 再加一次会产生
    // 两条 rss:url 订阅 → React key 冲突、未读计数翻倍、store.patch 一次改两条。
    // 移动端粘贴 URL 是高频误操作。**不抛错**(避免误显为失败)——直接当作已存在返回(normalize
    // 首尾空白;desktop 另做 canonUrl,此处 URL 直链场景取精确匹配足够)。
    const dup = (await dl.subscriptions.list()).find(
      (s) => s.channelKey === "rss:url" && (s.info?.url ?? "").trim() === u,
    )
    if (dup) return
    // ⚠️ addSubscription 内部**已 refresh 一次**(新订阅无缓存 → 走网络)。
    // 不再额外 refresh:曾补一次 `force:true` 会用同一 id 再抓一遍(同订阅串行执行两次网络),
    // 对反爬源是双倍请求。core 现在会把首刷结果作为 `refresh.error` 返回；移动端
    // 「极简看内容」刻意不做失败徽标（那属工作台），但结果已可被上层消费。
    await dl.addSubscription("rss:url", title?.trim() || u, { url: u }, {})
    set({ subs: await dl.subscriptions.list() })
  },
  async removeSub(id) {
    const dl = get().dl
    if (!dl) return
    await dl.subscriptions.remove(id)
    set({ subs: await dl.subscriptions.list() })
  },

  async refresh() {
    const dl = get().dl
    if (!dl) return
    const subs = await dl.subscriptions.list()
    // ⚠️ force:true —— 用户显式点「刷新」= 期望最新;force:false 会在 TTL(默认 30min)
    // 内命中缓存直接返回,**列表毫无变化**(与 desktop 手动刷新对齐)。
    for (const s of subs.filter((x) => x.enabled)) {
      await dl.refresh(s.id, { force: true }).catch(() => {})
    }
    set({ subs })
  },

  // ⚠️ onProgress 由播放器按 timeupdate(4Hz)回调 —— 不节流直接落库会打爆 SQLite
  // (写放大同样触发持久层串行队列积压)。判据走 core 的 positionDecision(近片尾清除 /
  // 5s 节流),与 desktop 同一份;读 store 当前值(调用方持有的 item 可能是旧对象)。
  savePosition(item, sec, durationSec) {
    const dl = get().dl
    if (!dl) return
    // ⚠️ 必须同时匹配 subscriptionId —— 同一个 id 会跨订阅出现(见 core readingKey)。
    const cur = findItem(get().items, item.subscriptionId, item.id) ?? item
    const d = positionDecision(cur.positionSec ?? 0, sec, durationSec)
    if (d.kind === "clear") {
      if ((cur.positionSec ?? 0) > 0) {
        dl.store.patch(item.subscriptionId, item.id, { positionSec: undefined })
        void dl.reading.setPosition(item.subscriptionId, item.id, 0).catch(() => {})
      }
      return
    }
    if (d.kind === "wait") return
    dl.store.patch(item.subscriptionId, item.id, { positionSec: d.next })
    void dl.reading.setPosition(item.subscriptionId, item.id, d.next).catch(() => {})
  },
}))

/**
 * 可播判定与 desktop 的 `isFeedItem` 对齐：audio 且无 stream = 播客 feed，
 * 主操作是「列出单集」而不是播放（移动端没有 feed 预览，至少不要送进播放页必碎）。
 */
export const isPlayable = (i: MediaItem) =>
  (i.kind === "video" || i.kind === "audio" || i.kind === "live") &&
  !(i.kind === "audio" && !(i as { stream?: unknown }).stream)
