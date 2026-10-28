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
  - `playlist.ttvnw.net`（Twitch）→ **只设 `config.pLoader`**（分片仍走浏览器 XHR）。
  ⚠️ **Twitch playlist 在 true release 下会 403**（2026-10-21 实测）：只有
  `playlist.ttvnw.net` 对 `Origin: http://tauri.localhost` 回 **403**（dev 的
  `http://localhost:1420` 恰好放行）；分片域 `*.cloudfront.hls.ttvnw.net` 带 `ACAO:*`、
  直连 206 正常（把分片也塞进隧道反而 `fragParsingError`）。现象：dev 正常、release 里
  Twitch 黑屏，错误 `hls networkError manifestLoadError`。**改 loader 条件后必须在 release
  里复验**（dev 掩盖这条 Origin 差异）。
  ⚠️ `pLoader` 的类型是 `Loader<PlaylistLoaderContext>`，与 `HlsHostLoader` 不完全兼容，
  需 `as unknown as typeof hls.config.pLoader` 收窄（运行时同一套 url/headers/range）。
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
