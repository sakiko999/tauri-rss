# RSS Reader 技术方案

> 状态：路线图。**本文是目标态规划，部分描述与当前实现已不同步**——以下模块已按新架构落地，
> 以实际代码为准：
> - **数据获取层已换成 crawler**（`packages/crawler`）：一切皆 RssChannel → RSS XML，取代本文的
>   `feeds/parser` + `fetch/transport` 划分。channel 直接 implements 能力接口
>   `RssVideoChannel`/`RssLiveChannel`（懒解析 `resolvePlay`/`resolveLivePlay`），getSource
>   是纯函数（每次新实例，缓存/去重归 core）。宿主能力经**全局 `globalThis.appHost`** 注入
>   （`packages/host`，node/browser/tauri 三环境），取代本文 `platform/` + `PlatformHost` seam。
> - **core 数据模型是判别联合 `MediaItem`**（`packages/core/src/types/media-item.ts`，五种 kind：
>   article/social/video/audio/live），XML 编解码在独立包 `packages/xml`。
> - 当前桌面端是验证型两栏界面（订阅列表 + 按 kind 渲染），尚未实现本文的三模式 UI。
> 其余（UI 三模式、数据流边界、Tauri 插件调研、实现阶段）仍是后续方向。
> 更新日期：2026-08-07

## 目标

Tauri RSS reader（桌面 + 移动双端），需处理 **文章 / 图片 / 视频 / 音频 / 直播流** 五种 source，支持三种 UI 模式：

1. **多级列表**（三分栏阅读器：feed 树 → 文章列表 → 详情）
2. **瀑布流**（masonry）
3. **短视频模式**（上下左右可划，全屏 swipe，自动播放/暂停）

## 技术选型（已确认）

| 领域 | 首选 | 版本 | 备选 / 备注 |
|------|------|------|-------------|
| 框架 | React | 19.2.8 | — |
| 样式 | Tailwind CSS | 4.3.3 | `@tailwindcss/vite` 插件，CSS-first |
| 数据获取 | @tanstack/react-query | 5.101.4 | SWR |
| 状态管理 | Zustand | 5.0.14 | persist middleware |
| 虚拟化 | react-virtuoso | 4.18.11 | 列表 + Masonry + VirtuosoGrid 一体化 |
| 短视频滑动 | Swiper | 14.0.7 | EffectCube/EffectFlip/virtual/lazy |
| 视频/直播 | 自研 `<video>` + hls.js | 1.6.16 | 见下方理由 |
| CSS 工具 | clsx + tailwind-merge | 2.1.1 / 3.6.0 | — |
| feed 解析 | fast-xml-parser | — | 纯 JS，不用 Rust 解析 |
| HTML 清洗 | DOMPurify | — | 详情渲染前 sanitize |
| 离线存储 | idb-keyval | — | 阶段 6 引入 |

### 选型理由

- **react-virtuoso**：一个库覆盖列表/瀑布流/网格，动态高度自动测量，维护活跃（2026-07 发版）。弃用 `react-masonry-css`（2023 停更）。
- **Swiper 14**：维护最活跃的滑动库，竖向翻页 + Cube/Flip 3D 转场 + 触摸惯性是主场，支持鼠标拖拽（桌面）。
- **自研 video + hls.js**：hls.js 是事实标准（Vidstack 底层也是它）。双端 UI 用我们自己的 Tailwind 组件，天然一致；体积小，无 Web Components 桥接层。弃用 `react-player`（2025-12 停更）。Vidstack 作为备选（开箱即用 UI 但定制成本高）。
- **zustand 管应用状态 + react-query 管网络内容**（边界见数据流章节）。

### 视频/直播适配逻辑（hls.js 官方 feature-detect）

```ts
if (canPlayNativeHls) {
  video.src = src;           // iOS WKWebView：原生 HLS
} else if (Hls.isSupported()) {
  const hls = new Hls({ lowLatencyMode: true }); // 桌面/Android：hls.js + MSE
  hls.loadSource(src);
  hls.attachMedia(video);
}
```

- 直播：`lowLatencyMode: true`，`LEVEL_LOADED.details.live` 判定直播态
- `hls.destroy()` 必须幂等（兼容 React StrictMode 双挂载）

## 数据模型（packages/core/types）

核心是**判别联合** `Content`，决定 UI 用哪种渲染（列表行/卡片/全屏 slide）：

