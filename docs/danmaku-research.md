# 弹幕(Danmaku)获取机制研究报告

> 2026-08-13 实测 + dart_simple_live 源码对照 + 第三方库调研。

## 结论先行

- **首个落地平台 = B站视频弹幕**(HTTP,零长连接,匿名可用)——契合「懒解析 + HTTP 隧道」架构。
- **第二落地平台 = YouTube 直播间实时聊天**(HTTP POST 轮询 + continuation token,匿名,无 quota)。**是唯一不用 WebSocket 的直播弹幕**,走现有 `appHost.http` 隧道(POST 已支持),优先级高于四个 WS 平台。
- 其余直播弹幕全是 WebSocket 长连接(bilibili/douyu/huya/douyin),统一走 **`appHost.ws`**(Rust `ws_connect` 隧道可带自定义 header;CLI/example = node `ws` 包带 header;未注入兜底原生 WS)。douyin 握手校验 UA/Cookie/Origin 完整性(残缺 cookie 417、陈旧 ttwid 415 DEVICE_BLOCKED),原生 WS 带不了 header,**必须隧道**;bili live/douyu/huya 原生无 header 可连,顺带统一接入。
- **渲染:自研 + Canvas 2D**。B站高级弹幕(mode 7)**暂不支持**,降级普通滚动(mode 1–6 全覆盖)。
- **时间单位坑**:seg.so proto 的 `progress` 是**毫秒**,XML 弹幕是**秒**,播放器 `currentTime` 是秒;YouTube live chat 的 `timestampUsec` 是**微秒**。
- ✅ **落地状态(2026-09 复核)**:B站视频弹幕 + YouTube live chat + 四平台 WS 直播弹幕(bili live/douyu/huya/douyin)+ player `DanmakuLayer`(Canvas)已端到端实现。接口统一为 `DanmakuPlayable.getDanmaku(id) → DanmakuStream`(订阅即开始,全量/增量由实现方定):crawler 能力接口 → core `resolvePlay/resolveLivePlay` 探测 `isDanmakuPlayable` 后附带 `ResolvePlayback.danmaku`(无独立 `openDanmaku` 门面)→ player `DanmakuLayer` 内部订阅分流;desktop `ExpandedPlayer` 零弹幕逻辑。四平台 channel 的 getSource 返回 `& DanmakuPlayable`。实测开播房间全收弹幕(bili 43/8 条、douyu 7/6 条、huya 29/29 条、douyin 40/92 条)。**剩余**:desktop 实机验证 Rust ws_connect 隧道 + 渲染。tsc crawler/player/core/desktop 全绿。

## 一、B站视频弹幕(主链路,已实测)

```
bvid → GET /x/web-interface/view?bvid= → data.cid(匿名,复用 client.resolveCid)
     → GET /x/v2/dm/web/seg.so?type=1&oid={cid}&segment_index={n}
         返回 protobuf DmSegMobileReply(707B 实测,含首条弹幕)
```

- 每段 **6 分钟**(360s),`segment_index` 从 1 起,段数 = `ceil(durationSec/360) + 1`。
- **匿名 200,无需 cookie/wbi**。2023 后有 wbi 版 `/x/v2/dm/wbi/web/seg.so`(带 `pid={aid}`),实测无签名也放行(软风控),稳妥做法带 `DEFAULT_BILIBILI_COOKIE`。
- 备选 XML:`comment.bilibili.com/{cid}.xml`(gzip,`inflateRawSync`,匿名,整包)。

### DanmakuElem proto 字段
| 字段 | 说明 |
|---|---|
| progress | 出现位置,**毫秒** |
| mode | 1/2/3 滚动,4 底,5 顶,6 逆向,7 高级 |
| fontsize | 字号(默认 25) |
| color | 十进制 ARGB(int → hex) |
| midHash | 发送者 8 位 hash |
| content | 弹幕正文 |
| pool | 0 普通 / 1 字幕 / 2 特殊 |

## 二、YouTube 直播实时聊天(HTTP 轮询,重点新增)

