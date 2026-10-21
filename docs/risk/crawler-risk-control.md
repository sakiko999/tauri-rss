# Crawler 风控防御与 LX 被动采集

> 2026-10-19 调研。范围：crawler 请求治理的分级模型、集中式 governor、
> LX 浏览器被动采集的可行性与 CDP 工具选型。
> **状态**：窗口模式（§3.9）、governor（§2.7）、渠道 `passive` 属性与 xhs/bili 被动采集
> （§3.7 / §3.8）已落地；平台等级支持「全局默认 + 平台覆盖」。

## 0. 结论

1. **单点治理**：所有出站请求由一个 `NetworkGovernor` 统一准入；不按 API/媒体/图片/浏览器拆成多个管理器。
2. **等级只保留一条轴**：`L0`（无限制）、`L1`（并发/RPM + 基础冷却）、`L2` / `L3`（更紧配额）。缓存优先、浏览器优先不再作为等级；**浏览器被动采集是渠道属性 `passive`**，不是等级（原 L9，2026-10-21 移除）。
3. **限流对象是“会触发平台风控的 API 调用”**，不是字节流。媒体分片与图片不按 RPM/冷却，只共享全局并发。
4. **LX = 浏览器作为唯一请求发起者**：禁止应用构造的 API 调用与页面内自定义 `fetch()`；允许导航、滚动、点击等页面自然产生的请求。
5. **不引入运行时 CDP 库**：沿用现有 Rust `ws` 隧道 + 手写 JSON-RPC，只补事件分发、session 与响应体生命周期；`devtools-protocol` 仅作 devDependency 类型。

## 1. 现状（代码事实）

### 1.1 请求通路

| 通路 | 位置 | 备注 |
| --- | --- | --- |
| 常规 HTTP 便捷层 | `packages/resolve/src/host.ts:15-41`（`httpGet/httpText/httpJson`） | 多数渠道的汇合点 |
| 平台 client | `platform/{bili,weibo,douyin,douyu,xhs,youtube}/client.ts` | 最终调 `appHost.http.request` |
| 直接调 `appHost.http` | `utils/img-size.ts:103`、`player/engines/hlsHostLoader.ts:53`、`player/engines/dashHostLoader.ts:92`、`ui/.../MediaImage.tsx:81`、`bili/danmaku-vod.ts:20`、各扫码登录 | 绕过便捷层，限流必须放在 host 后端 |
| 页面内自定义 fetch | `resolve/src/browser/cdp.ts:67` | `Runtime.evaluate("fetch(...)")` |
| 页面自然请求 | `cdpNavigate` / 滚动 / 点击（`browser/cdp.ts:118`、`xhs/user.ts:195-260`） | LX 允许，见 §3.1 |
| 弹幕 WS | `resolve/src/danmaku/stream.ts` → `appHost.ws` | 已有指数退避 + 抖动 |
| 浏览器 / 媒体 / 图片 | 原生 `<img>`、原生 mp4、部分 HLS | 不经过 `appHost.http`，host 层理论上覆盖不到 |

### 1.2 刷新与缓存

- `refreshAll` 对全部订阅无界 `Promise.allSettled`（`apps/desktop/src/store/actions/data.ts:134-145`）。
- 同订阅串行、跨订阅并行（`packages/core/src/data-layer.ts:316-341`）。
- 无周期性后台刷新：只有启动、手动、新建订阅触发。
- TTL 缓存命中零网络（`data-layer.ts:237-257`）；`force=true` 完全绕过 TTL。
- `loadMore`、`previewChannel`、热搜、详情补全、播放解析均无 TTL/配额。
- 一次 `fetch()` 可能扇出多个 HTTP（bili 多房间、weibo 长文 + 每图 Range）。

### 1.3 浏览器

- Crawler 使用独立 Edge profile，端口固定 9223（`apps/src-tauri/src/commands/browser.rs:46`）。
- release 下窗口隐藏、移屏外、禁图（`browser.rs:209-240,387`）。
- `BrowserBackend` 只连 `/json/list` 的第一个 page；事件帧被丢弃（`packages/host/src/tauri/browser-backend.ts:87-152`）。
- 现有浏览器抓取都是主动导航/页面内 fetch，属于 §3.1 的 ①②。

## 2. 集中式 governor

### 2.1 单一流水线

```text
所有经过 appHost.http 的请求
        │
   classify(url, metadata)        ← 唯一权威：平台 + 是否计量
        │
   dedupe（仅计量请求）
        │
   global 并发额度（全部请求共享）
        │
   ┌────┴─────────────┐
计量（平台 API）        不计量（媒体/图片/本地 CDP）
RPM + 最小间隔 + 冷却     跳过 RPM/冷却
   └────┬─────────────┘
        │
     执行 → 状态码/信号 → 更新同一个冷却账本
```

- 一个 governor、一份 `NetPolicy`、一份 `governor:state`。
- 平台由 URL host 自动推导；调用方可选传 `policy: { platform?, metered?, dedupeKey? }` 覆盖。
- 缓存命中不经过 governor，天然不扣配额。

### 2.2 计量分类

**计量**：平台 API / 签名接口 / 搜索 / 详情 / 播放解析 / 弹幕元信息。

**不计量**：

- **媒体分片**：签名的 CDN 地址，播放器自身已调度并发与缓冲；host 只设全局连接并发上限（建议 6～8），不扣平台配额。
- **图片**：`MediaImage` 已有 in-flight 合并 + blob LRU；有效手段是 URL 去重、缓存、dataSaver，并发上限建议 4。
- 本地 CDP `/json/list`、外部 feed 之外的非目标域。

⚠️ 原生 `<img>`、原生 mp4、部分 HLS 根本不经过 `appHost.http`，不要假设 governor 能管住全部媒体流量。

### 2.3 冷却账本（简化版）

```ts
// governor:state
{ cooldowns: { [platform]: { until: number, reason: string } } }
```

规则：

1. 只对计量 API 生效；媒体/图片/本地 CDP 不读写冷却。
2. 只有显式信号写冷却（429/Retry-After、412/403/418、平台风控码如 `-352/-509/4031/300011/432`）；超时、5xx、空 body、DNS 失败**一律不写**。
3. 冷却按平台整体生效，不做 endpoint 粒度。
4. 到期即恢复，不做 half-open 探测；冷却期内重复失败只刷新 `reason`，不叠加时间。

被否决的复杂账本（不作为实现目标）：置信度、`hits`、endpoint scope、`suspect/half_open/auth_required` 状态机、审计环。理由：个人桌面工具收益低、维护成本高。

### 2.4 等级

| 等级 | 行为 |
| --- | --- |
| L0（`0`） | governor 直通（仅调试） |
| L1（`1`） | 入门：并发 / RPM / 最小间隔的**基准配额** |
| L2（`2`） | 标准：并发/RPM ×0.5、最小间隔 ×2 |
| L3（`3`） | 严格：并发/RPM ×0.25、最小间隔 ×4 |

⚠️ **没有「浏览器被动」等级**（原 L9，2026-10-21 移除）：把它做成平台/渠道等级会让
该平台完全看不到内容（只读缓存），属于过度防御；「谁发起请求」改为渠道属性
`RssChannel.passive`。存量 `9` / `"lx"` 在 settings-repo 归一化为 `1`（被动渠道不受
影响 —— 属性优先）。

**等级是「全局默认 + 平台覆盖 + `"*"` 兜底」**（`AppSettings.netLevel` + `netLevels`）。
现实里各平台不该用同一档：B站/YouTube 的匿名 API 稳定，保持 L1 更可靠。

⚠️ **被动采集是渠道自身属性**（`RssChannel.passive`，2026-10-21）：
`xhs:explore` 的登录/匿名正常路径都是导航 + 读页面 SSR（`fetchPassive`），所以声明
`passive`。⚠️ `xhs:user` **刻意不声明**：匿名 profile SSR 会抹空 noteId，必须走页面内
`fetch`（登录态 `fetch()` 内部仍是导航 + 读 SSR）。设置页对被动渠道只显示「浏览器被动」
标签、不给下拉。有 `appHost.browser` 时只调 `fetchPassive`；没有浏览器（移动端/CLI）
回落主动抓取（否则会永远只剩缓存）。

解析顺序（防御等级）：

```
平台覆盖 → "*"（兜底覆盖，对未精确列出的平台同样生效）→ 全局默认
```

设置页只暴露「默认等级」与「平台覆盖」表（`Network.tsx` 的 `PLATFORM_ROWS`：
小红书 / B站 / 微博 / 抖音 / 斗鱼 / 虎牙 / YouTube / Twitch / Apple 播客 / `"*"`）。
粒度停在平台：账号风控、冷却与并发/RPM 都是平台维度，按订阅拆没有可执行语义。

