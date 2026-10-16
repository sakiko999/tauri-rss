# 能力缺口（对照参照项目，2026-09-23 起）

> 背景：对照 `tmp/pure_live`（Flutter 直播聚合器，23 平台）逐平台比对。
> **已落地的能力不在此登记**（代码与 CLAUDE.md 可查）；本文件只留**未做的缺口**与
> **实测证伪的结论**（防止后人重走已证明走不通的路）。
> 状态更新至 2026-10-16。

## 一、未做的缺口

- **bili 按分区列房** —— `second/getList` 需 wbi 签名 + access_id + cookie，且匿名实测
  **仍 `-352` 风控**（带 buvid3/access_id/wbi 均无效），必须登录态。分区树
  （`Area/getList`）匿名可用、已实现但未挂 channel（它并非 feed）。
- **抖音搜主播的覆盖局限** —— `live:douyin:anchor` 走本地过滤（无匿名主播搜索接口），
  只命中**当前在播**主播（离线不在任何列表），受扫描量限制（热门 + 前 3 分区 ≈ 90 房）。
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

## 附：参照项目位置

- `tmp/pure_live` —— gitignore 内。README 提及的 `lemon-live` **无源码**（仅 README）。
  `tmp/RSSHub` / `tmp/MediaCrawler` 为既有参考仓库。