**不是 WebSocket**。走 InnerTube `live_chat/get_live_chat` **continuation 轮询**——POST + 拿下一 token,和页面评论/订阅流同一套机制。零 OAuth、零 API key、零 Data API quota,匿名即可(等价匿名浏览器访问直播间页面)。

### 完整链路

```
1. 抓直播间页面 https://www.youtube.com/live/{videoId}(或 watch?v=)
   ├─ ytcfg.set({...})      → INNERTUBE_API_KEY(YouTube 自己的公开 web key,每个访客都收到)
   │                          + INNERTUBE_CONTEXT(web client 版本 + visitorData)
   └─ ytInitialData = {...}  → contents.twoColumnWatchNextResults.conversationBar
                                  .liveChatRenderer.continuations[0].reloadContinuationData.continuation
                                  = 初始 continuation token(首次)
2. POST https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key={INNERTUBE_API_KEY}
   body = {"context": INNERTUBE_CONTEXT, "continuation": "<token>",
           "currentPlayerState": {"playerOffsetMs": "<播放偏移>"}}   ← yt-dlp 有,对齐时间轴用
3. 响应 JSON:continuationContents.liveChatContinuation
   ├─ actions[]  → 每条 addChatItemAction.item.liveChatTextMessageRenderer
   │     authorName.simpleText / timestampUsec(微秒) / message.runs[]
   │        runs[]: {text} 纯文本 run,或 {emoji:{emojiId, image}} 表情 run(自定义表情带 image.thumbnails url)
   └─ continuations[0] → 下一 token(timedContinuationData 或 invalidationContinuationData,带 timeoutMs)
4. sleep(timeoutMs)(服务端建议,通常 ~5s)再回第 2 步
5. 响应无 continuation = 直播结束
```

### 关键决策点

- **top chat vs live chat**:直播间页面默认 Top chat(算法过滤子集)。要**全量**弹幕,初始 token 应从页面 viewSelector 的 `SortFilterSubMenuRenderer.subMenuItems[1]`(通常为 Live chat 项)取,而非默认项(yt_chat.go 实证取 `[1]`;语义按 YT 菜单序,未显式标名)。yt-dlp 走 `liveChatRenderer.continuations[0]` 起始 + 后续轮询;chat-downloader 类库提供显式选择。
- **直播回放**:换 `get_live_chat_replay` 端点 + `https://www.youtube.com/live_chat_replay?continuation=` 页面(yt-dlp `youtube_live_chat_replay` protocol 实现完整:逐段 `replayChatItemAction.actions` + `videoOffsetTimeMsec` 定位)。
- **鉴权一致性**:轮询 body 保持同一 `INNERTUBE_CONTEXT`(visitorData 不变) + 后续轮询带 `context.clickTracking.clickTrackingParams`(来自上一响应),yt-dlp `generate_api_headers` 干这事。anonymous visitor 即可,极端风控再带 cookie。
- **轮询频率**:以服务端 timeoutMs 为准;第三方库默认 1s,但太快易触发限流,保守用服务端建议。
- **落地**:`crawler/src/channels/youtube/live-chat.ts` 的 `createLiveChatPoller(liveId)`(提取 ytcfg/ytInitialData → 递归 POST 轮询 → poll/unsubscribe)。⚠️ ytcfg 用**对象形式 marker `ytcfg.set({`**(页面顶部有单 key 调用 `ytcfg.set('KEY', value)` 会错位)。
- 断线续传 = 拿最后 continuation 重轮询;消息统一成 `DanmakuItem`(见 §五)进弹幕层即可。
- 已知实现全走同一链路可对照:yt-dlp `youtube_live_chat.py`(live + replay 最全)、`chat-downloader`(xenova)、`@miukyo/ytlc`、`chatterino-yt-chat`、`youtube-chat-next`、`yt_live_chat`(Go)。

### 与现有 youtube channel 的关系

crawler 的 youtube channel 走 **ANDROID_VR** client(gapis `youtubei.googleapis.com`)拿直链;live chat 是**另一套**:`www.youtube.com` web client 的 InnerTube。两者共享 `liveId`(ANDROID_VR 直播解析可得),但 context/api key 各取各的。页面内嵌 JSON(`ytcfg.set` / `ytInitialData`)用 **`extractInlineJson`**(平衡括号截取,嵌套深不截断)提取,不用正则。

