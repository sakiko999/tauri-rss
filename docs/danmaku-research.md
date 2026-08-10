# 弹幕(Danmaku)获取机制研究报告

> 2026-08-10 实测 + dart_simple_live 源码对照。为播放器弹幕层落地做准备。

## 结论先行

- **首个落地平台 = B站视频弹幕**(HTTP,零长连接,匿名可用)——完美契合「懒解析 + HTTP 隧道」架构。
- 直播弹幕全是 WebSocket 长连接,且当前 host 层(Rust)只有 HTTP 命令,需先决策 WS 方案。
- **时间单位坑**:seg.so proto 的 `progress` 是**毫秒**,XML 弹幕是**秒**;播放器 `currentTime` 是秒,换算勿混淆。

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

## 二、各直播平台弹幕协议(dart_simple_live 源码实证)

所有平台:WS 长连接 + 定时心跳,统一 `interface/live_danmaku.dart`。

| 平台 | 端点 | 鉴权 | 心跳 | 封包 | 弹幕字段 |
|---|---|---|---|---|---|
| bilibili 直播 | `wss://{host}/sub`(getDanmuInfo 给 host+token) | wbi 签名 + buvid,可带 cookie | 60s | 16B 大端头 + brotli/zlib | op5 `cmd=DANMU_MSG` → `info[1]` |
| douyu | `wss://danmuproxy.douyu.com:8506` | 无(WS),拉流才需 cryptojs | 45s | 12B 小端头 + STT 文本 | `chatmsg` → `txt` |
| huya | `wss://cdnws.api.huya.com` | 无 | 60s 固定字节 | Tars | uri1400 → `HYMessage.content` |
| douyin | `wss://webcast3-ws-web-lq...` | **QuickJS 签名**(10724 行混淆 JS)+ cookie | 10s | protobuf PushFrame+gzip | `WebcastChatMessage.content` |

### bilibili 直播封包(最值得做)
```
offset 0  (4B) 总包长 = bodyLen+16
offset 4  (2B) 头长=16
offset 6  (2B) 协议版本 0=JSON / 1=人气 / 2=zlib / 3=brotli
offset 8  (4B) op:2 心跳 / 5 通知 / 7 认证进房 / 8 进房回
offset 12 (4B) 序号=1
offset 16 body
```
认证 op=7:`{"uid","roomid","protover":3,"buvid","platform":"web","type":2,"key":getDanmuInfo.token}`
弹幕:op5 解压 → 按 `[\x00-\x1f]+` 切分 → 逐条 JSON → `cmd=DANMU_MSG` → **`info[1]`=文本**,`info[2][1]`=用户名,`info[0][3]`=颜色。

## 三、落地建议

1. **MVP(强烈建议)**:B站视频弹幕。crawler 加 `resolveDanmaku(itemId)`,复用 `client.resolveCid` + `getJson`;ui 加 `<DanmakuLayer>`,`currentTime*1000` 对 `progress` 做时间窗口过滤。protobuf 解码可抄 kindred-web `~40 行手写 wire 解码`,或引 protobufjs。
2. **直播弹幕需先决策 WS**:
   - 浏览器原生 WS:零新基础设施,但**不能设自定义 header**(cookie/UA);bilibili 直播带 cookie 受限,douyin 需 query 签名、huya/douyu 无 header 可行。
   - Rust `ws_connect` command:reqwest 不支持 WS,需引 `tokio-tungstenite`(新依赖)。
3. 弹幕层挂载点:VideoShell 的 `relative` 容器内,`pointer-events-none` 覆盖层。

## 四、可复用资产

| 资产 | 路径 | 复用点 |
|---|---|---|
| `client.resolveCid` | `packages/crawler/src/channels/bili/client.ts` | bvid→cid |
| `client.getJson` | 同上 | 拉 seg.so(带 UA/referer/cookie) |
| `client.signWeb`/`getMixinKey` | 同上 | wbi 弹幕接口收紧时备用 |
| HTTP 隧道 | `packages/host/src/tauri/` | seg.so 无 CORS |
| `DEFAULT_BILIBILI_COOKIE` | `packages/core/src/bilibili-cookie.ts` | 带登录态更稳 |
| 懒解析范式 | `resolveBiliPlay`(channels.ts) | 弹幕懒解析照抄 |
| 播放器时间 | `useVideoElement.state.currentTime` | 弹幕窗口 |
| 弹幕层挂载点 | `VideoShell.tsx` relative 容器 | 加 DanmakuLayer |

## 五、其他仓库结论

- `tmp/producer`:明确注释「danmaku surface intentionally omitted — belongs to app layer」。无代码。
- `tmp/RSSHub`:仅 B站视频弹幕 XML 路由(danmaku.ts),无直播/无 seg.so。
- `tmp/folo`:弹幕用官方 iframe 播放器,不自己拿数据。
- `tmp/NewPipeExtractor`:无 YouTube live chat 实现(YouTube 弹幕需另走 InnerTube live_chat continuation 轮询,源码未见需另调研)。
