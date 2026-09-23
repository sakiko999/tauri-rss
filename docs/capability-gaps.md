# 能力补齐路线图（对照参照项目，2026-09-23）

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

**分区浏览**——参照侧几乎标配；**四平台已落地（2026-09-23）**：

| 平台 | 参照实现 | 我们的现状 |
|---|---|---|
| bili | `bilibili_site.dart:65`(分区树)/`:96`(按分区列房) | 分区树✅(`Area/getList` 已实现,未挂 channel);**按分区列房未做** |
| 虎牙 | `huya_site.dart:155/173/197` | ✅ **已落地** `live:huya:category` |
| 斗鱼 | `douyu_site.dart:36/63/87` | ✅ **已落地** `live:douyu:category` |
| 抖音 | `douyin_site.dart:133`(抓首页 `categoryData`)/`:177` | ✅ **已落地** `live:douyin:category` |

> ✅ **四平台分区（2026-09-23）**：取数层 `resolve/platform/<平台>/discover.ts`，
> channel 层薄封装。实测分区树：斗鱼 10+518、虎牙 4 顶层(硬编码)+105 二级、
> bili 12+462、抖音 8+7。列房间均 120/15 条，分页验证通过。
> ⚠️ **bili 按分区列房未做**——`second/getList` 需 wbi 签名 + access_id + cookie，
> 且匿名实测**仍 `-352` 风控**(带 buvid3/access_id/wbi 均无效)，必须登录态。
> ⚠️ bili 分区树(`Area/getList`)已实现但未挂 channel(它并非 feed)。

**搜索**——参照侧几乎标配；**四平台已落地（房间 + 主播）**：

| 平台 | 房间 | 主播 |
|---|---|---|
| bili | ✅ `bili:search` | ✅ `bili:anchor` |
| 虎牙 | ✅ `live:huya:search` | ✅ `live:huya:anchor` |
| 斗鱼 | ✅ `live:douyu:search` | ✅ `live:douyu:anchor` |
| 抖音 | ✅ `live:douyin:search`（⚠️ 见下） | ❌ 未做 |
| 小红书 | — | — |

> ✅ **四平台搜索（2026-09-23）**：全部**匿名可用**(实测)，无需 cookie。
> ⚠️ **抖音搜索有硬边界**——三路中只有 `partition/search` 匿名可用，它**只按
> 分区名匹配且只认游戏名级**：`原神`/`英雄联盟` 有结果，`舞蹈`/`美食`/`聊天`
> **返空**。前两路(`aweme/v1/web/live/search`、`general/search/stream`)返
> `2483 请先登录`——补它们需登录态。故抖音搜索目前**只对游戏类关键词有效**。
> ⚠️ **虎牙搜索不可分页**——接口 `start` 参数实测无效(`start=0` 返 20 条、
> `start>=20` 一律返同一批 40 条)，故只取首页、不声明 `Pageable`。
> ⚠️ 参照项目斗鱼搜索带设备 DID cookie，**实测匿名响应一致**，故不注入。
> ⚠️ 抖音搜主播未做(`partition/search` 只出分区、无主播)。

## P2 —— 健壮性

- ✅ **bili 弹幕 token 刷新重连（2026-09-23 落地）**：`createWsStream` 新增 `refresh`
  钩子（重连前重新求值）+ `url` 支持函数（动态 host/token）+ 解码抛错→主动断开走重连。
  bili 侧接 `getDanmuInfo` 重取 token，上限 3 次后放弃。
  ⚠️ **实测修正**：token 无效时服务器**直接 `1006` 断连**，**不是** op=8 code!=0
  （op=8 检测仍保留，覆盖未来形态）；真正的价值是**重连不再复用过期 token**。
  实测验证：注入无效 token → 恰好重连 3 次后停止（上限生效），不再无限重连。
- ✅ **bili 直播 `current_qn` 实测确认（2026-09-23 落地）**：读响应的 `current_qn`
  （实际生效档位）而非请求的 `qn`，并在收敛时**按实际档位去重**。
  ⚠️ **实测**：匿名请求 `qn=10000`（原画）服务器只给 `current_qn=250`（超清），
  且 `10000/400/250` 三个请求**全部收敛到 250** —— 此前会把这一档标成「原画」，
  UI 说谎且菜单会出现三个重复档。现显示为 `超清(请求原画)`。
- **弹幕连接释放竞态**（已有记忆，见 CLAUDE.md）——保持现状即可。

## P3 —— 播放层

