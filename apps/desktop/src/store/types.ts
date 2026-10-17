/**
 * store 的共享类型:视图状态形状 + 动作契约 + 动作工厂上下文。
 *
 * 拆出来是为了让 `actions/*` 不依赖 store 入口文件(避免环形 import),
 * 同时让各动作文件的返回类型能用 `Pick<DesktopState, ...>` 做完整性检查。
 */
import type { StoreApi } from "zustand"
import type {
  AppSettings,
  DataLayer,
  MediaItem,
  ResolvePlayback,
  Subscription,
  SubscriptionGroup,
} from "@amoeba/core"
import type { SortMode, ViewFilter, ViewResult } from "./selectors.ts"

/** social 详情弹窗载荷(点击卡片打开;xhs 异步补全 full)。 */
export interface SocialDetail {
  item: MediaItem
  full?: MediaItem | null
  /** 详情补全失败的原因(为空 = 还在补全或无需补全)。 */
  error?: string
}

/** 热搜词流:词 + 内容 + 加载/失败态(失败不能与「加载中」同态,否则永久停在转圈)。 */
export interface HotWordState {
  word: string
  items: MediaItem[]
  loading: boolean
  error?: string
}

export interface Toast {
  id: number
  tone: "ok" | "warn" | "error" | "info"
  title: string
  text?: string
  /** 可撤销操作(如「一键归组」)—— 有这组字段时吐司里出现一个动作按钮。 */
  action?: { label: string; run: () => void }
  /**
   * 退场中:已从「显示」逻辑移除,但**先不卸载** —— 留到退场动画放完再由渲染层
   * 调 `removeToast`。**不能**直接过滤掉:元素一卸载就没机会播退场动画。
   */
  closing?: boolean
}

export interface DesktopState {
  dl: DataLayer | null
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  /** 全局全部条目(core store 的快照;视图查询从它派生)。 */
  allItems: MediaItem[]
  /** 当前视图的**未分页**结果(供详情/推荐等直接消费)。 */
  view: ViewResult
  settings: AppSettings | null

  selectedNodeId: string | null
  selectedArticleId: string | null
  socialDetail: SocialDetail | null
  hotWord: HotWordState | null
  /** DataLayer 初始化失败(库损坏/宿主未注入)→ 整页错误,不让应用白屏。 */
  initError: string | null
  /**
   * 首屏可以交给真实视图了 —— 即 init **全部**结束(含首轮 `refreshAll`)。
   *
   * ⚠️ 不能只等「同步部分」结束就置 true。曾这么写,结果是 `ready=true` 而
   * `loading` 还是 false(首轮 refreshAll 的 `loading: true` 要等一个 await 才落),
   * 中间那一拍 `showSkeleton` 判成 false → 启动骨架**卸掉又装回来**。真机逐帧量到
   * 相位是 static → overlay → static → overlay → static(两次翻转),
   * 用户看到的就是「骨架闪一下、露出空视图、再盖回去」。
   * 等首轮刷新跑完再置 true,全程只有**一次**翻转。
   */
  ready: boolean

  /** 展开的分组(纯内存)。 */
  openGroups: Record<string, boolean>
  filter: Record<string, ViewFilter>
  sort: Record<string, SortMode>
  page: Record<string, number>
  query: string

  /** 刷新中(全量/单订阅)。 */
  loading: boolean
  busy: Record<string, boolean>
  refreshErrors: Record<string, string>
  /** 订阅是否支持分页(懒查缓存)。 */
  canLoadMore: Record<string, boolean>
  loadMoreEnded: Record<string, boolean>
  totals: Record<string, number>
  loadingMore: boolean
  offline: boolean

  /** 命令面板开合(顶栏按钮与 ⌘K 共用同一状态)。 */
  paletteOpen: boolean
  /**
   * 播放队列。元素是 `itemKey` 复合键(`subId:itemId`,见 lib/media.ts)——
   * ⚠️ **不能只存 item.id**:同一个 id 会跨订阅出现(bili:live 与 bili:live:hot),
   * 只存 id 的话队列里两条不同订阅的条目会互相顶掉/串位。
   * 落 localStorage(`ui-queue`),重开应用队列还在。
   */
  queue: string[]
  /**
   * 播客 feed 的**临时单集预览**(Apple 榜单那种「条目是节目、不是单集」的源)。
   *
   * 点开这类条目 → 拉它那个 RSS feed → 列出单集让用户挑。这批单集**不落库、
   * 不建订阅**（`previewChannel` 语义）—— 它们只活在这次会话里,故单独存这里,
   * 播放页找不到条目时回退查它。关掉弹窗即清。
   */
  feedPreview: { title: string; feedUrl: string; items: MediaItem[] } | null
  /** 播放页取消的弹幕(设置项为总开关,此处是临时覆盖)。 */
  danmakuVisible: boolean

