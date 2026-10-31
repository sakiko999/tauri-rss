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
import { createRemoteDataLayer, type RemoteHooks } from "@amoeba/service-client"
import type { EndpointInfo } from "@amoeba/service-protocol"
import { invoke } from "@tauri-apps/api/core"

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
    // 远端模式不把它拉进首屏包。rsshub provider 靠模块副作用注册，只有进程内
    // DataLayer 用得上（Tauri 下由数据服务入口自己注册）。
    // ⚠️ desktop 其余位置只许 `import type` core 根入口、值导入走 `@amoeba/core/pure`，
    // 否则这里的动态 import 失效、crawler/resolve 回到首屏包（core-imports.check.ts）。
    const [{ createDataLayer }] = await Promise.all([import("@amoeba/core"), import("@amoeba/core/source/rsshub")])
    return createDataLayer()
  }

  const endpoint = await invoke<EndpointInfo>("service_endpoint", { dbFile: dbFileName() })
  return createRemoteDataLayer(endpoint, hooks)
}
