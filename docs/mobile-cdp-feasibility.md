# 移动端跑 CDP 可行性调研（2026-08-16）

背景：桌面 `feat/browser-sim` 用 Tauri spawn 系统 Edge + CDP（`appHost.browser` 门面）抓微博/小红书。评估移动端（Android/iOS）能否做同样的事。

**结论**：移动端复制桌面的「spawn 系统浏览器 + CDP 附加」**不可行/不划算**。iOS 无标准 CDP；Android 可行但强依赖 PC（adb），App 内可连的 WebView CDP 驱动的是自家 WebView（release 默认关 + 指纹弱 + 安全洞）。**移动端走 HTTP/SSR + 登录 cookie 路径**，xhs:user 已 SSR 化恰好是这一步（2026-08-16 改造）。

## Android

| 路径 | 连接方式 | 能否独立(手机本机) | 关键坑 |
|---|---|---|---|
| 系统 WebView（Tauri Android = wry/WebView） | `WebView.setWebContentsDebuggingEnabled(true)` → 设备本地 abstract unix socket `@webview_devtools_remote_<pid>`（pid 从 /proc/net/unix 查；多渲染进程各一 socket） | 技术上本机可连（`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 的开发机路径已验证 CDP 完整），但**驱动的是自己 App 的 WebView**——等价 evaluateJavascript + Network/Storage 域 | **release 默认关**（Tauri 需 devtools flag）；生产开 = 同设备任意进程可拿 DOM/cookie（Ostorlab 安全告警）；WebView 只暴露 page target（无 browser endpoint），`Network.getCookies` 需先 Network.enable 且 cookie 域限当前 origin；**系统 WebView 指纹弱**（UA/X-Requested-With），微博/小红书风控风险同桌面「WebView vs Edge」 |
| Chrome for Android（真实浏览器） | `localabstract:chrome_devtools_remote`（Chrome 起着就有）+ `adb forward`；`/json/version` browser endpoint 比 WebView 全 | **否**，官方全流程都要 PC 起 adb（USB 或无线；无线 Android 11+ 仍 PC 侧 adb pair/connect，双端口且随机） | 需设备展开 Developer Options + USB debugging；App **无法带 `--remote-debugging-port` 拉起系统 Chrome**（需 root/调试 shell）；Termux+Tasker 的 on-device adb hack 极不稳固 |
| 内嵌 Chromium | 自 build content_shell（`content_shell_devtools_remote` socket）/ chromium-aw 当 WebView 引擎 | 能 | Android 无官方 headless Chrome apk；工程量与维护成本极高，不推荐 |

## iOS（不可行）

- **无原生 CDP**。WKWebView/Safari 只有私有 **WebKit Remote Inspector(WIR)** 协议，只能由外部 Mac（Safari/iOS WebKit Debug Proxy）经 usb 配对连接；iwdp/inspect-webkit 等翻译层 CDP 覆盖残缺（iOS 缺 `Network.getResponseBody`/`Network.requestIntercepted` 永不触发 等 ~30 域）。
- Appium + WebDriverAgent：**W3C WebDriver 非 CDP**，测试工具链（Xcode 构建签名 + Developer Mode），非发货 App 运行时能力。
- App Store 指南 **2.5.6 强制 WebKit**；EU(iOS 17.4+) BrowserEngineKit 放行替代引擎但需 Apple entitlement、仅 EU 分发、禁 JIT。iOS 无法内嵌 Chromium。

## 与项目现状对表

- crawler CDP 层（`browser/cdp.ts`）是 `BrowserBackend.evaluate/cdpNavigate/getCookies` 薄层——缺的不是 client，是「移动端可连的 CDP 端点浏览器」（移动端没有）。
- `appHost.browser` 是**可选门面**：移动端不注入即自动降级 HTTP/SSR（现有代码已留好降级路径）。
- xhs:user / explore 已全 SSR（HTTP + cookie 即产），无浏览器依赖；weibo:user 浏览器路径 = m.weibo.cn 同源 fetch，HTTP 降级需登录 cookie（冷 cookie 时效要用「失效检测→引导重登」兜底）。

## 建议

1. **不做**移动端浏览频繁模拟。移动端定位 = HTTP/SSR + 登录 cookie。
2. 补三个实际缺口（复用现有体系）：
   - 接入 **Loginable 扫码登录**（已有 `scanLogin` + `ScanLoginDialog` + cookie 落 settings）——随移动端 appHost 接入；
   - weibo HTTP 降级冷 cookie 时效 → 失效检测 + 引导重登；
   - 若未来必须真浏览器环境（weibo 用户页 API 等）→ 唯一复用桌面 CDP 代码的路径 = **远程服务端跑 Chromium**，移动端经 API/WS 调用（Puppeteer-on-iOS 的普遍替代），不在设备上跑。

## 来源

- Android WebView 调试官方：developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools；Chrome webviews remote debugging
- 安全风险：docs.ostorlab.co/kb/DANGEROUS_API_WEBVIEW_REMOTE_DEBUGGING_ENABLED/
- 驱动 WebView CDP 实测：github.com/readest/readest（apps/readest-app/src/__tests__/android/helpers/cdp.ts）——HTTP 帧非标准需 `Host: localhost`、Runtime.evaluate 可用
- Chrome for Android 调试官方：developer.chrome.com/docs/devtools/remote-debugging（adb forward localabstract:chrome_devtools_remote）
- 无线 adb 双端口坑：buildbench.dev/android-11-wireless-adb-two-ports/
- 内嵌引擎先例：github.com/kevin-smets/android-chromium、github.com/ridi/chromium-aw；Salesforce embedded JS CDP 桥
- iOS：webkit.org/web-inspector/enabling-web-inspector/；developer.apple.com/support/alternative-browser-engines/（EU-only）；Appium hybrid：appium.github.io/appium-xcuitest-driver/latest/guides/hybrid/
- Tauri：v2.tauri.app（Android inspector 需 USB debugging + chrome://inspect）；github.com/tauri-apps/tauri/issues/12492（release 默认不开 WebView debugging）

相关：[[edge-swhide-hidden-window]]、[[xhs-user-ssr-loggedin-notes]]