  toasts: Toast[]

  init(): Promise<void>
  select(nodeId: string | null): void
  loadHotWord(word: string): Promise<void>
  setQuery(q: string): void
  setFilter(node: string, patch: ViewFilter): void
  setSort(node: string, mode: SortMode): void
  growPage(node: string): void
  toggleGroup(gid: string): void
  selectArticle(id: string | null): void
  openSocialDetail(item: MediaItem): void
  closeSocialDetail(): void
  /**
   * 展开一条**播客 feed 条目**的单集列表(Apple 榜单的节目:url 是 feed 不是单集)。
   * 拉一次该 feed、列出单集,临时存 `feedPreview`(不建订阅、不落库)。
   */
  openFeedPreview(item: MediaItem): Promise<void>
  closeFeedPreview(): void

  /** `opts.silent` 时不弹「已更新」toast（供内部编排调用，调用方自己有提示）。 */
  refresh(id: string, opts?: { silent?: boolean }): Promise<void>
  refreshAll(force?: boolean): Promise<void>
  loadMore(): Promise<void>
  setOffline(v: boolean): void

  markRead(item: MediaItem): void
  /**
   * 批量标已读。⚠️ 收**条目**而非 id —— reading 键要带 subscriptionId
   * （见 core `readingKey`），只传 id 会丢掉订阅维度。
   */
  markAllRead(items: MediaItem[]): void
  toggleStar(item: MediaItem): void
  /** 记录续播位置(秒)。播完(近片尾)则清除记录,避免重看时又跳到结尾。 */
  savePosition(item: MediaItem, sec: number, durationSec: number): void
  /** 记录文章阅读进度(0..1 滚动比例)。读到结尾(≥0.95)清除记录。 */
  saveScrollRatio(item: MediaItem, ratio: number): void

  resolvePlay(subscriptionId: string, itemId: string): Promise<ResolvePlayback>
  resolveLivePlay(subscriptionId: string, roomId: string): Promise<ResolvePlayback>

  addSubscription(
    channelKey: string,
    title: string,
    info: Record<string, string>,
    meta?: { groupId?: string | null; refreshIntervalSec?: number },
  ): Promise<string | null>
  updateSubscription(id: string, patch: Partial<Omit<Subscription, "id">>): Promise<void>
  removeSubscription(id: string): Promise<void>
  toggleSubEnabled(id: string): Promise<void>
  addGroup(title: string): Promise<string | null>
  renameGroup(id: string, title: string): Promise<void>
  removeGroup(id: string): Promise<void>
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>

  setPaletteOpen(open: boolean): void
  /** 入队。⚠️ 收**条目**而非 id —— 队列按 `subId:itemId` 复合键存(跨订阅不串)。 */
  addToQueue(item: MediaItem): void
  /** 出队(播完一条自动下一条时用)。 */
  removeFromQueue(item: MediaItem): void
  clearQueue(): void
  toggleDanmaku(): void

  toast(tone: Toast["tone"], title: string, text?: string, action?: Toast["action"]): void
  /** 开始退场(标记 `closing`,元素留下播动画)。 */
  dismissToast(id: number): void
  /** 真正移除(退场动画结束后由渲染层调用)。 */
  removeToast(id: number): void
  /** 把未分组订阅按内容类型一键归入「视频 / 直播 / 社交 / 音频 / 文章」分组。返回移动条数。 */
  autoGroupByKind(): Promise<number>
  /** 订阅清单 → OPML 2.0 字符串(只含带 url 的 rss/rsshub 订阅)。 */
  exportOpml(): string
  /** 导入 OPML:按 groupPath 建分组 + 逐条落 rss:url。返回 新建/跳过/失败 计数。 */
  importOpml(xml: string): Promise<{ added: number; skipped: number; failed: number }>
}

/** zustand 的 set/get(动作工厂共用)。 */
export type StoreSet = StoreApi<DesktopState>["setState"]
export type StoreGet = StoreApi<DesktopState>["getState"]

/**
 * 动作工厂的共享上下文:set/get + 三个由多处动作复用的派生操作。
 * （refreshView / syncSubscriptions / queryCanLoadMore / isRealSub 都需要访问
 *   store 当前快照,放在 ctx 里避免每个动作文件各写一份。）
 */
export interface StoreCtx {
  set: StoreSet
  get: StoreGet
  /** 重算当前视图 + 全局条目快照。 */
  refreshView(): void
  /** 订阅集变更后重读 + 重绘。 */
  syncSubscriptions(): Promise<void>
  /** 懒查分页能力并写 canLoadMore(仅真实订阅;已缓存短路)。 */
  queryCanLoadMore(nodeId: string): void
  /** 真实订阅节点(非 tab/smart/group/page/play)。 */
  isRealSub(nodeId: string | null): nodeId is string
}
