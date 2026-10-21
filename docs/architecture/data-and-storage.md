# 数据 / 存储 / 订阅约定

> 合并自 data-conventions.md + sqlite-storage-research.md（2026-10-21 整理）。前半是业务数据契约，后半是 SQLite 选型与迁移的落地记录。
> 原先分别从 `CLAUDE.md` 与调研记录迁出；`CLAUDE.md` 只留「XML 是唯一通道」「id 只在订阅内唯一」两条硬契约。相关：`docs/platforms/domestic-feeds.md`。

## crawler → core：唯一通道是 XML

**crawler 输送给 core 的唯一通道是 XML（`serializeFeed` → core 自解析）**：core 用自解析 XML
建 `MediaItem`（item 数据不经 crawler 类型；但 core 仍 import crawler 的渠道类型
`SourceInfoField` 与运行时 `registerAllChannels` / `isXxxSource` / `httpText`）。

故 **channel 设的每个字段若要到达 UI，serialize 必须写、deserialize 必须读** —— 两边漏一个
就静默丢。曾只写 `tpl:kind`，导致 Live 的 `liveStatus`/`online`/`platform`、Video 的
`channel`、Audio 的 `artist`/`album`、Social 的 `likes` **全丢**（实测 174 条 live 全
`liveStatus="unknown"`、`online` 恒 undefined、「X 人在看」全平台不显示、YouTube 直播
platform 被 URL 兜底误判为 bilibili）。✅ 修复后实测（2026-10-13）：观众数**全平台打通**
—— 162 条 live 中 159 条有在线数（此前仅 15，全是抖音）—— bili 59万 / 斗鱼 303万 /
虎牙 436万 / 抖音。

**加新字段务必同时改 serialize + deserialize 两侧**，回归守卫
`serialize-roundtrip.check.ts` + `serialize-contract.check.ts`。

## `MediaItem.id` 只在订阅内唯一

⚠️ 实测 `bilibili:7734200` 同时在 `bili:live`（roomIds 解析成该房）与 `bili:live:hot`。
凡是「按 id 记/改/查」的地方**都要带 subscriptionId**，否则两个订阅互相串：

- **reading 键** = `readingKey(subId, itemId)`（`core/types/reading.ts`，分隔符 `\u0000`）。
  `subscriptionId` 是必填 —— 不再有裸 id 形态（旧版回退已于 2026-10-19 删除）。
- **内存 store** `patch(subscriptionId, id, patch)`（`media-store.ts`）—— 原来按裸 id 打
  **所有**订阅的同 id 条目。
- **播放队列**存 `itemKey` 复合键 + 落 localStorage `ui-queue`（原来只存内存，重开就没）。
- 定位用 `findItem(items, subId, id)`；列表 key 用 `lib/media.ts` 的 `itemKey`。

## 分页：`fetchedAt` 必须对齐到首屏

⚠️ 2026-10-20 小红书发现页实测：没有 `publishedAt` 的源，`selectors.sortItems` 走
`publishedAt ?? fetchedAt` 兜底，而 `loadMore` 是**另一次抓取**（`tpl:fetchedAt` 更新）——
新一批会整体排到列表最前。现象：滚到底点「加载更多」，视口里还是原来那批，**新内容全插到
顶部**（实测 89 → 272 条，顶部一屏一换），用户描述成「往下滑一直看同一页」。

修法：`core.loadMore` 把本页条目的 `fetchedAt` 覆盖成该订阅已有内容的抓取时间（同一订阅 =
同一批快照）→ 排序键相同 → 稳定排序保持 append 顺序。**新增分页渠道时不需要额外处理**
（在 core 统一做）。

另有守卫：游标前进但 `store.append`（按 id 去重后**返回实际新增数**）为 0 条 = 上游把已返回
内容又给了一遍 → `hasMore=false`；游标没动（或本轮是**首次翻页**，core 原本无游标，渠道返回
的重试游标不算「前进」）才是「平台还在加载」的 retry 语义。

