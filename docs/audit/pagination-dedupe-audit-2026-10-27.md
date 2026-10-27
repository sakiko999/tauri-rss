# 渠道翻页 / 去重全量审计（2026-10-27）

> 方法：8 个域并行读**全部 55 个渠道** + core 侧翻页/去重语义（data-layer / media-store /
> deserialize / factory），共 65 个 agent（8 扫描 + 57 条逐条反驳验证）、1472 次工具调用。
> 验证 agent 默认怀疑，多数条目附带**真机接口实测**（分页参数、条数、页间重叠）。
> 本文是审计快照；按 §D 排期修复，修一条勾一条。

## 为什么查这个

v0.7.5 前后修了两件事：`bili:user_video` 写死 `pn=1`（7 个订阅 6 个卡在 30 条）、
`store.replace` 不去重（xhs 生产库 61 条 / 60 唯一，UI 报重复 React key）。这两个都是
「渠道 → core」契约的个例，于是对全渠道做一次同型排查。

## 结论速览

| 类别 | 数量 | 含义 |
| --- | --- | --- |
| 行动项（验证为真） | 19 | §A 拿不全 11 · §B 去重/正确性 8 |
| 合理取舍（不要修） | 26 | §C |

与已修工作的关系：`5340265`（replace 去重 + user_video 分页）已把 UI 重复与 B站投稿
截断兜住；本文修正其中一处**根因归因**（见 B-1）。

---

## A. 拿不全（缺分页 / 被截断）

### A1. `bili:dynamic` — offset 翻页缺失【高】
`dynamic.ts:131` 请求不带 `offset`；`data.has_more` / `data.offset` 完全未使用
（文件头注释自己写了「实测 12 条，has_more + offset 翻页」）。无 `fetchMore` →
`canLoadMore` 恒 false，且 refresh 走 `store.replace` 整批替换 → 订阅**永远只有最新 ~12 条动态**。
- 上游：`feed/space?host_mid=&offset=` → `items[] + has_more(bool) + offset(string)`（RSSHub 同端点在传 offset）。
- 修法：类实现补 `fetchMore(offset)`（数值 `apiFetchMore` 不适用，`Number(cursor)` 会吃掉 offset 字符串）；
  首翻无 cursor 时先拉一次 `offset=''` 拿下一页 token（`weibo/user.ts:69-74` 模式）；
  本页过滤空但 `has_more=true` 必须回传 `hasMore: true`。
- ⚠️ 该端点要登录 cookie + dm_\* 指纹；CLI 匿名探针实测 412（bili 全平台进 15 分钟冷却），改造时连风控一起验。

### A2. YouTube 频道视频 — continuation 被丢弃【高】
`youtube/channel.ts:68` 只调 `fetchYoutubeChannelVideos(channelId)`，`:69` 只消费 `page.videos`，
**解析出来的 `page.continuation` 无人使用**；`:47-51` 只返回 `{ fetch }`。频道订阅永远只能看到
最新 ~30 条（RSS 回退路径更只有 15 条）。与 bili:user_video 同型，且是主力平台。
- 能力已齐全：resolve 侧 `fetchYoutubeChannelVideos(channelId, { continuation })` 支持续页，
  `youtube-channel.check.ts:65-92` 有断言。
- 修法：getSource 补 `fetchMore`（类实现）；cursor 直接复用 InnerTube token；首翻先取首页拿 token
  （不能闭包缓存，refresh 会换掉首页）；RSS 回退分支无 token → 返回空页不带 cursor；
  续页失败要 throw，不能返回空页（core 会判到底）。

### A3. `bili:popular` — pn/ps + no_more 未接【中】
`popular.ts:68` 请求不带 pn/ps（默认 20 条），spec 无 pageable。验证 agent 真机实测：
`pn=2` 返回 20 条与首页**零重叠**，深度约 1000 条（pn=50 → 空列表 + `no_more=true`）。
- 修法：`pageable: { first: 2, step: 1 }`，`?pn=${page}&ps=20`，返回 `{ items, hasMore: !data.no_more }`
  （PopularPayload 补 `no_more` 字段）。热门榜跨快照翻页必有重叠，靠 store 去重兜，别据新增 0 判到底。