```ts
export type ContentKind = 'article' | 'image' | 'video' | 'audio' | 'live';

export interface MediaItem {
  url: string;
  kind: 'image' | 'video' | 'audio' | 'live';
  mimeType?: string;
  poster?: string;            // 视频封面 / 直播缩略图
  width?: number;
  height?: number;
  aspectRatio?: number;
  durationSec?: number;
  bitrate?: number;
  sizeBytes?: number;
  streamingFormat?: 'hls' | 'dash' | 'progressive';
  isLiveNow?: boolean;
  lang?: string;
}

export type Content =
  | { kind: 'article'; media?: MediaItem[] }
  | { kind: 'image';  image: MediaItem; caption?: string }
  | { kind: 'video';  video: MediaItem; caption?: string }
  | { kind: 'audio';  audio: MediaItem; artist?: string; album?: string }
  | { kind: 'live';   stream: MediaItem; channel?: string; viewerCount?: number };
```

### 设计记录:live 源与产品形态的错位(2026-08)

**问题**:live channel 是 1:1(一个直播间 = 一个订阅),其他 channel 是 1:N(一个
订阅 = 一个内容流)。`refresh` 按 `channelKey + info` 查 crawler,直播源的
`fetchItems` 恒返回 1 条 Item → 在列表/瀑布流里是一个孤条,没有「流」的体感;
单房间订阅只有短视频模式(每条全屏播)天然不违和。**不是 UI 层的错**——
数据模型缺「直播聚合」维度,单房间 live channel 本质是「单房间查询器」,
不是「内容源」。

**倾向方案(未定,待 P2 前决定)**:
- **B. 分组聚合(core 层)**:渲染层把同 kind 的 live 订阅动态合成一个混合 feed
  (「直播」分组 = 所有 live 订阅合并),无新 channel,改动集中在 core 编排
  (合并 + 去重 + 排序)。当前倾向此方案——复用现有订阅模型,不引入新源概念。
- A. 订阅级聚合(`live:aggregate`,rooms 数组参数,复用各 live channel fetch):
  一条订阅 = 一条「我的直播」流,但引入新 channel,与订阅模型耦合。
- C. 分区/搜索聚合(发现流,`dart_simple_live` 已实现可参考):分区 API 拉「平台
  在播房间」+ 房间搜索,是瀑布流/短视频的**发现**来源,与订阅聚合互补。
  本仓库已有 bilibili partition v2 + ABogus 签名能力(见 CLAUDE.md),douyu/huya
  的分区/搜索在 `tmp/dart_simple_live` 有 Dart 参考。

**产品形态下的落地**:
- 三分栏列表:订阅树里「直播」分组 = 聚合 feed(B),单房间订阅是叶子。
- 瀑布流:聚合源(关注,B)+ 分区热榜(发现,C)混排,直播卡片带「● 直播中」角标。
- 短视频模式:聚合源直接驱动上下滑切换直播间,懒解析即播。

**dart_simple_live 参考**(`tmp/dart_simple_live`):分区推荐、房间搜索、
按平台列出所有在播房间——C 方案的成熟参照,已对照 douyin HTML fallback。

### Feed / FeedItem / 阅读 / 设置

```ts
export interface Feed {
  id: string;                 // stable hash(url)
  url: string;
  siteUrl?: string;
  title: string;
  description?: string;
  favicon?: string;
  kind: ContentKind | 'mixed';
  lastFetchedAt?: number;
  etag?: string;
  lastModified?: string;
  lastError?: string;
  folderId?: string;
  createdAt: number;
}

export interface FeedItem {
  id: string;                 // stable hash(feedId + guid/link)
  feedId: string;
  guid?: string;
  title: string;
  summary?: string;
  content?: string;           // 原始 HTML，渲染前 sanitize
  link?: string;
  author?: string;
  publishedAt: number;
  updatedAt?: number;
  tags: string[];
  media: MediaItem[];
  content: Content;           // classifier 产出的判别联合
}

export interface ReadRecord {
  read: boolean;
  positionSec?: number;       // 音视频续播位置
  scrollRatio?: number;
  lastReadAt: number;
}
export type ReadingMap = Record<string, ReadRecord>;

export interface AppSettings {
  viewMode: 'reader' | 'masonry' | 'shortvideo';
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  density: 'comfortable' | 'compact';
  autoplayVideo: boolean;
  startMuted: boolean;        // 静音起播，用户交互后取消静音
  dataSaver: boolean;
  refreshIntervalMin: number;
}
```

## packages/core 模块划分（纯逻辑，ui/apps 依赖它）