## 三、各直播平台弹幕协议(dart_simple_live 源码实证)

除 YouTube 外全部 WS 长连接 + 定时心跳,统一 `interface/live_danmaku.dart`。

| 平台 | 端点 | 鉴权 | 心跳 | 封包 | 弹幕字段 |
|---|---|---|---|---|---|
| bilibili 直播 | `wss://{host}/sub`(getDanmuInfo 给 host+token) | wbi 签名,可带 cookie | 60s | 16B 大端头 + brotli/zlib | op5 `cmd=DANMU_MSG` → `info[1]` |
| douyu | `wss://danmuproxy.douyu.com:8506` | **无**(WS,拉流才需 cryptojs) | 45s | 12B 小端头 + STT 文本 | `chatmsg` → `txt` |
| huya | `wss://cdnws.api.huya.com` | **无** | 60s 固定字节 | **Tars**(非 protobuf) | uri1400 → `HYMessage.content` |
| douyin | `wss://webcast100-ws-web-lf...`(webcast3/5 已废弃) | **get_sign 签名**(弹幕专属,非 ABogus)+ cookie | 10s | protobuf PushFrame + gzip | `WebcastChatMessage.content` |

### bilibili 直播(最值得做)

前置:`GET https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id={realRoomId}`(**wbi 签名**,复用 `client.signWeb`),roomId 用 **realRoomId**(直播解析已归一)→ `data.token` + `data.host_list[].host`(取其一,host 带端口,常见 2245)。**匿名可用**(2026-09 实测),无需登录 cookie。

```
offset 0  (4B) 总包长 = bodyLen+16
offset 4  (2B) 头长=16
offset 6  (2B) 协议版本 0=JSON / 1=人气 / 2=zlib / 3=brotli
offset 8  (4B) op:2 心跳 / 3 心跳回(人气) / 5 通知 / 7 认证进房 / 8 进房回
offset 12 (4B) 序号=1
offset 16 body
```

- 进房 op=7:见 §四「bili live 坑」(protover/buvid/uid);心跳 op=2 空串(60s),op=3 心跳回 body 前 4B 是人气值。
- op=5 通知:protover **2 → zlib 解压** / **3 → brotli 解压** → utf8 → 按 `[\x00-\x1f]+` 切分 → 逐条 JSON。
- `cmd=DANMU_MSG` → **`info[1]`=文本**,`info[2][1]`=用户名,`info[0][3]`=颜色(十进制 ARGB int)。`cmd=SUPER_CHAT_MESSAGE` → `data.*`(price/message/user_info.uname)。
- 解码库:zlib 浏览器/Node 都有;brotli 浏览器 `DecompressionStream("br")`、Node `zlib.brotliDecompressSync`。

### douyu

```
offset 0  (4B) fullMsgLength(小端)= 4+4+bodyLen+1
offset 4  (4B) fullMsgLength2(同值)
offset 8  (2B) packType(小端):client→server=689,server→client=690
offset 10 (1B) encrypted=0
offset 11 (1B) reserved=0
offset 12 body(定长字符串)…末尾 0x00
```

- 进房:`type@=loginreq/roomid@={roomId}/` + `type@=joingroup/rid@={roomId}/gid@=-9999/`;心跳 `type@=mrkl/`(45s)。
- body 是 **STT 文本**:`k@=v/k2@=v2/`,`@S`→`/`、`@A`→`@` 转义,`//` 分隔数组。
- `type@=chatmsg` → `nn@=` 用户名、`txt@=` 文本、`col@=` **斗鱼专属 6 色索引**(1–6 → 红/蓝/绿/橙/紫/粉,非真 hex)。无鉴权、文本格式,落地成本低。

### huya

