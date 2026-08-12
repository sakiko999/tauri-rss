# YouTube 视频直链提取技术方案

> 现状缺口:`youtube` channel 用官方 RSS 拿元数据(videoId/缩略图/时长)可跑通,
> 但 `resolveYoutubePlay` 只返回 `format: "web"` 的 watch URL(打开网页播放),
> **没有真实可播直链**。本文档记录从 NewPipeExtractor 逆向出的完整方案。
>
> 参考实现:`tmp/NewPipeExtractor`(`extractor/src/main/java/org/schabi/newpipe/extractor/services/youtube/`)
> 与 yt-dlp 同思路(InnerTube API + player JS 解密),是**零登录**方案的成熟参照。

## 一、总览:四条候选路径与选择

| 路径 | 方式 | 优缺点 | 结论 |
|---|---|---|---|
| **A. InnerTube player API** | `POST youtubei/v1/player` 拿 playerResponse | 官方接口,字段全;带签名/n 参数需解 JS | **推荐** |
| B. 网页 `<script src=.../player>` 解析 | 从 watch 页面挖直链 | 抗爬最弱,需额外爬页面 | 不选 |
| C. embed 页面 | `youtube.com/embed/{id}` 内嵌的 playerResponse | 精简版,依赖少 | A 的变体 |
| D. 第三方解析服务 | 现成 API(如 cobalt) | 依赖外部服务,不稳定 | 不选(个人部署) |

关键结论:YouTube 官方 RSS 与 player API **互补**——RSS 拿元数据,player API 拿直链。
两者都要,才能从「列表」到「播放」闭环。

## 二、InnerTube player API 请求

### 端点

```
POST https://www.youtube.com/youtubei/v1/player?prettyPrint=false
```

请求头:
```
User-Agent: 各 client 的 UA(见下)
X-Goog-Api-Format-Version: 2        (Android/iOS client 必需)
Referer: https://www.youtube.com/    (web client)
```

请求体(JSON,核心是 client + videoId):

```json
{
  "context": {
    "client": {
      "clientName": "ANDROID",        // 或 WEB / IOS / TVHTML5_SIMPLY_EMBEDDED_PLAYER
      "clientVersion": "19.09.37",
      "androidSdkVersion": 30,
      "hl": "en",
      "visitorData": "..."            // 必填!无则拿不到有效 playerResponse
    }
  },
  "videoId": "xxx",
  "cpn": "随机13位base64",            // content playback nonce,拼到直链后
  "contentCheckOk": true,
  "racyCheckOk": true,
  "playbackContext": {
    "contentPlaybackContext": {
      "signatureTimestamp": 19484,    // 从 player JS 的 base.js 里解析
      "referer": "https://www.youtube.com/watch?v=xxx"
    }
  }
}
```

### client 选择(NewPipe 的轮询顺序)

NewPipe 依次尝试 **android → visionOS → iOS** 三个 client 的 `streamingData`,
全部能拿到直链。关键差异:

- **WEB client**:`streamingData.formats` 的 URL **绝大多数带 `signatureCipher`**(签名混淆),
  需解析 player JS 解密;且带 `n` 参数(节流混淆)也需解。
- **ANDROID client**:URL 通常**直接带 `url` 字段无签名**,或仅带 `n` 参数——最省事。
  但 HEVC 需 `androidSdkVersion >= 24`,否则只给 H.264。
- **IOS client**:URL 无签名,带 `n` 参数;`hlsManifestUrl` 在 iOS 上才有。

> **对我们的启示**:优先 ANDROID client(直链最干净,少解一道签名),失败再 fallback
> WEB(必要时解签名)。与 bilibili 直播「avc 优先」同理——优先能播的。

### visitorData 怎么来

visitorData 是必须的,NewPipe 用 `getVisitorDataFromInnertube` 发一个初始请求拿:

