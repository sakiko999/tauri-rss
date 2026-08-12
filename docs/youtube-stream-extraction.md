# YouTube 视频/直播直链提取方案

> 现状(2026-08-12):`youtube`/`youtube:live` channel 已打通真实可播直链——
> **视频走 DASH 1080p(自拼 MPD, dash.js 合成)、直播走 HLS(自带 1080p)**。
> 本文档记录从 NewPipeExtractor 逆向出的 InnerTube player API 方案 + 本项目落地。
>
> 参考实现:`tmp/NewPipeExtractor`(`extractor/src/main/java/org/schabi/newpipe/extractor/services/youtube/`)
> 与 yt-dlp 同思路(InnerTube API + player JS 解密),是**零登录**方案的成熟参照。

## 一、总览:候选路径与选择

| 路径 | 方式 | 优缺点 | 结论 |
|---|---|---|---|
| **A. InnerTube player API** | `POST youtubei/v1/player` 拿 playerResponse | 官方接口,字段全;带签名/n 参数需解 JS | **采用** |
| B. 网页 `<script src=.../player>` 解析 | 从 watch 页面挖直链 | 抗爬最弱,需额外爬页面 | 不选 |
| C. embed 页面 | `youtube.com/embed/{id}` 内嵌的 playerResponse | 精简版,依赖少 | A 的变体 |
| D. 第三方解析服务 | 现成 API(如 cobalt) | 依赖外部服务,不稳定 | 不选(个人部署) |

关键结论:YouTube 官方 RSS 与 player API **互补**——RSS 拿元数据,player API 拿直链。
两者都要,才能从「列表」到「播放」闭环。

## 二、InnerTube player API 请求

### 端点

```
POST https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false&t={ts}&id={videoId}
# gapis 更稳(绕开 www.youtube.com 的地域/风控),NewPipe 同款。t/id 参数 gapis 必需。
# visitor_id 端点走 www:POST https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false
```

请求头:
```
User-Agent: 各 client 的 UA(见下)
X-Goog-Api-Format-Version: 2        (Android/iOS/VR client 必需)
Referer: https://www.youtube.com/    (web client)
```

请求体(JSON,核心是 client + videoId):

```json
{
  "context": {
    "client": {
      "clientName": "ANDROID_VR",     // 或 WEB / IOS
      "clientVersion": "1.65.10",
      "deviceMake": "Oculus",
      "deviceModel": "Quest 3",
      "androidSdkVersion": 32,
      "osName": "Android",
      "osVersion": "12L",
      "hl": "en",
      "visitorData": "..."            // 必填!无则拿不到有效 playerResponse
    }
  },
  "videoId": "xxx",
  "cpn": "随机13位base64",            // content playback nonce
  "contentCheckOk": true,
  "racyCheckOk": true
}
```

### client 选择(本项目主力 + fallback)

**主力 ANDROID_VR(Oculus Quest 3)**——2026-08 起 ANDROID/IOS 标准 client 部分 IP 触发
poToken(LOGIN_REQUIRED),VR 返回免 token 直链(详见「六、poToken 与 ANDROID_VR」)。`resolveYoutubeStreams`
fallback 链 = **ANDROID_VR → WEB**(直播无 hls 再 fallback iOS)。

各 client 差异(溯源):
- **ANDROID_VR**:`formats`(渐进式)只有 itag 18(360p);`adaptiveFormats` 有 1080p+
  avc1(itag 137 等)带 initRange/indexRange;直播自带 hlsManifestUrl + dashManifestUrl。
  不支持 made-for-kids 视频(无 audio/video_only 流)。
- **WEB**:`streamingData.formats` 多数带 `signatureCipher`(签名混淆),需解;且带 `n` 参数。
- **IOS**:URL 无签名带 `n`;`hlsManifestUrl` 在 iOS 上才有(直播兜底)。

### visitorData 怎么来

visitorData 是必须的,零登录获取(不需要 cookie/puppeteer):

```
POST https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false
# body 带 client + androidSdkVersion;响应在 responseContext.visitorData
```

## 三、playerResponse 解析 → 直链

### 结构