**RSS 直链怎么办**：`"*"` 是它们的等级档。宿主对未知 host 按 **host 各自**建平台桶
（`platformOf` 返回 host 名），所以配额/冷却天然按 feed 互不干扰；等级统一吃 `"*"`
（或全局）。不需要、也没有为每个 feed 单列一行 —— 订阅地址是任意的，逐 host 列只会是噪声。

⚠️ 兼容：旧版允许 `netLevels[channelKey]`（旧 UI 的渠道覆盖）。DataLayer 启动时
`foldChannelLevels` 把它们折叠成平台键（L0 优先 / 1~3 取严格 / 被动渠道的键丢弃），
之后只写平台键；`syncNetPolicy` 仍会兜底折叠尚未迁移的写入。
改设置后**立即**同步，不等下一次 refresh —— `loadMore` / 详情补全 / 播放解析都不经过
`doRefresh` 的同步点，否则会出现「改了等级但下一次翻页仍按旧档」。

正交开关（不占等级）：

- **后台自动刷新**：关闭后启动/新建订阅不自动抓，只允许手动刷新。
- **每平台传输策略**：`auto` / `browser-only`；browser-only 不减少请求，只是换通道。

被否决的等级：缓存优先（本应用没有周期后台刷新，收益小，且更像新鲜度策略）、浏览器优先（不减少请求，不是“更保守”的等级）。

### 2.5 配置

```ts
netPolicy: {
  level: 0 | 1 | 2 | 3,             // 全局默认(不含 9)
  levels: { xhs: 3, "*": 1 },       // 平台覆盖(整表替换,0~3)
  global: { maxConcurrent: 32 },
  platforms: {                      // L1 基准;L2/L3 按等级缩放
    bili:   { maxConcurrent: 12, rpm: 600, minIntervalMs: 50, cooldownBaseMs: 600_000 },
    douyin: { maxConcurrent: 8,  rpm: 300, minIntervalMs: 50, cooldownBaseMs: 300_000 },
    // xhs / weibo / youtube / apple ...
  }
}
```

平台配额初值（**L1 基准 = 只兜极端情况的软限制**；L2 = ×0.5 / 间隔 ×2，
L3 = ×0.25 / 间隔 ×4。正常刷新/搜索/详情/解析不应感到排队。推导依据见 §3.12）：

| 平台 | 并发 | RPM | 最小间隔 | 冷却 |
| --- | --- | --- | --- | --- |
| B站 | 12 | 600 | 50ms | -352/-509 30min，412 15min |
| 抖音 | 8 | 300 | 50ms | 4031/2483 30min + 登录 |
| 小红书 | 8 | 300 | 50ms | verify-box/300011 60min |
| 微博 | 8 | 300 | 50ms | 432 10min；-100/418/403 30min |
| YouTube | 12 | 600 | 50ms | 429 15min |
| Apple 播客 | 8 | 300 | 50ms | 基础 5min |
| 通用 RSS / 其它 | 8/host | 300 | 50ms | 基础 5min |

全局并发上限 `32`（媒体/图片共享，不扣平台 RPM）。

### 2.6 落点

| 改动 | 位置 |
| --- | --- |
| governor（桶/信号量/冷却/去重） | 新增 `packages/host/src/net/governor.ts` |
| 全局包装 | `packages/host/src/runtime.ts` 的 `appHost.http` 注入处 |
| 请求元数据 | `global.d.ts` 的 `HttpRequest` 增加可选 `policy` |
| 平台风控分类 | 各平台 client 的 `getJson/httpText`，命中后调 `reportRisk` |
| 等级闸门 | `packages/core/src/data-layer.ts:238-260`（缓存/TTL 之后、发请求之前） |
| 编排并发 | `apps/desktop/src/store/actions/data.ts:134-145` |
| 浏览器节流 | `packages/resolve/src/browser/cdp.ts:23-28` 的 `withBrowserLock` |
| 配置 | `packages/core/src/types/settings.ts` + `DEFAULT_SETTINGS` |
| 冷却持久化 | `packages/core/src/repo/governor-repo.ts`（新增，KV `governor:*`） |

### 2.7 落地状态（2026-10-19）

已实现，自检 `bun packages/host/src/example/governor.check.ts`（分类 / L0 直通 /
平台覆盖 / 去重 / 冷却 / 等级分档 / 并发上限）：

| 能力 | 位置 / 说明 |
| --- | --- |
| NetworkGovernor | `packages/host/src/net/governor.ts`：`classifyRequest` → 冷却 → 去重 → 平台并发 / 最小间隔 / RPM → 全局并发 |
| 全局包装 | `runtime.ts` 的 `setHostCaps` 用 `governedHttp(caps.http)` 包住注入后端；`appHost.net` 恒可用（CLI/浏览器宿主也有） |
| 请求元数据 | `global.d.ts` 的 `HttpRequest.policy?: { platform?, metered?, dedupeKey? }` |
| 播放分片 | `hlsHostLoader` / `dashHostLoader` 显式传 `policy: { metered: false }`，不靠 host/扩展名猜（原生 mp4/`<img>` 不经 `appHost.http`，仍在治理之外） |
| 平台配额 | L1 软限制：bili/youtube 12/600/50ms，其它平台 8/300/50ms；未知 host 一 host 一桶 8/300/50。L2 = ×0.5 / 间隔 ×2，L3 = ×0.25 / 间隔 ×4。全局并发 32 |
| 等级 | **全局默认 + 平台覆盖 + `"*"` 兜底**：`AppSettings.netLevel` + `netLevels`；host 的 `levelFor(platform)` 只认精确平台 → `"*"` → 全局。旧 channelKey 键启动时折叠（`foldChannelLevels`） |
| 冷却 | `reportRisk(platform, signal)`；计量请求返回 412/418/403/429 时自动写；`governor:cooldowns` best-effort 持久化 |
| 浏览器闸门 | `net.browserGate(platform)`：CDP 操作入口的冷却 + 最小间隔 + 抖动（CDP 不经 `governedHttp`）；登录流程显式绕过冷却 |
| 等级与开关 | `AppSettings.netLevel / netLevels / autoRefresh` + 设置页「网络与风控」（全局默认 + 平台覆盖表） |
| 被动属性 | `RssChannel.passive`（crawler channel 级，core 投影 `ChannelInfo.passive`；目前仅 `xhs:explore`）；有浏览器时只调 `fetchPassive`，无浏览器回落主动抓取 |
| 被动闸门 | `packages/core/src/data-layer.ts` 的 `doRefresh`：`autoRefresh=false` 且非 force 只读缓存；渠道 `passive` 且有浏览器时只调 `fetchPassive()`，**绝不回退 `fetch()`** |
| 风控信号 | bili 412/-352/-509、weibo 418/403/432/-100、douyin 4031/2483、youtube 429、xhs verify-box/300011 |

与设计稿的差异：

- 配额直接写在 `governor.ts` 的 `DEFAULT_NET_POLICY`，**没有**单独的 `governor-repo.ts`；
  冷却账本用一个 KV `governor:cooldowns`。运行期改配额走 `appHost.net.configure`。
- `reportRisk` 的「只对计量生效」按**平台名**判断（localhost / 已知媒体 CDN 忽略），
  显式调用不会因 URL 未知而丢失。
- **未实现** §2.4 的每平台传输策略 `auto / browser-only`；CDP 内部流量不经过
  `governedHttp`。2026-10-19 补了一道显式闸门：xhs/weibo 的浏览器操作在
  `withBrowserMode(browser, mode, fn, platform)` 入口调 `net.browserGate(platform)`
  （平台冷却 + 最小间隔 600ms~2.4s + 0~400ms 抖动，字符串与 HTTP 冷却一致）。
  ⚠️ **登录流程不要传 platform**：冷却期正是用户需要重新扫码自救的时候，登录只走
  `withBrowserLock` 串行，不被冷却拦住。登录用 `withScanLoginLock(browser, mode, run)`
  （2026-10-20）：三平台统一持锁 + `scanLoginActive`（刷新超时跳过 abortPending），
  并接受 `opts.signal` —— UI 关掉二维码弹窗即 abort，否则锁被占到 5 分钟 deadline。
  ⚠️ 窗口模式按平台选：xhs/weibo 的二维码是图片（hidden 即可），douyin 是 canvas 绘制，
  hidden 下渲染停摆画不出来，必须 interactive。