- ✅ **虎牙多线路 + 双协议 + 全档位（2026-09-23 落地）**：数据源从
  `m.huya.com` HTML（首条 flv 线路、只返最高档）换成 **`mp.huya.com/.../profileRoom`
  JSON API** —— 一次给 flv + hls 双协议、各 5 条 CDN 线路、全部档位，且
  `multiLine[].url` **已含完整签名**（不再需要 `buildAntiCode`，该函数已删）。
  实测：4 档（蓝光10M/4M/超清/流畅）× 5 CDN × 2 协议 = 25 条；四档 HLS 全 200 +
  有效 m3u8；flv 标准 FLV 头可播。
  ⚠️ **两处旧结论被推翻**：①「PC 版被风控无线路」——实为可用；②「`ratio=` 低档
  flv.js 播几秒断」——仅对 **flv** 成立，HLS 走 `ratio=` 切档无此问题（故低档只产 HLS）。
  `live.ts` 房间元数据同批迁到该 API（去掉 HTML 解析），`getHtml` 现仅供弹幕用。
- **虎牙 Tars token 租约**（参照 `huya_site.dart:1144`，`wup.huya.com` 的
  `getCdnTokenInfoEx`）——**不做，条件触发**：当前 `profileRoom` 返回的 URL 已带
  完整签名（`wsSecret`/`fm`/`wsTime`）且实测可播；仅当虎牙开始**对无令牌请求限流/拒绝**
  时才补（成本高：需移植 Tars 二进制编解码 ~200 行）。
- **斗鱼 `getH5PlayV1`**——**不做，条件触发**：参照用 V1 是因为它把 CDN 基址与签名
  路径分开返回，参照代码里因此踩过「拼出 `https://cdn/live/https://other/live.flv`
  这种语法合法但放不了的 URL」的坑（`douyu_site.dart:344-356` 注释）。我们的
  `getH5Play` 直接返拼好的 URL，**没有这个坑**；仅当旧接口下线时才迁移。
  斗鱼播放侧已接近对等（全档位 + 多 CDN 轮询降级）。
- **抖音清晰度兜底路径按位置 join**——主路径（`stream_data` 为 JSON，按 sdk_key 取）**实测正常**，
  无需改；兜底路径 `resolve/douyin/stream.ts:132-133` 用 `flvList[length - level]` 按位置索引，
  理论上会取到 `undefined`（level 是业务档位号如 5，列表长度仅 3）。参照侧一律**按 key join**
  （`douyin_site.dart:706-730`）。**无失败证据，暂不改**；若遇到非 JSON `stream_data` 的源再修。

## P4 —— 产品化

- ✅ **bili 扫码登录协议（2026-09-23 落地）**：`resolve/platform/bili/login.ts` ——
  **纯 HTTP**（`qrcode/generate` + `qrcode/poll`，cookie 从 Set-Cookie 取，
  含 `refresh_token`）。状态机 86101 未扫 / 86090 已扫待确认 / 0 成功 / 86038 过期。
  实测：generate 拿到 key、poll 返 `86101 未扫码`、超时分支正常抛出。
  ⚠️ **与 xhs 路径的差异**：xhs 走 CDP 读页面 DOM（`platform/xhs/login.ts`），
  bili 是纯 HTTP 协议，**不依赖 `appHost.browser`**（移动端同样可用）。
  ⚠️ **待接 channel 的 `Loginable`**：`Loginable.scanLogin` 的 `emitQr` 契约是
  **图片 data URL**，而 bili 的 generate 返回的是**二维码内容字符串**（131 字符），
  需前端用 QR 库编码成图片。桌面端目前无 QR 库（`apps/desktop` 依赖表已确认）——
  接入时需引入一个（或复用 `ScanLoginDialog` 的渲染路径）。
- **bili 账号服务**（参照 `bilibili_account_service.dart:191`）——未做。用于登录后
  拉昵称/uid 展示（`/x/member/web/account`）。
- **微博无扫码登录**——`DEFAULT_WEIBO_COOKIE` 为空，冷 cookie 几分钟即失效（自述于 `weibo/user.ts:9-13`）。
- **抖音观众数单指标**——我们只用 `room_view_stats.display_value`，可能把**累计值当并发**显示；
  参照 `douyin_audience.dart` 把 online/total 分离成两个指标。

## P5 —— 参照项目已失效、不必抄

- 抖音弹幕签名：参照用 xbogus（`douyin_danmaku.dart:306`）**已失效**；我们用 2026 有效的
  webmssdk `get_sign`，**领先**。

## 附：参照项目位置

- `tmp/pure_live` —— 本次 clone（gitignore 内）。README 提及的 `lemon-live` **无源码**（仅 README，
  且作者自述「它用不了之后才有了 zrfme」）。`tmp/RSSHub` / `tmp/MediaCrawler` 为既有参考仓库。
