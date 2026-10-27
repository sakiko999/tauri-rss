# 平台渠道与能力总表

> 合并自 capability-gaps.md + channel-expansion-research.md（2026-10-21 整理）。记录「已实现的渠道扩展」与「未做的缺口 / 已证伪路线」。

> 背景：对照 `tmp/pure_live`（Flutter 直播聚合器，23 平台）逐平台比对。
> 第一节记录**已实现的渠道扩展**（2026-10-20 匿名实测）；其余各节只留**未做的缺口**与
> **实测证伪的结论**（防止后人重走已证明走不通的路）。
> 状态更新至 2026-10-22（B站直播分区目录落地）。

## 一、已实现的渠道扩展

> 状态：**§1~§4 已实现**（`youtube:live-hot` / `youtube:live-category` / `youtube:playlist` /
> `bili:season` / `bili:series` / `bili:favlist` + 分区目录订阅 `kind:"category"`）。
> 所有端点均为 2026-10-20 匿名实测；数据会变，接入前应重跑探针。
> 相关：`docs/platforms/twitch.md`、`docs/platforms/youtube.md`。

### 0. 结论摘要

| 目标 | 结论 | 形态 |
| --- | --- | --- |
| YouTube 直播热门 | ✅ 可接 | Live 页 `Live Now` 栏，约 12 条，无翻页 |
| YouTube 直播分区 | ✅ 可接，但只有栏目级 | `Live Now - News/Gaming/Sports`，不是 Twitch 式完整分区树 |
| YouTube 视频播放列表 | ✅ 可接 | 官方 RSS（≤15 条）或 InnerTube `VL`（100/页 + continuation） |
| B站视频合集 | ✅ 可接 | `seasons_archives_list`，匿名 + 分页；需 Referer |
| B站视频列表 / 系列 | ✅ 可接 | `x/series/archives`，匿名；固定 20/页；需要正确 mid |
| B站收藏夹 | ✅ 公开夹可接 | `x/v3/fav/resource/list`，匿名；私有夹需登录 |
| 现有分区订阅改二级操作 | ✅ 已实现 | 目录渠道（`*:categories`）+ `kind:"category"`；虎牙/斗鱼/抖音/Twitch/YouTube |

一句话：**YouTube 的「分区」只是 Live 页的编辑栏目；B站分区树（`Area/getList`）匿名可读，但列房需登录**。其余几类都能用现有
`previewChannel` + `Pageable` 模型接入，不需要新依赖，也不需要改播放解析。

---

### 1. YouTube 直播热门 / 分区（✅ 已实现）

#### 1.1 端点

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

#### 1.2 已实现渠道

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

#### 1.3 限制

- 没有 continuation：一页约 12 条，不能翻页。
- 栏目名随 `hl` / 地区变化；建议固定 `hl:"en"`，按 `Live Now - ` 后缀匹配，找不到时列出可用栏目报错。
- `Live Now` 的顺序不严格等于观众数，需要自己排序。
- 不是 Twitch 式完整分区树；只有 YouTube 当前提供的编辑栏目。
- 若以后要做「游戏级分区」，`/gaming` 页的 `Top live games` 可拿到 12 个游戏频道，每个频道 live tab
  实测约 51 条；这属于二期增强，不必和栏目级分区一起做。

---

### 2. YouTube 视频合集 / 播放列表（✅ 已实现方案 A）

#### 2.1 方案 A：官方 RSS（已接入 `youtube:playlist`）

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

#### 2.2 方案 B：InnerTube 完整播放列表

```json
{ "browseId": "VL<playlistId>" }
```

- 匿名 200。
- 实测单页 100 条；`continuationItemViewModel` 里有下一页 token，第二页再 100 条。
- 条目是 `lockupViewModel`，可解 `contentId`、标题、缩略图、时长、作者。
- 没有 `publishedAt`；按播放列表顺序展示即可（core 的稳定排序可用）。
- 解析器绑定 `lockupViewModel`，比 RSS 脆弱；建议作为「需要超过 15 条」时的升级路径。