- 平台等级由 `netLevels` 覆盖（平台名 / `"*"`）；旧 channelKey 键启动时折叠成平台档
  （L0 优先、1~3 取严格、被动渠道跳过，见 §2.4）。
- 被动采集收敛 `doRefresh` + **详情补全**（2026-10-19）：`doRefresh` 对 `passive`
  渠道只调 `fetchPassive`；`resolveDetail` 同样传 `{ passive: true }`，渠道只能导航到
  详情 URL 读页面 `__INITIAL_STATE__`（不构造 fetch/API），不支持就返回 `null` →
  原样返回列表 item。`loadMore` / `previewChannel` / 播放解析仍走主动请求。
- xhs 渠道按**登录态/渠道**分流（2026-10-20）：登录 → 被动（导航 + 读 SSR / 被动捕获）；
  匿名时 `xhs:explore` 也走被动（匿名推荐流 SSR 有 feeds），`xhs:user` 才回退 fetch
  （匿名 profile 的 noteId 被抹空）。登录判据 `isXhsLoggedIn` 不看 `web_session`（游客也有）。
  `xhs:explore` 的翻页也是被动：滚动驱动、读 `feed.feeds` 增量，登录/匿名共用。
- 计量请求的 in-flight 去重按 `method + url + body` 或 `policy.dedupeKey`；媒体/图片不参与。

## 3. LX 被动采集

### 3.1 定义：按“请求由谁构造”划分

| 类别 | 例子 | LX |
| --- | --- | --- |
| ① 应用直接构造平台 API 请求 | `appHost.http` → `api.bilibili.com/...` | ❌ |
| ② 页面上下文里发自定义 fetch | `cdpFetch` / `Runtime.evaluate("fetch(...)")` | ❌（与 ① 本质相同） |
| ③ 页面自己发的请求 | 导航、点链接、滚动加载、点击后站点自己的 XHR | ✅ |

③ 的 URL、签名、cookie、时序都由页面决定，应用只导航/滚动/读取结果。
现有 `xhs:user` 的滚动驱动翻页就是雏形（`packages/crawler/src/channels/xhs/user.ts:195-260`）。

> 注意：LX 不等于“零流量”。之前“隐藏窗口没有机会产生流量”的说法只在“必须由用户手动产生流量”的版本成立；在允许应用导航/模拟操作的定义下不成立。

### 3.2 两条采集路线

| | B：读已打开页面 | A：抓网络响应 |
| --- | --- | --- |
| 做法 | `Runtime.evaluate` 读 `window.__INITIAL_STATE__` / DOM | `Network.enable` → `loadingFinished` → `getResponseBody` |
| 覆盖 | 已加载的 SSR 页面（小红书最受益） | enable 之后的新 XHR/Fetch（微博/B站/抖音） |
| 成本 | 只需 evaluate | 事件管线 + target + 缓冲 |
| 顺序 | **先做** | 后做 |

### 3.3 需要补的能力

1. ✅ 已实现：`browser_ensure(mode)` / `browser_set_mode`（hidden / interactive），实测依据与落点见 §3.9。
2. `BrowserBackend`：
   - ✅ `send(method, params, sessionId?)`（公开原始 CDP 命令；当前走 page 连接，sessionId 预留给 P2 的 browser 连接）
   - ✅ `onEvent(cb)`（分发无 id 事件帧，带 `sessionId`）
   - ⏳ `targets()` / `attachTo()`（或 browser-level `attachBrowser()`）——SW / OOPIF 才需要
   - ✅ `Network.enable` + `getResponseBody`（由 `passive/capture.ts` 封装）
3. 多 tab / Service Worker / OOPIF：browser-level WS + `Target.setDiscoverTargets` + `Target.attachToTarget({flatten:true})`；`setAutoAttach` 用 `waitForDebuggerOnStart:false`，避免冻结页面。
4. Rust 侧可选事件过滤：host 白名单、丢弃 `dataReceived`、body 大小上限，降低 base64 + IPC 压力。

### 3.4 抓取状态机

| 事件 | 处理 |
| --- | --- |
| `Network.requestWillBeSent` | 建 request 记录（URL/type/headers/requestId/sessionId）；过滤 Image/Script/Stylesheet/Font/Media/Preflight |
| `Network.responseReceived` | 记 status/mime/cache/SW；**不取 body** |
| `Network.responseReceivedExtraInfo` | 合并真实 statusCode（304/缓存）；事件顺序不固定 |
| `Network.dataReceived` | 只对已 arm streaming 的 requestId 累计，且限长 |
| `Network.loadingFinished` | 调 `getResponseBody` 或 finalize stream；入队后删除记录 |
| `Network.loadingFailed` | 清理；流式请求的 `ERR_ABORTED` 视为正常结束 |
| `Page.frameNavigated` / `Page.navigatedWithinDocument` | 文档切换 / SPA 路由 |
| `Target.targetDestroyed` / `detachedFromTarget` | 清理 target/session |

建议上限：`maxTotalBufferSize` 32–64MB、`maxResourceBufferSize` 8–10MB、单 body 应用层 2MB、body 并发 2–4、单 body 超时 10s；只抓 `XHR/Fetch/Document/EventSource` 与 JSON/XML/text MIME。

### 3.5 已知坑

| 场景 | 结论 |
| --- | --- |
| attach 前已完成的请求 | 拿不到 body；LX 必须常驻观察，或对已打开页面用路线 B 兜底 |
| 304 | `responseReceived.response.status` 可能仍报 200，真实状态看 `responseReceivedExtraInfo.statusCode`；Edge 155 实测 **`getResponseBody` 能取到缓存体**（9B），不要假定无 body |
| 重定向 | 跳转响应体拿不到（实测 `-32000 No data found`）；同一 requestId 多跳，最终 URL 以最后一跳为准 |
| Service Worker | 请求在单独的 SW target/session：`Target.attachToTarget({flatten:true})` + 带 `sessionId` 的 `Network.enable`。实测**页面级同名请求仍带最终 body**；SW 内部 fetch 的 `getResponseBody` 返回空串（len 0），别依赖它 |
| gzip/br | `getResponseBody` 返回解压后内容，不要自己解压（实测 gzip 2000B 原文） |
| SSE / ndjson / 无限流 | 不会 `loadingFinished`；`streamResourceContent` 后 `dataReceived.data` 是 base64 分片（实测 3 片 / 40B）；客户端关闭时 `loadingFailed net::ERR_ABORTED` 属正常结束 |
| >10MB / 大文件 | 默认被 inspector cache 驱逐；**实测 12MB 在 `maxResourceBufferSize=16MB` 下可取**（139 个 dataReceived） |
| 缓存命中 | 实测 304 / `fromServiceWorker` 的请求 body 仍可取；不要为此重发请求 |
| `Fetch.enable` | 会暂停请求、可能卡死页面；被动模式禁止 |
| 导航/关 tab | 未取走的 body 直接丢失；必须在 `loadingFinished` 立即取 |
| CDP 兼容性 | 官方不承诺向后兼容；锁 Edge 版本 + 冒烟自检 |

### 3.6 现成 CDP 工具

| 工具 | 形态 | 能否进 Tauri WebView | 结论 |
| --- | --- | --- | --- |
| `devtools-protocol` | 纯 TS 类型 | ✅ | 推荐 devDependency，只买类型 |
| `chrome-remote-interface` | Node | ❌ | 只作参考实现 |
| `puppeteer-core` | Node sidecar | ❌ | 开发期对照 |
| `playwright-core` / CDPSession | Node sidecar | ❌ | 开发期对照 |
| `chrome-devtools-mcp` / `@playwright/mcp` | Node MCP server | ❌ | AI 调试工具，不是可嵌入库 |
| `chromiumoxide` | Rust | ✅ | 约 6 万行生成代码，编译成本高；v1 不用 |
| `headless_chrome` | Rust | ✅ | 同步阻塞 + 30s idle 断连，不推荐 |
| `fantoccini` / WebDriver BiDi | WebDriver | ✅ | 需要 driver/会话，重；Chromium-only 下不如 CDP |
| `chrome.debugger` 扩展 | 浏览器扩展 | 需配套扩展 | 不采用：只对 attach 日常浏览器有意义，且有商店政策与提示条风险 |
| `mitmproxy` / `hudsucker` | 代理 | 独立进程 | 需要 CA/代理，只作调试兜底 |

**结论**：生产不引入运行时依赖；先写 `scripts/lx-probe.ts`（复制 `scripts/ui-probe.ts` 的零依赖 CDP 客户端）验证边界。采集源固定为应用自有 Edge profile（§1.3），不 attach 用户日常浏览器。

