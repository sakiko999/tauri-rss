# 频道扩展与分区二级化调研（2026-10-20）

> 状态：**§1~§4 已实现**（`youtube:live-hot` / `youtube:live-category` / `youtube:playlist` /
> `bili:season` / `bili:series` / `bili:favlist` + 分区目录订阅 `kind:"category"`）。
> 所有端点均为 2026-10-20 匿名实测；数据会变，接入前应重跑探针。
> 相关：`docs/capability-gaps.md`、`docs/twitch-channel.md`、`docs/youtube-stream-extraction.md`。

## 0. 结论摘要

| 目标 | 结论 | 形态 |
| --- | --- | --- |
| YouTube 直播热门 | ✅ 可接 | Live 页 `Live Now` 栏，约 12 条，无翻页 |
| YouTube 直播分区 | ✅ 可接，但只有栏目级 | `Live Now - News/Gaming/Sports`，不是 Twitch 式完整分区树 |
| YouTube 视频播放列表 | ✅ 可接 | 官方 RSS（≤15 条）或 InnerTube `VL`（100/页 + continuation） |
| B站视频合集 | ✅ 可接 | `seasons_archives_list`，匿名 + 分页；需 Referer |
| B站视频列表 / 系列 | ✅ 可接 | `x/series/archives`，匿名；固定 20/页；需要正确 mid |
| B站收藏夹 | ✅ 公开夹可接 | `x/v3/fav/resource/list`，匿名；私有夹需登录 |
| 现有分区订阅改二级操作 | ✅ 已实现 | 目录渠道（`*:categories`）+ `kind:"category"`；虎牙/斗鱼/抖音/Twitch/YouTube |

一句话：**YouTube 的「分区」只是 Live 页的编辑栏目，B站没有可匿名读取的直播分区列表**。其余几类都能用现有
`previewChannel` + `Pageable` 模型接入，不需要新依赖，也不需要改播放解析。

---

## 1. YouTube 直播热门 / 分区（✅ 已实现）

### 1.1 端点

匿名 `POST https://www.youtube.com/youtubei/v1/browse`：

```json
{ "browseId": "UC4R8DWoMoI7CAwX8_LjQHig" }
```

这是 YouTube 的 Live 页。响应不是平铺列表，实际路径（2026-10-20 复核）是：

```text
contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
  .richGridRenderer.contents[]
    .richSectionRenderer.content.richShelfRenderer
```

每个 shelf 是一个栏目（`richShelfRenderer` 也可能直接挂在 section 上，解析器两种都兼容）：

| 栏目 | 实测条数 | 说明 |
| --- | --- | --- |
| `Live Now` | 12 | 全部在播，可作「直播热门」 |
| `Recent Live Streams` | 12 | 已结束，不能当直播 |
| `Upcoming Live Streams` | 11 | 预告，不能当直播 |
| `Live Now - News` | 12 | 新闻分区 |
| `Live Now - Gaming` | 12 | 游戏分区 |
| `Live Now - Sports` | 12 | 体育分区 |

每条的 `videoRenderer` 带：

- `videoId`（订阅/播放的 ID）
- `title` / `ownerText` / `viewCountText`（如 `3,748 watching`）
- `thumbnailOverlays[].thumbnailOverlayTimeStatusRenderer.text === "LIVE"`（在播判据）

### 1.2 已实现渠道

- `youtube:live-hot`：取 `Live Now` 栏（slug `hot`），过滤 LIVE，按 watching 数降序。
- `youtube:live-category`：参数 `category=news|gaming|sports`（也接受 `Live Now - Gaming`
  这类完整栏目名），匹配 `Live Now - <name>`。
- 两者都输出 `kind:"live"`，复用 `live-shelf.ts` 的 `youtubeLiveHitToLive`
  （`youtube:live-search` 也走它）：
  `roomId=videoId`、`url=https://www.youtube.com/watch?v=<id>`、`platform:"youtube"`、`online=观看数`。
- 直播页解析在 `resolve/platform/youtube/discover.ts`；整页约 800KB，结果做 **5 分钟内存
  缓存（缓存 Promise，并发去重）**，热门 + 栏目两个订阅同一轮刷新只发一次请求。
- 只看 `thumbnailOverlays[].thumbnailOverlayTimeStatusRenderer.text === "LIVE"`，
  所以同页的 `Recent Live Streams` / `Upcoming Live Streams` 会解析成空数组。