### A4. `live:douyin:search` — offset 硬编码 0【中】
`search.ts:40` 每个命中分区 offset 写死 0，永久封顶 20 条；底层列房接口本身支持 offset 游标。
「上游不可分页」的注释只对「关键词→分区」这步成立。
- 修法（最小）：`pageable` + `searchDouyinRooms` 内用 `_page` 算 offset（只翻第一个分区，与现状单调一致）；
  或把 cursor 升级成「每分区 offset 组」兑现 3 分区合并的设计意图。

### A5. `live:huya:search` — rows=20 截断【中，类别实为 page-size-too-small】
真缺口不是分页：v=4 桶 `start` 实测**无效**（服务端只回显），`rows` 才是杠杆——
rows=100 → 97 条（≈ numFound），rows=200 仍 97（服务端 ~100 封顶）。现在只拿 20/97。
- 修法：`huya/search.ts` PAGE 20→100 + `huya/discover.ts:63` 夹取上限 50→100（**别动** :110 的 v=1 夹取）；
  同步修 channels.md 与 doc-backlog 里的「只取首页 20 条」表述。

### A6. RSS 直链无上限【中，资源悬崖而非正确性】
`raw.ts:55` 原样透传，无条数/体积上限：内置 `rss:changelog` 实测单次 **20.5MB / 3019 条**全量进
store + content KV 缓存（huberman 4.5MB/453、arxiv 803KB/374）。单订阅即可把服务快照体积翻倍。
RSS 是单文档，上游无分页可接——要做的是**入站上限**。
- 修法：保留最新 N 条（如 200）再序列化；或 >5MB 跳过 content KV 缓存 + 超限日志。

### A7. `apple:podcast-chart` — limit 硬截 100【低，注释失实】
`chart.ts:40` clamp 100，注释称「再大 Apple 会截断、URL 过长」；实测 limit=200 全量返回
（300 才 400），200 id 的 Lookup URL 仅 2239 字符。
- 修法：clamp 放宽到 200 + 文案改「最多 200」；`lookupApplePodcasts` 按批 ~100 id 分块
  （catalog.ts:106 注释本来就说「调用方分批」）。`apple:podcast-search` 的 100 不动（上游真实上限）。

### A8. `live:huya:anchor` — rows=20【低】
v=1 主播桶单次可给 50（rows=100 仍 50 封顶）；且验证 agent 实测 **v=1 的 `start` 有效**
（start=20/70 返回不相交窗口）——上游大概率支持真分页，但 start/rows 组合语义怪异（start>0 时
恒返 40 条），接 pageable 前需再实测。第一步最小修复：PAGE 20→50。
- ⚠️ search.ts:7-9 / discover.ts:107 的「start 无效」注释是把 v=4 结论错推到 v=1，一并修正。

### A9. 搜索候选翻页缺失（`bili:user` / 全部搜索渠道）【低，设计层】
`searchBiliUsers` 支持 page（实测 numResults=1000），但候选只经 core `previewChannel` 单次
`source.fetch()`，desktop 候选列表也没有「加载更多」——**bili:search / bili:anchor / youtube:user
同样只有首页候选**。单给某渠道加 pageable 无效，要做就做「候选列表翻页」这一层。

### A10. `youtube:playlist` — Atom 15 条 vs InnerTube 100/页【低，已登记 backlog】
注释明写的刻意取舍（「只适合订阅接收最近更新」），但静默截断无「还有更多」信号。
修法（backlog 已有）：InnerTube `browseId="VL<id>"` + `lockupViewModel` 解析接成 pageable。

### A11. factory `total` 不透传【低，契约缺口】
`apiFetchMore` 用裸 `serializeFeed`，`fetchPage` 返回类型无 `total` 字段 → makeApiChannel 渠道
（含刚修的 `bili:user_video`，读到了 `data.page.count` 却只能算 hasMore）无法把真实总数带到
desktop「已加载 N / 总数」。core 侧放大器：loadMore 在 total 缺失时删 `pageTotals` 旧值。
- 修法：fetchPage 联合返回加 `total?: number`，apiFetch/apiFetchMore 统一走 `serializeWithTotal`。

## B. 去重与正确性