> **Tauri 自带 WebviewWindow 的边界**（2026-10-19 查 tauri 2.12.4 / wry 0.57）：
> `visible(false)` / `skip_taskbar(true)` / `data_directory()` / `incognito()` /
> `eval_with_callback()` / `cookies()` 能覆盖「隐藏 + 独立 profile + 执行 JS + 读 cookie」，
> 且 `skip_taskbar` 比 Win32 的 `WS_EX_TOOLWINDOW` 干净。但 wry **没有网络响应拦截**
> （只有 navigation handler / custom protocol / IPC），拿不到页面自身 XHR 的 body，
> 路线 A 仍必须 CDP。隐藏窗口的渲染语义与 `SW_HIDE` 相同（rAF/IO/scroll 停摆），
> 滚动页面仍需 off-screen shown。另：WebView2 runtime 与用户 Edge 版本/指纹不完全一致，
> 迁过去要先过 xhs/weibo 的反爬验证。

> **扩展 / Service Worker 拦截的边界**（2026-10-19）：
> - MV3 `chrome.webRequest` 只能看 URL/请求头/响应头，**拿不到响应体**；
>   `declarativeNetRequest` 只能挡/改请求，同样没有 body。
> - `chrome.debugger` 能调完整 CDP（含 `Network.getResponseBody`），但需要加载扩展 +
>   `debugger` 权限 + 浏览器信息条；新版 branded Chrome 对 `--load-extension` 已收紧
>   （Edge 需实测）。本质上仍是 CDP，多一层包装。
> - Service Worker 只能拦截**自己 scope 内**的请求；第三方站点无法从外部注册 SW，
>   页面自身的 SW 也不会把响应体交出来。
> - 非 CDP 的唯一替代是 `Page.addScriptToEvaluateOnNewDocument` 注入 fetch/XHR hook +
>   `Runtime.addBinding` 回传：不改请求（被动），但可被检测，且漏 worker/SW/流式/二进制。

### 3.7 分阶段

- **P0 ✅（2026-10-19）**：`scripts/lx-probe.ts` 已实测 304 / 302 / gzip / SSE / 12MB / SW：
  请求事件、`responseReceivedExtraInfo`、gzip 解压、大 body、`streamResourceContent`
  分片、SW session 全部符合预期；两处修正见 §3.5（304 能取缓存体；SW 内部 fetch body
  为空，但页面级请求有 body）。待办：用 `Network.requestWillBeSent` 逐平台确认 §3.11
  里标「推断/未确认」的页面请求；Edge 大版本升级后重跑两个探针。
- **P1 ✅（2026-10-19）**：被动缓冲 + `fetchPassive?` 契约 + `send/onEvent` +
  `capturePage` + `xhs:explore` / `xhs:user` 的 `fetchPassive`（§3.8）+ core 的被动闸门
  （只读缓冲/缓存，绝不回退 `fetch()`）。**实机验证**仍需重启应用后用真实页面跑一次
  （页面是否发目标接口未实测）；假后端自检只覆盖事件编排。
  ⚠️ `bili:popular` 的被动采集已移除（2026-10-19）：B站匿名 API 稳定，页面也不保证
  自然发 `/x/web-interface/popular`，LX 对该渠道没有收益，保留只会误导设置页。
- **P2**：browser-level 多 target / SW / OOPIF、`streamResourceContent`、DOM 兜底。

### 3.8 采集缓冲与接入

- ✅ 已实现：`packages/crawler/src/passive/buffer.ts`（`PassiveBuffer`，单例 `passiveBuffer`）。
  键 = `(platform, endpoint, 规范化 URL)`；TTL 30 分钟、单条 4MB、总量 32MB，超限淘汰最旧。
  归一化剥掉 `wts/w_rid/msToken/a_bogus/x-s/xsec_token` 等易变参数，否则每次刷新都是新键。
- ✅ `RssSource.fetchPassive?()` 已加入契约；channel 侧用 `passive = true` 声明
  （未声明 = core 不尝试）；core 在被动路径下先读缓冲，读不到就走缓存，
  绝不回退到主动 `fetch()`。
- ✅ 采集入口：`packages/crawler/src/passive/capture.ts` 的
  `capturePage(browser, { platform, endpoint, match, trigger })`：`Network.enable` →
  页面自然触发 → `loadingFinished` 立即取 body → 只收文本 MIME → 写缓冲。
  调用方必须用 `withBrowserMode` 持有独占权；`trigger` 里禁止构造自定义请求。
- ✅ 首批接入：`xhs:explore.fetchPassive()`（导航 `/explore`，从 Document 响应体解析）。
  ⚠️ `xhs:user` **刻意不声明 `passive`**：匿名 profile SSR 会抹空 noteId，必须走页面内
  `fetch`（匿名产出 `anon-*` 虚拟条目）；它的 `fetch()` 在登录态内部仍是导航 + 读 SSR，
  不构造请求 —— 标成被动会让桌面匿名订阅永远只剩缓存。
  `bili:popular` 不声明 `passive`、也不提供 `fetchPassive`（理由见 §3.7 P1）。
- ✅ core 闸门：`packages/core/src/data-layer.ts` 的 `doRefresh` 在
  `channel.passive === true && appHost.browser` 时走被动路径，只调
  `source.fetchPassive?.()`；null/缺失回退**内容缓存**（即使过期），无缓存才报
  「被动采集：没有可用的数据，且无缓存可回退」。非 passive 渠道正常走 `source.fetch()`。
- 自检：`bun packages/crawler/src/example/passive-capture.check.ts`（假后端回放事件）。
- 自检：`bun packages/crawler/src/example/bili-popular.check.ts`（payload → Item 映射）。
- 自检：`bun packages/core/src/example/passive-mode.check.ts`（被动只走 fetchPassive / 开关 / 缓存回退 / 覆盖投影）。
- 自检：`bun packages/crawler/src/example/passive-buffer.check.ts`（归一化 / 同键覆盖 / TTL / 限额淘汰）。
- 只持久化解析后的条目（复用既有 `content:<subId>` 缓存）；原始响应体只在内存里活到 TTL 到期，见 §3.10。

### 3.9 窗口模式（2026-10-19 实测）

探针：`scripts/lx-visibility-probe.ts`（系统 Edge **155.0.4283.45**，Windows 11，本地测试页观察 6 秒）。
每组都是一次独立 Edge（临时 profile），测量项：`document.visibilityState`、rAF 帧数、
100ms 定时器实际触发数、IntersectionObserver 回调、`loading=lazy` 图片请求、scroll 事件、页面内 `fetch`。

| 窗口状态 | visibilityState | rAF / 6s | 定时器 / 6s | IO 回调 | lazy 图 | scroll 事件 | 页面 fetch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 正常可见（置顶） | visible | ~860–895 | 74 | 触发 | 加载 | 触发 | 发出 |
| 屏外 shown（`--window-position=-32000`） | **hidden** | 0 | 7–8 | 不触发 | 不加载 | 不触发 | 发出 |
| 屏外 shown + `--disable-features=CalculateNativeWinOcclusion` | visible | 829 | 74 | 触发 | 加载 | 触发 | 发出 |
| 屏外 shown + `--disable-backgrounding-occluded-windows` | visible | 827 | 74 | 触发 | 加载 | 触发 | 发出 |
| `SW_HIDE` | **hidden** | 0 | 7–8 | 不触发 | 不加载 | 不触发 | 发出 |
| `SW_HIDE` + 生产现用四个 flag | **hidden** | 0 | 74 | 不触发 | 不加载 | 不触发 | 发出 |
| 屏外 shown + 遮挡 flag + `WS_EX_TOOLWINDOW` | visible | ~860 | 74 | 触发 | 加载 | 触发 | 发出 |

结论：

1. **`SW_HIDE` 一定 hidden，加任何 Chromium flag 都改不回来**。被掐掉的是渲染管线：
   rAF 为 0、IntersectionObserver 不回调、`loading=lazy` 不发请求、`scrollTo` 只改 `scrollTop`
   但不派发 scroll 事件。唯一能恢复的是定时器（`--disable-background-timer-throttling`
   让 100ms 定时器从 ~1/s 回到正常频率）。
2. **屏外 shown 本身也会被 Chromium 的原生遮挡计算判成 hidden**。加
   `CalculateNativeWinOcclusion` 关闭或 `--disable-backgrounding-occluded-windows`
   任一即可恢复为 visible，页面行为与正常可见窗口**完全一致**。
3. **页面内 fetch 在所有状态都能发出**。可见性掐的是「渲染/观察者/懒加载驱动的请求」，
   不是网络层本身。导航 + DOM 读取 + `Runtime.evaluate` 也全部正常。
