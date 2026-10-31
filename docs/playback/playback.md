# 播放约定

> 从 `CLAUDE.md` 迁出（2026-10-21）。`CLAUDE.md` 只留「选流 = `streams[0]`」硬契约；
> Twitch release 403 等 loader 差异与弹幕细节全在本文与 `docs/playback/danmaku.md`。

## 选流契约

产流侧（resolve 平台解析）保证返回数组内**最高清晰度排最前**（bili/youtube/douyin 显式按 rate 降序；
huya 依赖 API 档位原序——最高档 `iBitRate=0`，按 rate 降序反而排最后；douyu 例外——
`rate` 是档位 ID，保留服务端顺序）。player `pickDefaultStream`
（`hooks/streamKind.ts`）**就取 `streams[0]`**，不做二次排序。

⚠️ 曾按**格式族**挑（`find(渐进式) ?? find(hls) ?? find(flv) ?? [0]`），以为「原生可播的最稳」
—— 那会在首档不是渐进式、后面却有的时候**静默降画质**（首档 1080p dash 后面跟一条 360p mp4
就去取 360p）。契约既保证顺序，就别再挑拣。回归：`useStreamSelection.check.ts`。

⚠️ 格式判据在 `streamKind.ts`（纯函数、**不 import 引擎**）—— `useMediaStream.ts` 引了
hls/flv/dashjs，加载即要 `window`，判据放那儿 node 侧自检跑不起来。

## 引擎与档位

- **HLS/DASH 锁最高档**（`currentLevel=max`，ABR 关闭）。原因：宿主隧道的固定开销
  （Rust reqwest + base64）让 ABR 带宽估算失真（1080p 实测仅 ~1Mbps），自动降档会骤降 144p
  永不回升。`defaultQuality: "auto"` 因此**不做**，设置页只留只读的「锁最高档」。
- **loader 路由按「WebView 里直接发会不会被拒」，不按「有没有 CORS」**：
  - `googlevideo.com`（YouTube）→ `config.loader = HlsHostLoader`（manifest 与分片**全走隧道**）；
  - `playlist.ttvnw.net`（Twitch）→ **XHR 直连**，由 Rust 改写 Origin（见下）。
  ⚠️ **Twitch playlist 只拒页面源 Origin**（`http://tauri.localhost` → 403，dev 的
  `http://localhost:1420` 恰好放行）；分片域 `*.cloudfront.hls.ttvnw.net` 带 `ACAO:*`、
  直连 206 正常（把分片也塞进隧道反而 `fragParsingError`）。现象：dev 正常、release 里
  Twitch 黑屏，`hls networkError manifestLoadError (HTTP 403)`。
  **改写值不能带尾斜杠**（2026-10-30 release 实测）：`https://www.twitch.tv/` → 403、
  `https://www.twitch.tv` → 200 —— Origin 的语法里没有路径段，早先带斜杠的版本在 dev
  永远测不出来（CDN 根本不校验 dev 的 Origin）。规则在 `resolve/media-referrer.ts`
  的 `XHR_ORIGIN_RULES`，Rust `media_referer.rs` 同步执行。
- **huya HLS 只认播放器 UA**（2026-10-30 实测）：manifest 与分片对浏览器 UA 回 403
  `text/html`，带 HYSDK UA 才 200（Referer/Origin 有无都不影响，响应带 `ACAO:*`）。
  `User-Agent` 是 forbidden header（hls.js 设不了），所以同样由 Rust 按
  `XHR_UA_RULES`（`hls.huya.com`）在 XHR/FETCH 上改写；`flv.huya.com` 不需要。
- hls.js fatal 错误必须上报 **Error 实例**（带 `type/details/HTTP code/URL`）。直接传 hls 的
  `ErrorData` 对象会让 UI 显示 `[object Object]`，丢掉全部上下文。

## 自动播放

- **带声自动播放**：`unlockAudioPlayback()` 必须在**用户手势的同步调用栈内**调（不能挪进
  effect）。原生 mp4 分支要**等 `canplay` 再带声 play** —— src 刚设立即 play 媒体未加载，
  易被 policy 判断失败而降级静音。
- ⚠️ desktop 若自定义 `additionalBrowserArgs`（Windows）会**覆盖** wry 默认 args，必须显式
  带上 `--autoplay-policy=no-user-gesture-required`，否则带声播放回归静音。
- ⚠️ 切流/切档时 `video` 元素复用（`useRef`），**保留用户当前静音态**；无条件写
  `muted=!autoPlay` 会把切档/下一条的声音强行打开。

## 播放器外壳

