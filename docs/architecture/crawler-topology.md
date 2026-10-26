# 爬虫拓扑：desktop 服务化与移动端边界
> 合并自 desktop-crawler-service.md + mobile-cdp-feasibility.md（2026-10-21 整理）。前者是 desktop/mobile 数据供给分离的决策依据与形态选型，后者是「移动端为什么不能复用 CDP」的结论。

> **决策**：打破 desktop/mobile 完全一致性。desktop 数据供给走**独立爬虫服务**
> （本机 sidecar 或自部署服务，承载重反爬平台）；mobile 保持**内置 crawler**，
> 仅支持有限平台。下文记录决策依据（RSSHub / MediaCrawler 对照调研）与形态选型空间，
> 以及移动端不能复用 CDP 的实测依据。

## 决策背景与动机

- **反爬已升级到「浏览器级」**：xhs 需滚动驱动 + 验证码检测（`.fe-verify-box`）、
  weibo cookie 分钟级时效、签名 1 月~1 季度一改 + 按账号/会话灰度分发。
  这些手段需要桌面环境特权（spawn 系统浏览器、CDP、持久 profile、无沙箱限制），
  mobile 沙箱给不了（见 `docs/architecture/crawler-topology.md` 的「移动端 CDP：不可行」：
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

## RSSHub / MediaCrawler 对照调研（2026-08-25，两只读 agent 实读代码）

### RSSHub（lib/routes/xiaohongshu, lib/routes/weibo）

| 维度 | 小红书 | 微博 |
|---|---|---|
| 数据路径 | **全 SSR HTML**，无签名 API | **m.weibo.cn 容器 API**（getIndex/…），无签名 |
| 签名 | **无任何 x-s/webmsxyw 代码** | 无（仅 MWeibo-Pwa/X-Requested-With 固定头） |
| 浏览器 | Playwright 渲染 SSR（或 `XIAOHONGSHU_PROXY` 代理直连替代） | 仅用于拿**访客 cookie**（缓存+节流续期，`ok===-100`/432 触发换新） |
| cookie | `XIAOHONGSHU_COOKIE`，仅全文/收藏/check-cookie 必需 | `WEIBO_COOKIES`；公开路由可访客模式，私密路由强制 |
| 风控 | `.fe-verify-box` → CaptchaError | 432/`ok===-100` → 换访客 cookie 重试 |
| 匿名可用 | notes/board 匿名可跑（丢收藏，易验证码） | oasis 匿名；user/keyword/super-index/hot 访客模式可 |
| 路由稳定性 | **依赖 Playwright 运行时**（或 proxy），自部署不「免维护」 | 同左 |

### RSSHub 运行时实测（2026-08-25，git bff8a52 + patchright chromium 1234）

本机起 dev 服务（`pnpm dev`，port 1200）实测 4 条路由，**零配置匿名**：

| 路由 | 结果 | 详情 |
|---|---|---|
| `/weibo/search/hot` | ✅ 200（2.2s） | 访客 cookie 自动 Playwright 拉取；「微博热搜榜」完整 RSS |
| `/weibo/user/1195230310` | ✅ 200（1.5s） | 「何炅的微博」完整 RSS（标题/图/链接），**无需配任何 cookie** |
| `/xiaohongshu/user/:id/notes` | ❌ 503（7s） | `小红书未返回用户数据`——匿名 SSR 的 `userPageData` 是空对象 `{}`（无 basicInfo）、`user.notes` 是 5 个空分组数组；Playwright 渲染也一样（页面骨架需要登录态） |
| `/xiaohongshu/board/:id` | ❌ 503（30s 超时） | `waitForSelector('.pc-container')` 超时——board 页 SSR 数据全空壳（`boardDetails:[]`、`boardFeedsMap[id].notes:[]`），`.pc-container` 已不存在（改版），**上游匿名模式当前就是坏的** |

对照探针（同机裸 fetch + 平衡括号提取 `__INITIAL_STATE__`）：**explore 匿名可用**
（`feed.feeds` 30 条，与我们 crawler `xhs:explore` 实测 31 条一致）；**user/board
匿名拿不到数据**——user 页匿名 SSR 空分组是已知结论（CLAUDE.md 已记），board 是
本次新发现（RSSHub 该路由等的选择器已过时 + 数据需登录态）。

