# 爬虫拓扑：desktop 服务化与移动端边界
> 合并自 desktop-crawler-service.md + mobile-cdp-feasibility.md（2026-10-21 整理）。前者是 desktop/mobile 数据供给分离的决策依据与形态选型，后者是「移动端为什么不能复用 CDP」的结论。

> **决策**：打破 desktop/mobile 完全一致性。desktop 数据供给走**独立爬虫服务**
> （本机 sidecar 或自部署服务，承载重反爬平台）；mobile 保持**内置 crawler**，
> 仅支持有限平台。下文记录决策依据（RSSHub / MediaCrawler 对照）与形态选型，
> 以及移动端不能复用 CDP 的实测依据。
>
> **落地状态（2026-10-26）**：已按本文实现——`rss --service` 单写者 + `amoeba-runtime`
> 启动器 + WebView2 sidecar，desktop 默认走 `service_endpoint`。服务落地细节以
> `system/06-data-service.md` 为准（本文保留决策依据与移动端分析）。
> **mobile 于同日冻结**，不再随改动维护。

## 决策背景与动机

- **反爬已升级到「浏览器级」**：xhs 需滚动驱动 + 验证码检测（`.fe-verify-box`）、
  weibo cookie 分钟级时效、签名 1 月~1 季度一改 + 按账号/会话灰度分发。
  这些手段需要桌面环境特权（spawn 系统浏览器、CDP、持久 profile、无沙箱限制），
  mobile 沙箱给不了（见本文「移动端 CDP：不可行」：
  iOS 无 CDP、Android 依赖 PC/adb）。
- **移动端定位早已论证**（2026-08-16）：HTTP/SSR + 登录 cookie，不做浏览器模拟。
  本决策是该论证的自然延伸——既然两端环境能力分层是事实，不如显式承认。
- **架构红利**：crawler「XML 即天然类型」——channel 输出本就是 RSS 2.0 XML 字符串，
  服务化只是把进程内调用变 HTTP GET 返回同一字符串，core 层不动（自解析 XML 建
  MediaItem）。等于自造 mini-RSSHub，路由表 = channel 注册表。
- **旧文档前提变化**：原 `xhs-signature-sidecar-eval.md` 推荐 RustPython 嵌入的
  主要理由是移动端兼容；desktop 服务化后**服务进程可直接跑 CPython xhshow**
  （不受 Tauri 移动端 sidecar 限制），签名恢复路径比 RustPython 更简单
  （该文档已删，结论并入 `docs/platforms/xhs-signature.md`）。

## RSSHub / MediaCrawler 对照（2026-08-25 实读代码）

- 两家都只把浏览器当**登录容器 / 访客 cookie 源**，业务请求走纯 HTTP：RSSHub 用 Playwright（现 patchright）渲染 SSR 或拿访客 cookie，MediaCrawler 纯 httpx 打 API、浏览器仅在 432 异常时刷 cookie。
- 签名维护已行业性收敛到第三方库 **xhshow**（Python）：MediaCrawler `pip install xhshow`，RSSHub 干脆不碰签名。
- **自部署 RSSHub ≠ 免维护**：能覆盖我们已复刻的 SSR/board，但覆盖不了 xhs 分页翻页与登录态全量（实测：weibo 路由匿名可用；xhs user/board 匿名拿不到数据，配 `XIAOHONGSHU_COOKIE` 后 user 才可能通）。

### 两条行业路线的启示

1. **重反爬平台的供给 = 常驻服务进程 + 纯 HTTP 业务请求 + 浏览器仅作登录态容器**。
   没有任何人在这两个平台上把浏览器当业务请求通道（RSSHub 只用来渲染 SSR / 拿访客
   cookie，MediaCrawler 只用来登录 + 432 时刷 cookie）。我们的 browser-sim（CDP 页面内
   同源 fetch）已经比 RSSHub 更「浏览器原生」，比 MediaCrawler 少了纯算法签名。
2. **签名维护已行业性收敛到第三方库 xhshow**（Python，Cloxl 维护）——RSSHub 干脆
   不碰签名，MediaCrawler `pip install xhshow`。自研服务继承这条路径成本最低。
3. **微博解法是访客 cookie 池**（RSSHub）或常驻 context + 432 刷新（MediaCrawler），
   不是登录 cookie 长效化。我们的 weibo 浏览器路径已对齐 MediaCrawler 形态。
4. **自部署 RSSHub ≠ 免维护**：其 xhs/weibo 路由稳定性依赖 Playwright 运行时（或
   外部 proxy），且无签名能力（拿不到 homefeed/user_posted 等游标分页 API）——
   **能覆盖我们已复刻的 SSR/board，但覆盖不了分页翻页与登录态全量数据**。

