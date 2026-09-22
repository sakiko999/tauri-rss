# RSS Reader 技术方案

> 状态：路线图——**本文是目标态规划**，已落地模块的实现细节见各包源码（各包职责见 CLAUDE.md），
> 本文不重复。以下两处与本文原设定不同，以新架构为准：
> - **数据获取层已换成 crawler**（`packages/crawler`）：一切皆 RssChannel → RSS XML，取代本文原
>   `feeds/parser` + `fetch/transport` 划分。宿主能力经**全局 `globalThis.appHost`** 注入
>   （`packages/host`，node/browser/tauri 三环境），取代本文原 `platform/` + `PlatformHost` seam。
> - **core 数据模型是判别联合 `MediaItem`**（`packages/core/src/types/media-item.ts`，五种 kind：
>   article/social/video/audio/live），XML 编解码在独立包 `packages/xml`。
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
| 离线存储 | idb-keyval | — | 离线缓存阶段引入 |

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

## 设计记录:live 源与产品形态的错位(2026-08)

**问题**:live channel 是 1:1(一个直播间 = 一个订阅),其他 channel 是 1:N(一个
订阅 = 一个内容流)。`refresh` 按 `channelKey + info` 查 crawler,直播源的
`fetchItems` 恒返回 1 条 Item → 在列表/瀑布流里是一个孤条,没有「流」的体感;
单房间订阅只有短视频模式(每条全屏播)天然不违和。**不是 UI 层的错**——
数据模型缺「直播聚合」维度,单房间 live channel 本质是「单房间查询器」,
不是「内容源」。

**倾向方案(未定,待实现前决定)**:
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

## Feed / FeedItem / 阅读 / 设置

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

## 三模式实现要点

**1. 三分栏**（`ThreeColumnReader`）
- CSS Grid + 容器查询折叠：≥1080px 三栏，720–1080 两栏，<720 单栏
- 中栏 `Virtuoso` 虚拟化 + `endReached` 无限加载
- 选中态放 zustand nav，虚拟化重挂载不丢
- 桌面键盘导航：↑/↓ 切文章，←/→ 切 feed

**2. 瀑布流**（`MasonryGrid`）
- ⚠️ **已修正**:原方案 `VirtuosoGrid + grid-auto-rows:8px + span` 不可行——
  VirtuosoGrid 假设「same sized items」(等宽等高)做虚拟化,变高 span 击穿测量。
- ✅ **实际方案**:CSS columns 实现(`apps/desktop/src/components/MasonryGrid.tsx`)。
  列优先填充、高度错落;递增渲染数 + 底部哨兵 IntersectionObserver 无限加载;
  `loading="lazy"` 懒加载。social 源按图片 width/height 撑比例(方案 A:Range 预取
  文件头解析,`crawler/src/utils/img-size.ts`),未知比例退化 4:3。
- 按 kind 分发:MediaList 中 social → MasonryGrid,其余 → VirtuosoGrid

**3. 短视频**（`ShortVideoFeed`）
- Swiper vertical + Virtual + Cube/Flip，只渲染可视 ±1
- `PlayerRegistry`（Context）管理播放器互斥：slide 切换 `stopAll()` 再 `play(active)`
- 起播策略：静音起播 → 交互后取消静音（兼容双端自动播放策略）
- 非激活 slide 显示 poster 占位，不挂 hls 实例

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

> ⚠️ 双端**定位已分离**：desktop 数据供给走独立爬虫服务，mobile 保持内置 crawler
> （有限平台）。本文的「一致性」只覆盖 UI 层——数据供给层的切分边界见
> `docs/desktop-crawler-service.md`。

- 设计令牌唯一来源：`packages/ui/src/styles/theme.css` 的 `@theme`
- 容器查询优先（Tailwind 4 内建 `@container`）：三栏折叠、瀑布流列数、slide 密度
- 设备差异只留 3 个开关：
  - `useIsTouch`（`pointer: coarse`）→ 触摸目标 44px、hover 门控 `@media (hover:hover)`
  - `useSafeArea` → 移动端 `env(safe-area-inset-*)`
  - platform 通道 → 桌面 ResizableSplitter + 键盘，移动 swipe + 返回手势
- 断点（容器查询）：0 单栏 / 720px 两栏 / 1080px 三栏；瀑布流列数 2→3→4
- 全部 rem 基准，字号跟随 `AppSettings.fontSize`
