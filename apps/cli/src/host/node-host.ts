/**
 * CLI 宿主注入 —— node 后端 + SQLite 存储(bun:sqlite)的组合。
 *
 * 不用 host 包的 injectNodeHost(它绑死内存存储),而是用其导出的单件后端
 * 自行组装:[纪律] ws 必须绑 nodeWsBackend(ws 包)——bili 直播弹幕握手要带
 * Cookie,Bun 原生 WebSocket 是浏览器标准 API 不支持自定义头
 * (docs/cli-plan.md §三),绝不透传原生 WS。
 *
 * log 开关:CLI 环境没有 localStorage,@tauri-playground/log 会视为「开」,
 * crawler/resolve 的数据路径 info/debug 会淹没探针输出。这里垫一个
 * localStorage shim 默认 log="0"(warn/error 永保留),RSS_LOG=1 放开——
 * CLI 的观测面是探针本身的结构化输出,不是散装 log(docs/cli-plan.md §七)。
 */
import { nodeBackend, nodeJsBackend, nodeWsBackend, setHostCaps } from "@tauri-playground/host"
import { sqliteStorage } from "../store/sqlite-storage.ts"

export function setupHost(): void {
  shimLocalStorageForLog()
  setHostCaps({
    http: nodeBackend(),
    js: nodeJsBackend(),
    storage: sqliteStorage(),
    ws: nodeWsBackend(),
  })
}

/** log 开关 shim:默认全局关 info/debug;RSS_LOG=1 放开(等价 log="1")。 */
function shimLocalStorageForLog(): void {
  const value = process.env.RSS_LOG === "1" ? "1" : "0"
  const store = new Map<string, string>([["log", value]])
  const shim = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, v: string) => void store.set(key, v),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: store.size,
  }
  ;(globalThis as Record<string, unknown>).localStorage = shim
}