#### 2.3 输入归一化

接受形式与拒收前缀见 §2.1（`channels/youtube/refs.ts`）。

⚠️ 不要接 `RD`（Mix）、`WL`（稍后再看）、`LL`（点赞列表）：前两个是动态/私有，后者需登录。

---

### 3. B站视频合集 / 视频列表 / 收藏夹（✅ 已实现）

B站没有统一的「播放列表」概念，需要区分：

| 用户说法 | B站功能 | 渠道（已实现） |
| --- | --- | --- |
| 合集 | `ugc_season` | `bili:season` |
| 视频列表 / 系列 | `series` | `bili:series` |
| 收藏夹 | `favlist` | `bili:favlist` |
| 稍后再看 | 私有 | 不接 |

#### 3.1 视频合集（season）

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
- ✅ `bili:season` 已实现：`page_num` 递增翻页（`Pageable`），`seasonId` 用**模块级**
  `seasonIdCache`（`season.ts:49`；core 每次 refresh/loadMore 都新建 source，实例级 memo
  跨不过一次调用），视频链接只换一次；输入归一化在 `channels/bili/refs.ts`。

#### 3.2 视频列表 / 系列（series）

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

#### 3.3 收藏夹（favlist）

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

### 4. 分区订阅改造成「苹果播客式」二级操作（✅ 已实现）

#### 4.1 设计动机

改造前用户只能手输 `gameId` / `areaId` / `partition`，缺「第一层分类目录」；最终采用目录渠道而非
channel 级 `listCategories`（理由见 §4.5）。

#### 4.2 可行性矩阵

| 平台 | 现有分区渠道 | 分类目录数据 | 结论 |
| --- | --- | --- | --- |
| 虎牙 | `live:huya:category` | 4 个顶层固定枚举 + `fetchHuyaSubCategories` 二级接口 | ✅ |
| 斗鱼 | `live:douyu:category` | `fetchDouyuCategories` 一次返回一二级 | ✅ |
| 抖音 | `live:douyin:category` | `fetchDouyinCategories` 首页 SSR 的 `categoryData` | ✅（必须同时带 `partitionType`） |
| Twitch | `twitch:category` | `games(first: 30)` 匿名返回 slug/displayName/viewersCount/boxArt | ✅ |
| YouTube | `youtube:live-category` | Live 页的 `Live Now - <栏目>` | ✅（栏目级） |
| B站直播 | `bili:live:area`（列房需登录） | `Area/getList` 匿名出全树；`second/getList` 登录态列房（匿名 `-352`） | ✅（2026-10-22 落地） |

**结论：全部分区渠道都能改成二级操作。**

#### 4.3 已落地架构：目录渠道 + `kind:"category"`

目录本身是一个**无参渠道**（与 `apple:podcast-chart` 同构）：

| 目录渠道 | 内容 | 目标订阅渠道 |
| --- | --- | --- |
| `twitch:categories` | Twitch 分类（30 条） | `twitch:category` |
| `youtube:live-categories` | 直播栏目（News/Gaming/Sports） | `youtube:live-category` |
| `live:douyin:categories` | 抖音顶层 + 子分区（16 条） | `live:douyin:category` |
| `live:douyu:categories` | 斗鱼二级分区（530 条） | `live:douyu:category` |
| `live:huya:categories` | 虎牙二级分区（389 条） | `live:huya:category` |
| `bili:live:areas` | B站直播顶层 + 子分区（12 顶层 + 二级全量） | `bili:live:area`（列房需登录） |

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

#### 4.4 各平台目录实现要点

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
- **B站直播** ✅：`bili:live:areas`（`Area/getList` 匿名出全树）+ `bili:live:area`
  （`second/getList` 列房，需登录 + `w_webid`）；目录条目 `areaId="0"` 即整区列房。

#### 4.5 为什么新增 `kind:"category"` 而不是伪装成文章/音频

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

#### 4.6 落地顺序（已完成）

