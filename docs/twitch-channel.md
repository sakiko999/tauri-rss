# Twitch 渠道一期方案（2026-10-20）

> 状态：一期实现中。调研依据见本文「实测结论」；二期/三期只做边界说明，不在本次范围。
> 相关：`docs/capability-gaps.md`、`docs/crawler-risk-control.md`、`docs/rsshub-vs-crawler.md`。

## 1. 结论与范围

Twitch 匿名链路可用：公开 web Client-ID 的 GraphQL → `PlaybackAccessToken` →
`usher.ttvnw.net` HLS，全程不需要账号、不需要 `Client-Integrity`、不需要浏览器。
官方 Helix 匿名不可用（401），也不提供播放地址，因此**不走 Helix**。

一期（MVP）：

- 新增 `twitch:live` 渠道：`roomIds` = 频道登录名列表，产出 `Live` item（含离线态）。
- resolver 支持 `https://www.twitch.tv/<login>` 的直播 HLS 解析。
- 不做：登录、VOD、clip、聊天弹幕、搜索/分区、`supportsL9`、cookie 字段。

二期再考虑 VOD/clip（路由要排在频道名之前）、搜索/分区、IRC 聊天（需宿主 ws
支持 text 帧——当前 `WsLike.send(Uint8Array)` 只发 binary，实测 Twitch 不收）。

## 2. 实测结论（2026-10-20，匿名）

| 能力 | 端点 | 结果 |
| --- | --- | --- |
| 频道元数据 | `POST https://gql.twitch.tv/gql`，`Client-Id: kimne78kx3ncx6brgo4mv6wki5h1ko` | 200；`user{login,displayName,description,stream{id,title,viewersCount,createdAt,type,game{name}}}` |
| 离线/不存在 | 同上 | `stream = null` / `user = null` |
| 播放 token | 同 GraphQL，persisted `PlaybackAccessToken` | 200；`signature` + `value`（约 20 分钟有效） |
| 直播 HLS | `https://usher.ttvnw.net/api/v2/channel/hls/<login>.m3u8?...` | 200；6 档（1080p60 source → audio_only） |
| Helix | `api.twitch.tv/helix/streams` | 401 `OAuth token is missing`（匿名不可用） |
| 聊天 | `wss://irc-ws.chat.twitch.tv:443`，`justinfan` | 文本帧可用；binary 帧 0 条 |

### 2.1 GraphQL 频道查询

直查文本即可（不是 persisted query）：

```graphql
query($login: String!) {
  user(login: $login) {
    login
    displayName
    description
    stream {
      id
      title
      viewersCount
      createdAt
      type
      game { name }
    }
  }
}
```

- `stream != null` = 直播中；`stream == null` = 离线；`user == null` = 频道不存在。
- 多频道用**别名**合并成一次请求，别逐频道发（按 IP 限流，无公开阈值）。
- 不要查 `profileImageURL`：实测报 `server error`；头像一期省略。

### 2.2 播放 token

必须走 persisted query；直接手写 `streamPlaybackAccessToken(login:...)` 会报
`argument: channelName is required`（schema 已变）。

```
operationName: PlaybackAccessToken
variables: { isLive:true, login, isVod:false, vodID:"", platform:"web", playerType:"site" }
extensions.persistedQuery: { version:1, sha256Hash:"ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9" }
```

⚠️ hash 会轮换（2025-11 曾整体替换一次）；把它集中成一个常量，Twitch 改版时只改这里。
token 的 `value` 是 JSON，含 `geoblock_reason` / `blackout_enabled` / `maximum_resolution`
等诊断字段；**不要把 token 写进日志/错误文案**。`geoblock_reason` 非空时给「地区/版权受限」，
不要重试。

### 2.3 usher / HLS

```
https://usher.ttvnw.net/api/v2/channel/hls/<login>.m3u8
  ?platform=web
  &p=<随机数>
  &allow_source=true
  &allow_audio_only=true
  &playlist_include_framerate=true
  &supported_codecs=h264
  &sig=<signature>
  &token=<value>
```

- **master 没有 `Access-Control-Allow-Origin`** → hls.js 不能直接加载；variant playlist
  和分片是 `ACAO: *`。因此 resolver 必须用 `appHost.http` 拉 master、解析出 variant，
  把 **variant URL** 作为 `Stream.url`。播放器现有 HLS 分支无需改。
- master 的 variant 顺序**不是高→低**（实测 audio_only 排第二）。按 `RESOLUTION` 高度 /
  `BANDWIDTH` 显式降序，audio_only 最后。
- `supported_codecs=h264` 固定（避免 AV1/HEVC source 兼容性问题）。
- 广告分片 hls.js 能处理；无法在不违背 ToS 的前提下跳过。

## 3. 数据映射

`twitch:live`（`kind: "live"`，`sourceInfoTpl` 用 `roomIds`）：

| 字段 | 值 |
| --- | --- |
| `id` | `twitch:<login>` |
| `sourceId` | `twitch:live` |
| `url` | `https://www.twitch.tv/<login>` |
| `platform` | `twitch` |
| `roomId` | login |
| `liveStatus` | `stream ? "live" : "offline"` |
| `online` | `stream?.viewersCount ?? 0` |
| `title` | `stream?.title`；离线回落 `<displayName>（离线）`，直播中标题为空回落 `displayName`（不带「离线」） |
| `thumbnail` | `https://static-cdn.jtvnw.net/previews-ttv/live_user_<login>-640x360.jpg` |
| `author.name` | `displayName` |
| `introduction` | `description` |
| `showTime` | `stream.createdAt`（ISO） |

