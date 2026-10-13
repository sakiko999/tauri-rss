/**
 * Mobile store —— 复用 core DataLayer(订阅/抓取/阅读态),只做移动端需要的薄视图状态。
 *
 * 定位与 desktop 分离:mobile **不做**「订阅工作台」全形态(rail/五视图/发现/管理),
 * 只保留「看内容」最小闭环:未读列表 → 点开播放/阅读。订阅管理走 desktop。
 * 内置 crawler 形态(见 CLAUDE.md):移动端不接爬虫服务,仅用有限平台(SSR/HTTP)。
 */
import { create } from "zustand"
import { createDataLayer, type DataLayer, type MediaItem } from "@tauri-playground/core"

import "@tauri-playground/core/source/rsshub"

interface MobileState {
  dl: DataLayer | null
  items: MediaItem[]
  initError: string | null
  /** 当前打开的条目(播放/阅读),null = 列表页。 */
  open: MediaItem | null
  init: () => Promise<void>
  openItem: (item: MediaItem) => void
  closeItem: () => void
  refresh: () => Promise<void>
}

let initPromise: Promise<void> | null = null

export const useMobile = create<MobileState>((set, get) => ({
  dl: null,
  items: [],
  initError: null,
  open: null,

  async init() {
    if (get().dl) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const dl = createDataLayer()
        set({ dl, initError: null, items: dl.store.query({}) })
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

  async refresh() {
    const dl = get().dl
    if (!dl) return
    const subs = await dl.subscriptions.list()
    for (const s of subs.filter((x) => x.enabled)) {
      await dl.refresh(s.id, { force: false }).catch(() => {})
    }
  },
}))

export const isPlayable = (i: MediaItem) => i.kind === "video" || i.kind === "audio" || i.kind === "live"
