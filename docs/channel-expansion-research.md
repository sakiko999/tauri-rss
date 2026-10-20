# 频道扩展与分区二级化调研（2026-10-20）

> 状态：调研结论，未实现。所有端点均为 2026-10-20 匿名实测；数据会变，接入前应重跑探针。
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
| 现有分区订阅改二级操作 | ✅ 可做 | 缺的是「分类目录」；内容预览已经存在 |

一句话：**YouTube 的「分区」只是 Live 页的编辑栏目，B站没有可匿名读取的直播分区列表**。其余几类都能用现有
`previewChannel` + `Pageable` 模型接入，不需要新依赖，也不需要改播放解析。

---

## 1. YouTube 直播热门 / 分区

### 1.1 端点

匿名 `POST https://www.youtube.com/youtubei/v1/browse`：

```json
{ "browseId": "UC4R8DWoMoI7CAwX8_LjQHig" }
```

这是 YouTube 的 Live 页。响应不是平铺列表，而是若干 `richShelfRenderer`：

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

### 1.2 建议渠道

- `youtube:live-hot`：取 `Live Now` 栏，过滤 LIVE，按 watching 数降序。
- `youtube:live-category`：参数 `category=news|gaming|sports`，匹配 `Live Now - <name>`。
- 两者都输出 `kind:"live"`，可直接复用 `youtube:live-search` 的 `Live` 映射：
  `roomId=videoId`、`url=https://www.youtube.com/watch?v=<id>`、`platform:"youtube"`、`online=观看数`。

### 1.3 限制

- 没有 continuation：一页约 12 条，不能翻页。
- 栏目名随 `hl` / 地区变化；建议固定 `hl:"en"`，按 `Live Now - ` 后缀匹配，找不到时列出可用栏目报错。
- `Live Now` 的顺序不严格等于观众数，需要自己排序。
- 不是 Twitch 式完整分区树；只有 YouTube 当前提供的编辑栏目。
- 若以后要做「游戏级分区」，`/gaming` 页的 `Top live games` 可拿到 12 个游戏频道，每个频道 live tab
  实测约 51 条；这属于二期增强，不必和栏目级分区一起做。

---

## 2. YouTube 视频合集 / 播放列表

### 2.1 方案 A：官方 RSS（建议先做）

```text
https://www.youtube.com/feeds/videos.xml?playlist_id=<playlistId>
```

- 匿名 200，无需 API key。
- 实测两个公开播放列表分别返回 12 / 15 条。
- 最多 15 条，无翻页；按播放列表顺序返回，不保证是「最新」。
- 可直接复用 `packages/crawler/src/channels/youtube/channel.ts` 的 `entryToVideo()`。
- 适合「订阅一个播放列表，接收最近更新」；不适合需要完整列表的场景。

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

## 3. B站视频合集 / 视频列表 / 收藏夹

B站没有统一的「播放列表」概念，需要区分：

| 用户说法 | B站功能 | 建议渠道 |
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

### 3.2 视频列表 / 系列（series）

```text
GET https://api.bilibili.com/x/series/archives
  ?mid=<mid>&series_id=<seriesId>&page_num=1&page_size=20
```

- 匿名 200；实测 total 54，**固定 20 条/页**（传 50 也只给 20）。
- 需要 `mid`，而且必须是正确的作者 mid。`mid=1` 可能 code 0 但拿不到 archives。
- 元信息走 `x/series/series?mid=&series_id=`。
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

---

## 4. 分区订阅改造成「苹果播客式」二级操作

### 4.1 现状

发现页已经具备**第二层**：

- `PlatformBrowser` 调 `dl.previewChannel(categoryChannel, info)` 取一次性房间数据（不建订阅）。
- 结果用 `CandidateList` 展示，可选中房间直接订阅。
- 「订阅该分区」打开 `AddSubscriptionDialog`，用 `presetInfo` 预填参数。

缺的是**第一层分类目录**：用户必须先手输 `gameId` / `areaId` / `partition` / `category`，
而不是从可见的分类列表点进去。

Apple 播客的模型是：

```text
榜单（节目 feed）
  → 点节目 → FeedPreviewModal（临时单集列表）
  → 选单集播放 / 订阅该节目
```

但**分类不是 feed**：它没有自己的 RSS，也不应进入订阅内容。因此不建议造「分类目录渠道」
（会需要新的 item kind，污染 XML/store）；应在 core/channel 增加分类目录能力。

### 4.2 可行性矩阵

| 平台 | 现有分区渠道 | 分类目录数据 | 结论 |
| --- | --- | --- | --- |
| 虎牙 | `live:huya:category` | 4 个顶层固定枚举 + `fetchHuyaSubCategories` 二级接口 | ✅ |
| 斗鱼 | `live:douyu:category` | `fetchDouyuCategories` 一次返回一二级 | ✅ |
| 抖音 | `live:douyin:category` | `fetchDouyinCategories` 首页 SSR 的 `categoryData` | ✅（必须同时带 `partitionType`） |
| Twitch | `twitch:category` | `games(first: 30)` 匿名返回 slug/displayName/viewersCount/boxArt | ✅ |
| YouTube | 尚未建分区渠道 | Live 页的 `Live Now - <栏目>` | ✅（栏目级；随 `youtube:live-category` 一起做） |
| B站直播 | 无分区订阅渠道 | `Area/getList` 只有分区树；`second/getList` 需登录且匿名 `-352` | ❌ 不做 |