```
POST https://www.youtube.com/youtubei/v1/visitor?prettyPrint=false
# body 里带 client + androidSdkVersion,拿到的 response.data.visitorData
```

这是**零登录**的——不需要 cookie/puppeteer。

## 三、playerResponse 解析 → 直链

### 结构

```
playerResponse
├── videoDetails         # id/title/thumbnail/isLiveContent/isPostLiveDvr...
├── playabilityStatus    # status: "OK" / "LOGIN_REQUIRED" / age-restricted...
├── streamingData        # ★ 直链核心
│   ├── formats          # 渐进式(音视频合一,mp4)
│   ├── adaptiveFormats  # 自适应(纯视频/纯音频,DASH)
│   ├── hlsManifestUrl   # 直播/部分视频的 HLS
│   └── dashManifestUrl  # DASH MPD(可自己拼)
└── captions             # 字幕(可选)
```

每个 format 字段:
```json
{
  "itag": 18,
  "url": "...",                // 或 cipher / signatureCipher(带签名)
  "mimeType": "video/mp4; codecs=\"avc1.64001f, mp4a.40.2\"",
  "bitrate": 1081494,
  "width": 640,
  "height": 360,
  "fps": 30,
  "quality": "medium",
  "qualityLabel": "360p",
  "initRange": { "start": "0", "end": "746" },
  "indexRange": { "start": "747", "end": "2259" },
  "contentLength": "123456",
  "audioChannels": 2,
  "audioSampleRate": "44100",
  "signatureCipher": "s=xxx&sp=sig&url=xxx"   // 或 cipher
}
```

### itag 语义(关键:ItagItem 是 YouTube 特有的格式表)

NewPipe 的 `ItagItem` 是**静态 itag → 格式映射表**(比字段推断可靠):
- `ItagType.AUDIO`(音轨):139/140/141(m4a)、249/250/251(opu)…
- `ItagType.VIDEO`(渐进式):18/22/37(mp4 音视频合一)…
- `ItagType.VIDEO_ONLY`(纯视频 DASH):160/133/134/135/136/137/299/266…

```
itagType 决定流分类:
  AUDIO       → AudioStream
  VIDEO       → VideoStream(带音轨,渐进式)
  VIDEO_ONLY  → VideoStream(isVideoOnly=true,需另配音频)
```

> **对我们的启示**:B 站直播解析已经只留 avc(参照 `parseBiliLiveStreams`),YouTube 同理——
> itag 表天然按编码分组,按 itag 选型而非 URL 后缀判断,可播性有保证。

### 签名与 n 参数(两个反爬点)

**1. `signatureCipher`(仅部分视频 + WEB client 有)**:

```
url=...&sp=sig&s=ZYXWV...      → 需要解 s
```

解密:解析 `https://www.youtube.com/s/player/{hash}/.../base.js`(从 watch 页拿),
用正则挖出解密函数(`YoutubeSignatureUtils.FUNCTION_REGEXES`,6 个候选模式匹配
`deobfuscate` 函数),再在 JS 引擎里跑:
```
streamUrl = url + "&" + sp + "=" + deobfuscate(s)
```

**2. `n` 参数(所有 HTML5 client 的 URL 都有)**:

不解 `n` → **限速 ~50KB/s 或 403**。`YoutubeThrottlingParameterUtils.getThrottlingParameterFromStreamingUrl`
从 URL 里提取 `n=xxx`,再用 player JS 里的 n 函数解密,替换回 URL。

> ⚠️ **门槛认知**:签名+n 参数都要「从 base.js 挖函数 + JS 引擎执行」。
> 两条路:
>   1. **用 ANDROID client 绕开签名**(多数视频无 signatureCipher),只剩 n 参数;
>   2. `n` 参数仍要解——yt-dlp 用 JS 引擎,我们也需要。Node 侧可用 `new Function`,
>      桌面 WebView2 同理(已有 `js` 签名执行能力,见 host 的 FunctionJsBackend)。

