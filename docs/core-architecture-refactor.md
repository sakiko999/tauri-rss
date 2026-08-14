# core 架构评估与收敛规划（2026-08-14）

> 细读 `packages/core/`（1490 行/16 文件）后的架构评估。目标：**apps 唯一数据入口是
> DataLayer + 稳定类型模型；crawler/xml/host/repos/store 全收敛进 core 内部**。
> 记录待办，未实施。

## 现状（已做对的）

- `DataLayer` 已是单一公共 seam（`data-layer.ts:36`），三个 repo 内部化。
- cookie 合并（`sourceInfoFor`）、分页游标（`pageCursors`）已收敛进 core。
- desktop 通过 `useDesktop` 消费，只 import core 的 **type**（MediaItem 族/ResolvePlayback/Subscription）
  + `createDataLayer`，已不直接碰 repo/store 内部。

## 泄漏点（apps 直接碰了不该碰的）

| # | 泄漏 | 位置 | 后果 |
|---|---|---|---|
| ① | desktop 直接 import crawler `listChannels` | `apps/desktop/src/components/AddFeedDialog.tsx:12` | apps 绕过 core 摸 crawler 注册表；mobile 接入要复制；crawler 内部结构变化波及 apps |
| ①b | desktop 直接 import crawler `getChannel` | `apps/desktop/src/store.ts:24`（`nodeKindOf` 查 channel.kind） | 同上 |
| ② | core 公共面 re-export 无人消费项 | `index.ts:59-62` `parseFeed`/`ParsedFeed`/`ParsedItem`、`deserializeFeed`、三个 `create*Repository`、`createMediaStore` | desktop 全走 `dl.*`，这些只 example 用，属多余公共面 |
| ③ | desktop 自实现订阅编排 | `apps/desktop/src/store.ts:362 addSubscription`（拼 id + add + refresh） | 编排逻辑应在 core |
| ④ | cookie 在 AppSettings 暴露 | `settings.ts:25-29` 三 cookie 字段 + `bilibili-cookie.ts`（DEFAULT 密钥）在 core 根 | `core-auth-architecture.md` 已规划迁 `core/auth/`，目前中间态 |

## 收敛方案

| # | 改动 | 内容 |
|---|---|---|
| 1 | DataLayer 补渠道能力 | `listChannels(): ChannelInfo[]`（apps 只需 `key/name/kind/sourceInfoTpl/defaultInfo`，类型在 core 定义，不透 crawler 的 `RssChannel`）+ `channelKindOf(subscriptionId): MediaKind` |
| 2 | desktop 删 crawler import | `AddFeedDialog` 用 `dl.listChannels()`；`nodeKindOf` 用 `dl.channelKindOf()` → desktop 对 crawler 零依赖 |
| 3 | addSubscription 收敛 | `DataLayer.addSubscription(channelKey, title, info)` 拼 id + add + refresh；desktop 只调一个方法 |
| 4 | index.ts 公共面收窄 | 删 `parseFeed`/`ParsedFeed`/`ParsedItem`/`deserializeFeed`/`create*Repository`/`createMediaStore`（example 改内部路径引）；只留 DataLayer + types + `NoChannelError` |
| 5 | cookie 迁 core/auth | 按 `core-auth-architecture.md`：AppSettings 去 cookie 字段，credential-repo 独立 key（独立专题） |

## 保持暴露（apps 真需要）

- `MediaItem` 判别联合全家 / `MediaStream` / `ResolvePlayback` / `Subscription` / `SubscriptionGroup` / `RefreshResult`
- DataLayer 方法集（refresh / resolvePlay / resolveLivePlay / resolveHotWord / loadMore / canLoadMore / store.query）

## 留在 apps（UI 决策，不收敛）

- `queryView` 聚合逻辑、`tab:`/smart feed 节点体系、`viewTitleFor`/`nodeKindOf`
  （改用 core `channelKindOf` 后仍是 desktop 视图函数）、分组树展开态。

## 落地顺序（小步，校准范围）

1. **1+2**：DataLayer 补渠道能力 → desktop 删 crawler 依赖 → tsc 绿。收益最大，改动集中。
2. **3**：addSubscription 收敛（desktop store 变薄）。
3. **4**：公共面收窄（确认 example 引用路径）。
4. **5 独立**：auth 架构（扫码登录/保活）单独专题，不混入。

## 落地状态（2026-08-14 前三项已完成）

✅ **1+2+3+4 已实施**（含渠道能力、addSubscription、公共面收窄）：

- `packages/core/src/types/channel-info.ts` **新建** ChannelInfo（crawler RssChannel 的 apps 投影，
  不透 source 装配）。
- `packages/core/src/data-layer.ts`：DataLayer 加 `listChannels()`（crawler 注册表投影）、
  `channelKind(channelKey)`、`addSubscription(channelKey,title,info)`（拼 id+add+refresh 编排收敛）。
- `packages/core/src/index.ts`：公共面收窄——删 `parseFeed`/`deserializeFeed`/
  三个 `create*Repository`/`createMediaStore`/独立 repo 类型 re-export；只留
  DataLayer + types + NoChannelError + ChannelInfo。
- `apps/desktop/src/store.ts`：删 crawler `getChannel` import；`nodeKindOf` 改用
  `useDesktop.getState().dl?.channelKind()`；`addSubscription` 收敛调 dl。
- `apps/desktop/src/components/AddFeedDialog.tsx`：删 crawler `listChannels` import，
  改用 `dl?.listChannels()`。

验证：core/desktop/player/ui 四包 tsc 全绿；`grep apps crawler` 清零（apps 对 crawler 零依赖）；
冒烟 listChannels 57 渠道 / channelKind / addSubscription 正常。

待办：**5（cookie 迁 core/auth）** 独立专题未做，按 `core-auth-architecture.md`。