- `watching` 才计入观看数；`views`（回放）与 `waiting`（预告）不取数字。

### 1.3 限制

- 没有 continuation：一页约 12 条，不能翻页。
- 栏目名随 `hl` / 地区变化；建议固定 `hl:"en"`，按 `Live Now - ` 后缀匹配，找不到时列出可用栏目报错。
- `Live Now` 的顺序不严格等于观众数，需要自己排序。
- 不是 Twitch 式完整分区树；只有 YouTube 当前提供的编辑栏目。
- 若以后要做「游戏级分区」，`/gaming` 页的 `Top live games` 可拿到 12 个游戏频道，每个频道 live tab
  实测约 51 条；这属于二期增强，不必和栏目级分区一起做。

---

## 2. YouTube 视频合集 / 播放列表（✅ 已实现方案 A）

### 2.1 方案 A：官方 RSS（已接入 `youtube:playlist`）

```text
https://www.youtube.com/feeds/videos.xml?playlist_id=<playlistId>
```

- 匿名 200，无需 API key。
- 实测两个公开播放列表分别返回 12 / 15 条。
- 最多 15 条，无翻页；按播放列表顺序返回，不保证是「最新」。
- 可直接复用 `packages/crawler/src/channels/youtube/channel.ts` 的 `entryToVideo()`。
- 适合「订阅一个播放列表，接收最近更新」；不适合需要完整列表的场景。
- 输入归一化在 `channels/youtube/refs.ts`：裸 ID / `playlist?list=` / `watch?v=&list=` /
  `youtu.be?list=`；`RD`（Mix）/ `WL`（稍后再看）/ `LL`（点赞）/ `LM` 前缀直接拒收。

### 2.2 方案 B：InnerTube 完整播放列表

```json
{ "browseId": "VL<playlistId>" }
```

- 匿名 200。
- 实测单页 100 条；`continuationItemViewModel` 里有下一页 token，第二页再 100 条。
- 条目是 `lockupViewModel`，可解 `contentId`、标题、缩略图、时长、作者。
- 没有 `publishedAt`；按播放列表顺序展示即可（core 的稳定排序可用）。
- 解析器绑定 `lockupViewModel`，比 RSS 脆弱；建议作为「需要超过 15 条」时的升级路径。

### 2.3 输入归一化

`youtube:playlist` 建议接受：

- 裸 `playlistId`
- `youtube.com/playlist?list=...`
- `watch?v=...&list=...`
- `youtu.be/...?list=...`

⚠️ 不要接 `RD`（Mix）、`WL`（稍后再看）、`LL`（点赞列表）：前两个是动态/私有，后者需登录。

---

## 3. B站视频合集 / 视频列表 / 收藏夹（✅ 已实现）

B站没有统一的「播放列表」概念，需要区分：

| 用户说法 | B站功能 | 渠道（已实现） |
| --- | --- | --- |
| 合集 | `ugc_season` | `bili:season` |
| 视频列表 / 系列 | `series` | `bili:series` |
| 收藏夹 | `favlist` | `bili:favlist` |
| 稍后再看 | 私有 | 不接 |

### 3.1 视频合集（season）

```text
GET https://api.bilibili.com/x/polymer/web-space/seasons_archives_list
  ?mid=0&season_id=<seasonId>&page_num=1&page_size=30
```

- **必须带 Referer**（`https://www.bilibili.com/`）；不带时返回 `-352`。
- `mid` 可以是 `0`，服务端会返回真实 `meta.mid`。
- 实测 season `2974525`：61 条，30 条/页；`page_size=100` 也接受。
- 返回 `meta.title/name/description/total`、`archives[]`、`page.total`。
- `archives[]` 字段：`bvid` / `aid` / `title` / `pic` / `pubdate` / `duration` / `stat`；没有作者名。
- 输入可以是 `seasonId`，也可以是视频 URL：先走 `x/web-interface/view?bvid=` 读 `data.ugc_season.id`。
- 可直接复用 `packages/crawler/src/channels/bili/video-common.ts` 的 `ugc()`。
- ✅ `bili:season` 已实现：`page_num` 递增翻页（`Pageable`），`seasonId` 按 source 实例
  memo（视频链接只换一次）；输入归一化在 `channels/bili/refs.ts`。

### 3.2 视频列表 / 系列（series）

