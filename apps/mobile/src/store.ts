/**
 * Mobile store —— 复用 core DataLayer(订阅/抓取/阅读态),只做移动端需要的薄视图状态。
 *
 * 定位与 desktop 分离:mobile **不做**「订阅工作台」全形态(rail/五视图/发现/管理),
 * 只保留「看内容」最小闭环:未读列表 → 点开播放/阅读。订阅管理走 desktop。
 * 内置 crawler 形态(见 CLAUDE.md):移动端不接爬虫服务,仅用有限平台(SSR/HTTP)。
 */
import { create } from "zustand"
import { createDataLayer, type DataLayer, type MediaItem, type Subscription } from "@tauri-playground/core"

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
    // 标记已读(阅读态由 core reading 管)。
    get().dl?.reading.markRead(item.id).catch(() => {})
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
}))

export const isPlayable = (i: MediaItem) => i.kind === "video" || i.kind === "audio" || i.kind === "live"
