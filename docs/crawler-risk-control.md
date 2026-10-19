# Crawler 风控防御与 LX 被动采集

> 2026-10-19 调研，设计草案（未实现）。范围：crawler 请求治理的分级模型、
> 集中式 governor、LX 浏览器被动采集的可行性与 CDP 工具选型。

## 0. 结论

1. **单点治理**：所有出站请求由一个 `NetworkGovernor` 统一准入；不按 API/媒体/图片/浏览器拆成多个管理器。
2. **等级只保留一条轴**：`L0`（无限制）、`L1`（并发/RPM + 基础冷却）、`LX`（浏览器唯一发起请求）。缓存优先、浏览器优先不再作为等级，降级为正交开关。
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
- 平台由 URL host 自动推导；调用方可选传 `policy: { lane?, platform?, dedupeKey? }` 覆盖。
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
| L0 | governor 直通（仅调试） |
| L1 | 全局/每平台并发 + RPM + 基础退避冷却；浏览器操作同额度 |
| L1 严格 | 同机制、更低配额（RPM 减半、最小间隔加倍） |
| LX | 浏览器唯一发起请求；禁用应用构造的 API 调用与页面内自定义 fetch |

正交开关（不占等级）：

- **后台自动刷新**：关闭后启动/新建订阅不自动抓，只允许手动刷新。
- **每平台传输策略**：`auto` / `browser-only`；browser-only 不减少请求，只是换通道。

被否决的等级：缓存优先（本应用没有周期后台刷新，收益小，且更像新鲜度策略）、浏览器优先（不减少请求，不是“更保守”的等级）。

### 2.5 配置

```ts
netPolicy: {
  level: 0 | 1 | "lx",
  strict?: boolean,
  global: { maxConcurrent: 4 },
  platforms: {
    bili:   { maxConcurrent: 2, rpm: 30, minIntervalMs: 1500, cooldownBaseMs: 600_000 },
    douyin: { maxConcurrent: 1, rpm: 12, minIntervalMs: 3000, cooldownBaseMs: 300_000 },
    // xhs / weibo / youtube / rsshub ...
  }
}
```

平台配额初值（**未实测**，仅作默认）：

| 平台 | 并发 | RPM | 冷却 |
| --- | --- | --- | --- |
| bili | 2 | 30 | -352/-509 10~60min，412 15min |
| 抖音 | 1 | 12 | 空 body 5~30min，4031/2483 30min + 登录 |
| 小红书 | 1 | 6~10 | verify-box 30~60min，300011 60min |
| 微博 | 1 | 10~15 | 432/-100/418/403 10~30min |
| YouTube | 2 | 20~30 | 429 按 Retry-After，否则 1~30min |
| 通用 RSS | 1/host | 6~10 | 按 Retry-After |

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

1. `browser_ensure` 支持“可交互窗口”模式：不 `SW_HIDE`，images 是否禁用待定。具体用可见、屏外 shown 还是隐藏，取决于 §4.1 的可见性调研结论，当前不写成既定设计。
2. `BrowserBackend`：
   - `send(method, params, sessionId?)`（公开原始 CDP 命令）
   - `onEvent(cb)`（分发无 id 事件帧，带 `sessionId`）
   - `targets()` / `attachTo()`（或 browser-level `attachBrowser()`）
   - `enableNetworkCapture()` / `getResponseBody()`
3. 多 tab / Service Worker / OOPIF：browser-level WS + `Target.setDiscoverTargets` + `Target.attachToTarget({flatten:true})`；`setAutoAttach` 用 `waitForDebuggerOnStart:false`，避免冻结页面。
4. `browser_close` 区分 app-owned 与 daily attach：attach 模式只 detach，不杀外部浏览器。
5. Rust 侧可选事件过滤：host 白名单、丢弃 `dataReceived`、body 大小上限，降低 base64 + IPC 压力。

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
| 304 | 无 body；`responseReceived.response.status` 不可信，要看 `responseReceivedExtraInfo.statusCode` |
| 重定向 | 跳转响应体拿不到；同一 requestId 多跳，最终 URL 以最后一跳为准 |
| Service Worker | 请求可能只在 worker target 的 session 里；要 attach 到 SW target |
| gzip/br | `getResponseBody` 返回解压后内容，不要自己解压 |
| SSE / ndjson / 无限流 | 不会 `loadingFinished`；用 `streamResourceContent` 自己累计并限长 |
| >10MB / 大文件 | 默认被 inspector cache 驱逐；提高上限不一定生效（新版有失效报告） |
| 缓存命中 | `requestServedFromCache` 的 body 可能不可用；不要为此重发请求 |
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
| `chrome.debugger` 扩展 | 浏览器扩展 | 需配套扩展 | 日常浏览器体验最好，但有商店政策与提示条风险 |
| `mitmproxy` / `hudsucker` | 代理 | 独立进程 | 需要 CA/代理，只作调试兜底 |

**结论**：生产不引入运行时依赖；先写 `scripts/lx-probe.ts`（复制 `scripts/ui-probe.ts` 的零依赖 CDP 客户端）验证边界。

### 3.7 分阶段

- **P0（1–2 天）**：`scripts/lx-probe.ts` 实测 304、302、gzip、SW、SSE、>10MB、重载缓存、`getResponseBody` 命中率。
- **P1（MVP）**：可见/已显示窗口 + 事件分发 + `Network.enable` + 白名单取 body + 单平台（建议 xhs explore 或 bili popular）→ 缓冲 → `fetchPassive`。
- **P2**：browser-level 多 target / SW / OOPIF、`streamResourceContent`、DOM 兜底、daily-profile opt-in。

### 3.8 采集缓冲与接入

- 放在 `packages/crawler/src/passive/`：按 `(platform, endpoint, url)` 归并，TTL 30 分钟，单条 2–4MB，总量 32MB。
- `RssSource` 增加可选 `fetchPassive()`；core 在 LX 下先读缓冲，读不到就走缓存，绝不回退到主动 `fetch()`。
- 默认只持久化解析后的条目，不长期保存原始 body；落盘前脱敏 Cookie/Authorization/URL token。

## 4. 未决问题

1. **可见性对页面行为的影响待调研**：`SW_HIDE`、屏外 shown、正常可见三种状态下 `document.visibilityState`、后台节流、懒加载、IntersectionObserver、埋点的差异，尚未实测。**在结论出来前，不把“必须可见”写成既定设计**；当前只作为倾向性建议。
2. 采集源：应用自有 profile 还是用户日常浏览器（后者需 `edge://inspect/#remote-debugging` + `DevToolsActivePort` + 用户 Allow）。
3. 原始响应体是否落盘、保留期与加密策略。
4. 各平台 URL → channel/parse 的映射；现有 parser 与请求逻辑的耦合程度。
5. 各平台 RPM/并发/冷却初值需用 CLI 探针实测校准。
6. mobile 无 `appHost.browser`，LX 不可用；需要明确降级行为（只读缓存）。
7. 日常浏览器 attach 的隐私边界与授权交互。

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