4. `WS_EX_TOOLWINDOW` 可以在保持窗口 shown 的同时去掉任务栏按钮（实测页面仍 visible）。

据此实现两种模式：

| 模式 | 做法 | 适用 |
| --- | --- | --- |
| `hidden`（现有） | `SW_HIDE` | 路线 B（读 SSR/DOM）、一次导航式路线 A。够用且最省 |
| `interactive`（新增） | 屏外 shown + 遮挡 flag + 可选 toolwindow | 依赖滚动 / 懒加载 / IO 的页面，典型是 `xhs:user` 翻页 |

⚠️ `channels/xhs/user.ts` 的 `fetchMoreViaBrowser` 正落在被掐掉的那一类：隐藏窗口下
`window.scrollTo` 不派发 scroll 事件、IO 也不触发。平台侧「滚动后加载」到底靠 scroll
listener 还是 IntersectionObserver，仓库里只有注释、未证实，但两条路在 hidden 下都断了。
此前把它归因为「平台对一步滚到底不敏感」，实测表明至少一半根因是**没有渲染帧**。
现已切到 interactive；上线前仍建议在两种模式下各跑一次 `xhs:user` 翻页做最终确认。
`xhs:explore` / `xhs:user` 首页（SSR）不受影响。

**用户无感知性（同一探针附带测量）**

| 项 | `SW_HIDE`（hidden） | `interactive`（屏外 + flag + toolwindow） |
| --- | --- | --- |
| 屏幕可见 | 无 | 无（实测 `screenX=-17476`，在任何显示器外） |
| 任务栏图标 | 无（窗口直接隐藏） | 靠 `WS_EX_TOOLWINDOW` 去掉；实测样式已应用到 5 个顶层窗口，页面仍 visible |
| 前台焦点 | 启动瞬间 Chromium 会显示窗口，**可能前台化**；同配置复测结果不稳定（一次保持原前台、一次变成 Edge） | 同样会前台化；从 hidden 重显（`SW_SHOWNA` + `WS_EX_NOACTIVATE`）**仍观测到占用前台** |
| Alt-Tab / Task View | 不出现 | toolwindow 通常被 Alt-Tab 排除；Task View 未验证 |
| CPU（7.5s 观察窗） | 0.7s ≈ 8% 单核（含启动，稳态接近 0） | 2.48s ≈ 28% 单核（测试页持续 rAF 的偏上限值） |
| 窗口对象 | 存在但隐藏 | 存在且 `IsWindowVisible=1`（窗口枚举/调试工具可见） |

结论：屏幕与任务栏可以做到无感知，**焦点是唯一不可靠项**——窗口位置、`SW_SHOWNA`、
`WS_EX_NOACTIVATE` 都不能可靠阻止 Chromium 在显示窗口时前台化，当前 `SW_HIDE`
启动也有同样的短暂抢占。实现上已按「spawn/切换前记 `GetForegroundWindow`，窗口就绪后
`SetForegroundWindow` 还原」兜底；它与窗口模式无关。

`interactive` **按需启用**——只在滚动/懒加载采集期间使用，其余时间维持 `hidden`，
不要整个会话常驻（常驻渲染有 CPU/GPU 开销）。

**实现落点（2026-10-19）**

| 层 | 改动 |
| --- | --- |
| Rust `browser.rs` | `BrowserMode`；`browser_ensure(mode)` 与 `browser_set_mode`；遮挡/节流 flag 改为**启动时常驻**（否则切 interactive 唤不醒渲染）；`hide_until_stable(root, require_seen)`、`show_main_window`（`WS_EX_TOOLWINDOW` + `SW_SHOWNA`）、`foreground_hwnd`/`restore_foreground` |
| 宿主 | `TauriBrowserBackend.setMode` → invoke `browser_set_mode`；`BrowserBackend.setMode?` 为可选能力 |
| crawler | 统一用 `withBrowserMode(browser, mode, fn)` 包装：内部串行化 + 设模式，interactive 结束自动切回 hidden。滚动路径（`xhs:user` 翻页）传 `interactive`，SSR/页面 fetch 传 `hidden` |
| 语义 | `browser_ensure` **不带 mode = 只确保就绪、不改模式**（否则 `ensureConn` 会把刚切好的 interactive 打回 hidden） |

- `--blink-settings=imagesEnabled=false` 保留：实测 interactive 下 rAF/IO/scroll 正常，仅图片不加载。
- ⚠️ **隐藏判定必须看「可见性」**（2026-10-16 修）：`hide_windows_for_pids` 若对 PID 的**每个**
  顶层窗口都计数，Chromium 那堆本来就 `vis=False` 的辅助/IPC 窗口会让 `hidden>0` 在**主框架
  窗口创建之前**成立 —— 旧代码 `if cdp_alive && hidden>0 { return }` 于是提前返回，稍后自行
  `ShowWindow(SW_SHOW)` 的主窗口漏藏（现象：release 下隐藏 Edge 仍**在任务栏出现图标**，
  主进程只被 `--window-position=-32000` 挪到屏幕外）。正解两条缺一不可：① 只对
  `IsWindowVisible` 的窗口计数；② 等「**曾见过可见窗口** + 连续数轮 0 命中」的稳定态才返回
  （主框架比 CDP 就绪晚约 1s，不加 `seen` 门槛 0.3s 就误判藏净）。**只在 release 显现**
  （debug 走可见分支不触发），改隐藏逻辑务必用 release 实例验证。
- debug 构建窗口始终可见，模式切换为 no-op；`interactive` 的效果只能在 release 实例验证。
- 健壮性：`tcp_listen_pids` **只认 LISTEN + 非 0 PID**（ALL 表里同端口的 TIME_WAIT 行
  Owner=0，拿它当根会让切换静默失效）；模式切换失败时状态置「未知」而非成功态，
  下次强制重试；spawn 的 CDP 未就绪路径会杀半启动进程树、关句柄并还原前台。
- 并发模型：JS 侧 `withBrowserLock` 的 promise 链本身就是 FIFO 队列（所有 platform 共用
  一个 Edge）；Rust 侧 `switch_lock` 只是防前端并发/退出竞态的兜底。当前不引入
  actor/任务线程——**等 LX 需要常驻 `Network` 事件循环或真正的多平台并行时**，再把
  「Edge + 模式状态」收进单个 browser worker（命令通道 + 单线程），那时队列才划算。

⚠️ `WS_EX_TOOLWINDOW` 是 Win32 壳层技巧，不是 Chromium 开关。Edge 升级或窗口重建后
要复测任务栏与 Alt-Tab；如果失效，退路是「接受任务栏图标」或「只在采集瞬间显示」。

### 3.10 原始响应体：只进内存，不落盘

**决定**：原始 body 不写 SQLite / localStorage。

1. **内存缓冲（已实现）**：`PassiveBuffer`，键 `(platform, endpoint, 规范化 URL)`
   （规范化见第 3 条），TTL 30 分钟；单条上限 4MB、总量 32MB，超限按最旧淘汰。
   进程退出即清空。
2. **持久化的只有解析结果**：条目走既有 `content:<subId>` XML 缓存（TTL 与刷新策略不变），
   不新增「原始响应库」。理由：原始 body 与内容缓存重复、体积大，且 URL/正文里常带
   `xsec_token`、`a_bogus`、`x-s` 等一次性签名或凭据。
3. **入缓冲前的裁剪**：只保留 status / mime / 最终 URL（去掉 query 中的
   `token|xsec_token|a_bogus|signature|x-s|x-t|w_rid|wts` 值）/ body；
   **永不保存** `Cookie`、`Set-Cookie`、`Authorization`。
4. **调试导出**：仅 dev 且显式设 `LX_DUMP=1` 时把 body 写到 `tmp/lx-dump/`（gitignore），
   发布构建无此分支。
5. **不做加密**：不落盘就不需要「保留期与加密策略」；真要审计，重新抓一次比翻旧档更可靠。

### 3.11 平台端点与解析复用（2026-10-19 全渠道调查）

范围：`packages/crawler/src/register.ts` 注册的全部渠道 + 对应 `resolve/platform/*`。

**结论先行**：现有渠道没有「payload → Item」的公开入口——`fetch()` 里是「发请求 + 内联字段映射」，
`apiFetchItems` 只负责序列化。LX 接入前必须按渠道拆出 `parse(payload)`，这是主要改造成本。

平台级判断：