## 四、DASH/HLS 直链

- **HLS**:`streamingData.hlsManifestUrl`(iOS/直播才有)→ hls.js 直接播。
- **DASH**:`streamingData.dashManifestUrl`(或自拼 mpd_version=7),需要 dash.js。
  NewPipe 对 OTF/直播/post-live 强制 `DeliveryMethod.DASH`。

> **对我们的启示**:YouTube 视频如果拿到的是 **adaptiveFormats(纯视频 + 纯音频分离)**,
> 要么用 DASH(dash.js),要么**合并不了**(浏览器不能直接拼流)。
> 最省事的播法是:优先取 `formats`(渐进式 mp4 音视频合一)的**最大分辨率**那一条。
> 只有渐进式全缺时才考虑 DASH。

## 五、落地到本项目的实现路径

### 5.1 目标形态

`youtube` channel 的 `resolvePlay` 从「返回 web 页面」升级为「返回真直链」:

```ts
// packages/crawler/src/channels/youtube/ 下新增
function resolveYoutubePlay(videoId: string): Promise<Stream[]> {
  // 1. POST youtubei/v1/player (ANDROID client,零登录)
  // 2. 解析 streamingData.formats → 取渐进式 mp4 最大分辨率(带 headers: referer+UA)
  // 3. 失败 fallback: hlsManifestUrl / WEB client 解签名
}
```

### 5.2 拆文件(参照 bili/channels 的组织)

```
packages/crawler/src/channels/youtube/
  index.ts        # 现有 channel(元数据 + resolvePlay 改调 resolveYoutubePlay)
  client.ts       # InnerTubeClient: getVisitorData / getPlayerResponse / parseFormats
  itag.ts         # itag 映射表(ItagItem 的 TS 移植,精简版)
  signature.ts    # base.js 挖解密函数 + n 参数解密(需要 host.js 执行)
```

### 5.3 关键顺序

1. **先拿 ANDROID client 的渐进式 mp4**(最干净:无签名)
2. **fallback 层**:WEB client 解签名、HLS manifest、DASH(按需)
3. **itag 表**(只维护本项目需要的编码:avc/mp4a,过滤 vp9/av1 初期可不支持)

### 5.5 实测结论(2026-08 已验证,重要!)

- ✅ **ANDROID client 渐进式 mp4 直链可拿到、可直接播**:
  `resolveYoutubeStreams` 实测返回 itag 18(360p mp4 avc+mp4a),HTTP 206 + MP4 头
  `00 00 00 24`,带 referer 即可播,`dQw4w9WgXcQ` 和 3Blue1Brown `6XPlmCDNLNc` 都通。
- ⚠️ **clientVersion 是最大坑**:用过时版本(如 19.09.37 / 2.20240821.00.00)会
  **400 `Precondition check failed` 或 playability `UNPLAYABLE`**,即使视频可播。
  必须用**最新版本**(NewPipe 2026-01 的 `21.03.36` / WEB `2.20260120.01.00`)。
  **版本过旧会静默表现为「视频不可播」,排查时优先怀疑它**。
- ✅ **ANDROID client 渐进式 URL 没有独立 n 参数**(实测 URL 的 `n=` 实为 `mn=` 多播参数)——
  **无需 n 参数解密即可播**。n 解密逻辑(signature.ts)保留作 WEB fallback 兜底。
