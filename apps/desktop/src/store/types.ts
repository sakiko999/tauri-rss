/**
 * store 的共享类型:视图状态形状 + 动作契约 + 动作工厂上下文。
 *
 * 拆出来是为了让 `actions/*` 不依赖 store 入口文件(避免环形 import),
 * 同时让各动作文件的返回类型能用 `Pick<DesktopState, ...>` 做完整性检查。
 */

import type {
  AppSettings,
  DataLayer,
  ErrorKind,
  MediaItem,
  ResolvePlayback,
  Subscription,
  SubscriptionGroup,
  SubscriptionPatch,
} from "@amoeba/core"
import type { StoreApi } from "zustand"

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
  /**
   * 续播进度版本。`progress` 事件只**原地**改条目字段、不换 `allItems` 身份（播放时
   * 每 5 秒一次，换身份会重渲染播放器整棵树）。依赖进度的派生视图（首页「继续观看」、
   * rail 的继续计数、resume 节点列表）订阅这个计数来重算 —— 只加它，不加播放树。
   */
  progressVersion: number
  /** 当前视图的**未分页**结果(供详情/推荐等直接消费)。 */
  view: ViewResult
  settings: AppSettings | null

  selectedNodeId: string | null
  /**
   * 阅读栏选中项。**复合键**（`itemKey(subscriptionId, id)`）—— 聚合视图里同一 id
   * 会跨订阅出现，裸 id 会选中另一订阅的文章。仅会话态，不进 URL。
   */
  selectedArticleKey: string | null
  socialDetail: SocialDetail | null
  hotWord: HotWordState | null
  /** DataLayer 初始化失败(库损坏/宿主未注入)→ 整页错误,不让应用白屏。 */
  initError: string | null
  /** 数据服务/事件通道状态（本地 DataLayer 恒 true）。 */
  serviceOnline: boolean
  serviceError: string | null
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
  /** 各订阅最近一次成功取数的时间(缓存 fetchedAt;TTL 内跳过自动补刷)。 */
  fetchedAt: Record<string, number>
  refreshErrors: Record<string, string>
  /** 与 refreshErrors 同键的失败分类（登录/风控/网络/…），供 UI 选文案。 */
  refreshErrorKinds: Record<string, ErrorKind>
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
   * **二级订阅的内容预览**（`?open=<itemId>` 的右侧列表）。
   *
   * 两类「容器条目」共用：
   *   - 播客 feed（Apple 榜单：`kind:"audio"` 且无 stream，url 是节目 RSS）；
   *   - 分区目录（`kind:"category"`，自带 `categoryChannel` + `categoryInfo`）。
   *
   * 点开容器 → 用 `previewChannel` 取它的真实内容，`MediaMain` 用**与正常订阅同一套
   * 网格/卡片**渲染（只换表头），不另造列表组件。
   * 内容**不落库、不建订阅**；播放页找不到条目时回退查这里（单集/房间的
   * subscriptionId 是 `preview:`，不在 store 里）。
   */
  previewDetail: {
    /** 容器所在订阅节点（页面 nodeId）。 */
    nodeId: string
    itemId: string
    title: string
    /** feed = 播客节目（内容为单集）；category = 分区目录（内容为房间）。 */
    kind: "feed" | "category"
    channelKey: string
    info: Record<string, string>
    /** 请求键（nodeId:itemId），防过期结果覆盖。 */
    key: string
    /** 抓取时间（TTL 内来回进出不重复拉；过期后再点开会重抓）。 */
    at: number
    items: MediaItem[]
    /** 首次读取中；读完为空要能区分「空内容」。 */
    loading: boolean
    error?: string
  } | null
  /** 播放页取消的弹幕(设置项为总开关,此处是临时覆盖)。 */
  danmakuVisible: boolean

  toasts: Toast[]

  init(): Promise<void>
  /** 启动后台对齐浏览器登录 cookie 快照(不阻塞首屏;失败只记录)。 */
  syncBrowserCookies(): Promise<void>
  select(nodeId: string | null): void
  loadHotWord(word: string): Promise<void>
  setQuery(q: string): void
  setFilter(node: string, patch: ViewFilter): void
  setSort(node: string, mode: SortMode): void
  growPage(node: string): void
  toggleGroup(gid: string): void
  selectArticle(item: MediaItem | null): void
  openSocialDetail(item: MediaItem): void
  closeSocialDetail(): void
  /**
   * 打开二级订阅的内容（播客节目 → 单集 / 分区 → 房间）。
   *
   * 容器条目自带目标渠道：feed 用 `rss:podcast` + `{url}`，category 用
   * `categoryChannel` + `categoryInfo`。结果临时存 `previewDetail`（不建订阅、不落库）。
   * `force` 用于失败重试。
   */
  openPreviewDetail(item: MediaItem, opts?: { force?: boolean }): Promise<void>

  /** `opts.silent` 时不弹「已更新」toast（供内部编排调用，调用方自己有提示）。
   *  `opts.force` 默认 true（手动刷新语义）；`false` = 走 TTL 缓存（自动补刷）。 */
  refresh(id: string, opts?: { silent?: boolean; force?: boolean }): Promise<void>
  refreshAll(force?: boolean): Promise<void>
  /** 选中过期订阅时的自动补刷：TTL 内零调用，过期才发一次非 force 刷新
   *  （不阻塞内容展示，仅 busy 转圈；失败走 refreshErrors + toast）。 */
  refreshIfStale(id: string): void
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
  updateSubscription(id: string, patch: SubscriptionPatch): Promise<void>
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
  /**
   * 重算当前视图 + 全局条目快照（输入未变时命中 memo，跳过 set）。
   * `keepItems`：只更新 `view`、不替换 `allItems` 身份 —— 供 progress 事件使用
   * （条目对象已原地更新，换数组身份会让播放器整树重渲染）。
   */
  refreshView(opts?: { keepItems?: boolean }): void
  /** store 内容变更（replace/append/patch/clear）时调用，让 refreshView 的 memo 失效。 */
  markItemsChanged(): void
  /** 订阅集变更后重读 + 重绘。 */
  syncSubscriptions(): Promise<void>
  /** 懒查分页能力并写 canLoadMore(仅真实订阅;已缓存短路)。 */
  queryCanLoadMore(nodeId: string): void
  /** 真实订阅节点(非 tab/smart/group/page/play)。 */
  isRealSub(nodeId: string | null): nodeId is string
}
