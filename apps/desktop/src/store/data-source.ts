/**
 * 桌面数据层选择器。
 *
 * - Tauri 桌面：默认连本地数据服务（Rust spawn `amoeba-runtime` + `service.js`）。
 * - Web dev / mobile / `VITE_DATA_SERVICE=0`：沿用进程内 `createDataLayer()`（单写者）。
 *
 * ⚠️ 远端模式失败**不回退本地库**（fail-closed）：否则会出现第二写者，
 * 静默丢更新。要本地调试显式设 `VITE_DATA_SERVICE=0`。
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
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}
  const remote = env.VITE_DATA_SERVICE !== "0" && isTauri()
  if (!remote) {
    // 动态 import：远端模式不把 crawler/resolve/本进程 DataLayer 拉进首屏包。
    const { createDataLayer } = await import("@amoeba/core")
    return createDataLayer()
  }

  const endpoint = await invoke<EndpointInfo>("service_endpoint", { dbFile: dbFileName() })
  return createRemoteDataLayer(endpoint, hooks)
}