**实测结论**：RSSHub weibo 路由（访客 cookie 模式）开箱即用质量不错；xhs 路由匿名
全灭，配 `XIAOHONGSHU_COOKIE` 后 user/notes 才可能通（getUserWithCookie 分支），
board 大概率仍坏（等不到选择器）。另注意：RSSHub 已从 playwright 换 **patchright**
（反检测 fork），部署时浏览器二进制约 700MB（ms-playwright 缓存）。
（`pnpm install` 4min、`patchright install chromium` 必做、dev 启动 ~10s。）

### MediaCrawler（media_platform/xhs, media_platform/weibo）

| 维度 | xhs | weibo |
|---|---|---|
| 请求 | **纯 httpx** 打 edith API，浏览器零业务请求 | **纯 httpx** 打 m.weibo.cn，浏览器仅在 432 异常时 goto 刷新 cookie |
| 签名 | **Python xhshow 纯算法**（`sign_with_xhshow`，xhshow>=0.2.0）——**已放弃浏览器内取签**，旧 JS 注入代码退化为遗留；浏览器仅作登录容器（扫码/验证码/cookie 注入） | 无签名，纯 cookie |
| 登录 | 扫码 / 手机验证码 / cookie（仅 web_session） | 扫码 / cookie（注 .weibo.cn）；登录后**强制 goto m.weibo.cn 切移动端 cookie** |
| 生命周期 | **常驻单例 BrowserContext**（整个爬取全程） + httpx 快照 cookie | 同左 |
| 反爬应对 | 461/471 读 Verifytype 抛异常，**手动过滑块**（默认非 headless） | 432 → goto 首页刷 cookie 重试（5 次） |
| IP | ProxyRefreshMixin 每请求前查代理池（kuaidaili 等） | 同左 |

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

## 形态选型空间（待用户选型后补充最终结论）

| 方案 | 说明 | 优劣 |
|---|---|---|
| **A. 自研 sidecar** | crawler 包 + 薄 HTTP 层（Bun） + injectNodeHost | 代码 100% 复用；浏览器模拟/扫码登录/cookie 走 appHost.browser 同款路径；与 example/browser-sim 同构 |
| **B. RSSHub 自部署** | 桌面只消费 RSSHub 路由 | 路由现成但两平台同样要配 cookie；签名维护押注社区；与我们已复刻的 crawler 能力大面积重复；xhs 无签名 → 无分页 |
| **C. 混合** | 自研为主 + RSSHub 补充长尾平台 | A 的超集，按需开 |

**初步倾向 A**（代码全复用 + 反爬资产自持），RSSHub 可随时作为 C 叠加。**最终结论待用户选型**。

> 术语：本节的 sidecar = **爬虫取数服务**（Bun/HTTP）。CLI 的 `amoeba-browser` 是
> **浏览器宿主**（无 Tauri 的 WebView2 + CDP），两者不是同一个东西；后者已在
> `apps/browser-sidecar/` 落地（`rss --browser`）。
>
> 2026-10-26 决策升级：取数服务与 core/storage 合并为 `rss --service` 单写者数据服务，
> desktop/CLI 都做客户端；本节的形态 A 只是它的子集。计划见
> `docs/architecture/system/06-data-service.md`。

## 切分边界（规划期细化）

- **服务化范围**：feed 层（fetch/fetchMore + 扫码登录）。`resolvePlay`/`getDanmaku`
  留在前端内置——直链解析是纯算法签名，WebView 跑得动；弹幕是长连接，经服务代理反而复杂。
- **channel 元数据**：`GET /channels` 端点，或前端保留元数据子集（mobile 仍直接 import）。
- **mobile 裁剪**：channel 加环境标记（xhs/weibo = desktop-only），mobile 构建时裁掉。
  实际能力损失小——丢的只有 xhs/weibo feed，rss 直链/bili/youtube/直播四平台全保留
  （纯算法或免登录）；mobile 播放/弹幕能力不受影响。
- **架构对齐**：core 层 HTTP 化路线（feed 路由层）可与本决策合并落地
  （原 `core-architecture-refactor.md` 已实施完并入本文，该文档已删）。
- **签名恢复路径（若选 A）**：服务进程跑 CPython + `pip install xhshow`，失效时
  `pip install -U xhshow` 即恢复——比 RustPython 嵌入（16MB + 每平台打包链）简单，
  原评估结论的前提（移动端兼容）已随本决策消解。