```text
GET https://api.bilibili.com/x/series/archives
  ?mid=<mid>&series_id=<seriesId>&pn=1&ps=20
```

- 匿名 200；实测 total 54，**固定 20 条/页**（传 50 也只给 20）。
- ⚠️ **分页参数是 `pn`/`ps`**，不是 season 那套 `page_num`/`page_size`。实测传
  `page_num=2` 会静默返回第 1 页（`page.num` 仍是 1），表现为翻页永远重复首页。
- 需要 `mid`，而且必须是正确的作者 mid。`mid=1` 可能 code 0 但拿不到 archives。
- 元信息走 `x/series/series?series_id=`（**只传 series_id 即可**，返回 `meta.mid`，
  所以渠道不要求用户手填 mid）。
- 输入建议只接受 URL：
  - `space.bilibili.com/<mid>/lists/<sid>?type=series`
  - `space.bilibili.com/<mid>/channel/seriesdetail?sid=<sid>`
  - `www.bilibili.com/list/<mid>?sid=<sid>`

### 3.3 收藏夹（favlist）

```text
GET https://api.bilibili.com/x/v3/fav/resource/list
  ?media_id=<id>&platform=web&pn=1&ps=20
```

- **公开收藏夹匿名可读**；实测 `media_id=1052622027` 返回 28 条，20 条/页，`has_more` 正常。
- 私有收藏夹需要登录；「稍后再看」是私有数据，不建议接。
- 输入 URL：`space.bilibili.com/<mid>/favlist?fid=<media_id>`，从 `fid` 取 `media_id`。
- `medias[].attr != 0` 表示失效视频，建议跳过。
- 官方文档 `ps` 上限 20；实测 40 也返回过，但不要依赖，按 20 分页。
- 返回 `info.title`、`medias[].bvid/title/cover/intro/upper.name/pubtime/duration`。
- ✅ `bili:favlist` 已实现：`pn` 递增翻页，`attr != 0` 跳过；`fid` 与 `media_id` 同值。

---

## 4. 分区订阅改造成「苹果播客式」二级操作（✅ 已实现）

### 4.1 改造前现状

发现页已经具备**第二层**：

- `PlatformBrowser` 调 `dl.previewChannel(categoryChannel, info)` 取一次性房间数据（不建订阅）。
- 结果用 `CandidateList` 展示，可选中房间直接订阅。
- 「订阅该分区」打开 `AddSubscriptionDialog`，用 `presetInfo` 预填参数。

缺的是**第一层分类目录**：用户必须先手输 `gameId` / `areaId` / `partition` / `category`，
而不是从可见的分类列表点进去。

Apple 播客的模型是：

```text
榜单（节目 feed）
  → 点节目 → 右侧列表（?open=，临时单集列表，复用正常网格）
  → 选单集播放 / 订阅该节目
```

分类不是 feed：它没有自己的 RSS。设计上曾考虑 channel 级 `listCategories` 能力（目录只在
发现页临时用），但最终采用**目录渠道**模型 —— 用户明确要求「和播客热门榜一样作为一个订阅，
订阅的内容就是分区列表，点进去看对应分区的内容」。因此新增 `kind:"category"` 条目：
目录本身就是订阅内容，点击条目用自带的 `categoryChannel` + `categoryInfo` 预览目标分区。

### 4.2 可行性矩阵

| 平台 | 现有分区渠道 | 分类目录数据 | 结论 |
| --- | --- | --- | --- |
| 虎牙 | `live:huya:category` | 4 个顶层固定枚举 + `fetchHuyaSubCategories` 二级接口 | ✅ |
| 斗鱼 | `live:douyu:category` | `fetchDouyuCategories` 一次返回一二级 | ✅ |
| 抖音 | `live:douyin:category` | `fetchDouyinCategories` 首页 SSR 的 `categoryData` | ✅（必须同时带 `partitionType`） |
| Twitch | `twitch:category` | `games(first: 30)` 匿名返回 slug/displayName/viewersCount/boxArt | ✅ |
| YouTube | `youtube:live-category` | Live 页的 `Live Now - <栏目>` | ✅（栏目级） |
| B站直播 | 无分区订阅渠道 | `Area/getList` 只有分区树；`second/getList` 需登录且匿名 `-352` | ❌ 不做 |

**结论：除 B站直播分区外，现有/计划中的分区渠道都能改成二级操作。**

### 4.3 已落地架构：目录渠道 + `kind:"category"`