- Tars 二进制编解码(专用 tag/长度前缀格式,非 protobuf),需移植 Tars codec(~200 行)或引 tars 库。
- 进房:`TarsOutputStream` 拼 `wscmd{tag0=1, tag1=进房数据}`,进房数据 `{ayyuid, true, "", "", topSid, subSid, 0, 0}`(参数来自直播流解析的页面数据,与 `buildAntiCode` 同源);心跳固定字节(base64 `ABQdAAwsNgBM`,60s)。
- 消息:读 tag0=type,==7 时读 tag1 bytes → `HYPushMessage{pushType, uri, msg, protocolType}`。
  - `uri=1400` 弹幕 → `HYMessage{userInfo: HYSender{nickName,...}, content, bulletFormat: HYBulletFormat{fontColor,...}}` → nickName/content/fontColor(`0xRRGGBB`);
  - `uri=8006` 在线数(消息体 tag0 int)。

### douyin

- 前置参数:roomId(长号)+ userId + webRid + cookie + **弹幕专属签名**(DouyinSign,独立于播放的 a_bogus——另一套混淆 JS)。
- WS query:`app_name/version_code/webcast_sdk_version/compress=gzip/room_id/user_unique_id/...&signature={sign}`;headers 带 UA/Cookie/Origin `https://live.douyin.com`。**主域名 `webcast100-ws-web-lf.douyin.com`(webcast3/5 已废弃)**。
- 封包 protobuf:
```
PushFrame{seqId=1, logId=2, service=3, method=4, headersList=5, payloadEncoding=6, payloadType=7, payload=8}
   payloadType="hb"=心跳/进房、"ack"=回执
   → payload 是 gzip 压缩的 Response
        Response{needAck=9, internalExt=5, messagesList=1[]}
          → messages[i].method == "WebcastChatMessage" → ChatMessage{user.nickName=2, content=3}
```
- 进房/心跳都发 `PushFrame{payloadType="hb"}`(10s);`needAck=true` 时回 ack frame(⚠️ dart `sendAck` 有 bug,见 §四)。
- 最重:protobuf 解码 + 弹幕签名(10724 行混淆 JS)+ cookie,三样缺一不可。

## 四、数据获取落地建议

### 优先级排序(按架构契合度)

1. **B站视频弹幕**——HTTP,零依赖,MVP 首选。`resolveCid` + `getJson`,ui `<DanmakuLayer>` 用 `currentTime*1000` 对 `progress` 做时间窗口过滤。protobuf 解码抄 kindred-web ~40 行手写 wire 解码,或引 protobufjs。
2. **YouTube 直播聊天**——HTTP POST 轮询 + JSON,匿名,走现有隧道,零 WS。提取 ytcfg/ytInitialData → 轮询 get_live_chat,按 timeoutMs 拉增量。**页面 JSON 提取用 `extractInlineJson`,不用正则。**
3. **bilibili 直播弹幕**——WS,但协议最规整:16B 头 + JSON + brotli(有库),`getDanmuInfo` 复用 `signWeb`。唯一门槛是 WS。
4. **douyu**——WS 无鉴权 + STT 纯文本解析,成本低;STT 解析 + 6 色表映射。
5. **huya**——WS + Tars 编解码,需移植 Tars codec(**四平台中唯一无现成编解码器**,一次性基础设施 ~200 行;协议本身简单)。
6. **douyin**——WS + protobuf + 弹幕签名 + cookie,最重,最后考虑。

### WS 决策(影响 3–6 全部)

- ✅ **实测(probe-ws)**:浏览器原生 WS(标准 API,无自定义 header)直接连——bili live(`wss://{host}/sub` op=7)收到 op=3 心跳回**可行**;douyu(8506 + loginreq/joingroup)收到 loginres(690 帧)**可行**;huya(cdnws.api.huya.com)握手成功**可行**;douyin(极简 URL 无签名)握手被拒 → **签名必须**。
- 结论:**原生 WS 覆盖 bili live/douyu/huya**(bili 直播 WS 连接本身不需 header,cookie 只影响 getDanmuInfo 前置);douyin 握手校验 Cookie 完整性(残缺 417、陈旧 415 DEVICE_BLOCKED)+ 签名 → 原生 WS 必然失败。
- ✅ **Rust `ws_connect` 隧道**:`apps/src-tauri/src/commands/ws.rs`(tokio-tungstenite,握手前注入 UA/Cookie/Origin header)→ `appHost.ws` 门面。`createWsStream` 统一走 `appHost.ws`(desktop=TauriWsBackend / CLI+example=node ws 包带 header / 未注入兜底原生 WS)。**douyin 唯一必需**,bili/douyu/huya 顺带统一接入。