## 与文档体系的关系

- `docs/platforms/xhs-signature.md`：461 根因 + 频率证据 + xhs 签名降级决策——**仍有效**，
  本决策的「desktop 服务化」正是其「未来若需恢复」的载体。原 sidecar-eval 的
  RustPython 推荐前提（移动端兼容）已消解、该文档已删，结论（服务进程直接跑 CPython）
  即上节「签名恢复路径」。
- `docs/architecture/crawler-topology.md` 的「移动端 CDP：不可行」节：移动端不做浏览器
  模拟——**仍有效**，是本决策移动侧的依据。
- `docs/platforms/channels.md`：平台能力补齐路线图（分区/搜索等发现层缺口）——**规划依据**。
- `docs/platforms/login.md`：三平台扫码登录全可行——**仍有效**，登录能力
  随服务化沉淀到服务侧。
- `docs/README.md`：Folo 云端聚合不能照搬的前提已变——现在可以
  拿它的生产者/消费者分离，服务放本机。**前提变化**，结论可部分翻案。

## 后续落地需回答（规划另起任务）

sidecar 生命周期（Tauri spawn/端口协商/随 app 退出）、core 的 feed 路由层、
channel 环境标记与 mobile 裁剪、HTTP 端点设计（与 crawler fetch/fetchMore 契约对齐）。

> 落地记录与 RSSHub 对照已并入 `docs/platforms/channels.md`（消费契约 / 验证 / 遗留）。

## 移动端 CDP：不可行

背景：桌面早期实现用 spawn 系统 Edge + CDP（`appHost.browser` 门面）抓微博/小红书；2026-10-22 已换成 Tauri WebView2。评估移动端（Android/iOS）能否做同样的事。

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

- crawler CDP 层（`browser/cdp.ts`）是 `BrowserBackend.evaluate/cdpNavigate/getCookies` 薄层——缺的不是 client，是「移动端可连的 CDP 端点浏览器」（移动端没有）。
- `appHost.browser` 是**可选门面**：移动端不注入即自动降级 HTTP/SSR（现有代码已留好降级路径）。
- xhs:user / explore 已全 SSR（HTTP + cookie 即产），无浏览器依赖；weibo:user 浏览器路径 = m.weibo.cn 同源 fetch，HTTP 降级需登录 cookie（冷 cookie 时效要用「失效检测→引导重登」兜底）。

### 建议

1. **不做**移动端浏览频繁模拟。移动端定位 = HTTP/SSR + 登录 cookie。
2. 补三个实际缺口（复用现有体系）：
   - 接入 **Loginable 扫码登录**（已有 `scanLogin` + 凭证页 `QrImage` + cookie 落 settings）——随移动端 appHost 接入；
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

相关：[[edge-swhide-hidden-window]]、[[xhs-user-ssr-loggedin-notes]]

## WebView2 当抓取浏览器（2026-10-22 决策：已合入）

**动机**：隐藏 Edge 实例活跃时 private 约 **0.99 GB**，其中约 0.29 GB 是 Edge 自带界面
（Copilot 130MB + discover-chat browser_ui 30MB + 它拉起的 VideoCaptureService 128MB）——
这层 CDP 关不掉、flags 也挡不住。Tauri 自己的 WebView2 没有这一层。

**做法**（`apps/src-tauri/src/webview_browser.rs`）：用 `WebviewWindowBuilder` 建一个**隐藏**
webview（独立 `data_directory` + `--remote-debugging-port=9334`，Tauri 文档要求「参数不同的
webview 必须配不同 data dir」），TS 后端调 `webview_browser_open/set_mode/close/reset`。
旧的 spawn-Edge 路径（`commands/browser.rs`）已随合并删除。

**生命周期契约**（2026-10-22 修正，改这里前先读）：

- **懒创建**：第一次抓取才建；空闲回收（3 分钟）关掉后不会被开机重新拉起。
  **唯一例外**：启动后 1.5s 的登录 cookie 快照同步（`DataLayer.syncBrowserCookies`）——
  存在**启用的** weibo 订阅时主动拉起一次（weiboCookie 是桌面 HTTP 消费方），只读
  `Network.getCookies`（不导航），读完交给空闲回收关闭；xhsCookie 无桌面消费方，
  只在浏览器已因 weibo 被拉起时顺带读。停用/无订阅的平台不会拉起浏览器。
