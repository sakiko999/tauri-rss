/**
 * CLI 宿主注入 —— node 后端 + SQLite 存储(bun:sqlite)的组合。
 *
 * 不用 host 包的 injectNodeHost(它绑死内存存储),而是用其导出的单件后端
 * 自行组装:[纪律] ws 必须绑 nodeWsBackend(ws 包)——bili 直播弹幕握手要带
 * Cookie,Bun 原生 WebSocket 是浏览器标准 API 不支持自定义头
 * (docs/cli-plan.md §三),绝不透传原生 WS。
 *
 * log 开关:CLI 环境没有 localStorage,@amoeba/log 会视为「开」,
 * crawler/resolve 的数据路径 info/debug 会淹没探针输出。这里垫一个
 * localStorage shim 默认 log="0"(warn/error 永保留),RSS_LOG=1 放开——
 * CLI 的观测面是探针本身的结构化输出,不是散装 log(docs/cli-plan.md §七)。
 */
import {
  createSidecarBrowser,
  locateSidecarBinary,
  nodeBackend,
  nodeJsBackend,
  nodeWsBackend,
} from "@amoeba/host/node"
import { setHostCaps } from "@amoeba/host/runtime"
import { sqliteStorage } from "../store/sqlite-storage.ts"

/**
 * 浏览器是**显式 opt-in**：`--browser` 或 `AMOEBA_BROWSER=1`。
 *
 * ⚠️ 不能默认注入：crawler 的 xhs/weibo 一看到 `appHost.browser` 就走浏览器路径，
 * 并忽略 `--kv cookie=`（HTTP 降级路径会静默失效）。CLI 的浏览器 profile 与桌面
 * 独立，未登录时 xhs 只会报「需要登录」——所以先让用户明确选择。
 */
function browserRequested(): boolean {
  if (process.env.AMOEBA_BROWSER === "0" || process.argv.includes("--no-browser")) return false
  return process.env.AMOEBA_BROWSER === "1" || process.argv.includes("--browser")
}

/**
 * 命令结束时关闭浏览器（优雅：sidecar 会等 WebView2 flush cookie 再退出）。
 * 不调用它会让 Bun 因为子进程句柄一直不退出——命令打印完了却挂住。
 */
export async function closeBrowser(): Promise<void> {
  const browser = globalThis.appHost?.browser
  if (!browser) return
  await browser.close().catch(() => {})
}

export function setupHost(): void {
  shimLocalStorageForLog()
  let browser: BrowserBackend | undefined
  if (browserRequested()) {
    const binary = locateSidecarBinary()
    if (binary) {
      browser = createSidecarBrowser({ binary })
    } else {
      console.warn(
        "⚠️ 未找到 amoeba-browser.exe：先 `cargo build -p amoeba-browser`，" +
          "或设 AMOEBA_BROWSER_SIDECAR=<path>。浏览器渠道将回退/报错。",
      )
    }
  }
  setHostCaps({
    http: nodeBackend(),
    js: nodeJsBackend(),
    storage: sqliteStorage(),
    ws: nodeWsBackend(),
    ...(browser ? { browser } : {}),
  })
}

import { shimLocalStorageForLog } from "./log-shim.ts"