- ⚠️ **player 包方角（产品决定，非待补样式）**：`VideoShell`/`PlayerControls`/`PlayableMedia`
  **都不带 border-radius** —— 常见播放器都是满幅方角设计。曾经三处各写死一档
  （`rounded-xl`/`rounded-b-lg`/`rounded`）互相错位，且给画面套圆角本就不符合播放器惯例。
  播放器内嵌到任意容器都不该假定圆角档位。

## 听视频（audio-only DASH，2026-10-28）

「听视频」= 对 `kind=video` 条目只播 DASH 音轨（B站/YouTube 音视频分离），当播客听。

- **实现位置全在 player/desktop 侧，零协议改动**：音轨 URL 本来就在每档流的
  `dashManifest` 里（resolve `utils/mpd.ts` 的 buildMpd 给每档嵌同一条最高码率 AAC）。
  `audioOnlyMpd()`（`player/src/utils/audioOnlyMpd.ts`）把选流的 MPD 剥掉 video
  AdaptationSet，仍走 dash.js + DashHostLoader 隧道。dash.js 的 `attachView` 收
  `HTMLMediaElement`，直接挂 `<audio>`（已真播实证：起播/推进/时长/隧道 headers 全过）。
- **入口收口**：URL `/play/:itemId?mode=listen`；`usePlayerNav.onListen` 是唯一入口
  （卡片封面右下的音符钮 + 播放页「只听声音/看视频」切换都经它/`usePlayNavigate`）。
- **选流契约不动**：仍取 `streams[0]`（各档 MPD 剥完音轨相同，听的模式下不渲染档位条）。
- **回退**：MPD 剥不出音轨（如 bili durl 回退的混合轨 mp4）→ `listenMode` 不成立，
  照常播视频，不报错。
- **进度共享**：听/看与观看共用同一个续播键（`savePosition`）；听⇄看切换是**换媒体元素**，
  `PlayableMedia` 会把最后的 `currentTime` 带到新元素（否则又从头播）。队列自动下一条
  透传当前模式。

## 音频播放页（播客单集 / 听视频，2026-10-29）

`AudioShell` 是音频条目与听视频共用的**播放面卡片**（原型 podplay 的落地形态）：

| 区块 | 内容 |
| --- | --- |
| 顶部 | 封面 190px + 「正在播放 · 播客单集/仅音频」+ 标题 + 节目名 + 日期/时长/平台 |
| 声纹频谱 | `controls/WaveformSeek.tsx`：确定性伪波形（FNV-1a 指纹 → 四正弦 × 拱形包络），已播段 accent、播放头竖线 + 圆点；点击/拖动 seek，`role="slider"` 键盘可达 |
| 时间 | 当前 / `-剩余` |
| 控件 | −15 / 66px 主键 / +30；倍速、睡眠定时；右侧是宿主给的次要动作（听⇄看、下一条、打开原文） |
| 右栏（desktop 组装） | 章节（有数据才出现）+ 播放队列 + 来自同一订阅（按当前条目往后数，查 `known` 覆盖预览单集）；简介在**播放器下方** |
| 迷你条 | 播客单集的会话级播放器（`views/player/audio-session.ts`）：离开播放页继续播，底部浮条可暂停/回页/关闭。视频会话的浮层形态见下节 |

- **波形不进 React state**：rAF 直接读 `mediaRef.currentTime`，暂停时靠 `timeupdate` 重画一帧
  —— 4Hz 的 state 会让条形一顿一顿地跳。`prefers-reduced-motion` 下只画静态帧。
- **配色走主题 token**（带深色回退值）：pod-stage 是内容卡片，浅色主题下是浅底；与
  「视频舞台恒黑 + 方角」是两套契约，别把方角规则套到这张卡上。
- **数据来源边界**：标题/封面/简介/时长全部来自条目本身；播放器包不认识数据模型，
  这些由宿主经 `audioStage` 透传。
- **章节数据通路（2026-10-29）**：`biliClient.viewPoints`（`/x/player/v2` 的
  `view_points`，非 wbi、匿名可读）→ `resolveBiliVideoPlay` 随流一起返回 →
  `ResolveResult` / `ResolvePlayback.chapters` → `PlayableMedia.onChapters` →
  播放页右栏 + 波形刻度，点击走 `onMediaControl.seek`。**没有章节的条目一律缺省**
  （播客 RSS、喜马拉雅单集、YouTube 都不带），右栏那一栏不渲染。
- **会话级播放器（两个，同构）**：播客单集走 `audio-session.ts`（模块级 `<audio>` 挂 body，
  播放页与迷你条是它的两个控制面，`AudioShell` 因此有 `ownElement=false`）；视频/直播/听视频
  走 `video-session.ts` + `VideoSessionStage`（见下节）。两会话互斥（任一路起播先暂停另一路）、
  播完自动下一条统一在 `session-queue.ts`。
