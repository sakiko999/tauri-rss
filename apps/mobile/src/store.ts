/**
 * Mobile store —— 复用 core DataLayer(订阅/抓取/阅读态),只做移动端需要的薄视图状态。
 *
 * 定位与 desktop 分离:mobile 是**极简看内容**闭环 —— 未读列表 → 点开播放/阅读,
 * 外加**基础订阅管理**(RSS 直链添加/移除,见 addFeed/removeSub + subs 页签)。
 * 不做「订阅工作台」全形态(rail/五视图/频道发现/播放器控件) —— 那归 desktop。
 * 内置 crawler 形态(见 CLAUDE.md):移动端不接爬虫服务,仅用有限平台(SSR/HTTP)。
 */
import { create } from "zustand"
import { createDataLayer, positionDecision, type DataLayer, type MediaItem, type Subscription } from "@tauri-playground/core"

import "@tauri-playground/core/source/rsshub"

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
      dl.store.patch(item.id, { isUnread: false })
      void dl.reading.markRead(item.id, true).catch(() => {})
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
    // 通用 RSS 直链(rss:url);标题留空则先用 URL,刷新后由 feed 自身标题补。
    const id = await dl.addSubscription("rss:url", title?.trim() || url, { url }, {})
    set({ subs: await dl.subscriptions.list() })
    await dl.refresh(id, { force: true }).catch(() => {})
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
    for (const s of subs.filter((x) => x.enabled)) {
      await dl.refresh(s.id, { force: false }).catch(() => {})
    }
    set({ subs })
  },

  // ⚠️ onProgress 由播放器按 timeupdate(4Hz)回调 —— 不节流直接落库会打爆 SQLite
  // (写放大同样触发持久层串行队列积压)。判据走 core 的 positionDecision(近片尾清除 /
  // 5s 节流),与 desktop 同一份;读 store 当前值(调用方持有的 item 可能是旧对象)。
  savePosition(item, sec, durationSec) {
    const dl = get().dl
    if (!dl) return
    const cur = get().items.find((i) => i.id === item.id) ?? item
    const d = positionDecision(cur.positionSec ?? 0, sec, durationSec)
    if (d.kind === "clear") {
      if ((cur.positionSec ?? 0) > 0) {
        dl.store.patch(item.id, { positionSec: undefined })
        void dl.reading.setPosition(item.id, 0).catch(() => {})
      }
      return
    }
    if (d.kind === "wait") return
    dl.store.patch(item.id, { positionSec: d.next })
    void dl.reading.setPosition(item.id, d.next).catch(() => {})
  },
}))

export const isPlayable = (i: MediaItem) => i.kind === "video" || i.kind === "audio" || i.kind === "live"