目录本身是一个**无参渠道**（与 `apple:podcast-chart` 同构）：

| 目录渠道 | 内容 | 目标订阅渠道 |
| --- | --- | --- |
| `twitch:categories` | Twitch 分类（30 条） | `twitch:category` |
| `youtube:live-categories` | 直播栏目（News/Gaming/Sports） | `youtube:live-category` |
| `live:douyin:categories` | 抖音顶层 + 子分区（16 条） | `live:douyin:category` |
| `live:douyu:categories` | 斗鱼二级分区（530 条） | `live:douyu:category` |
| `live:huya:categories` | 虎牙二级分区（389 条） | `live:huya:category` |

条目契约（xml `Category` / core `CategoryItem`）：

```ts
interface CategoryItem {
  kind: "category"
  title: string
  /** 点进去预览/订阅的目标渠道（如 twitch:category）。 */
  categoryChannel: string
  /** 直接传给 previewChannel / addSubscription 的完整参数。 */
  categoryInfo: Record<string, string>
}
```

XML 边界：`tpl:categoryChannel` + `tpl:categoryInfo`（JSON 字符串），serialize 写、
deserialize 读，`serialize-roundtrip.check.ts` 有专项用例。`serialize-contract.check.ts`
也会盯着两侧字段不齐。

UI 流程（与播客榜单完全同构）：

```text
发现页「可订阅榜单」→ 一键订阅 twitch:categories
  → 订阅内容 = 分类卡片（kind:"category"，不摆播放按钮）
  → 点卡片 → 右侧列表（URL `?open=<itemId>`，MediaMain 复用正常网格）
      → dl.previewChannel(item.categoryChannel, item.categoryInfo)
      → 房间列表（临时预览，不落库/不建订阅）
      → 表头「订阅该分区」→ dl.addSubscription(item.categoryChannel, 标题, item.categoryInfo)
```

- `Kind` 增加 `category`，但**不加入 `KIND_ORDER`**：不生成新的内容 tab；目录条目出现在
  「全部」和目录订阅节点里。
- `MediaCard`/`CardMini` 按 `isCategoryItem` 走「预览」主操作；不发播放/加队列按钮。
- 卡片副行展示 `summary`（「N 人在看」「M 个子分区」「父级分区名」）。
- 预览弹窗里**不挂播放**：预览条目的 `subscriptionId` 是 `preview:<channel>`，
  没有真实订阅，core 的 `resolveLivePlay` 取不到 info。要看内容/持续收更新请订阅分区。
- 发现页的「浏览分区」仍保留手输参数入口（已知分区 ID 时最快）；参数按
  `sourceInfoTpl` **逐字段渲染**（抖音 `partition + partitionType` 双参不漏）。

### 4.4 各平台目录实现要点

- **虎牙** ✅：`HUYA_TOP_CATEGORIES` 4 个顶层固定，各发一次
  `fetchHuyaSubCategories(parentId)`（`Promise.all`），实测 **389** 个二级分区；
  单个顶层失败不影响其余，全空才抛错。
- **斗鱼** ✅：`fetchDouyuCategories` 一次请求返回全树，flatten 成二级条目，实测
  **530** 条（一级分区没有直接列房接口，不列入）；`summary` 用父级名。
- **抖音** ✅：`fetchDouyinCategories` 返回顶层 + 子分区，实测 **16** 条；每条
  `categoryInfo` **同时带** `{ partition, partitionType }`（顶层 `4` / 子 `1`）。
  手输流程也已改为逐字段渲染 `sourceInfoTpl`，不再只填第一个参数。
- **Twitch** ✅：`games(first: 30)` 返回 `slug` / `name` / `viewersCount` / `boxArtURL`，
  实测 **30** 个分类；`categoryInfo = { category: slug }`。
- **YouTube** ✅：复用 Live 页解析，实测 `News` / `Gaming` / `Sports` 3 个栏目；
  `categoryInfo = { category: slug }`。`Live Now` 本身不是分区，归 `youtube:live-hot`。
- **B站直播**：不实现；不要用 `Area/getList` 造一个只有名字、没有房间的假目录。

### 4.5 为什么新增 `kind:"category"` 而不是伪装成文章/音频

- 分类不是可播放/可阅读内容；伪装成 `article`/`social` 会进入阅读、未读、正文抓取等
  语义，点击会落到空文章视图。