1. ✅ `kind:"category"` + XML 契约 + 目录渠道 + 卡片点击分流。
2. ✅ 右侧内容视图（`?open=`，复用正常网格）+ 「订阅该分区」（完整参数）。
3. ✅ 抖音 `partitionType` 两参问题（目录与手输都带完整参数）。
4. ✅ 五个平台目录渠道（Twitch / YouTube / 抖音 / 斗鱼 / 虎牙）。
5. ✅ **B站直播分区**（2026-10-22）：`bili:live:areas` 目录 + `bili:live:area` 列房
   （`second/getList` 需登录态 + `w_webid`，见 `docs/platforms/platform-notes.md`）。

---

## 二、未做的缺口

- ~~**bili 按分区列房**~~ ✅ 已落地（2026-10-22）：`bili:live:areas`（目录，匿名）+
  `bili:live:area`（列房，**需登录态**——wbi + buvid + `w_webid`（live 页 HTML 的
  `access_id`），匿名 `-352`，20 条/页 + `has_more`）。此前「匿名带 access_id 仍
  -352」的结论系探针 cookie 拼接缺 `; ` 分隔导致 buvid3 失效所致，登录态实测可用。
- **抖音分区搜索的词表局限** —— `live:douyin:search` 本质是分区搜索，只按分区名匹配；
  主播名（`旭旭宝宝`）与三级词（`美食`）返回 0。已知主播请用 `live:douyin` +
  抖音号/主页链接（见 `docs/platforms/platform-notes.md`）；`live:douyin:user` 仅保留给存量订阅。
  `live:douyin:anchor` 已删除（本地过滤热门房间没有意义）。
- **虎牙搜索不可分页** —— 接口 `start` 参数实测无效（`start=0` 返 20 条、`start>=20` 一律
  返同一批 40 条），故只取首页、不声明 `Pageable`。
- **微博无纯 HTTP 扫码登录** —— `weiboScanLogin` 走 CDP 浏览器路径（passport 页自带
  二维码）；`settings.weiboCookie` 为空时按匿名，冷 cookie 几分钟即失效（自述于
  `weibo/user.ts:9-13`）。
- **bili 账号服务**（参照 `bilibili_account_service.dart:191`）—— 未做：登录后拉昵称/uid
  展示（`/x/member/web/account`）。
- **Twitch 未做部分**（2026-10-20）—— 已落地：`twitch:live`（`roomIds` 多频道）、
  `twitch:hot`（热门，观看数降序）、`twitch:category`（分区流列表，slug/目录链接，
  游标翻页）+ by-url 直播 HLS 播放；**VOD / clip / 聊天弹幕 / 关键词搜索 / 登录均未做**：
  - VOD/clip 路由要排在频道名**单段路径之前**（`/videos/<id>`、`/<login>/clip/<slug>`），
    二期再加；`normalizeTwitchLogin` 现在对多段路径一律返回 null（避免误当频道）。
  - **分类榜已做成目录订阅 `twitch:categories`**（`games(first)` 只给分类元数据、本身没有
    可播房间）→ 点分类订阅 `twitch:category`，不另造分类 feed。
  - 聊天（IRC `wss://irc-ws.chat.twitch.tv:443` + `justinfan`）文本帧实测可用，但宿主
    `WsLike.send(Uint8Array)` **只发 binary**，Twitch 不收 → 要先给宿主 ws 加 text 帧。
  - 关键词搜索（搜频道/流）依赖 persisted query（结构不稳），二期再评估；登录
    （OAuth「我的关注」）需注册应用，不建议近期做。
  - **Helix 匿名 401**（`api.twitch.tv/helix/streams`），且不提供播放地址 → 不走 Helix；
    元数据与播放 token 都走公开 web GraphQL。
- **YouTube 播放列表的完整列表未做**（2026-10-20）—— 需要 >15 条时走 InnerTube
  `VL<playlistId>`（100/页 + continuation，解析器绑 `lockupViewModel`，较脆弱）尚未实现。