```
core/
  index.ts                     // barrel：只导出公共 API
  types/
    content.ts                 // ContentKind / MediaItem / Content
    feed.ts                    // Feed / FeedItem
    reading.ts                 // ReadRecord / ReadingMap
    settings.ts                // AppSettings
    queries.ts                 // ItemsQuery 等
  feeds/
    parser.ts                  // parseFeed(bytes, url): 格式探测→分发
    rss.ts                     // RSS 2.0 + RDF 映射
    atom.ts                    // Atom 映射
    json.ts                    // JSON Feed 映射
    media.ts                   // enclosure/media:content/itunes → MediaItem[]
    normalize.ts               // 字段规整、HTML→文本、guid/id 稳定哈希
    sanitize.ts                // DOMPurify 白名单清洗
  fetch/
    transport.ts               // FetchTransport 接口：get(url) → {status, headers, body}
    tauri.ts                   // invoke('http_get')，走 Rust 透传绕 CORS
    web.ts                     // 浏览器 fetch（dev/预览）
    index.ts                   // createTransport()：isTauri() 分支
  content/
    classifier.ts              // inferContentKind(item): Content
    aspect.ts                  // MediaItem → aspectRatio
  store/
    subscriptions.ts           // zustand(persist)：Feed[] 清单、文件夹
    reading.ts                 // zustand(persist)：ReadingMap + markRead/setPosition
    settings.ts                // zustand(persist)：AppSettings
    nav.ts                     // zustand：activeFeedId/activeItemId/activeSlideIndex
  queries/
    feeds.ts                   // useFeeds / useFeed / addFeed/refreshFeed mutations
    items.ts                   // useFeedItems / useInfiniteFeedItems
    unread.ts                  // useUnreadCounts()：query + reading 组合派生
    keys.ts                    // 统一 queryKey 构造
  cache/
    db.ts                      // IndexedDB 适配（idb-keyval）
    offline.ts                 // 离线队列
  platform/
    runtime.ts                 // isTauri() / platform / isTouch()
    storage.ts                 // createStorage：localStorage→IndexedDB 抽象
    link.ts                    // openExternal(url)（Tauri opener 封装）
  utils/
    id.ts                      // 稳定哈希
    time.ts                    // 相对时间 / 格式化
    url.ts                     // favicon 推导、域名提取
    bytes.ts                   // 字节格式化
  constants.ts                 // 断点、刷新间隔、staleTime
```

### 关键点

- **CORS 边界**：桌面 WebView2 的 `fetch()` 抓 RSS 被 CORS 拦截。唯一触碰 Rust 的地方 = 一个极薄 `http_get` Rust command（reqwest 透传原始字节），**解析仍 100% 在 JS**。媒体标签（img/video/audio）不受 CORS 影响。备选：官方 `tauri-plugin-http`。
- media 提取：RSS `enclosure` / Atom `link rel=enclosure` / `media:content` / `media:group` / `itunes:*` 统一归一成 `MediaItem[]`。
- core 不自带 UI；`sanitize.ts` 在 core 而非 UI，保证详情渲染统一走白名单。

## packages/ui 组件树

```
ui/
  index.ts
  src/
    styles/theme.css           // Tailwind 4 @theme 设计令牌（唯一来源）
    lib/cn.ts                  // clsx + tailwind-merge
    hooks/
      useMediaQuery.ts  useContainerQuery.ts  useElementSize.ts
      useIsVisible.ts  useIsTouch.ts  useScrollRestoration.ts
      useShortVideoPlayback.ts
    components/
      primitives/       Button Icon Avatar Badge Spinner Skeleton Card Thumbnail
                        SegmentedControl EmptyState ErrorState ProgressBar ExternalLink
      layout/           AppShell Header ViewSwitcher ResizableSplitter
      reader/           ThreeColumnReader FeedListPane FeedTreeNode ArticleListPane
                        ArticleListItem DetailPane ArticleDetail
      masonry/          MasonryGrid MediaCard ArticleCard AudioCard LiveCard
      shortvideo/       ShortVideoFeed ShortVideoSlide VideoSlide ImageSlide
                        ArticleSlide AudioSlide SlideProgressBar
      player/           MediaPlayer PlayableMedia MediaItemView(renderers)
                        VideoShell useVideoElement useMediaStream(useHls)
                        controls/   ← MediaChrome 式独立控件(见下)
                        MediaPlayButton MediaMuteButton MediaVolumeSlider
                        MediaTimeRange MediaRateButton MediaQualityButton
                        MediaFullscreenButton MediaLiveEdgeButton MediaTimeDisplay
                        PlayerControls(默认组合=media-control-bar)
```