输入归一化：裸 login、`@login`、`twitch.tv/<login>` 都接受；小写；只允许
`[a-z0-9_]{3,25}`；排除 `videos/directory/search/clips/settings/...` 保留字。
⚠️ **只认频道域** `twitch.tv` / `www.twitch.tv` / `m.twitch.tv`：clip 页是
`clips.twitch.tv/<slug>`（**单段路径**），不卡 host 会把 clip slug 归一成频道名
（永远离线的假频道）。判据 = `utils/twitch.ts` 的 `isTwitchChannelHost`，router 与
channel 共用。
离线频道仍产出 item，避免下播后订阅空掉；全部频道失败才抛错（对齐 bili/douyin
「不能静默清空」护栏）。

## 4. 落点

### 4.1 resolve

新增：

- `packages/resolve/src/platform/twitch/client.ts`：GraphQL POST、Client-ID、别名批量查询、
  风控上报、`normalizeTwitchLogin`（或放 `utils/twitch.ts`）。
- `packages/resolve/src/platform/twitch/live.ts`：`PlaybackAccessToken` → usher → master
  解析/排序 → `Stream[]`；`parseTwitchMaster` 写成纯函数便于自检。
- `packages/resolve/src/platform/twitch/index.ts`
- `packages/resolve/src/utils/twitch.ts`：login 归一化/保留字（router 与 channel 共用）。

修改：

- `resolve/src/index.ts` 导出 twitch。
- `resolve/src/log.ts` 增加 `log.twitch`。
- `resolver/router.ts`：`ResolvePlatform` 加 `"twitch"`；直播路由只匹配**单段路径**
  `twitch.tv/<login>`（VOD/clip 二期再加，避免误把 `/<login>/clip/<slug>` 当频道）。
- `resolver/play.ts`：`LivePlatform` 加 `"twitch"`，`resolveLiveStreams` 分发。

### 4.2 crawler

新增 `packages/crawler/src/channels/twitch/live.ts` + `index.ts`；`register.ts` 登记。
只实现 `RssSource.fetch`；不实现 `fetchMore`/`resolveDetail`/`fetchPassive`/`Loginable`。

### 4.3 类型 / 平台标签 / 设置

- `packages/xml/src/types.ts`、`packages/core/src/types/live.ts`：`LivePlatformId` 加 `"twitch"`。
- `apps/desktop/src/lib/media.ts`：`PLATFORM_LABEL.twitch = "Twitch"`。
- `packages/core/src/data-layer.ts` / `apps/desktop/.../Network.tsx`：`platformOfChannel` 加
  `twitch:` → `twitch`。
- `apps/desktop/src/lib/subscriptions.ts`：`LIVE_SUB_CHANNEL.twitch = "twitch:live"`（为二期
  搜索/发现预留；`SEARCH_CHANNEL` 一期不加）。
- CLI：`info.ts` 的 `exampleInfo("twitch:live")`；`item.ts` 路由错误文案与 `danmakuNote`
  （一期「无（Twitch 聊天二期）」）。

### 4.4 governor

`packages/host/src/net/governor.ts`：

- `platformOf`：`twitch.tv` / `*.ttvnw.net` / `*.jtvnw.net` → `"twitch"`。
- `MEDIA_CDN_SUFFIXES`：`ttvnw.net`、`jtvnw.net`（m3u8/分片/图片不扣 RPM，但仍占全局并发）。
- `DEFAULT_NET_POLICY.platforms.twitch`：先保守 `maxConcurrent:6, rpm:120,
  minIntervalMs:100, cooldownBaseMs:600_000`。
- `SIGNAL_COOLDOWNS.twitch`：`429: 10 分钟`。403（多为地区/版权限制）未单列信号，但
  governor 对计量请求的 403 仍会走 `cooldownBaseMs` 兜底冷却（同样是 10 分钟）——
  不要误以为「403 不会冷却」。

## 5. 分期

| 阶段 | 内容 |
| --- | --- |
| 一期 | 直播频道订阅 + 元数据 + 离线态 + HLS 播放 + router/governor/标签/CLI + 自检 |
| 二期 A | VOD / clip 播放（路由排在频道之前） |
| 二期 B | 搜索 / 分区（persisted query，结构不稳） |
| 二期 C | IRC 聊天弹幕（先给宿主 ws 增加 text 帧） |
| 三期 | OAuth「我的关注」（需注册应用，不建议近期） |
| 暂不做 | `Client-Integrity` 浏览器兜底、去广告、订阅者专属流 |

## 6. 风险 / 待确认

- `gql.twitch.tv` 是未公开 API，公开 Client-ID 属 ToS 灰色地带；只低频、只读公共数据。
- persisted query hash 会轮换；改成常量并留更新说明。
- `Client-Integrity` 与 IP 相关；本机实测不需要，部分网络可能要求。真出现时最小兜底是
  用现有 CDP 打开页面、被动捕获 token，成本较高，先不做。
- master CORS 是硬约束（必须服务端拉 master）；不要把 master URL 直接交给播放器。
- 待真机：不同地区是否要求 `Client-Integrity`、实际 429 阈值、WebView2 广告分片、
  variant 跨小时重载、地区限制错误码。

## 7. 自检

- `packages/resolve/src/example/twitch-playlist.check.ts`：master 解析/排序、login 归一化。
- `packages/crawler/src/example/twitch-live.check.ts`：GQL payload → Live 映射（live/offline/
  标题回落/在线数）。
- 真实探针（不常驻自检）：`bun run rss fetch twitch:live`、
  `bun run rss item https://www.twitch.tv/<login>`。