- 伪装成 `audio`（播客榜单那种「无流 feed item」）会被 `isFeedItem` 当成播客，
  点开去拉 RSS feed，同样错。
- 独立的 `category` kind 让点击分流、卡片文案、无播放按钮都由 type 决定；XML 只多两个
  `tpl:` 字段，契约清晰。
- 目录条目没有 `publishedAt`，排序靠 `fetchedAt` 兜底；同一轮抓取时间一致，稳定排序
  保持上游顺序（Twitch 按观看数、抖音/斗鱼/虎牙按分区树顺序）。
- **不做** UI 侧 `listCategories` 能力：目录是订阅内容，走正常的存储/刷新/列表链路，
  刷新间隔、分组、退订都与其它订阅一致，不需要单独的缓存层。

### 4.6 落地顺序（已完成）

1. ✅ `kind:"category"` + XML 契约 + 目录渠道 + 卡片点击分流。
2. ✅ 右侧内容视图（`?open=`，复用正常网格）+ 「订阅该分区」（完整参数）。
3. ✅ 抖音 `partitionType` 两参问题（目录与手输都带完整参数）。
4. ✅ 五个平台目录渠道（Twitch / YouTube / 抖音 / 斗鱼 / 虎牙）。
5. ⬜ **B站直播分区**：不做，除非登录态方案另行立项。

---

## 5. 频道扩展建议优先级

1. ✅ `youtube:live-hot` + `youtube:live-category`（Live 页栏目解析，一次请求）
2. ✅ `youtube:playlist`（先 RSS 15 条；需要完整列表再接 `VL` + continuation）
3. ✅ `bili:season`（合集；匿名 + 分页 + 现有 `ugc()`）
4. ✅ `bili:series`（视频列表；URL 解析 mid + seriesId）
5. ✅ `bili:favlist`（公开收藏夹；私有夹需登录）
6. ✅ 分区订阅二级化：目录渠道（`*:categories`）+ `kind:"category"` +
   右侧内容视图（与 1、Twitch、抖音等一起做）

实测补充（2026-10-20，接入后复核）：

| 渠道 | 实测 |
| --- | --- |
| `youtube:live-hot` | 10 条（Live Now，按 watching 降序），864ms |
| `youtube:live-category` | `gaming` 12 条，1.19s |
| `youtube:playlist` | 15 条，178ms |
| `bili:season` | 30 条/页；第二页新增 30，cursor 前进 |
| `bili:series` | 20 条/页；第二页新增 20（修 `pn`/`ps` 前为 0） |
| `bili:favlist` | 20 条/页；第二页 8 条（总数 28） |

现有播放链路无需改：YouTube 条目落 `watch?v=`，B站条目落 `bilibili.com/video/<bvid>`，
`resolve` 已覆盖。

---

## 6. 实测记录（2026-10-20，匿名）

| 探针 | 结果 |
| --- | --- |
| YouTube Live 页 `browseId=UC4R8DWoMoI7CAwX8_LjQHig` | 200；`Live Now` 12、News/Gaming/Sports 各 12；无 continuation |
| YouTube `VL<playlistId>` | 200；100 条 + continuation；第二页 100 条 |
| YouTube playlist RSS | 200；12 / 15 条；无翻页 |
| B站 `seasons_archives_list`（season 2974525） | 带 Referer 200/code 0；61 条、30/页；不带 Referer `-352` |
| B站 `x/series/archives`（series 358495） | 200/code 0；54 条、20/页；mid 必须匹配 |
| B站公开收藏夹 `media_id=1052622027` | 200/code 0；28 条、20/页；匿名可读 |
| Twitch `games(first: 10)` | 200；slug/displayName/viewersCount/boxArt 全出 |
| 目录渠道（接入后复核） | `twitch:categories` 30 / `youtube:live-categories` 3 / `live:douyin:categories` 16 / `live:douyu:categories` 530 / `live:huya:categories` 389 |
| 目录条目 XML 往返 | `kind/categoryChannel/categoryInfo` 全保住；抖音 `partition=101` + `partitionType=4` |
| 抖音顶层分区列房 | `partition=101&partitionType=4` 出 15 条（修复前默认 type=1 取不到） |
| desktop 二级流程 | 一键订阅 `twitch:categories` → 点 Just Chatting → 弹窗 30 个房间 →「订阅该分区」；抖音目录点「聊天」→ 15 个房间 → 订阅成功 |