| 平台 | 页面是否自然发同一请求 | 解析现状 | LX 优先级 |
| --- | --- | --- | --- |
| 小红书 | ✅ `explore` / `user` 导航即得 SSR（生产代码已走通）；`user_posted` 由页面滚动后自己发（仅代码注释记载，请求形态未入库） | SSR 链路已导出纯函数（`extractInitialState` / `noteCardToSocial` / `noteDetailToSocial`） | **最高**：路线 B 零改造 |
| B 站 | 大概率是（API 同源、Referer 已指向对应页面），**未实测** | `ugc()` 是导出纯函数；5 个 UGC 渠道只差内联 raw→入参映射；直播/搜索/广场完全耦合 | **不做**：匿名 API 稳定，页面是否自然发目标接口未实测，收益不抵复杂度（2026-10-19 移除 `bili:popular` 被动采集） |
| 微博 | 推断是（`m.weibo.cn` 的 getIndex、`weibo.com` 的 hot_band 都是站点自身接口），未实测 | `mblogToSocial()` 纯函数；长文展开会二次请求 | 高：正好替掉现有类别② |
| 抖音 | **未确认**：enter / partition / profile 都是应用构造；直播页 HTML 内含流直链 | `douyinLiveItem()` / `douyinOnline()` 已导出；列表/搜索映射内联 | 中 |
| 斗鱼 | 推断是（`japi`/`gapi` 同源），未实测 | 无 payload→Item；`douyuSign` 是本地 JS，不产生网络请求 | 中 |
| 虎牙 | 推断是（`cache.php` 同源），未实测 | `parseProfile()` 是现成的纯解析范例 | 中 |
| YouTube | ❌ InnerTube POST 的 body/client context 由应用构造，页面 player 用的是另一套 | feed 路径可解析 | 低 |
| Apple / RSS | 不适用（公开目录 API / 任意外部 feed） | 完全分离 | 无 |

复用度三档：

1. **已导出纯函数，可直接接**：`ugc()`（bili 视频）、`mblogToSocial()`（微博）、
   `noteCardToSocial()` / `noteDetailToSocial()`（小红书）、`douyinLiveItem()`、
   虎牙 `parseProfile()`、RSS `extractArticle()`。
2. **私有但纯，导出即可**：bili `dynamic` 的 `parseModule` / `parseItem`、
   xhs `extractSsrNotes` / `notesToItems`、Apple `toPodcast`。
3. **完全耦合，必须先拆**：斗鱼/虎牙/抖音的全部列表与搜索、`bili:live` 的
   `fetchBiliRoom`、bili 三个搜索渠道、`bili:live:hot`、`bili:square`、`weibo:hot`。

四条落地结论：

1. **路线 B 先做小红书**：`xhs:explore` / `xhs:user` 首页的 SSR 解析已分离，
   浏览器导航路径已在生产使用（`explore.ts:55-71`、`user.ts:160-181`）。
   但 `user_posted` 的响应解析器**仓库里不存在**（全仓只有注释提到），
   要抓翻页 XHR 得新写 note 适配。
2. **路线 A 的能力是新增，不是复用**：全仓 `Network.enable|getResponseBody` 零命中，
   `browser/cdp.ts` 目前只有 evaluate / 页面内 fetch / 导航。
3. **`weibo:user` 现有浏览器路径属于类别②**（页面内 `cdpJson` 自定义 fetch，
   `user.ts:85`）。LX 下必须改成「导航到 `m.weibo.cn/u/{uid}` + 读页面自身请求/SSR」。
4. **`live:douyin:search` 没有自然页面**：`www.douyin.com/search?type=live` 被
   verify-center 拦截且不发目标请求，LX 对该渠道无解，只能维持主动模式或在 LX 下禁用。

⚠️ 上表「页面是否自然发同一请求」只有小红书是源码/实现证据，其余是端点归属推断，
接入时必须在 P0 探针里用 `Network.requestWillBeSent` 逐平台确认。

### 3.12 配额初值的依据（2026-10-19 实测）

探针：`scripts/lx-request-profile.ts`（匿名，单次 `fetch()`，统计扇出 / 延迟 / 目标 host）。
实测样本（本机，网络为境内直连）：

| 渠道 | 请求数 | 目标 host | 单次耗时 |
| --- | --- | --- | --- |
| `bili:popular` / `precious` / `ranking` | 1 | api.bilibili.com | 92–158ms |
| `bili:weekly` | 2（series + 明细） | app.bilibili.com | 254ms |
| `bili:square` | 2（nav 取 wbi + 榜单） | api.bilibili.com | 92ms |
| `bili:live:hot` | 2（spi + 列表） | api/live.bilibili.com | 206ms |
| `live:douyu:hot` | 1 | www.douyu.com | 133ms |
| `live:huya:hot` | 1 | www.huya.com | 632ms |
| `live:douyin:hot` | 2（首页 + 分区） | live.douyin.com | 1.3s |
| `weibo:hot` | 1 | weibo.com | 199ms |
| `xhs:explore` | 1（SSR HTML） | www.xiaohongshu.com | 325ms |
| `douyin:trend` | 1 | www.douyin.com | 297ms |
| `apple:podcast-chart` | 2（榜单 + Lookup） | itunes.apple.com | 662ms |

结论：

1. **稳态负载可以忽略**：默认 TTL 30 分钟 → 每个订阅每小时 2 次刷新；即使按 2 请求/次算，
   单订阅 ≈ 0.07 RPM。50 个订阅分散在 7 个平台，**没有任何平台会接近 RPM 上限**。
   RPM 在本应用里只约束「刷新爆发」，不是稳态限速器。
2. **爆发规模 = 该平台订阅数 × 扇出**。例如 20 个 B 站订阅 ≈ 30 个请求；在
   `maxConcurrent=12` + `minInterval=50ms` 下约 1.5 秒完成，`rpm=600` 也不会成为瓶颈。
   两个数值都远低于会触发风控的量级，**优先保证不并发突刺**即可。
3. **初值见 §2.5（2026-10-19 已放宽一档）**：默认值只约束突发形状，不贴上限；
   真正防封的是平台级冷却（§2.3）与按平台降级到 LX。若用户订阅数显著增长（>100），
   先调 `maxConcurrent` 与 `minInterval`，最后才动 RPM。
4. **冷却值不通过压测校准**：只按 §2.3 的显式信号累积观测；探测 412/verify-box 边界
   本身就是风控行为，不做。

### 3.13 多 tab 与 lane 粒度（设计评估，2026-10-21；**已实现** 2026-10-22）

> 触发：详情/登录会把列表页导航走，回头再抓只能整页重载；xhs 的翻页还依赖页面里
> 累积的 `feed.feeds`，页面被导航走就只能重载 + cursor 重试。这里记录「要不要多 tab、
> 按什么粒度分」的评估结论，后续实施照此执行。
>
> **实施注记（2026-10-22，阶段 1+2 一次落地）**：`resolve/browser/scheduler.ts` 四原语
> （withLane / withRenderLease / browserGateFor / withBrowserGlobal）；宿主 `browser.tab(key)`
> 每 lane 独立 target（`PUT /json/new`）+ 独立 CDP 连接（事件/abort 天然按 lane 隔离），
> LRU 上限 8；组合入口 `withBrowserOp({lane, mode, platform})`（gate → op lane → 租约 →
> activate）。lane 分配：`list:<channelKey>`（xhs:explore / xhs:user / weibo:user）、
> `detail:xhs`、`login:<platform>`×3、`browser:global`（clearCookies/resetProfile）。
> `abortTabs({keepLogin:true})` 取代 `scanLoginActive` 布尔与 45s 超时的平台前缀猜测；
> capturePage 收尾 `Network.disable`。回归：`scheduler.check.ts`（并发 lane / 租约计数 /
> gate 串行不占 lane / 异常释放 / abort 豁免登录）。未做：passiveBuffer 按 lane 过滤
> （当前仅 xhs:explore 声明 passive，同 lane 串行无并发采集，见 §3.13.1 待办）。
>
> **审查修正（2026-10-22，48-agent 审查 43 候选 → 39 确认，去重后修 8 条）**：
> ① tab.send 缺惰性建连（capturePage 首条命令直接 `CDP not connected`，被动渠道
> 每轮回退缓存）；② withScanLoginLock 丢掉 lane 句柄（登录仍在默认页，douyin
> interactive 还会把默认页挤成非激活 → canvas 二维码画不出）；③ xhs 被动兜底
> readPage 读默认页（应读本 lane tab，否则 0 条写空缓存）；④ interactive 改为
> **全局串行**（激活互斥 + 等首个 setMode 落地，防 hidden 下滚动）；⑤ setMode
> 抛错不再泄漏租约计数；⑥ withBrowserGlobal 改为**读写锁独占**（不同 lane 键并不
> 天然互斥，clearCookies/resetProfile 仍会与导航交错）；⑦ data.ts 超时恢复「仅
> 浏览器订阅才 abortTabs」（非浏览器慢源超时不该掐别人的抓取）；⑧ bili 分区列房
> 改为**登录预检**（匿名请求 -352 会写 30 分钟 bili 平台冷却并把整个平台打死），
> 端点 -352 走 `riskSignal:false`（w_webid 过期可重取，不写冷却）。
> cookie 字符串拼接专项全仓 9 处逐一核对：**产品代码无分隔符缺陷**（探针脚本的
> `;` 缺失问题未进入产品代码）。

