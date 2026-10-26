/**
 * 桌面数据层选择器。
 *
 * - Tauri 桌面：**只连本地数据服务**（Rust spawn `amoeba-runtime` + `service.js`）。
 * - 非 Tauri（浏览器里跑 `bun run dev`）：进程内 `createDataLayer()`，仅纯前端调试。
 *
 * ⚠️ 远端模式失败**不回退本地库**（fail-closed）：否则会出现第二写者，静默丢更新。
 * 桌面进程内回退（旧 `VITE_DATA_SERVICE=0`）已删除，见 main.tsx 的注入注释。
 */
import type { DataLayer } from "@amoeba/core"
import { invoke } from "@tauri-apps/api/core"
import type { EndpointInfo } from "@amoeba/service-protocol"
import { createRemoteDataLayer, type RemoteHooks } from "@amoeba/service-client"

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** 与 packages/host/src/tauri/sqlite-storage-backend.ts 的 DB_PATH 规则保持一致。 */
function dbFileName(): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}
  if (env.PROD === true) return "rss.db"
  if (env.VITE_AMOEBA_PROFILE === "release-debug") return "rss.release-debug.db"
  return "rss.dev.db"
}

export async function createDesktopDataLayer(hooks: RemoteHooks = {}): Promise<DataLayer> {
  if (!isTauri()) {
    // 浏览器 dev（没有 Rust 侧服务）：动态 import 进程内 DataLayer，仅供纯前端调试；
    // 远端模式不把它拉进首屏包。
    const { createDataLayer } = await import("@amoeba/core")
    return createDataLayer()
  }

  const endpoint = await invoke<EndpointInfo>("service_endpoint", { dbFile: dbFileName() })
  return createRemoteDataLayer(endpoint, hooks)
}