### 四平台实现要点与 ⚠️ 坑

通用 WS 封装 `danmaku/ws.ts`(`createWsStream`):onopen 发认证帧 → onmessage 解码成批 `onItems` → onclose/onerror 指数退避重连(保留房号)→ 返回退订(close + 清 timer)。**四平台差异只在帧编解码**;弹幕不带 `timeMs` → 渲染层自动走 live 实时追加,player/core/desktop 零改动。

1. **bili live**(`danmaku-live.ts`)⚠️ 认证 op=7 帧:`{"uid":<nav mid,匿名为 0>,"roomid":realRoomId,"protover":2,"buvid":<buvid3>,"platform":"web","type":2,"key":token}`。`buvid` = cookie 有则取 cookie 的 buvid3,否则**必须**取匿名指纹 `/x/frontend/finger/spi` 的 b3——**留空会被拒连**(2026-09 根因:此前误记为「匿名被 1006 拒」)。⚠️ 发 `protover:2` 时服务器回 **zlib + 明文**帧,无 brotli;**Bun 的 `DecompressionStream("br")` 不支持**(仅 deflate),故不请求 3。归一:`cmd=DANMU_MSG` → `text=info[1]`、`user=info[2][1]`、`color=intColorToHex(info[0][3])`;`SUPER_CHAT_MESSAGE` 同 chat(带边框由渲染层后续加)。
2. **douyu**(`danmaku.ts`)⚠️ 心跳 45s 不能省(断连限流);**STT 转义漏一处即解析错乱,写单测**。归一:`text=txt@=`、`user=nn@=`、`color=DOUYU_COLORS[col@=]`(6 色索引表)。
3. **huya**(`danmaku.ts` + `tars.ts`)⚠️ 成本大头在 **Tars codec 必须移植**(约 200 行),协议本身简单;进房参数依赖页面数据,房间解析必须先通。归一:`text=content`、`user=nickName`、`color=fontColor(0xRRGGBB → #RRGGBB)`。
4. **douyin**(`danmaku.ts` + `msdk-sign.ts` + `douyin-proto.ts`)⚠️ 坑最多:
   - **签名脚本版本是根因(2026)**:dart 2023 提取的 kWebMsSDK(入口 `getMSSDKSignature`,1.0.0.53)已被服务端风控(415 DEVICE_BLOCKED);必须用 douyinLive(2026 维护)的 **2024-06-21 修改版 webmssdk.js**(入口 `get_sign`),`webcast_sdk_version` 用 **1.0.15**(dart 的 1.3.0 已失效)。`getMsStub` = `md5("live_id=1,aid=6383,version_code=180800,webcast_sdk_version=1.0.15,room_id={roomId},sub_room_id=,sub_channel_id=,did_rule=3,user_unique_id={userId},device_platform=web,device_type=,ac=,identity=audience")`;signature = `appHost.js.call(WEBMSSDK_ENV + kWebMsSDK, "get_sign", [msStub])`。**host 层 JS 在 Rust/Node 执行,无浏览器 CSP 限制**;含 `-` 或 `=` 的 signature 需**重新生成重试**。
   - **执行环境两个硬约束**:**遮蔽 node 特有全局**(`process`/`Buffer`/`global` 等;webmssdk 检测到 process 走 node 分支,产出服务端拒的指纹);window 必须**完整挂载**(navigator/screen/document)。每次执行前清 `window.byted_acrawler`(首次执行污染全局,二次被短路)。
   - **UA 分工**:enter 接口用 **QQBrowser** UA(Chrome 150 返空 body 200 len0),WS 签名/握手用 **Chrome 150** UA。
   - **连接必走 `appHost.ws`**(Rust ws_connect 带 header);浏览器原生 WS 带不了 header,握手必败。
   - ⚠️ dart `sendAck` 有 bug:`payloadType` 先设 `'ack'` 又被 `internalExt` 覆盖——标准 ack 应 `payloadType="ack"` + `payload=internalExt`,勿照抄。
   - 归一:`text=content`、`user=nickName`(颜色固定白,dart 未解析)。