```
playerResponse
├── videoDetails         # id/title/thumbnail/lengthSeconds/isLiveContent...
├── playabilityStatus    # status: "OK" / "LOGIN_REQUIRED" / age-restricted...
├── streamingData        # ★ 直链核心
│   ├── formats          # 渐进式(音视频合一,mp4)——仅 itag 18(360p)
│   ├── adaptiveFormats  # 自适应(纯视频/纯音频,DASH)——1080p+ 高清来源
│   ├── hlsManifestUrl   # 直播的 HLS(自带 6 档含 1080p)
│   └── dashManifestUrl  # 直播的原生 DASH MPD(VR 自带)
└── captions             # 字幕(可选)
```

每个 format 字段:
```json
{
  "itag": 137,
  "baseUrl": "...",               // adaptiveFormats 用 baseUrl;formats 用 url(或 cipher/signatureCipher)
  "mimeType": "video/mp4; codecs=\"avc1.640028\"",
  "bitrate": 1945652,
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "qualityLabel": "1080p",
  "initRange": { "start": "0", "end": "741" },
  "indexRange": { "start": "742", "end": "893" },
  "contentLength": "10434003"
}
```

### itag 语义(关键:ItagItem 是 YouTube 特有的格式表)

NewPipe 的 `ItagItem` 是**静态 itag → 格式映射表**(比字段推断可靠):
- `ItagType.AUDIO`(音轨):139/140/141(m4a)、249/250/251(opu)…
- `ItagType.VIDEO`(渐进式):18/22/37(mp4 音视频合一)…
- `ItagType.VIDEO_ONLY`(纯视频 DASH):160/133/134/135/136/137/299/266…

> 本项目 itag 表(`channels/youtube/itag.ts`)只维护 H.264 + AAC 子集
> (avc/mp4a,过滤 vp9/av1 初期不支持),与 B 站直播解析「只留 avc」同理。

### 签名与 n 参数(两个反爬点)

**1. `signatureCipher`(仅 WEB client 的部分视频有)**:

```
url=...&sp=sig&s=ZYXWV...      → 需要解 s
```

解密:从 watch 页拿 `base.js`,用正则挖出解密函数(6 个候选模式),再在 JS 引擎里跑:
```
streamUrl = url + "&" + sp + "=" + deobfuscate(s)
```

**2. `n` 参数(HTML5 client 的 URL 有)**:

不解 `n` → **限速 ~50KB/s 或 403**。从 URL 提取 `n=xxx`,再用 player JS 的 n 函数解密
替换回 URL。`resolveFormatUrl`(client.ts)统一处理 url/签名/n 参数——每个流装配前过一遍。

> 门槛认知:签名+n 参数都要「从 base.js 挖函数 + JS 引擎执行」。ANDROID_VR 多数视频
> 无 signatureCipher、无独立 n 参数,所以是主力。n 解密(signature.ts)保留作 WEB fallback。

## 四、本项目落地:DASH 优先(视频)+ HLS(直播)

**核心决策:视频 DASH 优先,渐进式只作整体降级**。原因:ANDROID_VR 渐进式只到 360p,
1080p 一直在 adaptiveFormats;且 MediaPlayer 默认选流 `find(isProgressiveVideo)` 会优先
渐进式——若混排,默认会落 360p 违背 1080p 目标。所以 DASH 装配失败才整体 fallback 渐进式。

### 视频:DASH 自拼 MPD(1080p+ 有声)

视频 adaptiveFormats 是**音视频分离**(video_only + audio),每个 format 带
`initRange`/`indexRange`/`contentLength`(如 itag 137: init 0-741 / idx 742-893),
与 B 站 DASH 完全同构 → 用 `buildMpd`(共享 `packages/crawler/src/utils/mpd.ts`,
从 bili 抽出)拼 SegmentBase MPD,存 `stream.dashManifest`,`format:"dash"` 由 dash.js
双 SourceBuffer 合成播放(等价 B 站 MSE)。

- 档位:itag 137(1080p avc1.640028)/136(720p)/135(480p)/134(360p)/133(240p)/160(144p),
  音频 itag 140(mp4a.40.2)。
- **每档 MPD 只含该档 video + 公共最高音轨** → dash.js 天然锁档,无 ABR 降档。
  切档时按 rate(height)换流,不重发请求。
- 返回 Stream[]:高度降序,默认 `streams[0]` = 1080p。
- URL 装配统一过 `resolveFormatUrl`(解 n/签名);失败跳过该档。

### 直播:HLS(自带 1080p,无需改动)

`resolveYoutubeStreams` 直播分支返回 `format:"hls"` → hls.js。master manifest 自带
**6 档 144/240/360/480/720/1080p**(itag 96 = 1080p),`useHls.ts` `currentLevel=max`
锁最高档 → **直播实际播 1080p**。