### B1. `xhs:user` 置顶笔记重复 —— 修正 5340265 的根因归因【低（UI 已兜）】
**根因是 `user.notes` 为分组数组（置顶组 + 全部组），`flat()` 后置顶笔记一批出现两次**
（生产库：重复项在 idx 0 与 idx 52，两段 XML 逐字节相同；idx 0 pubDate 是 7 月旧笔记 =
置顶位，idx 52 是时间序原位。两天快照完全相同，非竞态）。缓存唯一写入点是 doRefresh，
而 `fetchXhsList` 用 `cdpNavigate(url, true)` **强制重载** → 重复来自新鲜 SSR 初始状态，
**不是** 5340265 提交信息里写的「滚动 state 重复追加」。
- 现状：replace 去重后 UI 已无重复；残留 = XML 缓存存 61/60 + append 同批缺口（见 B2）。
- 修法：`notesToItems` / `explore.toItems` 按外层 id 去重（保留首次）。

### B2. `store.append` 页内不去重【中，契约缺口】
append 只与 store 已有 id 比，同一批内部重复两条都会进（addedCount 也虚计）。
可达场景：store 较空时首次 fetchMore 的 30 条窗口同时含置顶副本与时间位副本。
- 修法：把 replace 的 seen 逻辑搬进 append（`seen` 初始化为 existingIds）；check 补页内重复断言。

### B3. `bili:season` 首页 = 最老视频【中，审计附带新发现，已亲测】
`seasons_archives_list` 默认 pubdate **升序**：实测 season 2974525 page1 首条 2024-05-11，
page2 末条 2024-08 —— 合集订阅第一屏是最老批次，最新视频在最后一页，与订阅语义相反。
- 修法：请求带 `sort_by=desc`（RSSHub 同款）并实测；翻页语义随之复核。

### B4. `live:douyin` / `live:douyin:user` 的 id 用一次性 `room_id`【低】
`live.ts:153` `id: douyin:${room.id_str}`，注释「唯一稳定」不成立（同文件 ：11/:147 自己写了
「roomId 一次性、需改用 webRid」）。每次重新开播换 id → 星标/已读/续播每场失效、旧条目以新未读重现。
- 修法：改 `douyin:${webRid}`（与 hot.ts:66 / discover.ts:125 对齐），id_str 仅在 reflow/danmaku 用。

### B5. deserialize 空 guid → `id=""`【低】
`deserialize.ts:140` `it.guid ?? it.link ?? hash-title`：无属性空 `<guid></guid>` 经 asString 得 ""
并压过 link；`asLink` 缺值返回 ""（永不为 undefined）→ 标题兜底是死代码。所有缺 guid/link 的条目
共享空 id → replace/append 去重后**整个 feed 只剩 1 条**（静默丢数据）。`rss/podcast.ts:51` 同款复制。
- 修法：`guid?.trim() || link?.trim() || 兜底`；兜底别用 hash-标题（不是 hash、标题一改就变），
  至少拼稳定摘要 + 页内序号，或空 id 跳过 + warn。

### B6. `live:douyu:hot` / `live:douyu:category` 过滤页不回 hasMore【低，潜伏】
pageable + 过滤（`type===1`）却返回裸数组，违反工厂契约（「过滤过条目的渠道必须给 hasMore」）。
实测 24 个多页分区 88 页未出现整页滤空（douyu 广告位 type=2 存在、area=1509 首页 19/20 是广告），
当前无可复现故障。hot 的 `pgcnt` 恒 0 不可用（只能按原始行满 40 推断）；category 的 `pgcnt`=总页数可精确判。
- 修法：两处 fetchPage 返回 `{ items, hasMore }`（用过滤前行数）；顺手统一 hot/category 的 type 过滤语义。

### B7. `xhs:explore` 增量切片的两条提前「到底」路径【低，未复现】
索引算术游标 + core `exhausted` 判据叠加：本轮增量整批是已返回 id 时（平台重复追加），
fresh 非空、游标推进、append 去重后 0 新增 → 判到底；另一条：`fresh.length===0 && !platformActive`
时返回无 cursor（= 到底），与同文件注释承诺的「返回空 + 原 cursor 重试」不一致。
- 修法：页面确实增长时显式 `hasMore: true`；`!platformActive` 分支带原 cursor；fresh 后按 id 自去重。