- `open` 的就绪判据是 **CDP 端口真的可连**，不是「窗口对象存在」；半启动 / 端口未就绪时
  销毁重建，不会把假端口交给 TS。
- `close` 用 `destroy()` 并**等到窗口销毁 + 端口释放**才返回（`open/close/reset/set_mode`
  共用同一把 OP 锁）—— 否则紧接着的重建会撞上旧 WebView2 环境占着的 user-data-dir / 端口。
- 没有窗口却有人监听 9334：**先校验归属（父进程链是否走到本进程）**。属于本进程树的
  残留 → `taskkill /T`；不属于（另一个应用实例）→ 返回「端口被占用」，绝不误杀/误连。
  外部控制台命令（netstat/taskkill）一律带 `CREATE_NO_WINDOW`（release 是 GUI 子系统）。
- ⚠️ **抓取 webview 是第二个窗口**：只关主窗口时 Tauri 的 windows 集合非空，不会自动退出，
  进程会变成不可见僵尸。`lib.rs` 在 `main` 窗口 `Destroyed` 时显式 `exit(0)`。
- 不在 `RunEvent::Exit` 里做清理：该事件在 `Event::LoopDestroyed` 才回调，投递窗口消息
  已无人处理。进程退出会带走 WebView2 子进程（带 lane 窗口关闭主窗口已实机验证）。
- ⚠️ **lane target = 独立顶层窗口**（WebView2 没有 tab）：`Target.createTarget` 建的窗口
  不归 Tauri 管，默认可见且进任务栏。TS 侧用 `newWindow + 屏外坐标 + background` 创建，
  创建后立刻调 `webview_browser_tidy`（Win32：去 `WS_EX_APPWINDOW` 换 `WS_EX_TOOLWINDOW`，
  hidden `SW_HIDE` / interactive 屏外 `SW_SHOWNA`）。`set_mode` 也会把已有 lane 窗口
  一并切模式。
- ⚠️ **仅销毁宿主窗口不够**：lane 窗口会让 WebView2 浏览器进程（和 9334）继续存活，
  下次 `open` 会撞 user-data-dir。`close` 在宿主销毁后若端口仍活，直接杀整棵进程树。

**实测**

| 维度 | 结果 |
| --- | --- |
| CDP | ✅ `/json/list` + WS + `Runtime.evaluate` + `Page.navigate` 全通，TS 侧无需改动 |
| xhs 首屏 | ✅ 34 条 / 约 0.8s |
| xhs 匿名滚动 | 首轮 ✅ 34 → 53 → 72 → 88 条，无 verify（headless 同路径撞 `300012`）；⚠️ **同一 profile 连续第二轮**撞 `300011`「账号异常」+ verify —— 风控是累积的，与浏览器形态无关 |
| 内存（同一页面） | 7 进程 / WS 775MB / **private 472MB**（Edge 是 992MB） |
| 合计（含应用自身 UI WebView2 375MB） | **约 850MB**（现在是 1.37GB） |

**指纹（同页面安全上下文）**

- `window.chrome.webview` **存在**（`window.chrome` keys: `loadTimes,csi,app,webview`）；
- `navigator.userAgentData.brands` = `["Microsoft Edge WebView2/155", "Not(A:Brand/24",
  "Microsoft Edge/155", "Chromium/155"]` —— **明文自报 WebView2**；
- Tauri `.user_agent()` 只改 UA 字符串，**UA-CH 不变**；要抹掉只能在每个 target 上
  CDP `Network.setUserAgentOverride` 覆盖 `userAgentMetadata`（= 伪装，方向与「用真实 Edge」
  相悖）；
- 其余正常：`webdriver=false`、plugins 5 个、WebGL 是真实 Intel Arc。

**结论**：功能与内存都过（判据：CDP 可用、xhs 流程可用、private ≤750MB），**但指纹判据不过**。
已合入 master 并作为唯一抓取浏览器：产品接受了 UA-CH 明示 `Microsoft Edge WebView2`
（不做 `setUserAgentOverride` 伪装 —— 那与「用真实浏览器」的方向相悖）。
xhs 匿名态移除后（2026-10-22），抓取路径统一走登录态，指纹差异的实际影响面进一步收窄。