✅ **新发现:ANDROID_VR 直播自带 `dashManifestUrl`(原生 MPD)**——将来想用 dash.js 播
直播可直接 `attachSource(dashManifestUrl)` 走原生 MPD,不须自拼。目前 hls.js 已覆盖
且正常,属可选增强。

### 视频 DASH vs 直播 DASH —— 两条路不同

| 维度 | 视频 | 直播 |
|---|---|---|
| 渐进式 | itag 18(360p) | 无 |
| HLS | 无 | ✅ 有(含 1080p) |
| 原生 dashManifestUrl | no | ✅ YES(可选增强) |
| adaptive 是否带 initRange | ✅ 是(自拼 MPD) | 否(分段流,无 Range) |
| 当前播放 | **DASH 1080p(dash.js)** | **HLS 1080p(hls.js)** |

## 五、实测坑(2026-08,重要!)

- ⚠️ **clientVersion 是最大坑**:用过时版本会 **400 `Precondition check failed` 或
  playability `UNPLAYABLE`**,即使视频可播。**版本过旧会静默表现为「视频不可播」,
  排查时优先怀疑它**。当前 ANDROID_VR 用 `1.65.10`(yt-dlp master 2026-08);>1.65 可能
  返回 SABR-only,需随 yt-dlp 更新。
- ✅ **渐进式分辨率实测修正**:ANDROID 21.03.36 与 ANDROID_VR 的 `formats`(渐进式)
  **都只有 itag 18(360p)**——**itag 22(720p 渐进式)两个 client 都不返回**。1080p 一直
  在 adaptiveFormats,旧代码只取 formats 所以 360p 封顶(现已 DASH 优先)。
