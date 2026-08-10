# Folo(RSSNext)架构与数据层调研

> 2026-08 调研 tmp/Folo(RSSNext/Folo,AGPL-3.0)。关注与本项目 RSS Reader 相关的部分。

## 一、架构总览

```
apps/desktop(Electron: main 主进程 + renderer Vite React)
apps/mobile(React Native Expo)
packages/internal/
  database/   Drizzle ORM + SQLite 数据层(核心)
  store/      Zustand store + 数据编排(核心)
  atoms/      Jotai 原子状态
  models/     RSSHub 路由数据模型
  constants/  FeedViewType / tabs 定义
  shared/     跨平台常量 / Electron bridge
  hooks/ components/ utils/
```

**关键差异:它是「服务端聚合 + 本地离线缓存」架构**,抓取/解析/刷新编排全在云端,客户端只调 `followClient.api.feeds.refresh({id})` 触发 + 本地 SQLite 镜像。我们 crawler 本地真实抓取,不能照搬云架构,只借鉴 store 层形态。

## 二、数据层

- **Drizzle + SQLite**。桌面用 `wa-sqlite`(wasm)+ IndexedDB(IDBMirrorVFS)持久化;38 个版本化迁移。
- **核心表**:
  - `feeds`(feed 元数据,与订阅分离)+ `subscriptions`(feedId+userId+view,**分组就是 `category` 字符串字段**)
  - `entries`(标题/内容/`read` 布尔/**`media` JSON/`attachments` JSON**)
  - `collections`(entryId 主键 = 星标)、`unread`(subscriptionId→count 聚合表)
- **已读**:entries.read + unread 聚合表双写;滚动 100ms 批量窗口 `queueEntriesAsRead`。
- **去重**:`upsertMany` ON CONFLICT DO UPDATE。
- **刷新**:客户端无定时轮询,手动/进入页面触发云端刷新 + React Query invalidate。

## 三、分组建模(最值得抄)

Folo 分组**极简:subscriptions 表一个 `category` 字符串列**:
- 无 category 时 `getDefaultCategory` 按 feed 的 `siteUrl` 域名兜底自动归类。
- store 维护 `categories: Record<view, Set<string>>` + 展开状态;路由 `folder-` 前缀。
- 无多层嵌套,是「视图 × 单层分类」二维组织。

**对照本项目**:core 分组目前「仅渲染/展开,不做增删」。Folo 的「category 字段 + 按域名自动分组」是可落地的轻量升级。

## 四、前端状态(重点:Transaction 事务模式)

三层混合:Zustand(业务 store)+ Jotai(UI 原子)+ TanStack Query(服务端状态)。

**最值得抄:`Transaction` 四段式乐观更新**(`store/src/lib/helper.ts`):
```
tx.store(乐观更新内存 store) → tx.request(网络) → tx.rollback(失败回滚) → tx.persist(本地 DB)
```
订阅增删改/标已读/星标全走此模式。比我们 core DataLayer 直接写更优雅——UI 先行 + 失败回滚 + 本地落库三态一致。

## 五、视频播放

**Folo 对 YouTube/Bilibili 是嵌入官方 iframe 播放器**(`transformVideoUrl` 映射到 player.bilibili.com / youtube-nocookie.com embed),只有直链 mp4/mp3 才用原生播放器。**没有 hls.js/flv.js/dash.js**——我们项目的流解析方案比它更深入一层,不抄。

## 六、对本项目可借鉴点

**值得抄**:
1. `category` 字符串 + 按域名自动分组(轻量分组树升级)
2. Transaction 四段式乐观更新(改 core 的写订阅/标已读)
3. `unread` 聚合表(侧栏未读数 O(1))
4. store 反查索引(entryIdByFeed/ByView/ByCategory Set 索引)
5. media/attachments 内嵌 JSON(与 ui 按 kind 分发渲染器互补)

**不适用**:
- 云端聚合架构(我们本地抓取)
- 38 迁移 + wa-sqlite(我们 demo 用 localStorage)
- iframe 嵌入播放(差于我们直链解析)
- AI 摘要/lists/inboxes/多用户

## 关键文件路径
- schema:`packages/internal/database/src/schemas/index.ts`
- 事务模式:`packages/internal/store/src/lib/helper.ts`
- 分组逻辑:`packages/internal/store/src/modules/subscription/`
- 视频 URL 映射:`packages/internal/utils/src/url-for-video.ts`