- **YouTube 直播分区只到栏目级**（2026-10-20）—— **不是 Twitch 式完整分区树**，无
  continuation。游戏级分区（`/gaming` 页的 Top live games，每个频道约 51 条）未做。
- **B站合集 / 视频列表 / 收藏夹的分页深度**（2026-10-20）—— 剩余：
  私有收藏夹需登录；「稍后再看」不接；合集/系列条目没有作者名（archives 里只有
  `mid`，不回查用户资料）。
- **分区目录订阅的剩余项**：预览弹窗里的房间**只读**（预览条目无真实订阅，不能直接播）。

## 三、条件触发的迁移（当前不做，等信号）

- **虎牙 Tars token 租约**（参照 `huya_site.dart:1144`，`wup.huya.com` 的 `getCdnTokenInfoEx`）
  —— 当前 `profileRoom` 返回的 URL 已带完整签名（`wsSecret`/`fm`/`wsTime`）且实测可播；
  仅当虎牙开始**对无令牌请求限流/拒绝**时才补（成本高：移植 Tars 二进制编解码 ~200 行）。
- **斗鱼 `getH5PlayV1`** —— 参照用 V1 是因它把 CDN 基址与签名路径分开返回，参照代码踩过
  「拼出 `https://cdn/live/https://other/live.flv` 这种语法合法但放不了的 URL」的坑
  （`douyu_site.dart:344-356` 注释）。我们的 `getH5Play` 直接返拼好的 URL，**没有这个坑**；
  仅当旧接口下线时才迁移。斗鱼播放侧已接近对等（全档位 + 多 CDN 轮询降级）。
- **抖音清晰度兜底按位置 join** —— 主路径（`stream_data` 为 JSON，按 sdk_key 取）实测正常；
  兜底路径 `resolve/douyin/stream.ts:132-133` 用 `flvList[length - level]` 按位置索引（level 是
  业务档位号如 5，列表长度仅 3，理论上取到 undefined）。参照侧一律按 key join
  （`douyin_site.dart:706-730`）。**无失败证据，暂不改**；遇到非 JSON `stream_data` 的源再修。
- **YouTube 免 POT client**（2026-10-21 ✅ 已落地 `VISIONOS` 主力）—— `ANDROID_VR`
  进入退役期（2026-08-17 起 1.65.10 全格式 403、yt-dlp 已移出默认），故链改为
  `VISIONOS → ANDROID_VR → WEB`：VOD 27 条 adaptive（avc1 带 Range、无 `n`/cipher）、
  直播给 `hlsManifestUrl`。**与 VR 同档，机房 IP 上同样被拦**（换 client 救不了风控 IP）。
  ⚠️ 原计划 `WEB_EMBEDDED_PLAYER` 纯 HTTP 被 embedder identity 拦（补 flags/cookies
  仍 denied）。**残留缺口**：机房 IP 只能靠登录态或换出口。
- **YouTube poToken provider**（同上前提）—— 只解**格式级 GVS POT**，不解 IP 级
  `LOGIN_REQUIRED`，且 POT 必须与播放**同出口 IP**；当前无需求，仅在未来被迫迁 `mweb` 时做。

## 四、实测证伪（走过的死路，别再重走）

- **「补 poToken / 真浏览器抓包」能救机房 IP（2026-10-21，真 Edge 复核）** —— 机房 IP
  （VPS `107.174.100.175`，HostPapa AS36352）上，真 Edge + 游客会话打开 watch/embed 页时
  player 响应直接 `LOGIN_REQUIRED`（页面文案「请登录，以便我们确认你不是聊天机器人」），
  一条 googlevideo 都没发 —— **页面级拦截，与 token 无关**。且 watch 页根本不发
  `/youtubei/v1/player`（用内联 `ytInitialPlayerResponse`）、流走 SABR（`pot` 在二进制体里），
  embed 的 player 请求体也是二进制 —— **「读 URL 的 `pot=`」与「读 JSON 的
  `serviceIntegrityDimensions`」两条取 token 路径都已失效**。结论：机房 IP 只有
  「登录态 cookie」或换住宅出口；详见 `docs/platforms/youtube.md` §6。
