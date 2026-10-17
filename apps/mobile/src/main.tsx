import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { injectTauriHost, injectBrowserHost } from "@amoeba/host"
import { App } from "./App.tsx"
import { useMobile } from "./store.ts"
import "./styles.css"

// 注入宿主能力到全局 appHost(core/crawler 从它读 http/js/storage/now)。
// 移动端与桌面共用同一注入(tauri-plugin-sql + Rust http 隧道);不注入 browser
// 门面——移动端不做 CDP 模拟(见 docs/mobile-cdp-feasibility.md),自动降级 HTTP/SSR。
// ⚠️ 纯浏览器(非 Tauri WebView)下 `invoke` 不存在 → 降级 browser host,让
// `vite dev` 能开页调 UI(有 CORS 限制,平台抓取会失败,仅壳层/本地存储可用)。
// ⚠️ updater:false —— 自动更新是桌面专属能力,Rust 侧未给移动端注册插件。
if ("__TAURI_INTERNALS__" in globalThis) injectTauriHost({ updater: false })
else injectBrowserHost()

// dev 调试锚点(同 desktop):CDP 连进来用 `__store.getState()` 读权威状态。
if (import.meta.env.DEV) (globalThis as { __store?: unknown }).__store = useMobile

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
