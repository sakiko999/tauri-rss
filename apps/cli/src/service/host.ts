/**
 * 数据服务宿主注入。
 *
 * 服务进程 = 数据层唯一写者：这里注入 node HTTP/JS/WS + bun:sqlite（desktop 的库）
 * + WebView2 sidecar（profile 也由服务持有）。桌面端只保留 http/js/ws/媒体能力。
 *
 * stdout 契约：除 `READY <port>` 外不写任何东西；日志一律 stderr（宿主 console
 * logger 默认写 stdout，必须替换）。
 */
import {
  createSidecarBrowser,
  locateSidecarBinary,
  nodeBackend,
  nodeJsBackend,
  nodeWsBackend,
} from "@amoeba/host/node"
import { setHostCaps } from "@amoeba/host/runtime"
import { setLogSink } from "@amoeba/log"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { sqliteStorage } from "../store/sqlite-storage.ts"

export interface ServiceHostOptions {
  dbFile: string
  profileDir: string
  /** 显式 sidecar 路径（Tauri 从 resourceDir 传入）；缺省按仓库/同目录探测。 */
  browserSidecar?: string
  /** false = 不注入浏览器（`--no-browser` / 测试）。 */
  browser?: boolean
}

export interface ServiceHost {
  close(): Promise<void>
}

import { shimLocalStorageForLog } from "../host/log-shim.ts"

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_BACKUPS = 7

/**
 * 每天最多一次 `VACUUM INTO` 单文件备份（打开库之前调用）。
 * 失败只记 stderr，不阻止服务启动；备份目录在 dataDir/backups。
 */
export function backupDbIfNeeded(dbFile: string, dataDir: string): void {
  if (!existsSync(dbFile)) return
  const dir = join(dataDir, "backups")
  try {
    mkdirSync(dir, { recursive: true })
    const backups = readdirSync(dir)
      .filter((name) => name.startsWith("rss-") && name.endsWith(".db"))
      .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (backups[0] && Date.now() - backups[0].mtime < BACKUP_INTERVAL_MS) return
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const dest = join(dir, `rss-${stamp}.db`)
    const db = new Database(dbFile, { readonly: true })
    try {
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
      console.error(`[service] db backup: ${dest}`)
    } finally {
      db.close()
    }
    for (const old of backups.slice(MAX_BACKUPS - 1)) {
      rmSync(join(dir, old.name), { force: true })
    }
  } catch (e) {
    console.error(`[service] db backup skipped: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function setupServiceHost(opts: ServiceHostOptions): ServiceHost {
  shimLocalStorageForLog()
  // stdout 契约（只允许 `READY <port>`）：@amoeba/log 的所有级别（含 info/debug）
  // 改走 stderr。此前只有 core 的宿主 Logger 做了这件事，其它包的 console.info 会漏到 stdout。
  setLogSink((level, text) => console.error(`[${level}] ${text}`))
  const storage = sqliteStorage(opts.dbFile)
  const binary = opts.browser === false ? undefined : opts.browserSidecar ?? locateSidecarBinary()
  const browser = binary
    ? createSidecarBrowser({ binary, profileDir: opts.profileDir })
    : undefined
  if (!browser) {
    console.error("[service] browser sidecar not found; browser channels will fail")
  }

  setHostCaps({
    http: nodeBackend(),
    js: nodeJsBackend(),
    storage,
    ws: nodeWsBackend(),
    ...(browser ? { browser } : {}),
    now: Date.now,
  })

  return {
    async close() {
      await browser?.close().catch(() => {})
      storage.close?.()
    },
  }
}