## 形态选型（结论已落地：A）

| 方案 | 说明 | 优劣 |
|---|---|---|
| **A. 自研 sidecar** | crawler 包 + 薄 HTTP 层（Bun） + injectNodeHost | 代码 100% 复用；浏览器模拟/扫码登录/cookie 走 appHost.browser 同款路径；与 example/browser-sim 同构 |
| **B. RSSHub 自部署** | 桌面只消费 RSSHub 路由 | 路由现成但两平台同样要配 cookie；签名维护押注社区；与我们已复刻的 crawler 能力大面积重复；xhs 无签名 → 无分页 |
| **C. 混合** | 自研为主 + RSSHub 补充长尾平台 | A 的超集，按需开 |

**结论：选 A** —— 已升级为 `rss --service` 单写者数据服务（B/C 都是它的子集），见 `system/06-data-service.md`。

> 术语：取数服务 = 数据服务（`rss --service`）。`amoeba-browser.exe` 是**浏览器宿主**
> （`apps/browser-sidecar/`，无 Tauri 的 WebView2 + CDP），由 CLI（`rss --browser`）与
> 数据服务（按需 spawn）共用。

## 切分边界（已按实现收口）

抓取、扫码登录、`resolveDetail`、`resolvePlay`/`resolveLivePlay`、`resolveHotWord` 全在服务（RPC 清单见 `system/06-data-service.md` §4）；mobile 的 channel 环境裁剪未做，随 mobile 冻结取消。

签名恢复路径（若将来重启）：服务进程跑 CPython + `pip install xhshow`，失效时 `pip install -U xhshow` 即恢复——比 RustPython 嵌入简单，原评估的「移动端兼容」前提已消解。

## 与文档体系的关系

- `docs/platforms/xhs-signature.md`：461 根因 + 频率证据 + xhs 签名降级决策——**仍有效**，
  本决策的「desktop 服务化」正是其「未来若需恢复」的载体。原 sidecar-eval 的
  RustPython 推荐前提（移动端兼容）已消解、该文档已删，结论（服务进程直接跑 CPython）
  即上节「签名恢复路径」。
- 本文「移动端 CDP：不可行」节：移动端不做浏览器
  模拟——**仍有效**，是本决策移动侧的依据。
- `docs/platforms/channels.md`：平台能力补齐路线图（分区/搜索等发现层缺口）——**规划依据**。
- `docs/platforms/login.md`：四平台扫码登录（bili/weibo/xhs/douyin）全可行——**仍有效**，登录能力
  随服务化沉淀到服务侧。

## 移动端 CDP：不可行

背景：桌面早期实现用 spawn 系统 Edge + CDP（`appHost.browser` 门面）抓微博/小红书；2026-10-22 起改用 WebView2 宿主，2026-10-26 起由数据服务 spawn `amoeba-browser.exe`（同一套 CDP 语义）。评估移动端（Android/iOS）能否做同样的事。

**结论**：移动端复制桌面的「spawn 系统浏览器 + CDP 附加」**不可行/不划算**。iOS 无标准 CDP；Android 可行但强依赖 PC（adb），App 内可连的 WebView CDP 驱动的是自家 WebView（release 默认关 + 指纹弱 + 安全洞）。**移动端走 HTTP/SSR + 登录 cookie 路径**，xhs:user 已 SSR 化恰好是这一步（2026-08-16 改造）。

### Android