配套三条：

1. 渠道的 cursor **不能 clamp 到当前页面条数** —— 页面被重载过（点开笔记/刷新别的 xhs 订阅
   会把共享 Edge 导航走）时 clamp 会把切片压回已返回前缀，表现为「加载更多点了没反应」；
   正确做法是保持旧 cursor 滚到超过它，滚不到就返回空 + 原 cursor 重试。
2. refresh/refreshAll 后要把本地窗口（desktop `page[id]`）抬到至少覆盖新首屏 —— 首屏可能
   超过 PAGE_SIZE（xhs:explore 实测 89 条），而渠道分页只按 `addedCount` 增长窗口，首屏缺口
   永远补不上（尾部条目不可见、footer 却报「已加载全部」）；**种子用 `PAGE_SIZE` 不是 0**
   （停用订阅 refresh 返回 itemCount 0，用 0 当种子会把窗口压成 0 → 空视图）。
3. 游标是「页面 state 下标」的渠道（xhs explore/user）**首次翻页的起点用 core 传入的
   `ctx.existing`（`Pageable.fetchMore` 第二参，store 已有条数），不要用页面当前长度** ——
   共享 Edge 页面可能已被上次滚动养到几百条，用页面长度会跳过中间几百条。

## 播放与阅读状态

- ⚠️ **播完自动下一条**（`core` settings `autoPlayNext`，默认开）：`PlayableMedia` 的
  `onEnded` 必须**两处都挂** —— video 挂 `videoRef`，播客（audio）挂 `AudioShell` 的
  `audioRef`。只挂前者的话音频播完永远不触发（audio 根本不经过 videoRef）。
  播过的当前条同时出队（队列是待播列表，不是播放历史）。

## 正文补全

⚠️ **通用 RSS 文章按需补全正文**：feed 只带 description 摘要时，点开阅读视图会抓 `item.url`
原文页、提正文纯文本（`crawler/channels/rss/extract.ts`，零依赖正则启发式 —— 全仓无 HTML
解析器，HTMLRewriter/DOMParser 各只在一端）。阈值：feed 自带正文可见文本 ≥ `FULLTEXT_HINT`
(800) 则**不抓**（不把好 HTML 降级纯文本）；`ReaderMain` 只对可见文本 <400 的 article 触发。
UI 侧经 `dl.resolveDetail`（`ItemDetailSource`，与 xhs 同一条能力总线，已从
`resolveSocialDetail` 更名）。SPA / 反爬占位页提取失败 → 回退原摘要。
**持久缓存**：抓到的正文落 KV（`core/repo/body-cache-repo.ts`，`body:<sub>:<item>`），退订
一并清；**只对 article**（xhs social 补全含多图/标签，只缓存 content 会丢）。

## dev 种子与重置

- **首启种子订阅**在 `apps/desktop/src/dev/seed.ts`（SEED_SUBSCRIPTIONS + SEED_GROUPS，仅
  dev 构建动态 import）。**覆盖全部 channel**（每个 channel 一条，2026-10-20）：需登录的
  `bili:dynamic` / `weibo:user` 停用；关键词搜索类（`*:search` / `*:anchor` / 搜频道 /
  搜UP主）进「搜索」组且**默认停用**（启用即测）；36 条内置 RSS 直链属同一实现，只留
  `rss:hn` 代表。
  首次写入后落 `dev:seeded` 标记 —— **重置数据/手动删空后不会再次写入**（要恢复测试种子：
  删掉该 KV key 或整个 dev DB）。⚠️ **只在空库 + 无标记 + `import.meta.env.DEV` 下写入** ——
  之后再启动不覆盖（否则用户 CRUD 的订阅会被启动时删掉）；生产构建里种子 import 被摇掉，
  **发布版首启是空库**（走 onboarding）。⚠️ **改了种子列表存量 dev 库不会自动补** ——
  需「设置 → 存储与诊断 → 完全重置数据」或删 dev DB 再启动。