- ⚠️ **Bun 字符串转义坑**:正则里 `\(` 用字符串/模板拼接会被 Bun 吞反斜杠
  (未知转义丢 `\`),必须用正则字面量 `/.../`。已踩坑并全部改字面量。
- ✅ 节点:visitorData 端点是 `youtubei/v1/visitor_id`(不是 `visitor`),响应在
  `responseContext.visitorData`。
- ✅ **直播实现(2026-08 已实测)**:Claude Code 常驻直播间 `tRsQsTMvPNg` →
  `resolveYoutubeStreams` 返回 hls,manifest HTTP 200 + `#EXTM3U`(标准 HLS 直播流)。
  要点:
  - **判定直播**:`playabilityStatus.liveStreamability` 存在(或 `videoDetails.isLiveContent`)。
  - **ANDROID client 直播时不返回 hlsManifestUrl**——必须加 **iOS client**
    (`getIosPlayerResponse`,gapis 端点 + `&t={ts}&id={videoId}`,iOS UA
    `com.google.ios.youtube/21.03.2(iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X; en)`)。
  - iOS client 对**普通视频也返回 hlsManifestUrl**(NewPipe 注释:非 Apple client 没有 HLS)。
    所以只在 `isLiveContent=true` 时用 iOS 拿 hls;普通视频仍走渐进式 mp4。
- ⚠️ **DASH-only 直播形态(2026-08 实测)**:部分直播(如 Claude FM `tRsQsTMvPNg`
  当前形态)**iOS 不返回 hlsManifestUrl**,只给 `adaptiveFormats`(音视频分离,无渐进式)。
  此时 `resolveYoutubeStreams` 直播分支拿不到 HLS → throw → UI 降级 `format:"web"`
  (打开页面播放)。当前**不支持内嵌 DASH 播放**(需 dash.js,MSE 混流),已知边界。
  HLS 直播(主流大直播)仍正常内嵌。
- ✅ **ANDROID/WEB 端点统一走 gapis(2026-08 对齐 NewPipe)**:`getAndroidPlayerResponse`
  从 `www.youtube.com/youtubei/v1/player` 改为 `youtubei.googleapis.com/youtubei/v1/player`
  + `&t={ts}&id={videoId}`(NewPipe `YoutubeStreamHelper.java:150` 同款)。gapis 更稳,
  绕开 www.youtube.com 的地域/风控;iOS 本就同款。
- ⚠️ **node/example 环境被 YouTube IP 风控(2026-08 实测)**:`injectNodeHost` 直连时
  ANDROID/WEB/iOS 任意 client 都返回 `playabilityStatus.status = LOGIN_REQUIRED` +
  "Sign in to confirm you're not a bot"。curl 对比 gapis 与 www.youtube.com 两个端点
  **结果一致**——是出口 IP 信誉问题,不是端点选择。**youtube 可播性只能在 Tauri 设备
  环境实测**(真实 IP + webview),node 断言失败 ≠ 实现坏。NewPipe 的 poToken(bot guard)
  是解决途径,零登录无 poToken 无法绕开 node 环境的 IP 风控。

### 5.6 ANDROID/iOS client 强制 poToken(2026-08)与规避方案

> ⚠️ **重要更新(2026-08-12,含实测修正)**:2026 年起 **ANDROID / iOS 标准 client 的
> poToken 要求收紧**——部分 IP(机房/代理/风控 ASN)会触发 `LOGIN_REQUIRED`
> "Sign in to confirm you're not a bot"。⚠️ **不是所有环境都失效**:实测(2026-08-12)
> 当前 ANDROID client(`21.03.36`)对普通视频(mp4 直链)和 iOS client 对直播(hls)
> **仍可正常解析**,触发机器人检测的是**部分 IP**,非「Tauri 一律失效」。规避与溯源如下,
> 作为 **ANDROID_VR 兜底预案**(当前主 client 仍可用,无需改动)。

#### 根因:NewPipe 已移除 ANDROID/IOS client

- **NewPipeExtractor PR #1529(2026-08-06,AudricV)把 ANDROID + IOS client 整体移除**,
  注释原话 *"using them requires poTokens nobody can generate"*——ANDROID 用
  **DroidGuard**(Play Services 原生 VM,校验 app 签名/包 ID,非 root 的 reVanced 都过不了),
  iOS 用 **iosGuard**(可能依赖 Apple attestation)。两者都不是纯 HTTP/JS 能复刻的。
- **ANDROID 无 poToken 时 NewPipe 改用 reel 端点兜底**(`getAndroidReelPlayerResponse`,
  `YoutubeStreamExtractor.fetchAndroidClient`——`androidPoTokenResult == null` 走
  `reel/reel_item_watch`,Shorts 专用,非常规 player 端点)。我们项目只有常规 player 端点,
  **在受影响的 IP 上**(NewPipe 语境 ANDROID 已被强制)无 poToken 会撞 LOGIN_REQUIRED;
  但当前 21.03.36 在正常 IP 上仍可解析(见下实测)。
- 时间线:2025 年初 ANDROID 仍匿名可用(PR #1272 只是可选加 poToken 支持);
  **2025-09 起 poToken 从 visitorData 绑定改为 videoId 绑定**(yt-dlp #14471 / FreeTube #8137,
  每视频现 mint);**2026 年起 ANDROID/iOS poToken 要求收紧**(NewPipe 因无法生成而移除),
  ⚠️ **但非「全面强制」**:实测(2026-08-12)当前 ANDROID `21.03.36` + iOS 对普通视频/直播
  **仍可解析**,受影响的只是**部分 IP** 触发机器人检测。

#### 规避方案(按推荐序)

**① 换 ANDROID_VR(Oculus Quest 3)client —— 兜底预案,最小改动**

YouTube 曾长期给此 client 返回**传统 stream URL(非 SABR),无需 poToken**,多项目 2026 实测:
yt-dlp `youtube.py` 内置、[YoutubeExplode PR #936](https://github.com/Tyrrrz/YoutubeExplode/pull/936)
(2026-02,用户确认恢复下载)、[NewPipe PR #1498](https://github.com/TeamNewPipe/NewPipeExtractor/pull/1498)
(2026-05,恢复 720p/1080p+,并检测 SABR-only 响应自动 fallback)。

⚠️ **定位修正(2026-08-12)**:yt-dlp **默认不用 ANDROID_VR**——它的默认链是
`('tv', 'web', 'mweb', 'android', 'ios')`,ANDROID_VR 靠
`--extractor-args "youtube:player_client=android_vr"` **显式指定**才启用(非自动 fallback)。
YoutubeExplode/ytdown 则激进地把它当**主力/首选**。且 **ANDROID_VR 也非绝对免 token**:
yt-dlp 最新注释 *"Since 2026.07, intermittent/selective POT enforcement has been observed
for non-HLS formats"* —— non-HLS 格式也已开始选择性强制;并需 visitorData(无则 LOGIN_REQUIRED)。
**结论:作为 ANDROID 撞机器人检测时的 fallback 使用,不替换主力。**

完整常量(yt-dlp master 2026-08,clientVersion 已从 1.60.19 升到 **1.65.10**;注意
>1.65 可能返回 SABR-only):

```json
{
  "clientName": "ANDROID_VR",
  "clientVersion": "1.65.10",
  "deviceMake": "Oculus",
  "deviceModel": "Quest 3",
  "androidSdkVersion": 32,
  "osName": "Android",
  "osVersion": "12L"
}
// INNERTUBE_CONTEXT_CLIENT_NAME = 28
// UA: com.google.android.apps.youtube.vr.oculus/1.65.10
//   (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip
```

落地 = 改 `client.ts` 的 `getAndroidPlayerResponse` 常量 + ANDROID_UA,其余逻辑不变
(渐进式 mp4 优先 → HLS fallback)。已知限制:**不支持 made-for-kids 视频**(无
audio/video_only 流,可接受)。注意 AV1 itags(394-401)+ audio(599,600)需入 itag 表才能
吃到 VR 的高清流;仅用渐进式 mp4(18/22)则无感。

**② 兜底链(ANDROID_VR 万一也被封锁时)**

| client | poToken | 现状(2026-08) | 备注 |
|---|---|---|---|
| `ANDROID_VR` | 传统 URL 免;non-HLS 选择性强制 | ⚠️ 2026-07 起 intermittent | fallback;不含 made-for-kids,需 visitorData |
| `TVHTML5` / `tv` | 不需要 | ⚠️ 仍返回 URL 但格式 DRM'd | 无 cookie 全 DRM,需登录 |
| `WEB_EMBEDDED_PLAYER` | 不需要 | ⚠️ 仅可嵌入视频有效 | 换 embed 端点 |
| `WEB` / `MWEB` | 需要(GVS) | 🔒 2025-02 起锁 SABR-only | adaptiveFormats 被移除 |
| `ANDROID` / `IOS` | 必须(DroidGuard/iOSGuard) | ❌ NewPipe 已移除 | 无人能生成 |
| `web_safari` | GVS 暂不需要 | ✅ HLS 免 token | HLS 直播兜底 |

**③ 彻底方案:WebView2 内跑 BotGuard 生成 poToken(后续再议)**

Web 端 poToken 可**自托管生成**——yt-dlp 官方推荐 `bgutil-ytdlp-pot-provider`
(= [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) 跑 BotGuard challenge),但
PoTokenProvider javadoc 明确:**需「良好 DOM 的 JS 引擎」**。我们 Tauri 就是真实 WebView2,
天然满足(NewPipe 在 Android 也是用系统 WebView 生成,PR #12027 HtmlUnit 是替代)。
代价:poToken 现绑定 videoId,每视频 mint;且 @Nonnull 注入 `serviceIntegrityDimensions.poToken`。
**工程量大,仅当 ① ANDROID_VR 失效才考虑。**

#### 本项目的落地指向

- `packages/crawler/src/channels/youtube/client.ts` 当前 `getAndroidPlayerResponse` 用
  ANDROID client,实测(2026-08-12)仍可正常解析普通视频(mp4)+ 直播(iOS hls)。
  **保持 ANDROID 主力不变**;仅当某 IP 撞 LOGIN_REQUIRED(机器人检测)时,在
  `resolveYoutubeStreams` 的 fallback 链(当前 ANDROID → WEB)插入 ANDROID_VR
  (带 visitorData,常量见上)作为中间兜底。
- `resolveYoutubeStreams` 目前只取 `formats`(渐进式 mp4,最高 itag 22=720p);要 1080p+
  需扩展 adaptiveFormats + DASH 混流(与 bot 规避无关,后续迭代)。

### 5.4 依赖注入

`host.js` 已存在(`FunctionJsBackend`,`new Function` 执行 JS)——签名/n 解密天然可用。
无需 puppeteer,零登录,与 bilibili wbi 签名同级的复杂度。

## 六、参考链接

- NewPipeExtractor 实现:
  - `YoutubeStreamHelper.java` — player API 请求构造(5 个 client)
  - `YoutubeStreamExtractor.java:1130-1408` — getItags / cipher 解析 / itag 元数据
  - `YoutubeSignatureUtils.java` — base.js 挖解密函数(6 个正则候选)
  - `YoutubeThrottlingParameterUtils.java` — n 参数提取
  - `YoutubeJavaScriptPlayerManager.java` — 签名 + n 参数执行与缓存
  - `ItagItem.java` — itag → 格式/编码/清晰度映射
- 思路同源:yt-dlp(HTML5 client 解析 + JS 引擎执行)

## 七、风险

- **base.js 会变**:函数名/正则匹配需随 YouTube 更新维护(NewPipe 靠社区跟进)。
  缓解:多个正则候选 + 提取失败时回退 watch 页面/HLS。
- **visitorData 有生命周期**:过期需重新获取(每次 resolvePlay 现取即可,代价低)。
- **版权/ToS**:纯技术可行性,仅个人演示用途,不做下载/批量抓取。