| 路径 | 连接方式 | 能否独立(手机本机) | 关键坑 |
|---|---|---|---|
| 系统 WebView（Tauri Android = wry/WebView） | `WebView.setWebContentsDebuggingEnabled(true)` → 设备本地 abstract unix socket `@webview_devtools_remote_<pid>`（pid 从 /proc/net/unix 查；多渲染进程各一 socket） | 技术上本机可连（`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 的开发机路径已验证 CDP 完整），但**驱动的是自己 App 的 WebView**——等价 evaluateJavascript + Network/Storage 域 | **release 默认关**（Tauri 需 devtools flag）；生产开 = 同设备任意进程可拿 DOM/cookie（Ostorlab 安全告警）；WebView 只暴露 page target（无 browser endpoint），`Network.getCookies` 需先 Network.enable 且 cookie 域限当前 origin；**系统 WebView 指纹弱**（UA/X-Requested-With），微博/小红书风控风险同桌面「WebView vs Edge」 |
| Chrome for Android（真实浏览器） | `localabstract:chrome_devtools_remote`（Chrome 起着就有）+ `adb forward`；`/json/version` browser endpoint 比 WebView 全 | **否**，官方全流程都要 PC 起 adb（USB 或无线；无线 Android 11+ 仍 PC 侧 adb pair/connect，双端口且随机） | 需设备展开 Developer Options + USB debugging；App **无法带 `--remote-debugging-port` 拉起系统 Chrome**（需 root/调试 shell）；Termux+Tasker 的 on-device adb hack 极不稳固 |
| 内嵌 Chromium | 自 build content_shell（`content_shell_devtools_remote` socket）/ chromium-aw 当 WebView 引擎 | 能 | Android 无官方 headless Chrome apk；工程量与维护成本极高，不推荐 |

### iOS（不可行）

- **无原生 CDP**。WKWebView/Safari 只有私有 **WebKit Remote Inspector(WIR)** 协议，只能由外部 Mac（Safari/iOS WebKit Debug Proxy）经 usb 配对连接；iwdp/inspect-webkit 等翻译层 CDP 覆盖残缺（iOS 缺 `Network.getResponseBody`/`Network.requestIntercepted` 永不触发 等 ~30 域）。
- Appium + WebDriverAgent：**W3C WebDriver 非 CDP**，测试工具链（Xcode 构建签名 + Developer Mode），非发货 App 运行时能力。
- App Store 指南 **2.5.6 强制 WebKit**；EU(iOS 17.4+) BrowserEngineKit 放行替代引擎但需 Apple entitlement、仅 EU 分发、禁 JIT。iOS 无法内嵌 Chromium。

### 与项目现状对表

- crawler 用的 CDP 薄层是 `packages/resolve/src/browser/cdp.ts`（`cdpFetch/cdpJson/cdpNavigate` + `withBrowserOp` lane），底层 `BrowserBackend` 在 `packages/host/src/browser/`（evaluate/getCookies/tab）——缺的不是 client，是「移动端可连的 CDP 端点浏览器」（移动端没有）。
- `appHost.browser` 是**可选门面**：移动端不注入即自动降级 HTTP/SSR（现有代码已留好降级路径）。
- xhs:user 可 HTTP SSR（须登录 cookie）；`xhs:explore` **必须有抓取浏览器**（登录态 HTTP SSR 只给空壳，见 `explore.ts` 的 `XHS_EXPLORE_NEEDS_BROWSER`）——无浏览器的 mobile 拿不到发现页。weibo:user 浏览器路径 = m.weibo.cn 同源 fetch，HTTP 降级需登录 cookie（冷 cookie 时效要用「失效检测→引导重登」兜底）。

### 建议

1. **不做**移动端浏览频繁模拟。移动端定位 = HTTP/SSR + 登录 cookie。
2. 剩余缺口与路径（复用现有体系）：
   - 扫码登录只走服务 `scanLogin` RPC（`rss login` 与桌面账号页共用；二维码组件 `apps/desktop/src/components/QrImage.tsx`）——mobile 冻结，不再排期；
   - weibo HTTP 降级冷 cookie 时效 → 失效检测 + 引导重登；
   - 若未来必须真浏览器环境（weibo 用户页 API 等）→ 唯一复用桌面 CDP 代码的路径 = **远程服务端跑 Chromium**，移动端经 API/WS 调用（Puppeteer-on-iOS 的普遍替代），不在设备上跑。

### 来源

- Android WebView 调试官方：developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools；Chrome webviews remote debugging
- 安全风险：docs.ostorlab.co/kb/DANGEROUS_API_WEBVIEW_REMOTE_DEBUGGING_ENABLED/
- 驱动 WebView CDP 实测：github.com/readest/readest（apps/readest-app/src/__tests__/android/helpers/cdp.ts）——HTTP 帧非标准需 `Host: localhost`、Runtime.evaluate 可用
- Chrome for Android 调试官方：developer.chrome.com/docs/devtools/remote-debugging（adb forward localabstract:chrome_devtools_remote）
- 无线 adb 双端口坑：buildbench.dev/android-11-wireless-adb-two-ports/
- 内嵌引擎先例：github.com/kevin-smets/android-chromium、github.com/ridi/chromium-aw；Salesforce embedded JS CDP 桥
- iOS：webkit.org/web-inspector/enabling-web-inspector/；developer.apple.com/support/alternative-browser-engines/（EU-only）；Appium hybrid：appium.github.io/appium-xcuitest-driver/latest/guides/hybrid/
- Tauri：v2.tauri.app（Android inspector 需 USB debugging + chrome://inspect）；github.com/tauri-apps/tauri/issues/12492（release 默认不开 WebView debugging）

## WebView2 当抓取浏览器（2026-10-22 决策；现由数据服务 spawn）

**动机**：隐藏 Edge 实例活跃时 private 约 **0.99 GB**，其中约 0.29 GB 是 Edge 自带界面
（Copilot 130MB + discover-chat browser_ui 30MB + 它拉起的 VideoCaptureService 128MB）——
这层 CDP 关不掉、flags 也挡不住。Tauri 自己的 WebView2 没有这一层。

**做法**：数据服务 spawn `amoeba-browser.exe`（`apps/browser-sidecar/src/main.rs`，无 Tauri
依赖的屏外 WebView2 宿主 + CDP，由 `packages/host/src/node/browser-sidecar.ts` 驱动）。
**这是唯一路径**：Tauri 进程内的 `webview_browser_*` 分支（9334 端口 + `TauriBrowserBackend`）
已于 2026-11-01 标 deprecated 并整体删除；`injectTauriHost` 不再注入 browser
（参数保留只为兼容旧调用点）。旧的 spawn-Edge 路径（`commands/browser.rs`）更早已删除。

**生命周期契约**（改这里前先读）：

- **懒创建**：`CdpBrowserBackend` 第一次用浏览器才 `ensureReady` spawn sidecar。
  **唯一例外**：服务 `READY` 后 1.5s 的登录 cookie 快照同步（`server.ts:1209-1219` 调
  `DataLayer.syncBrowserCookies`；桌面的同名方法是 no-op）——存在**启用的** weibo 订阅时
  按需拉起 sidecar 读一次 `Network.getCookies`（不导航），之后 sidecar 常驻供抓取复用。
  xhsCookie 无桌面消费方，只在浏览器已拉起时顺带读。停用/无订阅的平台不会拉起浏览器。
- **就绪判据 = stdout 的 `READY <port>`**（sidecar 在端口真的可连后才输出），不是「进程存在」。
  端口默认由 sidecar 从 127.0.0.1 挑空闲端口，不固定。
- **关闭**：写 stdin `close` 并等浏览器进程退出（5s 超时后 `taskkill /T`）。sidecar 把
  `msedgewebview2.exe` 放进 `KILL_ON_JOB_CLOSE` 的 Job，并等浏览器进程 flush cookie 后才关 Job。
- **单实例**：sidecar 用命名 mutex（`Local\amoeba-cli-browser-<hash>`）锁 profile，第二个
  实例直接报「profile 已被另一个 sidecar 占用」；不同 profile 才能并存。
- **随父进程退出**：service 以 `--parent-pid` spawn，服务退出即 shutdown。
- ⚠️ **lane target = 独立顶层窗口**（WebView2 没有 tab）：`Target.createTarget` 建的窗口
  默认可见且进任务栏。driver 用 `newWindow + 屏外坐标 + background` 创建，sidecar 每 500ms
  tidy（去 `WS_EX_APPWINDOW` 换 `WS_EX_TOOLWINDOW`，hidden `SW_HIDE` / interactive 屏外
  `SW_SHOWNA`）；`mode` 行命令把已有 lane 窗口一并切模式。
- ⚠️ **仅销毁宿主窗口不够**：lane 窗口会让 WebView2 浏览器进程继续存活，留下 profile 占用。
  sidecar 退出时先 Close controller → 销毁窗口 → 等浏览器进程退出（2s）→ 关 Job 兜底杀残留树。

**实测**（Tauri webview，2026-10-22）：CDP `/json/list` + WS + `Runtime.evaluate` +
`Page.navigate` 全通；xhs 首屏 34 条 / 约 0.8s；private 472MB（Edge 992MB），含应用自身 UI
WebView2 合计约 850MB（Edge 1.37GB）。

**指纹（同页面安全上下文）**：`window.chrome.webview` 存在、`navigator.userAgentData.brands`
明文自报 `Microsoft Edge WebView2`；Tauri `.user_agent()` 只改 UA 字符串、UA-CH 不变——要抹掉
只能每个 target `Network.setUserAgentOverride`（= 伪装，与「用真实 Edge」方向相悖）。其余正常
（`webdriver=false`、plugins 5 个、WebGL 真实）。

**结论**：功能与内存都过（判据：CDP 可用、xhs 流程可用、private ≤750MB），**指纹判据不过**。
唯一抓取浏览器 = 服务 spawn 的 `amoeba-browser.exe`（同为 WebView2 宿主）：产品接受 UA-CH
明示 `Microsoft Edge WebView2`，不做 `setUserAgentOverride` 伪装。xhs 匿名态移除后
（2026-10-22），抓取路径统一走登录态，指纹差异的实际影响面进一步收窄。