#### 现状（代码事实）

- **单 page target + 一把全局锁**：`host/tauri/browser-backend.ts` 连 `/json/list` 的
  第一个 page；`resolve/browser/cdp.ts` 的 `browserLock` 是全局 promise 链。
- `cdpNavigate` 只在 URL 完全相同时跳过，否则整页导航；refresh 的 `forceReload`
  本来就要重载（这部分省不掉）。
- **抢页面的四类操作**：xhs 详情（`xhs/shared.ts` 的 resolveDetail）、三平台扫码登录、
  同平台不同渠道（xhs:explore ↔ xhs:user）、跨平台（xhs ↔ weibo）。
- 登录还**持锁数分钟**（`withScanLoginLock`），期间所有浏览器抓取排队。
- `browser.rs` 的 `edge_args` 已带 `--disable-background-timer-throttling` /
  `--disable-renderer-backgrounding`，但那只救定时器：**非激活 tab** 的
  `visibilityState=hidden` 下 rAF / IntersectionObserver 仍停摆（与 §3.9 同一机制）。

#### 粒度对比

| 粒度 | 稳态 tab 数 | 能省什么 | 代价 |
|---|---|---|---|
| 平台级 | 3 | 跨平台互抢 | 不解决同平台内 explore/user/detail 互抢 |
| 渠道级（`channelKey`） | 3–4 | 渠道间互抢；**保住分页累积 state** | 每 tab ≈60–120MB；同渠道多 uid 仍互抢 |
| 订阅级（+ info hash） | 随订阅数增长 | 最彻底 | 内存不可控、边际收益，不建议 |
| 用途级（detail / login） | 2–3 | **收益最大**：详情不再污染列表、登录不再阻塞抓取 | 需在 cdp 层区分用途 |

**推荐：混合 —— `list` 按 `channelKey`，`detail` / `login` 每平台各一个**：

```
xhs:explore   xhs:user   weibo:user      # list lanes
xhs:detail    weibo:detail               # detail lanes
xhs:login     weibo:login   douyin:login # login lanes（临时，用完可回收）
```

理由：reload 的两大来源是详情与登录，各平台一个辅助 tab 即可彻底隔离；list 按渠道
分才能保住 xhs 翻页 state。订阅级不做（接口留 info hash 扩展位）。

#### 实施要点（可行，改动集中在宿主 + cdp）

- 建 tab 不需要改 Rust：`PUT /json/new?about:blank` → 拿 `webSocketDebuggerUrl` →
  现有 `ws_connect` 连上；`/json/activate/<id>`、`/json/close/<id>` 管激活与关闭。
- 宿主加 `browser.tab(key) → BrowserTab{ evaluate, send, onEvent, activate, close }`，
  每 tab 一条 ws（独立 pending / abort）；现有 `send(sessionId)` / `onEvent(sessionId)`
  已预留会话参数，默认 lane 保持向后兼容。
- `browserLock` 拆成「每 lane 一把 + 一把全局模式锁」。

#### 四个必须处理的坑

1. **非激活 tab 没有 rAF/IO**：滚动驱动（xhs:user 翻页、懒加载）前要 `activate`
   该 tab（毫秒级、**不触发 reload**），窗口保持 `interactive`。
2. **`setMode` 是窗口级**：多 lane 并发只对 `hidden` 安全；`interactive` 仍要全局模式锁。
3. **登录锁只锁自己的 lane**：这是「登录不再阻塞刷新」的关键，比多 tab 本身更重要。
4. **被动采集按 lane 绑定**：`capturePage` 的 `onEvent` / `getResponseBody` 必须绑到该
   lane 的 tab，否则会收到别平台的事件。

cookie 是浏览器级共享的（登录完其它 lane 直接受益）；app 重启后 target 映射丢失，
按 URL 前缀重新认领或直接新建。

#### 分阶段

- **阶段 1（低风险、收益最大）**：只加 detail / login 辅助 lane（每平台 1 个，LRU 2–3）。
- **阶段 2（可选）**：list lane 按 `channelKey`（3 个）+ LRU（默认 4）+ 空闲回收（10min），
  滚动前 `activate`。

验收：多订阅同时刷新 + 打开详情 + 扫码登录的组合下，抓取日志不应再出现「登录页/详情页
被当列表页读取」；xhs 翻页在穿插详情后仍从原 cursor 继续（不重载、不空页）。

#### 3.13.1 锁与窗口模式的配套改造（设计，未实现）

结论：`withBrowserLock` / `withBrowserMode` **必须一起改**，但不能整体换成「每 lane 一把锁」——
它们现在把四件不同粒度的东西捆在一个函数里：

| 关注点 | 现在的实现 | 正确粒度 |
|---|---|---|
| 互斥（导航 + fetch 必须原子） | `cdp.ts` 模块级 promise 链（全局、**非重入**） | **per-lane** |
| 窗口模式 | Rust `mode: Mutex<Option<BrowserMode>>` 单槽 + 对整棵 Edge 进程树 `ShowWindow` | **全局**（引用计数） |
| 平台准入 | `browserGate` 在**全局锁内**调用 | **per-platform**，挪到 lane 锁之外 |
| 登录豁免 | `scanLoginActive` 布尔 | per-lane（Set/计数） |

**目标 API**：

```ts
withLane(lane, fn)                       // 同一 tab 上的导航+fetch 原子
withRenderLease(fn)                      // 全局引用计数：首个租约切 interactive，最后一个释放切回 hidden
await browserGate(platform)              // 平台级（自带 per-platform 互斥）
withBrowserOp({ lane, mode, platform }, fn(tab))   // gate → lane → renderLease → activate → fn
```

**顺序与理由**：

- **gate 放到 lane 锁之外**：现在它在全局锁内，某平台冷却会把**所有平台**的浏览器操作一起卡住
  （队头阻塞），多 tab 也救不回来。
- **gate 自身要 per-platform 串行**：`governor.browserGate` 是「读 last → sleep → 写」的非原子
  序列，今天安全**只因**它在全局锁里；拆锁后两条 lane 会同读同放行，最小间隔/抖动失效。
- **interactive 用引用计数**：`withBrowserMode` 的 finally **无条件** `setMode("hidden")`
  （`cdp.ts:73`）；多 lane 下任一条 hidden 操作收尾都会把别人正在滚动的页面掐成 hidden
  （滚动静默 0 条）。另外 Rust 每次切换都要 `restore_foreground` sleep 350ms，反复抖动很贵。
- **滚动前 `activate` 该 tab**：非激活 tab 的 rAF/IO 停摆（§3.9 同机制），activate 毫秒级、不重载。
- **只用 tab、不开新窗口**：`main_window_for_pids` 只挑一个主框架窗口显示，多窗口时其余窗口
  仍隐藏（滚动同样是 0 条）；`PUT /json/new` 建**同窗口 tab** 可规避。禁图
  `--blink-settings=imagesEnabled=false` 是启动参数，对全部 tab 生效，不能按 lane 开关。
- **连接级状态全部下沉**：`connId / pending / nextId / eventListeners / abortPending` 要按 tab；
  `connect()` 现在取 `/json/list` 的**第一个 page**（`browser-backend.ts:112`），超时重连会
  悄悄换 tab —— lane→target 映射必须显式持有、可校验、可重建。
- **登录**：`withScanLoginLock` 改为 login lane 锁；`scanLoginActive` 布尔改 Set/计数
  （两个登录重叠会互相清标记，`cdp.ts:101`）；桌面 45s 超时（`data.ts:161`）改为只 abort
  自己 lane 的连接，登录 lane 不再需要特判豁免。
- **cdp 原语显式收 tab**：`cdpFetch / cdpEvaluate / cdpNavigate / capturePage` 现在既不持锁
  也不校验，默认打「默认 page」；lane 化后由 tab 句柄承载，漏传一处就会静默打回默认页。