### 三模式实现要点

**1. 三分栏**（`ThreeColumnReader`）
- CSS Grid + 容器查询折叠：≥1080px 三栏，720–1080 两栏，<720 单栏
- 中栏 `Virtuoso` 虚拟化 + `endReached` 无限加载
- 选中态放 zustand nav，虚拟化重挂载不丢
- 桌面键盘导航：↑/↓ 切文章，←/→ 切 feed

**2. 瀑布流**（`MasonryGrid`）
- `VirtuosoGrid` + `display:grid; grid-auto-rows:8px`
- 每卡按 `aspectRatio` 设 `grid-row-end: span ceil(高/8)`
- `useIsVisible` + `loading="lazy"` 懒加载；`dataSaver` 非可视渲染占位

**3. 短视频**（`ShortVideoFeed`）
- Swiper vertical + Virtual + Cube/Flip，只渲染可视 ±1
- `PlayerRegistry`（Context）管理播放器互斥：slide 切换 `stopAll()` 再 `play(active)`
- 起播策略：静音起播 → 交互后取消静音（兼容双端自动播放策略）
- 非激活 slide 显示 poster 占位，不挂 hls 实例

### VideoPlayer 接口（自研）

```ts
interface PlayableSource {
  src: string;
  poster?: string;
  type?: 'hls' | 'dash' | 'mp4' | 'webm' | 'audio';
  kind?: 'video' | 'audio' | 'live';
}
type PlayerState = 'idle'|'loading'|'ready'|'playing'|'paused'|'buffering'|'ended'|'error';
interface VideoPlayerHandle {
  play(); pause(); seekTo(t); setRate(r); toggleMute();
  getTime(); getDuration(); readonly isLive: boolean;
}
```

- `useHls` hook：`Hls.isSupported()` 分支 → hls.js attach / 原生 src
- `LEVEL_LOADED.details.live` 判定直播态 → LiveBadge + 无进度条（或 DVR）
- 音频复用同一 `<video>` 壳，`AudioPlayer` 只换控制条皮肤
- preload 策略：非激活 slide `preload="metadata"`，激活才全量加载

**实际落地（2026-08，与上述接口对齐的 React 实现）**：
- `useVideoElement(videoRef, isStreaming)`：单一状态中枢，监听 11 个媒体事件
  （timeupdate/durationchange/progress/volumechange/ratechange/play/pause/ended/waiting/playing/canplay）
  → `state{paused,currentTime,duration,buffered,volume,muted,playbackRate,waiting,live}`；
  暴露 `ops{togglePlay,seek,changeVolume,toggleMute,changeRate,setLiveEdge}`。
  直播判定：流媒体 duration 无效即 live，原生媒体 `duration===Infinity` 即 live。
- `VideoShell`：外壳(容器全屏 / 控件自动隐藏 2.5s / 键盘 Space K ←→↑↓ M F Home End 数字 / 
  点击播放暂停 + 双击全屏 / 缓冲 spinner 400ms 延迟 / 居中大播放键)。
- **控件 = MediaChrome 式独立组件**（`controls/`，每个窄接口、可自由组合，等价
  `<media-play-button>`/`<media-time-range>` 等）：MediaPlayButton / MediaMuteButton /
  MediaVolumeSlider / MediaTimeRange(原 SeekBar:缓冲+悬停+拖拽+键盘) / MediaRateButton(radix 菜单) /
  MediaQualityButton(radix 档位菜单) / MediaFullscreenButton / MediaLiveEdgeButton /
  MediaTimeDisplay。`PlayerControls` = 默认组合(等价 `<media-control-bar>`)。
- **useMediaStream 生命周期**：hls/flv/dash 懒实例 + StrictMode 双挂载安全
  （unmount effect 销毁实例）+ 锁最高档（`currentLevel=max`，宿主隧道带宽估算失真，
  ABR 会骤降 144p 永不回升，后续开放用户手动选档）。

## 数据流边界

**react-query 管"从网络来的内容"，zustand 管"本地的应用/阅读状态"。**