### B8. 实时榜页码翻页漂移（`bili:live:area` / `live:douyu:hot` / `live:douyu:category` / `live:douyu:search`）【低，固有限制】
排序键是实时人气，跨请求排名漂移 → 跨页重复/漏房间。重复被 store 去重兜住、漏项无法客户端消除
（上游无快照/游标接口），douyin 实测 offset 三页零重叠、bili/huya 实测页窗基本正确。
- 处置：不改代码，在渠道注释与平台备注标「已知上限」。

### B9. `bili:user_video` hasMore 用常量估算【低，可选加固】
`page * PAGE_SIZE < count` 用请求常量而非响应 `page.ps`；上游恒按 ps=30 返页时恒等，无可复现丢页。
留作防线：直接用 `data.page.count` 与本页实际条数判断。

## C. 合理取舍（验证确认，不要修）

- **固定榜单/目录，上游无分页**：`bili:ranking`（top100，pn 被忽略）、`bili:precious`（98 条静态）、
  `bili:square`（limit 50 封顶，>50 返 -400）、`bili:weekly`（单期 48 条，所有分页参数不生效）、
  `weibo:hot`（band_list ~52 条）、`douyin:trend`（word_list ~50 条）、
  `bili:live:areas` / `live:douyu:categories`（524 条全量）/ `live:huya:categories`（~390 条全量）、
  `twitch:categories`（games first 硬上限 30）、`youtube:live-*`（各栏目一页到底无 continuation）。
- **搜索候选单页够用**：`youtube:user` / `youtube:live-search`（选中后落到内容订阅）；
  `apple:podcast-search`（offset 被忽略、上游 ~99 条封顶，clamp 100 正好）。
- **显式列表无「更多」概念**：`bili:live` / `live:douyin` / `live:douyin:user`（roomIds）。
- **已有分页且验证正确**：`bili:anchor` / `bili:search` / `bili:season`（页码接续）/ `bili:favlist`
  （hasMore 透传）、`live:huya:hot` / `live:huya:category`（120/页，末页 47 条后空页）、
  `live:douyu:category`（同）、`weibo:user`（since_id 从尾部倒找真 mblog 的 mid，不漏条）、
  `twitch:hot/category`（首翻取首页只拿游标、条目整批丢弃，不重复）、`bili:live:hot`（页码 + 去重兜底）。
- **core `exhausted` 判据（游标前进 + 0 新增 = 到底）是防死循环设计契约**（xhs 整页重载案底），
  渠道要继续翻就走 `{ items, hasMore }` 语义 —— 不是缺陷。
- `xhs` note id 稳定（外层 id 与 feedKey 同优先级，无「翻页一套、产出一套」漂移）；
  retry cursor 原样回传不前进，core 只保留 hasMore 不判到底。
- `douyu`/`huya` 直播间 id（rid / profileRoom）稳定唯一。

## D. 排期建议（按收益/风险）

1. **A1 `bili:dynamic` offset 翻页** + **A2 YouTube channel continuation**：两个「高」，与
   user_video 同型，能力侧已就绪。
2. **B1 xhs notesToItems 去重**（一行根治缓存重复）+ **B3 season 排序反转**（一条参数）+
   **B2 append 页内去重**（契约对称）。
3. **A5 huya search rows=100** + **A8 anchor rows=50** + **A3 popular pageable** +
   **A4 douyin search offset**：全是小改动。
4. 小件：B4 douyin id→webRid、B5 空 guid 兜底、B6 douyu hasMore、A11 factory total、
   A7 apple clamp、B9 hasMore 加固。
5. 单独立项：A6 RSS 入站上限（涉及 core 缓存策略）、A9 搜索候选翻页（涉及 previewChannel/UI）、
   A10 youtube:playlist InnerTube 化。

> 修复时的回归：§各条目的实测口径已写明；渠道改动跑
> `bun run rss fetch <key>` + 对应 `.check.ts`，core 改动跑 `media-store.check.ts`。
> 分页渠道（A1/A2/A3/A4）验「第二页有新增」，参照 smoke-check「YouTube/B站合集」行的惯例。
