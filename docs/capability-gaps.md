# 能力补齐路线图（对照参照项目，2026-09-22）

> **背景**：对照开源参照项目 `tmp/pure_live`（Flutter 直播聚合器，23 平台，zrfme-live 的
> 主要知识来源）逐平台比对后梳理的差距与后续目标。**只列差距**——我们独有的能力
> （bili VOD 视频全套 / DASH 自建 MPD / 分段弹幕、微博·小红书内容流、抖音弹幕
> webmssdk 签名、热门列表真分页游标）不在本表。
>
> 参照项目的能力契约在 `tmp/pure_live/lib/core/interface/live_site.dart:202-219`：
> `getCategores` / `getCategoryRooms` / `searchRooms` / `searchAnchors` /
> `getRecommendRooms`，默认返回空数组 = **能力探测**（zrfme 的 `capabilities` 即源于此）。

## 已修（2026-09）

- ✅ **bili 直播弹幕匿名可用** —— 此前误判「匿名 uid=0 被 1006 拒」（记于 CLAUDE.md /
  danmaku-research.md）。**真实根因**：buvid3 取自 cookie，匿名时必然为空，空 buvid 触发拒连。
  改用 `/x/frontend/finger/spi` 的匿名 buvid3 后，匿名可收真实弹幕（用户名被遮为 `肆***` 式）。
  实现在 `packages/resolve/src/platform/bili/client.ts` 的 `anonBuvid3()`。

## P1 —— 发现层（最大结构性缺口，全平台一致）

**分区浏览**——全平台缺失；参照侧几乎标配：

| 平台 | 参照实现 | 我们的现状 |
|---|---|---|
| bili | `bilibili_site.dart:65`(分区树)/`:96`(按分区列房) | 无 |
| 虎牙 | `huya_site.dart:155/173/197` | 无 |
| 斗鱼 | `douyu_site.dart:36/63/87` | 无 |
| 抖音 | `douyin_site.dart:133`(抓首页 `categoryData`)/`:177` | 仅硬编码 `partition=720`（`crawler/channels/douyin/hot.ts:57`） |

**搜索**——全平台缺失（微博除外，我们有热搜词路径）：

| 平台 | 参照实现 |
|---|---|
| bili | `:712` 直播房间 + `:757` 主播（走 `search/type`，无签名门槛） |
| 虎牙 | `:871` 房间 + `:923` 主播（`search.cdn.huya.com`） |
| 斗鱼 | `:515` 房间 + `:562` 主播（`japi/search`） |
| 抖音 | 三路降级 `douyin_search.dart:319/350/377`（匿名 ttwid 即可） |
| 小红书 | 均无 |

> **判断**：这些端点大多**无签名门槛**，是纯工作量而非反爬难题。
> 建议先做**抖音分区**（我们已在调同一接口 `partition/detail/room/v2`，只需参数化）。

## P2 —— 健壮性

- **bili 弹幕 `op=8` 鉴权失败无感知**——`parseBiliDanmakuFrame` 只处理 op=5，
  **完全忽略 op=8**。参照侧在 `bilibili_danmaku.dart:316` 做「code!=0 → 刷新 token 重连」
  （上限 3 次），另有 `:130` 8s 未连超时重连、`:601` 多线路降级。约 20 行可补。
- **bili 视频播放 `applied-qn` 无确认**——B 站会对访客降档，UI 无反馈（`bilibili_site.dart:214`）。
- **弹幕连接释放竞态**（已有记忆，见 CLAUDE.md）——保持现状即可。

## P3 —— 播放层

- **虎牙线路/协议单一**——我们只取**首条 flv 线路 + 只返最高档**（`resolve/huya/play.ts:119-132,154`）；
  参照有**多 CDN 并行 + HLS/FLV 双协议 + 全档位 + Tars token 租约**
  （`huya_site.dart:278,623-676,1145`）。斗鱼播放侧已接近对等，仅缺 `getH5PlayV1` 与按线路重解析。
- **抖音清晰度兜底路径按位置 join**——主路径（`stream_data` 为 JSON，按 sdk_key 取）**实测正常**，
  无需改；兜底路径 `resolve/douyin/stream.ts:132-133` 用 `flvList[length - level]` 按位置索引，
  理论上会取到 `undefined`（level 是业务档位号如 5，列表长度仅 3）。参照侧一律**按 key join**
  （`douyin_site.dart:706-730`）。**无失败证据，暂不改**；若遇到非 JSON `stream_data` 的源再修。

## P4 —— 产品化

- **bili 扫码登录**——我们目前只能手工贴 cookie（`sourceInfoTpl`）。参照有完整体系：
  扫码 `tmp/pure_live/lib/modules/account/bilibili/qr_login_controller.dart:274`（generate+poll，纯 HTTP）
  + web 登录 + 账号服务 `bilibili_account_service.dart:191`（`/x/member/web/account` 拉昵称/uid）。
  xhs 侧我们**已有**扫码登录（`resolve/platform/xhs/login.ts`），bili 可参照补齐。
- **微博无扫码登录**——`DEFAULT_WEIBO_COOKIE` 为空，冷 cookie 几分钟即失效（自述于 `weibo/user.ts:9-13`）。
- **抖音观众数单指标**——我们只用 `room_view_stats.display_value`，可能把**累计值当并发**显示；
  参照 `douyin_audience.dart` 把 online/total 分离成两个指标。

## P5 —— 参照项目已失效、不必抄

- 抖音弹幕签名：参照用 xbogus（`douyin_danmaku.dart:306`）**已失效**；我们用 2026 有效的
  webmssdk `get_sign`，**领先**。

## 附：参照项目位置

- `tmp/pure_live` —— 本次 clone（gitignore 内）。README 提及的 `lemon-live` **无源码**（仅 README，
  且作者自述「它用不了之后才有了 zrfme」）。`tmp/RSSHub` / `tmp/MediaCrawler` 为既有参考仓库。