**实机验证待办**:node 侧四平台弹幕端到端已通;剩余 desktop(`bun run tauri dev`)实测 Rust ws_connect 隧道 + DanmakuLayer 渲染(B站视频按 seek/滚动窗口过滤、YouTube live chat 实时追加)。

## 五、dart_simple_live 统一消息模型(数据契约参考)

dart 侧四个平台弹幕全部归一成 `LiveMessage`,是 `DanmakuItem` 设计的直接参考(`simple_live_core/lib/src/model/live_message.dart`):

```dart
enum LiveMessageType { chat, gift, online, superChat }
class LiveMessage {
  LiveMessageType type;   // chat=弹幕 / online=人气值(data 携带) / superChat=醒目留言
  String userName;
  String message;
  dynamic data;           // type=online 时为人气值
  LiveMessageColor color; // RGB
}
class LiveMessageColor {
  // numberToColor(int):十进制 ARGB → RGB hex
  //   4 位补 "00";6 位直取;8 位跳过前 2 位(alpha)取 RGB
}
```

- **颜色归一规律**(跨平台统一 `#RRGGBB`):B站 `info[0][3]`(ARGB 十进制)、huya `fontColor`(`0xRRGGBB`)、douyu `col`(**专属 6 色索引**,需独立映射表)。
- **superChat**(醒目留言):B站 `SUPER_CHAT_MESSAGE` → price/message/user_info;dart 用 `LiveSuperChatMessage` 单独建模(带背景色/时段)。MVP 可只显示为带边框的高亮弹幕。

### 我们的 `DanmakuItem`(crawler 定义,对齐 LiveMessage + VOD 时间戳)

```ts
interface DanmakuItem {
  text: string
  user?: string            // 直播聊天必填;视频弹幕可无
  color?: string           // #RRGGBB(crawler 各平台归一;douyu 走 6 色映射)
  timeMs?: number          // VOD 绝对位置,毫秒;live 实时追加可省
  mode?: number            // B站视频专属:1滚动/4底/5顶/6逆向/7高级(VOD 渲染用)
}

/** 统一弹幕流:订阅即开始,返回退订函数。全量(VOD,带 timeMs)/增量(live)由实现方定。 */
type DanmakuStream = (onItems: (items: DanmakuItem[]) => void) => () => void

/** 能力接口(source 上,`isDanmakuPlayable` = `"getDanmaku" in s` 探测)。
 *  id:视频 = itemId / 直播 = roomId。 */
interface DanmakuPlayable { getDanmaku(id: string): DanmakuStream }
```

- **类型全放 crawler**(解析产物 + 消费接口同源):依赖方向 `xml ← crawler ← core ← player`,放 crawler 无环,player 直接 `import type`。
- **为什么单接口统一**:消费者只管「订阅弹幕」,**不关心返回多少条**。全量/增量只体现在 items 是否带 `timeMs`——有则播放器按时间轴窗口发射,无则实时追加。VOD/live 是媒体属性,不该做成两个接口。

## 六、player 弹幕接入方案

### 架构位置:三层职责

```
crawler(数据)  →  core(编排)  →  player(渲染)
getDanmaku(id)   resolvePlay/resolveLivePlay   DanmakuLayer
DanmakuStream    返回 ResolvePlayback.danmaku   (内部订阅分流)
                 (探测 isDanmakuPlayable 附带)
```

player 保持**平台无感**:只消费统一 `DanmakuStream`。弹幕探测收敛进 core(与播放流同一解析结果,`ResolvePlayback.danmaku` 附带),无弹幕 channel → `danmaku: undefined` → VideoShell 不渲染层(零开销);无独立 `openDanmaku` 门面。