| 数据 | 归属 | 理由 |
|------|------|------|
| feed 内容、文章列表、详情、媒体 | react-query | 网络获取、去重/缓存/刷新/无限分页 |
| 订阅清单（manifest） | zustand(persist) | 本地持久化、无网络语义 |
| 阅读进度 / 已读 / 音视频位置 | zustand(persist) | 纯本地状态 |
| 设置 / 主题 / dataSaver | zustand(persist) | 同上 |
| 导航选中态 / slide 下标 / scrollTop | zustand | 跨虚拟化重挂载存活 |
| 未读数 | 派生 hook `useUnreadCounts` | query cache + reading store 各取一半，不复制 |

queryKey 约定（`queries/keys.ts`）：
```
['feeds']
['feed', { url }]
['items', { feedIds, folderId, kind, unreadOnly }]
['items', 'infinite', { feedIds, ... }]
['item', { id }]
```

## 跨平台一致性

**原则：一套组件 + 一套设计令牌，靠"容器宽度"驱动布局，不靠设备判断。**

- 设计令牌唯一来源：`packages/ui/src/styles/theme.css` 的 `@theme`
- 容器查询优先（Tailwind 4 内建 `@container`）：三栏折叠、瀑布流列数、slide 密度
- 设备差异只留 3 个开关：
  - `useIsTouch`（`pointer: coarse`）→ 触摸目标 44px、hover 门控 `@media (hover:hover)`
  - `useSafeArea` → 移动端 `env(safe-area-inset-*)`
  - platform 通道 → 桌面 ResizableSplitter + 键盘，移动 swipe + 返回手势
- 断点（容器查询）：0 单栏 / 720px 两栏 / 1080px 三栏；瀑布流列数 2→3→4
- 全部 rem 基准，字号跟随 `AppSettings.fontSize`

## 工程基础设施（P0）

### 依赖

| 包 | dependencies |
|---|---|
| packages/core | `fast-xml-parser` `dompurify` `react` `@tanstack/react-query@^5` `zustand@^5` `idb-keyval`（阶段6） |
| packages/ui | `react` `react-dom` `clsx` `tailwind-merge` `react-virtuoso@^4.18` `swiper@^14` `hls.js@^1.6` `@tauri-playground/core` |
| apps/* | `react` `react-dom` `@tauri-playground/core` `@tauri-playground/ui` `@tauri-apps/api` |
| apps/* dev | `@tailwindcss/vite` `tailwindcss` `@types/react` `@types/react-dom` |

Cargo 侧（可选、极薄）：`reqwest` + `#[tauri::command] http_get(url) -> {status, headers, body}`，注册进 `lib.rs`。

### tsconfig 修复（关键）

- 根 `tsconfig.app.json` 追加：`"jsx": "react-jsx"`、`"types": ["vite/client"]`、`paths`（指向 `packages/*/src`，不加 baseUrl）
- 四个子包 tsconfig `extends` 从 `../../tsconfig.json` 改为 `../../tsconfig.app.json`（当前链条已断：根 tsconfig 是 solution 文件无 compilerOptions）
- 根 `tsconfig.json` references 补 `packages/core`、`packages/ui`

### Vite 配置

- alias：`@tauri-playground/core` → `packages/core/src`，`@tauri-playground/ui` → `packages/ui/src`
- `plugins: [tailwindcss()]`、`resolve.dedupe: ['react','react-dom']`
- `optimizeDeps.exclude` 两个 workspace 包

### Tauri 插件调研结论（2026-08 记录，保留现状）

> 背景：曾评估用 `tauri-plugin-http` 替换自研 `http_get` 命令、用 `tauri-plugin-sql`/`tauri-plugin-store` 替换 web 侧 localStorage。结论：**当前保留现状**，理由与后续切换点如下。

**HTTP：保留自研 `http_get`（reqwest）命令，不用 `tauri-plugin-http`**

- plugin-http 本质是把「Rust reqwest + CORS 直通」官方化，JS 侧是 fetch 兼容 API。但两个具体摩擦点对本项目是硬伤：
  1. **URL scope**：RSS 阅读器要抓**任意用户添加的 URL**，plugin-http 要求 capability 里配 `allow` URL pattern，等于放弃作用域保护或写死 `https://**`
  2. **forbidden header**：直播平台需自定义 `user-agent`/`referer`（douyin ABogus 签名必需），plugin-http 默认忽略，要开 `unsafe-headers` feature
- 自研命令已验证、无 scope/header 摩擦，对「任意 URL + 自定义头」是更贴合的核心需求模型
- **切换触发点**：需要媒体附件下载进度/取消（plugin-http 的 `download`/`upload`）、或想大幅削减自定义 Rust 代码时。迁移成本低：Cargo 加 `unsafe-headers`、capabilities 配宽 URL scope、TS 换 `@tauri-apps/plugin-http` 的 fetch