- **存储与诊断 → 完全重置数据**（`settings/Diagnostics.tsx`）：删空 SQLite KV + 清
  localStorage，然后整页重载；dev 下写 `dev:seeded` 防止种子回填。**不碰**浏览器
  profile/登录态 —— 那是同页「清理浏览器数据」的职责。

## 订阅归组

- **按类型归组**（`store/actions/subs.ts`）：手动一键（`autoGroupByKind`）把未分组订阅按
  `channelKind` 分桶，**只为实际有成员的 kind 建组** —— 否则会留下 0 成员空分组（用户看着
  像归类失败）；带撤销（分组本身留着）。
- **添加订阅时自动归组**（settings `autoGroupOnAdd`，默认开，2026-10-21）：新订阅直接进
  「视频/直播/社交/播客/文章」（同名组复用，不存在就建）；调用方显式给了**非空** `groupId`
  （手动选组）不覆盖；OPML 导入走 `dl` 直连、按 OPML 分组，不受此开关影响。

## 内置 RSS 直链

清单在 `packages/crawler/src/channels/rss/builtin.ts`；可用性结论见
`docs/platforms/domestic-feeds.md`。新源先 curl 验证再并入（注意新浪科技带
`xml-stylesheet`，会误判 HTML，实为真 RSS）。

## 存储层

### 内容缓存与存储形态

**内容缓存**：refresh 走 TTL 缓存（KV key `content:<subId>`，value = `{fetchedAt, xml}`）
—— TTL 内命中跳过网络抓取（防反爬源被打）。TTL = 订阅级 `refreshIntervalSec` 优先，
否则 `settings.refreshIntervalMin`（默认 30min）。`refresh(id, {force:true})` 强制抓取
（手动刷新 / CLI 默认）；抓取失败回退旧缓存不空窗；退订一并删缓存。
`packages/core/src/repo/content-cache-repo.ts`。`autoRefresh=false` 时**非 force** 刷新只读
缓存（不发网络）；手动刷新/刷新全部走 `force:true`，不受该开关限制。

⚠️ 内容缓存**没有独立的 content 表**（原判断「新增 content 表、不在 KV 表塞大 blob」**未采用**）：
就是同一 KV 表里 `content:<subId>` 的记录（`core/repo/content-cache-repo.ts`）。
单条 value 是一条 feed 的 XML，量级可接受；真要拆表时改 repo 实现即可，接口不变。

**storage 三态**：desktop `SqliteStorageBackend`（tauri-plugin-sql，appData/rss.db）·
CLI `sqliteStorage`（bun:sqlite）· example 内存版。
**DDL 唯一权威 = core `db/schema.ts`**（两端共用，插件自带的 migration 机制不用，防漂移）。

⚠️ **DB 按运行形态隔离**（`packages/host/src/tauri/sqlite-storage-backend.ts`）：
生产 `rss.db` · 普通 dev `rss.dev.db` · release debug `rss.release-debug.db`
（`scripts/tauri.ts` 在 `--release` 时给 Vite 注入 `VITE_AMOEBA_PROFILE`）。
release debug 仍走 Vite dev server（DEV=true），会在自己的库里写种子。

> 动机：desktop 原用 webview localStorage（容量 ~5-10MB、同步阻塞、无查询能力），
> CLI 用 file-JSON。切 SQLite 是 P6 离线内容缓存的前置，也是 `docs/ops/commands.md` §六
> 既定路线（「file-JSON 起步，为 SQLite 切换留门」—— repo 接口隔离让这次切换 repo 实现
> 零改动）。落地记录见下（2026-08-28）。

### 一、选型：desktop 用 tauri-plugin-sql？