**结论：除 B站直播分区外，现有/计划中的分区渠道都能改成二级操作。**

### 4.3 推荐架构：`listCategories` 能力

在 crawler 增加一个可选的 channel 级能力，而不是新渠道：

```ts
export interface ChannelCategory {
  id: string
  name: string
  parentId?: string
  parentName?: string
  /** 直接传给 getSource(info) 的完整参数（如抖音需同时带 partition + partitionType）。 */
  info: Record<string, string>
  thumb?: string
  viewers?: number
  meta?: string[]
}

export interface CategorizedChannel {
  listCategories(): Promise<ChannelCategory[]>
}

export function isCategorized(c: RssChannel): c is RssChannel & CategorizedChannel {
  return "listCategories" in c
}
```

core 投影：

- `ChannelInfo.categories: boolean`（UI 据此决定是否显示分类目录）
- `DataLayer.listCategories(channelKey): Promise<ChannelCategory[]>`
- 分类目录按 channelKey 做**内存 TTL 缓存**（建议 10 分钟）；不落库、不写内容缓存。
- `previewChannel` 保持「不读不写缓存」的语义不变。

UI：

```text
分区视图
  → dl.listCategories(ch.key)
  → 分类列表（按 parentName 分组 / 带封面/观看数）
  → 点击分类
      → dl.previewChannel(ch.key, category.info)
      → 房间列表（现有 CandidateList）
      → 订阅这个房间（现有逻辑）
      → 订阅该分区（presetKey=ch.key, presetInfo=category.info）
```

保留「手动输入 ID」作为折叠兜底：分类目录请求失败、分类树变化、或用户知道特殊 ID 时仍可用。
分类选择要用 `useLatestOnly` 作废在途请求，避免先点 A 再点 B 时 A 的结果覆盖 B。

### 4.4 各平台目录实现要点

- **虎牙**：`HUYA_TOP_CATEGORIES` 4 个顶层固定；二级走 `fetchHuyaSubCategories(parentId)`。
  一次 `listCategories` 可能发 4 个请求（4 个顶层），可用 `Promise.all`，再按父级分组；结果缓存更重要。
- **斗鱼**：`fetchDouyuCategories` 一次请求返回全树，直接 flatten 成带 `parentName` 的列表。
- **抖音**：`fetchDouyinCategories` 返回顶层 + 子分区；每一项必须带
  `{ partition: id, partitionType: String(type) }`。⚠️ **当前 `PlatformBrowser` 只填
  `sourceInfoTpl[0]`，顶层分区会漏 `partitionType` 并默认成 `1`（顶层应为 `4`）——这是当前
  手输流程的真实错值，目录化时一并修掉。**
- **Twitch**：`games(first: 30)` 返回 `slug` / `displayName` / `viewersCount` / `boxArtURL`；
  `info = { category: slug }`（`normalizeTwitchCategory` 也会接受目录链接）。
- **YouTube**：`youtube:live-category` 的 `listCategories` 直接从 Live 页解析
  `Live Now - News/Gaming/Sports`；`info = { category: "news" }`。`Live Now` 本身不是分区，
  归 `youtube:live-hot`。
- **B站直播**：不实现；不要用 `Area/getList` 造一个只有名字、没有房间的假目录。

### 4.5 为什么不做「分类目录渠道」

- 分类不是可播放/可阅读内容；如果做成 `kind:"article"` 或 `social`，会进入订阅内容、未读、
  排序、缓存和 XML 序列化，语义全错。
- 目录项没有 `publishedAt`、`roomId`、`stream`，会污染 `MediaItem` 的契约。
- 分类目录是一次性 UI 数据，退出发现页即可丢弃；用 `listCategories` 最贴合。

### 4.6 建议落地顺序

1. **core + 类型 + 一个最小平台**（建议 Twitch）：验证 `listCategories` / UI 二级流程。
2. **抖音**：同时修 `partitionType` 两参问题（收益最大）。
3. **斗鱼**：一次请求，接上即可。
4. **虎牙**：4 个顶层请求 + 分组展示。
5. **YouTube**：随 `youtube:live-hot` / `youtube:live-category` 一起做。
6. **B站直播分区**：不做，除非登录态方案另行立项。

---

## 5. 频道扩展建议优先级

1. `youtube:live-hot` + `youtube:live-category`（Live 页栏目解析，一次请求）
2. `youtube:playlist`（先 RSS 15 条；需要完整列表再接 `VL` + continuation）
3. `bili:season`（合集；匿名 + 分页 + 现有 `ugc()`）
4. `bili:series`（视频列表；URL 解析 mid + seriesId）
5. `bili:favlist`（公开收藏夹；私有夹需登录）
6. 分区订阅二级化（`listCategories`；与 1、Twitch、抖音等一起做）

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