- **被动采集**：`capturePage` 现在丢掉 `onEvent` 的第三参 `sessionId`（`capture.ts:55`）、
  `getResponseBody` 也不带 sessionId（`:95`）、`Network.enable` 从不 `disable`；多 lane 下必须
  绑到该 tab 的会话，否则事件/响应串台。`passiveBuffer` 的 key 只有 (platform, endpoint, url)，
  且 `getLatest` 不比 URL/时间（`buffer.ts:121`）——两个 lane 同采会互相串，还会把 30 分钟内
  的旧 body 当本轮结果；需要带 lane / captureId（或 since）过滤。
- **共用函数要显式传 lane**：`fetchXhsList` / `fetchXhsPassivePage` 被 xhs:explore 与 xhs:user
  共用，内部拿不到 channelKey，lane 必须由调用方传下去。

**另外三处要顺手收口**：

- **锁外的浏览器操作**：`AccountPage` 的 `clearCookies`、`Diagnostics` 的 `resetProfile` 现在
  完全绕过浏览器锁（前者可与导航交错，后者直接杀掉正在抓取的 Edge）。lane 化时归为
  `browser-global` 操作（独立全局锁，不占任何 lane）。
- **45s 超时 < 登录 300s**：`REFRESH_TIMEOUT_MS = 45s`，而 xhs/weibo 登录持锁可达 300s、
  douyin 180s —— 排队中的刷新必然先超时，现在全靠 `scanLoginActive` 豁免。lane 化后刷新超时
  只 abort 自己 lane 的连接，这条启发式可以删掉（`data.ts:161` 那个 `/^(weibo|xhs):/` 正则也
  一并去掉，lane 由订阅算出，而不是猜前缀）。
- **detail lane 的额外收益**：`resolveXhsItemDetail` 里的 `ensureXhsOrigin` 整页导航
  （`xhs/shared.ts:362` 附近）在专属 detail tab 常驻 xhs 域后可以直接删掉。

**迁移**：保留 `withBrowserMode` 作为 `withBrowserOp({ lane: "default" })` 的兼容壳，逐个调用点
迁移；补一个纯逻辑调度自检（假 backend）覆盖：hidden 下两 lane 可并发、interactive 租约串行
且最后释放才隐藏、gate 等待不占 lane 锁、异常路径必释放、abort 不跨 lane。

#### 3.13.2 要不要接 Effect（结论：不接，2026-10-21）

「异步复杂度上来了」只有前两类能靠库消除，后四类是**外部状态机**，任何 TS 库都管不了：

| 复杂度来源 | Effect 能解？ |
|---|---|
| 四件事四种粒度（lane / 全局租约 / per-platform gate / 登录豁免） | ✅ Scope + Semaphore + Ref |
| 取消只打自己 lane | ✅ fiber interruption |
| Rust `mode` 单槽 + `ShowWindow` 对整棵进程树 | ❌ |
| Win32 副作用不可回滚（已 interactive / 已导航走） | ❌ 仍要手写反向 finalize |
| CDP 连接级状态（`connId`/`pending`/`abortPending`） | ❌ 得改 backend |
| `await invoke(...)` 不可中断 | ❌ Effect 中断也是协作式 |

四个原语手写约 120 行（`packages/resolve/src/browser/scheduler.ts`）：

- `withLane(lane, fn)` —— promise 链（`tails` Map）：同 lane 串行、跨 lane 并发、异常不卡死后续；
- `withRenderLease(fn)` —— 全局引用计数：首个切 interactive，最后一个切回 hidden；
- `browserGate(platform)` —— `withLane("gate:"+p)` 里「读 last → sleep → 写 last」，顺带修掉
  §3.13.1 指出的非原子；
- lane 级 `AbortController` —— `abortLane(lane)` 只打自己。

接 Effect 的代价：调度器在 `resolve`，调用方遍布 `resolve`/`crawler`/`core`/`apps/desktop`，
还要进 CLI(node) 与 mobile —— 要么全仓 Effect 化（不可能），要么每个边界
`Effect.runPromise` 转换（净增噪音）；而真正需要它的能力（`Schedule` 重试矩阵、`Stream` 扇出、
`Layer` 依赖注入）当前一个都没有。

**重新评估的触发条件**（满足任意两条）：① 需要跨操作组合语义（多订阅竞速/取消、共享冷却
令牌）；② 需要可组合且可测的退避策略；③ 需要流式扇出；④ 调度代码自身超 ~400 行且开始出现
「这把锁到底护什么」的讨论。到那时上面四个函数就是移植边界，换库只动一个文件。

### 3.14 Edge 实例配置与调试端口

（2026-10-21 从 `CLAUDE.md` 迁入）

- ⚠️ **CDP 调试端口 9222 只在 dev**：`tauri.conf.json` 不带它（release 构建会带 = 发布版开
  无鉴权远程调试口，本机任意进程 attach 后可读改 cookie）；dev 用 `scripts/tauri.ts` 叠的
  `tauri.conf.dev.json`（`bun run tauri` 自动带上）。
- **release 下 CDP Edge 禁图**：只有可隐藏的 release 构建才拼
  `--blink-settings=imagesEnabled=false` —— SSR/滚动抓取只读 DOM 文本，图片纯浪费内存/带宽。
  实测该参数**不影响** `interactive` 模式的 rAF / IntersectionObserver / scroll 事件（只让
  图片不加载），所以模式切换不需要重开浏览器。扫码不受影响：微博读远程 `img.src`（图另走
  `appHost.http`）、小红书读 `img.qrcode-img` 的 data URL、抖音是 canvas 绘制；debug 不禁图
  便于观察。
- **CDP Edge 干净度（对齐 edge-cdp 插件）**：`edge_args` 带
  `--disable-sync --disable-extensions --disable-default-apps
  --edge-redirect-feed-at-first-run-disabled=1`，避免把本机登录账号的同步设置/扩展带进抓取
  实例。⚠️ `.msn/.bing` 账户 cookie 仍会被 Edge 账户层注入（flag 挡不住，不影响抓取）；
  要真正清空 profile 用「存储与诊断 → 清理浏览器数据」（先杀我们的 Edge 再删目录）。
  ⚠️ 不能像插件的 WSL 脚本那样 `taskkill /IM msedge.exe` 杀全部 Edge —— 那会关掉用户正在
  用的浏览器。

## 4. 结论与剩余风险

原先列的 7 个未决项已全部收敛：可见性（§3.9）、原始 body 落盘（§3.10）、
URL→渠道映射（§3.11）、配额初值（§3.12）。剩余的是**接入时逐平台验证**，不是设计空白：

1. 每个平台的具体响应结构会变——`fetchPassive` 复用现有 parser 时，用
   `serialize-roundtrip.check.ts` 同款思路补「真实样本 → 解析」的回归样本。
2. CDP 事件在 Edge 升级后可能变（§3.5 已列兼容风险）；P0 探针要在每次大版本升级后重跑。
3. 各平台风控阈值**不主动探测**：不为了「校准」去压测 412/verify-box 的边界。
   配额只从真实刷新节奏反推（§3.12），并用冷却账本的观测结果做反馈。

> **范围限定**：采集源固定为应用自有 Edge profile，不 attach 用户日常浏览器（隐私边界与授权交互不再讨论）；mobile 端（无 `appHost.browser`）暂不纳入 LX，降级行为随移动端实际需求再定。

## 5. 参考

- CDP Network: https://chromedevtools.github.io/devtools-protocol/tot/Network/
- CDP Target: https://chromedevtools.github.io/devtools-protocol/tot/Target/
- CDP Fetch: https://chromedevtools.github.io/devtools-protocol/tot/Fetch/
- `Network.getResponseBody` 时序与限制：https://github.com/ChromeDevTools/devtools-protocol/issues/44
- 重定向无 body：https://github.com/puppeteer/puppeteer/issues/1896
- 304 缓存 body：https://github.com/puppeteer/puppeteer/issues/10145
- Service Worker：https://github.com/microsoft/playwright/issues/21816
- 大 body 驱逐：https://github.com/microsoft/playwright/issues/13449
- Chrome 136+ 默认 profile 禁止远程调试：https://developer.chrome.com/blog/remote-debugging-port
- `chrome.debugger`：https://developer.chrome.com/docs/extensions/reference/api/debugger
- puppeteer-core：https://pptr.dev/api/puppeteer.connectoptions
- Playwright CDPSession：https://playwright.dev/docs/api/class-cdpsession
- chromiumoxide：https://crates.io/crates/chromiumoxide
- headless_chrome：https://crates.io/crates/headless_chrome