**存储：localStorage 元数据暂够，SQLite 留给离线缓存阶段（P6）**

- 分两层看：
  - **元数据**（订阅/设置/阅读状态）：量小，localStorage 足够。将来可换 `tauri-plugin-store`（JSON 文件，异步 + 100ms debounce 落盘），非紧迫
  - **条目缓存**（离线阅读/搜索/过滤）：这才是量级问题——500 feed × 50 条 × 几 KB 即超 localStorage ~5–10MB 配额，且无查询能力。**正解是 `tauri-plugin-sql`（SQLite + sqlx，支持迁移/索引/事务）**，但当前条目根本没持久化（纯内存 store），决策应推迟到做 P6 离线缓存时
- 全局 `appHost` 门面（`packages/host`）已保证宿主能力可扩展：届时新增一个 `QueryBackend` seam 接 SQLite，不碰 core 逻辑

**其他值得接入的插件（按优先级）**

| 优先级 | 插件 | 用途 | 时机 |
|---|---|---|---|
| ⭐ 已接入 | opener | 点文章链接开外部浏览器 | ✅ 已用 |
| 高 | notification | 新文章系统通知 | 有阅读行为后 |
| 高 | sql | 条目缓存/搜索 | P6 离线缓存 |
| 中 | fs | 媒体附件本地缓存、OPML 导入导出 | P6 配套 |
| 中 | dialog | OPML 文件选择/导出位置 | 导入导出时 |
| 中 | logging | 结构化日志，排查直播平台签名 | 需要就上 |
| 低 | websocket | 直播平台实时推送（非轮询） | 长尾 |
| 低 | window-state / single-instance / updater / deep-link | 窗口记忆/防重复轮询/分发 | 后期 |

**不建议**：stronghold（无敏感 API 密钥）、barcode/geolocation/haptics 等无关插件。

### Tailwind 4 CSS-first 接入

```css
/* apps/*/src/styles.css */
@import "tailwindcss";
@import "../../../packages/ui/src/styles/theme.css";
@source "../../../packages/ui/src";   /* 关键：monorepo 必须显式扫包源码 */
@source "../../../packages/core/src";
```

## 实现阶段

| 阶段 | 产出 | 验证 |
|------|------|------|
| **P0 基建** | 修 tsconfig 链、paths、Vite alias、Tailwind 接入、装依赖 | `tsc -p apps/desktop` 过；dev 出 Tailwind 占位页，四包可 import |
| **P1 core 数据层**（优先，UI 前提） | types / parser(rss/atom/json) / media / classifier / transport + `http_get` / store / query hooks；fixture 示例 feed | 控制台打印归一化 FeedItem[] + Content 判别；store 持久化可写可读 |
| **P2 三分栏** | primitives + AppShell + ThreeColumnReader + nav/reading 接线 | feed→列表→详情→标已读链路通；拖窄自动折叠单栏 |
| **P3 瀑布流** | MasonryGrid + 四卡片 + aspect 行高 + 懒加载 | 卡片错落排布、滚动流畅、dataSaver 生效 |
| **P4 短视频** | ShortVideoFeed + VideoPlayer/hls.js + PlayerRegistry + 自动播放 | 竖向翻页、切换互斥、demo m3u8 可播、无泄漏 |
| **P5 数据流接线** | mutations + 未读数 + 订阅管理 UI + 刷新间隔 | 增删 feed 双层同步、重启存活、未读正确 |
| **P6 跨平台** | mobile 布局 + 暗色 + 离线缓存 + 错误态 | 双端观感一致、断网读缓存 |

> P6 离线缓存：条目改用 `tauri-plugin-sql`（SQLite）持久化，新增 `QueryBackend` seam 接入（见「Tauri 插件调研结论」）。localStorage 只保留元数据，够用不换。

## 关键风险

1. **CORS**：极薄 `http_get` Rust 命令是唯一 Rust 改动，解析全 JS
2. **hls.js + StrictMode**：destroy 幂等，source 切换先 destroy
3. **Swiper 不嵌套 Virtuoso**：每 slide 独立内容组件，避免双虚拟化冲突
4. **自动播放**：统一静音起播 → 交互后取消静音
5. **内存**：Virtuoso 限 DOM、Swiper virtual 只活 3 张、hls 切走即销毁
6. **Tailwind @source**：必须显式扫 packages/ui，否则样式消失