- ⚠️ **Bun 字符串转义坑**:正则里 `\(` 用字符串/模板拼接会被 Bun 吞反斜杠(未知转义丢
  `\`),必须用正则字面量 `/.../`。已踩坑并全部改字面量。
- ✅ 节点:visitorData 端点是 `youtubei/v1/visitor_id`(不是 `visitor`),响应在
  `responseContext.visitorData`。
- ⚠️ **poToken 风控是「部分 IP」特性,与运行环境无关**:触发 `LOGIN_REQUIRED` "Sign in
  to confirm you're not a bot" 的是**出口 IP 信誉/风控 ASN**(与 node/tauri/browser
  无关)。开发机三种环境均正常抓取;另一台机器被风控正是切 ANDROID_VR 的动因。
  **youtube 可播性断言:同一 IP 下 node / tauri / browser 结果一致,node 断言失败 ≠
  实现坏,先确认当前 IP 是否被控**。

## 六、poToken 与 ANDROID_VR(2026-08 溯源与兜底)

### 根因:NewPipe 已移除 ANDROID/IOS client

- **NewPipeExtractor PR #1529(2026-08-06)把 ANDROID + IOS client 整体移除**,注释原话
  *"using them requires poTokens nobody can generate"*——ANDROID 用 **DroidGuard**
  (Play Services 原生 VM,校验 app 签名/包 ID),iOS 用 **iosGuard**。都不是纯 HTTP/JS
  能复刻的。
- 时间线:2025 年初 ANDROID 仍匿名可用;**2025-09 起 poToken 从 visitorData 绑定改为
  videoId 绑定**(每视频现 mint);**2026 年起 ANDROID/iOS poToken 要求收紧**,但非
  「全面强制」——受影响的只是**部分 IP**。

### 规避:ANDROID_VR 主力(已落地)

- YouTube 长期给 ANDROID_VR 返回**传统 stream URL(非 SABR),无需 poToken**,多项目
  2026 实测(yt-dlp 内置、YoutubeExplode/NewPipe 恢复 720p/1080p+)。
- ⚠️ yt-dlp **默认不用 ANDROID_VR**(靠 `--extractor-args "youtube:player_client=android_vr"`
  显式指定);YoutubeExplode/ytdown 则当主力。且 **VR 也非绝对免 token**:2026-07 起
  non-HLS 格式已开始选择性强制,并需 visitorData(无则 LOGIN_REQUIRED)。
- **本项目结论(2026-08-12 已落地,`92de21a`):本机被风控 → 直接切 ANDROID_VR 为主力**。
  ⚠️ 非永久保险——保持 fallback 链(VR 失败 → WEB;直播无 hls → iOS)与 clientVersion
  跟随更新,VR 万一也被封锁时再上彻底方案。

完整常量(yt-dlp master 2026-08,clientVersion `1.65.10`;>1.65 可能 SABR-only):

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

注意 AV1 itags(394-401)+ audio(599,600)需入 itag 表才能吃到 VR 的高清流;当前 DASH
装配只吃 avc1(137/136 等),AV1 高清留作未来。

### 兜底链(ANDROID_VR 万一也被封锁时)

| client | poToken | 现状(2026-08) | 备注 |
|---|---|---|---|
| `ANDROID_VR` | 传统 URL 免;non-HLS 选择性强制 | ⚠️ 2026-07 起 intermittent | 主力;不含 made-for-kids,需 visitorData |
| `TVHTML5` / `tv` | 不需要 | ⚠️ 仍返回 URL 但格式 DRM'd | 无 cookie 全 DRM,需登录 |
| `WEB_EMBEDDED_PLAYER` | 不需要 | ⚠️ 仅可嵌入视频有效 | 换 embed 端点 |
| `WEB` / `MWEB` | 需要(GVS) | 🔒 2025-02 起锁 SABR-only | adaptiveFormats 被移除 |
| `ANDROID` / `IOS` | 必须(DroidGuard/iOSGuard) | ❌ NewPipe 已移除 | 无人能生成 |
| `web_safari` | GVS 暂不需要 | ✅ HLS 免 token | HLS 直播兜底 |

### 彻底方案:WebView2 内跑 BotGuard 生成 poToken(后续再议)

Web 端 poToken 可**自托管生成**——yt-dlp 官方推荐 `bgutil-ytdlp-pot-provider`
(= [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) 跑 BotGuard challenge),但需
「良好 DOM 的 JS 引擎」——Tauri 就是真实 WebView2,天然满足。代价:poToken 现绑定
videoId,每视频 mint;注入 `serviceIntegrityDimensions.poToken`。**工程量大,仅当
ANDROID_VR 失效才考虑。**

## 七、实现位置(代码对照)

```
packages/crawler/src/channels/youtube/
  index.ts        # youtube / youtube:live channel(fetch 元数据 + resolvePlay/resolveLivePlay)
  client.ts       # InnerTubeClient: getVisitorData / 三 client player / resolveYoutubeStreams
  itag.ts         # itag 映射表(H.264/AAC 子集)
  signature.ts    # base.js 挖解密函数 + n 参数解密(host.js 执行)
packages/crawler/src/utils/mpd.ts   # 共享 MPD 装配器(从 bili 抽出,bili/youtube 共用)
```

- `resolveYoutubeStreams`:直播 → HLS;视频 → DASH(adaptiveFormats 拼 MPD)→ 渐进式 360p
  → HLS(罕见 VOD)→ throw。
- player 侧:useHls.ts `isDashStream` → dash.js + DashHostLoader(透传 stream.headers,
  分片 Range 走 appHost.http 隧道无 CORS);hls.js `HlsHostLoader`(googlevideo 无 CORS)。

## 八、参考链接

- NewPipeExtractor 实现:
  - `YoutubeStreamHelper.java` — player API 请求构造(多 client)
  - `YoutubeStreamExtractor.java` — getItags / cipher 解析 / itag 元数据
  - `YoutubeSignatureUtils.java` — base.js 挖解密函数
  - `YoutubeThrottlingParameterUtils.java` — n 参数提取
  - `YoutubeJavaScriptPlayerManager.java` — 签名 + n 参数执行与缓存
  - `ItagItem.java` — itag → 格式/编码/清晰度映射
- 思路同源:yt-dlp(HTML5 client 解析 + JS 引擎执行)

## 九、风险

- **base.js 会变**:函数名/正则匹配需随 YouTube 更新维护(NewPipe 靠社区跟进)。
  缓解:多个正则候选 + 提取失败时回退 watch 页面/HLS。
- **clientVersion 会变**:>1.65 可能 SABR-only(adaptive 无 baseUrl)→ DASH 装配失败 →
  降级渐进式 360p / throw。需随 yt-dlp 更新。
- **visitorData 有生命周期**:过期需重新获取(每次 resolvePlay 现取即可,代价低)。
- **baseUrl 签名/n 参数过期**:分片 URL 带签名,过期即 403。缓解:每次播放现取(不缓存
  进 refresh,与 B站同构)。
- **版权/ToS**:纯技术可行性,仅个人演示用途,不做下载/批量抓取。