- **不自造媒体状态机**：state/ops 复用 `useVideoElement`、键盘复用 `useContainerInteractions`
  （音频页 ←/→ = −15/+30）；听模式能否真剥音轨由播放器 `onAudioOnlyChange` 回报，
  剥不动（durl 混合轨）时页面按视频版式。
- **刻意不做**：节目笔记（单集简介就是它）。

## 视频会话与小窗（路由切走不打断，2026-10-31）

视频/直播（含听视频）的整条播放栈（解析/引擎/弹幕/控件）常驻 App 层：`VideoSessionStage`
经 `createPortal` 把 `PlayableMedia` 渲染进**模块级 host div**（React 树外，同 audio-session
的元素常驻思路），host 的**父容器**由 `video-session.moveHost` 命令式 `appendChild` 移动——
播放页插槽（`VideoStageSlot`）↔ 右下小窗（画面模式）↔ 隐藏 home（听模式，`<audio>` 不受
display:none 影响、音频照播）。同文档移动 DOM 不中断 MSE 播放，引擎零感知（hls/dash/flv
attach 的是元素本身；DanmakuLayer 随 host 移动，弹幕连接跨路由保持）。

- **纪律**：host 永不由 React 直接渲染（否则父链 reconcile 会把节点搬走）；移动走 `moveHost`
  单入口（幂等 + 移动前退出全屏）；插槽注册必须 `useLayoutEffect`（passive cleanup 晚于
  DOM 移除，会把 host 带进死树）；home 容器永在 DOM（保 `useMediaStream` 的
  `video.isConnected` 起播守卫）。
- **浮层判据**：`item && started && params.itemId !== item.id`（对齐迷你条）；从未起播的会话
  离页 3s 后自动 close（不飘占位小窗；StrictMode 的模拟卸载在同一帧重新注册，会取消它）。
- **浮层形态**：画面模式 = host + 帧 chrome（播放/静音/✕ + 透明点击层单击回页，顺带挡掉
  VideoShell 的 hover 控件——小窗不需要整条 PlayerControls）；听模式 = 复用 `.mp-*` 的右下
  卡片。z-index 38（与迷你条同层、低于浮层令牌），`bottom: calc(var(--sp-4) + 68px)` 让位
  迷你条（两浮层同显不叠）。live/错误态原样出现在 host 内（错误块可重试，不自动关闭）。
- **播完自动下一条（两会话统一，`session-queue.ts`）**：在播放页 → 导航下一条（URL 权威）；
  浮层态 → 会话内换条目**不导航**（用户在浏览别处，跳页 = 抢走视图；回页
  `playTo(会话条目)` 天然对齐 URL）；只续**同族**（audio→audio / video·live→video·live）。
  ⚠️ 先取 next 再出队（出队后 indexOf 恒 -1，next 永远取不到）。
- **互斥对称**：任一路 `play` 先暂停另一路（video host 的捕获监听 / audio-session 的
  playInterceptor 注入）——开新会话与浮层恢复播放两条路径都覆盖，两路声音永不叠加。
- **ShortVideoView 互斥**：进短视频视图一次性 pause 视频会话（短视频自带声自动播；它本身
  刻意「卸载即停」不入会话）。
- **player 包边界**：`PlayableMedia` 不感知会话——唯一改动是 `onMediaControl` 载荷扩展
  （`{seek}` → `{seek, togglePlay, pause, toggleMute}`，浮层控件需要）。
- **刻意不做**：小窗拖动（第一版固定右下）；OS 级 Picture-in-Picture API；ShortVideoView
  并入会话（见 `ShortVideoView.tsx` 头注释）。

## 统计信息（仿 YouTube 右键）

`VideoShell` 右键菜单 → `PlayerStatsOverlay`（`packages/player/src/PlayerStatsOverlay.tsx`）。
字段：引擎 / 档位 / 清晰度 / 当前与源分辨率 / 帧率 / 丢帧 / 缓冲健康 / 直播延迟 / 编解码器 /
音轨 / 音量 / 播放速率 / 宿主隧道 / 网络活动。

- 引擎侧（档位、码率、`CODECS`、hls.js `latency`）由 `useMediaStream` 的 `onStats` 上报
  （HLS `LEVEL_LOADED`、DASH `STREAM_INITIALIZED`）；点播时 `hls.latency` 为 0 → 不显示
  直播延迟（2026-10-21 修）。
- 元素侧每 500ms 读 `<video>`（`getVideoPlaybackQuality`，帧率用相邻采样的总帧差）。
- 宿主侧取 `appHost.net.governorStats()` 的 `lastLatency` 与 `network` —— governor 在
  `governedHttp` 入口统一计时/累计流量（含 L0 与媒体分片，覆盖 Rust 隧道/浏览器 fetch）。
- 纯格式化逻辑在 `packages/player/src/stats.ts`（node 自检 `player-stats.check.ts`）。
