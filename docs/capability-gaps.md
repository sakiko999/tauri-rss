# 能力缺口（对照参照项目，2026-09-23 起）

> 背景：对照 `tmp/pure_live`（Flutter 直播聚合器，23 平台）逐平台比对。
> **已落地的能力不在此登记**（代码与 CLAUDE.md 可查）；本文件只留**未做的缺口**与
> **实测证伪的结论**（防止后人重走已证明走不通的路）。
> 状态更新至 2026-10-18。

## 一、未做的缺口

- **bili 按分区列房** —— `second/getList` 需 wbi 签名 + access_id + cookie，且匿名实测
  **仍 `-352` 风控**（带 buvid3/access_id/wbi 均无效），必须登录态。分区树
  （`Area/getList`）匿名可用、已实现但未挂 channel（它并非 feed）。
- **抖音分区搜索的词表局限** —— `live:douyin:search` 本质是分区搜索，只按分区名匹配；
  主播名（`旭旭宝宝`）与三级词（`美食`）返回 0。已知主播请用 `live:douyin` + 抖音号，
  或 `live:douyin:user` + 主页链接（见第四节）。`live:douyin:anchor` 已删除（本地过滤
  热门房间没有意义）。
- **虎牙搜索不可分页** —— 接口 `start` 参数实测无效（`start=0` 返 20 条、`start>=20` 一律
  返同一批 40 条），故只取首页、不声明 `Pageable`。
- **微博无纯 HTTP 扫码登录** —— `weiboScanLogin` 走 CDP 浏览器路径（passport 页自带
  二维码）；`DEFAULT_WEIBO_COOKIE` 为空，冷 cookie 几分钟即失效（自述于
  `weibo/user.ts:9-13`）。
- **bili 账号服务**（参照 `bilibili_account_service.dart:191`）—— 未做：登录后拉昵称/uid
  展示（`/x/member/web/account`）。

## 二、条件触发的迁移（当前不做，等信号）

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

## 三、实测证伪（走过的死路，别再重走）

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
- **bili 直播档位：匿名一律降档** —— 匿名请求 `qn=10000`（原画）服务器只给 `current_qn=250`
  （超清），且 `10000/400/250` 三个请求**全部收敛到 250**。故读 `current_qn` 标注、按实际值去重
  （否则 UI 说谎、菜单出现三个重复档）。
- **bili 匿名弹幕真因** —— 此前误判「匿名 uid=0 被 1006 拒」，真实根因是 buvid3 取自 cookie、
  匿名时必然为空。改用 `/x/frontend/finger/spi` 的匿名 buvid3（`client.ts` 的 `anonBuvid3()`）后匿名可收。

## 四、2026-10-18 抖音直播补充实测

> 触发：确认「已知用户抖音号/主页信息，如何订阅其直播间」。探针脚本为临时文件
> （`tmp/douyin-live-probe*.ts`，已废弃），结论均已用 CLI 复现。

### 4.1 已知抖音号：直接当 `web_rid` 用（可落地）

`live:douyin` 的 `roomIds` **不要求纯数字**。把用户抖音号（`unique_id`，如
`pvcyinse`）或数字短 ID（如 `3482057509`）填进去，enter API 会解析到该用户当前
直播间：

```bash
bun run rss fetch live:douyin --kv roomIds=pvcyinse --json
bun run rss fetch live:douyin --kv roomIds=3482057509 --json
bun run rss item https://live.douyin.com/pvcyinse --json   # 4 档 flv 全出
```

实测结果：

| 输入 | 结果 |
| --- | --- |
| `pvcyinse`（抖音号，在播） | 1 条 live，标题/作者/在线数正确；播放解析出 4 档 |
| `3482057509`（short_id，在播） | 1 条 live，同一房间 |
| `22316883325`（杨楷文，离线） | 1 条 offline，标题/头像为最近一场 |
| `renyixu1989`（旭旭宝宝，离线） | 1 条 offline，同上 |
| `7697963097109187378`（长 room_id） | enter API `4001038`，**不可用** |
| `https://www.douyin.com/user/<sec_uid>`（主页链接） | `10011`，**不可用** |

结论：**知道抖音号就是最优解**；离线也能建订阅，开播后刷新自动变 live。
`roomIds` 会自动归一 `@抖音号`、`抖音号：xxx`、`live.douyin.com/<id>`；主页链接会被
拦截并提示改用 4.2 的 `live:douyin:user`。

### 4.2 主页链接（sec_uid）→ 抖音号：匿名资料 API 可用

`GET https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=<sec_uid>&...`
带 ABogus 签名 + ttwid（现有 `signDouyinUrl` 可复用）**匿名 200**，返回
`user.unique_id` / `short_id` / `uid` / `room_id_str` / `live_status`：

- `live_status: 1` = 直播中（对应 enter `room.status=2`）；`0` = 未开播。
- `room_id_str` 是精确长 ID；`room_id` 是 JSON number，超过 2^53 会丢精度，**别用**。
- 该接口只认 `sec_user_id`；传 `unique_id` / `short_id` / `uid` 均返回
  `UserId不合法`（status_code 2）。
- `www.douyin.com/user/<sec_uid>` 是客户端渲染 shell（约 72KB，无用户数据）；
  `iesdouyin.com/web/api/v2/user/info` 已返回空 body（旧接口失效）。
- `webcast.amemv.com/douyin/webcast/reflow/<room_id>?sec_user_id=<sec_uid>` 可返回房间
  页（含 webRid），但页面里可能有推荐房间的同名字段，**不要取第一个 `webRid`**；
  已知抖音号时无需这条路径。

✅ 已落地（2026-10-18）：新增渠道 `live:douyin:user`（`channels/douyin/user.ts`）——
sec_uid/主页链接 → 资料 API → `unique_id`/`short_id` → enter API（离线也返 offline；
从未开播的账号可能拿不到房间数据，会报抓取失败）；`live:douyin` 的 `roomIds` 增加归一
（`@抖音号`、`抖音号：xxx`、`live.douyin.com/<id>`），
主页链接会提示改用用户渠道。纯函数在 `resolve/platform/douyin/ids.ts`，自检
`resolve/src/example/douyin-user.check.ts`。

### 4.3 现有搜索渠道实测（都不适合「找指定主播」）

| 渠道 | 输入 | 结果 |
| --- | --- | --- |
| `live:douyin:search` | `原神` | 20 条（分区名命中） |
| `live:douyin:search` | `舞蹈` | 20 条（本地顶层分区匹配） |
| `live:douyin:search` | `旭旭宝宝` | 0 条 |
| `live:douyin:search` | `美食` | 0 条（三级词不在分区树） |

原因：`live:douyin:search` 本质是「关键词 → 分区 → 列房」，不是搜房间标题/主播；
渠道已更名为「抖音分区搜索」。`live:douyin:anchor` 已于 2026-10-18 删除（本地过滤
热门房间没有意义）。`SEARCH_CHANNEL` 已登记 douyin → `live:douyin:search`（发现页/
搜索面板显示「抖音分区」，输入框明确写「分区关键词」；结果仍是可一键订阅的直播间）。
**已知主播时直接用 4.1 的抖音号或 4.2 的 `live:douyin:user`，不要依赖分区搜索。**

## 附：参照项目位置

- `tmp/pure_live` —— gitignore 内。README 提及的 `lemon-live` **无源码**（仅 README）。
  `tmp/RSSHub` / `tmp/MediaCrawler` 为既有参考仓库。