App 层(desktop `ExpandedPlayer`)零弹幕逻辑,只传 resolve:
```ts
const resolve = item.kind === "live" ? () => resolveLivePlay(item.roomId) : () => resolvePlay(item.id)
<PlayableMedia streams={initialStream} resolve={resolve} autoResolve />
```

### player 内部

**`danmaku/DanmakuLayer.tsx`** — 渲染层(见 §七),**内部订阅 stream 并分流**(数据层 hook 已并入,无独立 useDanmaku):
- 有 `timeMs` → 累积全量池,按 `currentTime×1000` 窗口发射(`(prevT, currentT]` 新增,小预取 `PRE_MS` 提前进右缘);seek 回跳 >5s 重置起点,已发射 `timeMs` 集合跳过不重发。
- 无 `timeMs` → 实时追加(live 增量)。
- 暂停冻结:`paused && !live`(点播暂停弹幕停;直播暂停聊天照收——聊天不受播放暂停影响)。
- 渲染:rAF 自绘循环,React 只负责「新弹幕进队列」,画面更新全在 canvas。

**`VideoShell.tsx`** — 加 `danmaku?: DanmakuStream`:
```tsx
// video 之后、spinner 之前:
{danmaku && <DanmakuLayer stream={danmaku} currentTime={state.currentTime} live={state.live} paused={state.paused} />}
```
relative 容器(16:9 自撑)正是覆盖层载体;`useVideoElement.state` 已提供 `currentTime`(秒)/ `live` / `paused`——**零新增状态源**。**`PlayableMedia.tsx`** 把 `resolved?.danmaku` 透传给 VideoShell(仅视频分支;音频无画面不接)。

### 决策点

| 点 | 建议 |
|---|---|
| 时间单位 | `timeMs` 统一毫秒(`currentTime` 秒 ×1000);crawler 侧归一 YouTube `timestampUsec`(微秒)/B站 `progress`(毫秒) |
| Live 对齐 | YouTube live chat 是「当前时刻」轮询,实时追加即可,**不与播放时间轴对齐**(DVR setLiveEdge 不回溯聊天) |
| 颜色 | 各平台 crawler 侧归一为 `#RRGGBB`(复用 dart `numberToColor` 逻辑;douyu 独立 6 色表) |
| superChat | MVP 显示为带边框高亮弹幕(不单独建模型) |
| 依赖 | player 加 `@tauri-playground/crawler`(类型引用,无运行时耦合) |

## 七、弹幕渲染选型

### 结论:自研 + Canvas 2D,高级弹幕(mode 7)暂不支持

### 1. 第三方库 vs 自己实现 → **自研**

| 候选 | 问题 |
|---|---|
| DPlayer / ArtPlayer | 完整播放器,会替代整个自研播放器(controls 是自写 MediaChrome 式)——不可行 |
| danmaku.js 等纯弹幕库 | 绑死库的 API/生命周期,与「窄接口 state/ops」风格冲突;canvas 自绘难定制 |
| 自研 DanmakuLayer | 符合项目范式(播放器/控件全自研、零重依赖);弹幕渲染是成熟模式(~250 行) |

弹幕层是纯展示(输入 `DanmakuItem[]`,输出画面),无平台逻辑、无协议耦合——自研成本低且完全可控。

### 2. HTML / Canvas / WebGL → **Canvas 2D**

| | HTML(DOM) | Canvas 2D | WebGL |
|---|---|---|---|
| 同屏性能 | ~50 条内流畅,再上 GC/排版压力 | 几百条流畅 | 最强 |
| 轨迹/防重叠 | 需逐条改 transform,React 高频重渲染 | 数组遍历自绘,轨道算法好写 | 同 canvas |
| 文本清晰度 | 浏览器排版天然锐利 | 需按 devicePixelRatio 缩放 | 需离屏位图化文本 |
| 开发成本 | 低 | 中(~250 行) | 高(文本纹理复杂) |

**选 Canvas 2D 的理由**:
- **直播密度是真实场景**:明确要接 YouTube 直播聊天(热门直播间同屏 30–100 条、高速追加)——DOM 在临界,且 React 每帧 setState 重渲染几百节点成本高;
- 防重叠轨道算法在 canvas 就是「轨道占用表 + 每条右端位置追踪」,比 DOM transform 清晰得多;
- 高分屏清晰度:canvas 按 `devicePixelRatio` 缩放即可,文本锐利;
- 业界主流:DPlayer、danmaku.js 全用 canvas。

