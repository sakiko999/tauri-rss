# crawler 渠道 vs RSSHub 对照（2026-08-26 反转后）

> 状态:2026-08-26 方向反转——**内置 crawler 为主,RSSHub 改「可选外挂 HTTP 服务器」**。
> 不再内嵌 npm 包(`rsshub@...`)/sidecar 进程(`scripts/rsshub-server.ts` 已删)。
> 本表是历史对照,记录「哪些渠道 RSSHub 曾有等价路由且实测可跑」,供以后决策参考。

## 定位

- **内置 crawler 是主供给**:自解析平台 API / 官方 RSS / 直链,零外部依赖。
  **crawler 只输出订阅数据**(channel + 标准 RSS);平台能力全在 `@tauri-playground/resolve`。
- **resolve 是平台解析层**(2026-08-26 架构重构):platform 与 crawler 解耦,平台
  全部能力(签名/取数/播放/弹幕)集中在此。crawler channel 依赖它抓数据,core 依赖它播放。
- **RSSHub 是可选外挂**:用户配置 `settings.rsshubBaseUrl`(默认公网 `https://rsshub.app`
  或自部署实例),AddFeedDialog 可选 `rsshub:*` 渠道补充 crawler 未覆盖的信息源。
  只做信息抓取,不注入平台 cookie,不承担播放。
- **播放统一走 resolve/resolver by-url**:无论 crawler 还是 RSSHub 输出的 item,
  item.link 指向平台详情页,resolve 的 resolver 按 url 路由解析可播流
  (见 `docs/desktop-crawler-service.md`)。crawler 输出与 RSSHub 对齐(标准 RSS + 最小 tpl:kind)。

## 历史实测(2026-08-26,对 `rsshub@1.0.0-master.0a5fb34` npm 包)

### ✅ 曾有等价路由且实测可跑

| crawler 渠道 | RSSHub 路由 | items | link → resolver |
|---|---|---|---|
| `bili:popular` 综合热门 | `/bilibili/popular/all` | 20 | `video/BV` → bili video ✅ |
| `bili:weekly` 每周必看 | `/bilibili/weekly` | 49 | `video/BV` ✅ |
| `bili:user_video` 用户投稿 | `/bilibili/user/video/{mid}` | 30 | `video/BV` ✅ |
| `bili:square` 分区 | `/bilibili/partion/{tid}` | 15 | `video/BV` ✅ |
| `youtube` 频道 | `/youtube/channel/{id}` | 30 | `watch?v=` → youtube ✅ |
| `live:douyu` 斗鱼房间 | `/douyu/room/{rid}` | 1 | `douyu.com/{rid}` ✅ |
| `live:douyu:hot` 斗鱼热门 | `/douyu/room/{rid}` | 1 | `douyu.com/{rid}` ✅ |
| `live:huya` 虎牙房间 | `/huya/live/{rid}` | 1 | `huya.com/{rid}` ✅ |
| `weibo:user`/`weibo:hot` | `/weibo/user/{uid}` / `/weibo/search/hot` | 10/53 | 信息(非播放) |
| `rss:podcast` | `/url?u=` 泛代理(需 sidecar,已删) | 435 | 原文 |

### ⚠️ RSSHub 曾有的路由需登录/config 才可跑

| crawler 渠道 | RSSHub 路由 | 问题 |
|---|---|---|
| `bili:dynamic` | `/bilibili/user/dynamic/{uid}` | 风控 CaptchaError |
| `youtube:live` | `/youtube/live/{id}` | 需 `YOUTUBE_KEY` config |
| `live:douyin` | `/douyin/live/{rid}` | 需登录 cookie |
| `bili:live` | `/bilibili/live/room/{rid}` | 只输出开播状态,无 item |
| `xhs:*` | `/xhs/user/{id}` `/xhs/explore` | 需登录/失效 |

### ❌ RSSHub 无对应路由

| crawler 渠道 | 说明 |
|---|---|
| `bili:ranking` | 包内 -352 风控,空 feed |
| `live:huya:hot` / `live:douyin:hot` | RSSHub 无对应直播热门路由 |

## 当前 provider 渠道(source/rsshub.ts,外挂模式)

- `rsshub:weibo:hot` / `rsshub:weibo:user` — 信息源补充
- `rsshub:bili:popular` / `rsshub:bili:weekly` / `rsshub:bili:precious` — 视频信息
- `rsshub:youtube:channel` — YouTube 频道
- `rsshub:feed` — 任意路由兜底(`{route}` + 可选 `baseUrl`)

## 当前测试订阅(subscriptions.ts)

- `s-article` Hacker News → `rsshub:feed` `{route:"/hackernews"}`(唯一保留的外挂示例)
- 其余全部 crawler:`youtube`/`bili:popular`/`bili:weekly`/`youtube:live`/`rss:podcast`/
  `live:douyu`/`bili:live`/`live:huya`/`live:douyin`/4×`live:*:hot`/`bili:dynamic`/
  `weibo:*`/`xhs:*`

## 历史决策教训

- **内置 rsshub npm 包 + sidecar 成本高**:依赖大(内容路由多)、`request()` 是进程内
  API 需自行序列化、bilibili 需 cookie 才不风控(youtube 需 YOUTUBE_KEY)、小红书失效、
  sidecar 需随 app 起停。**收益**主要在能白嫖 RSSHub 的路由表整理、但大多路由需登录。
- **外挂模式更合适**:crawler 自解析稳定平台(YouTube 官方 RSS / bili API 可复刻),
  重反爬平台本身 crawler 已降级 SSR/浏览器模拟;RSSHub 只作可选信息补充,不参与播放,
  部署成本转移到用户自选实例。

## 消费契约（外挂模式，core 层）

- `packages/core/src/source/rsshub.ts` 走 `httpText(baseUrl+route)`，`baseUrl` 默认公网
  `https://rsshub.app`；`sourceInfoFor` 对 `rsshub:` 注入 baseUrl 但**不附平台 cookie**。
- `deserializeFeed` 兼容标准 RSS + Atom + media:* 增强——crawler(`tpl:`) 与 rsshub(标准)
  被**同一加工层**消费（`verify-alignment.ts` 断言成立）。播放统一走 resolver by-url。
- desktop `AddFeedDialog` 隐藏 crawler `rss:*` 渠道（`hiddenPrefixes=["rss:"]`），
  crawler 包内仍注册供 mobile 兜底。

## 验证与遗留（反转后）

- `verify-alignment.ts`：crawler(tpl:) video + rsshub(标准+media:) article 同 deserialize ✓；
  全量 tsc（core/desktop/crawler）零错。
- 遗留：release 构建侧用户需手动起外部实例；Rust `RunEvent::Exit` 的 spawn 形态留作后续
  （如需完全内建）。RSSHub `bilibili/ranking` 偶发 503（上游间歇），非本项目问题。