- **抖音搜索匿名无解（真实 Edge 复核，2026-10-13）** —— 路 1/2（`aweme/v1/web/live/search`、
  `general/search/stream`）在**干净 Edge 内同样** `2483 请先登录`；`www.douyin.com/search?type=live`
  页面自身被 **verify-center 挑战**（`4031 已阻止此次访问`），DOM 只渲染登录引导。
  即**登录硬门槛，与浏览器指纹无关** —— 拟用 browser 模拟解此缺口的路径**已证伪**
  （xhs 是 TLS 指纹差异 browser 能解；抖音是账号门槛 browser 不能解）。
  ✅ 但命中断面已扩：第三路 `partition/search` 只认**游戏名级**分区（`原神` 命中、`舞蹈` 返空），
  而**顶层分区名恰恰就是这些大类词**（聊天/音乐/游戏/二次元/舞蹈/文化/生活/运动）。故 resolve 侧
  改为 **上游命中 ∪ 本地分区树 title 匹配**：`舞蹈`/`音乐`/`聊天`/`二次元` 从 **0 → 20 条**。
  残留：树只到「大类」粒度，`美食`（属「生活」）这类三级词仍返空（需登录态）。
- **抖音观众数「累计当并发」误判（2026-10-13 复核）** —— 原记录称可能把累计值当并发，**实测有误**：
  `room_view_stats.display_value` 实测**等于** `room.user_count`（8 房间全等），即它显示的就是并发；
  累计观众在 `room.stats.total_user_str`（如 `7万+`）。仍改为显式取并发真字段 `room.user_count`
  （优先），`display_value` 仅兜底（`resolve/platform/douyin/audience.ts` 的 `douyinOnline()`）。
- **参照项目抖音弹幕签名已失效** —— 参照用 xbogus（`douyin_danmaku.dart:306`）**已失效**；
  我们用 2026 有效的 webmssdk `get_sign`，**领先**，不必抄。
- **bili 直播档位：匿名一律降档**（见 `docs/platforms/platform-notes.md`；此处只记结论：
  读 `current_qn` 标注、按实际值去重，否则 UI 说谎、菜单出现三个重复档）。
- **bili 匿名弹幕真因** —— 此前误判「匿名 uid=0 被 1006 拒」，真实根因是 buvid3 取自 cookie、
  匿名时必然为空。改用 `/x/frontend/finger/spi` 的匿名 buvid3（`client.ts` 的 `anonBuvid3()`）后匿名可收。

> 抖音号 / 主页链接 / 分区搜索的实测结论见 `docs/platforms/platform-notes.md` 的「斗鱼 / 虎牙 / 抖音」一节。

## 附：参照项目位置

- `tmp/pure_live` —— gitignore 内。README 提及的 `lemon-live` **无源码**（仅 README）。
  `tmp/RSSHub` / `tmp/MediaCrawler` 为既有参考仓库。

## 附：RSSHub 对照（已终止，2026-08-26 反转）

- **内置 RSSHub npm 包 / sidecar 成本高**：依赖大、`request()` 是进程内 API 需自行序列化、
  bilibili 需 cookie 才不风控（youtube 需 `YOUTUBE_KEY`）、小红书失效、sidecar 需随 app 起停。
  收益只是白嫖路由表整理，而多数路由仍需登录。
- **外挂模式更合适**：crawler 自解析稳定平台（YouTube 官方 RSS / bili API 可复刻），重反爬
  平台本身已降级 SSR / 浏览器模拟；RSSHub 只作可选补充，不参与播放，部署成本转移给用户
  自选实例。
- 2026-10-18 起 RSSHub 具名渠道（`rsshub:bili:*` / `weibo:*` / `youtube:*`）已删除，只保留
  泛用 `rsshub:feed`；`bili:precious` 收编为独立渠道。