**WebGL 不选**:弹幕是大量短文本、实时更新,文本必须位图化(离屏 canvas 画字 → 纹理上传),实现复杂、收益小。

### 3. 高级弹幕(mode 7)→ **暂不支持,降级普通滚动**

- seg.so `DanmakuElem.mode`:1/2/3 滚动、4 底、5 顶、6 逆向、7 高级。**1–6 全支持**(顶/底=静态居中停留 ~4s;逆向=反向滚动),**mode 7 忽略高级 payload,按普通滚动渲染保文本**。
- 理由:
  - 比例(量级估计,非实测):B站视频弹幕 99% 滚动,顶/底 ~2%,高级弹幕 <0.1%——投入产出不成立;
  - mode 7 需解析独立的 advanced 弹幕结构(定位/样式/图片弹幕),与 mode 字段是两套数据;
  - 直播弹幕根本没有高级弹幕概念(普通文本),不阻塞主场景。
- 降级保文本:用户看到内容只是无特殊样式,可接受;后续需要再加。

### 4. 渲染器设计(贴合 player 架构)

```
DanmakuLayer (canvas 2D)
├─ requestAnimationFrame 自绘循环(不依赖 React state 每帧)
├─ 轨道分配:固定行数(视频区 1/10 行距),每条 {text, speed, right, lane}
│   新弹幕 → 找占用最短轨道(或空轨道),速度按字长等差
├─ mode 分支:滚动(1/2/3/6)匀速右→左 / 顶部(5)/ 底部(4)静态停留 ~4s
├─ DPR 缩放:canvas.width = clientWidth * devicePixelRatio,ctx.scale(dpr,dpr)
└─ 挂载:VideoShell relative 容器内 pointer-events-none absolute inset-0
```

- **不随 React 每帧渲染**:DanmakuLayer 内部订阅 `DanmakuStream` → ref 持有弹幕队列 + rAF 驱动绘制,React 只负责「新弹幕进队列」,画面更新全在 canvas 循环——canvas 方案相比 DOM 的核心优势;
- 暂停时 rAF 冻结(`paused && !live`,VOD 弹幕停住);直播照常推(聊天不受播放暂停影响)。

## 八、可复用资产

| 资产 | 路径 | 复用点 |
|---|---|---|
| `client.resolveCid` | `packages/crawler/src/channels/bili/client.ts` | bvid→cid(视频弹幕) |
| `client.getJson` | 同上 | 拉 seg.so / getDanmuInfo(带 UA/referer/cookie) |
| `client.signWeb`/`getMixinKey` | 同上 | getDanmuInfo 的 wbi 签名;弹幕接口收紧时备用 |
| HTTP 隧道(POST 支持) | `packages/host/src/tauri/` | seg.so 无 CORS;**YouTube get_live_chat 轮询** |
| **`extractInlineJson`** | `packages/crawler/src/utils/inline-json.ts` | 提取 ytcfg.set / ytInitialData(平衡括号,嵌套不截断) |
| youtube channel(ANDROID_VR) | `packages/crawler/src/channels/youtube/` | 提供 liveId(直播弹幕 + live chat 共用) |
| `DEFAULT_BILIBILI_COOKIE` | `packages/core/src/bilibili-cookie.ts` | 带登录态更稳(视频/直播弹幕) |
| 懒解析范式 | `resolveBiliPlay`(channels.ts) | 弹幕懒解析照抄(YouTube live chat 轮询起始) |
| 播放器时间 | `useVideoElement.state.currentTime` | 弹幕时间窗口(currentTime 秒 × 1000) |
| 弹幕层挂载点 | `VideoShell.tsx` relative 容器 | 加 DanmakuLayer |
| **dart 统一消息模型** | `tmp/dart_simple_live/.../model/live_message.dart` | `DanmakuItem` 字段/颜色归一直接参考(LiveMessage + numberToColor) |