| 方案 | 说明 | 结论 |
|---|---|---|
| **tauri-plugin-sql（官方）** | sqlx 底层（sqlite feature），JS bindings `Database.load/execute/select` | ✅ **选定** |
| 自研 rusqlite command | `db_execute/db_select` 手写 command + JSON 绑定 + Mutex state（~100 行 Rust） | ❌ 插件就是这事的官方成品，自研零收益（除非要 SQLCipher 加密） |
| tauri-plugin-libsql / drizzle sqlite-proxy | ORM/加密/Turso 同步 | ❌ repo 接口已隔离 SQL，无 ORM 需求 |
| sql.js（wasm in webview） | 纯前端 | ❌ 性能差、持久化手动 |

**理由**：官方维护、桌面/移动全平台（mobile 将来直接受益）、API 面极小正对 KV 用法、
免写 Rust 样板。已知限制对本项目无影响：

- **IPC 开销**（plugins-workspace #2049：小查询也 ~ms 级）—— KV 量级（3 个 key 的
  get/set）完全无感；内容缓存批量读写是未来场景，届时用单条 SQL 批量语句即可
- 无加密（sqlx 不支持 SQLCipher）、无 JS 侧事务——均不需要
- Windows MS Store 沙箱路径问题——不走商店分发

**关键取舍：migration 不用插件的（Rust 侧 `add_migrations`）**。插件的 migration 定义
落在 Rust，CLI（bun:sqlite）就得复制一份 SQL——正是 `docs/ops/commands.md` §六禁止的
「各写各的 SQL 导致漂移」。改为：DDL 归 **core（`packages/core/src/db/schema.ts`）**，
两端启动时各跑同一份幂等 DDL（`CREATE TABLE IF NOT EXISTS`）。P1 schema 极简（KV 一张表），
不需要版本化框架；`MIGRATIONS` 数组已就位，引入非幂等迁移时补版本表、两端复用同一
执行逻辑。

### 二、落地形态：KV-over-SQLite（repo 零改动）

三 repo（subscriptions/reading/settings）的数据形态就是三个 JSON blob，StorageBackend
（KV string）语义保持——**换的是 backend 实现，不是 repo**：

```
desktop:  injectTauriHost → SqliteStorageBackend(tauri-plugin-sql, appData/rss.db)
CLI:      setupHost       → sqliteStorage(bun:sqlite, apps/cli/.data/rss.db)
共用:     core db/schema.ts 的 KV_TABLE/KV_DDL/MIGRATIONS（唯一 DDL 权威）
不动:     三 repo / DataLayer / 命令层 / UI
```

将来需要结构化查询（阅读状态批量操作、缓存索引、全文搜索）时按 repo 逐个拆表——
repo 接口不变，只是 KV 实现换成 SQL 实现。

### 三、localStorage → SQLite 迁移（desktop）

`SqliteStorageBackend` 首次访问时惰性执行（进程内一次）：

1. 建 KV 表（幂等 DDL）
2. 遍历 `subscriptions/reading/settings` 三个 localStorage key（`tauri-rss:` 前缀）：
   sqlite 该 key **为空才写入**；随后**删除 local key**——无论哪种情况都移除，
   杜绝双源漂移（旧 local 值不是权威，sqlite 已有值优先）

### 四、验证状态

- ✅ CLI：bun:sqlite 全链（refresh 落库、幂等 update、env probe KV roundtrip、
  `rss.db` 文件 + kv 表 + subscriptions 行实测）
- ✅ Rust：`cargo check` 通过（插件注册 + sqlite feature 编译）
- ✅ 前端：全仓 tsc 七项目通过（含 desktop 编译 host 源码的 plugin-sql 类型）
- ✅ desktop 运行时：appData/rss.db 已生效（CLAUDE.md 记）

### 五、遗留 / 后续

- **WAL**：两端各自独立库文件（不共享），单进程顺序访问无并发诉求，暂不开
  `journal_mode=WAL`；将来 CLI 与 desktop sidecar 指向同一库文件时再开
  （`docs/ops/commands.md` §六设想的「打开同一个文件」互通）
