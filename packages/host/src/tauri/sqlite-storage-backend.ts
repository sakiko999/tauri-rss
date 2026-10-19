/**
 * SqliteStorageBackend — StorageBackend 的 SQLite 实现(tauri-plugin-sql,sqlx 底层)。
 *
 * 2026-08-28 接入:desktop 存储从 webview localStorage 切到 SQLite(容量/可靠性,
 * 为离线内容缓存铺路)。选型与调研结论见 docs/sqlite-storage-research.md:
 * 用官方插件但**不用其 Rust 侧 migration**——DDL 归 core(db/schema.ts,两端共用,
 * CLI bun:sqlite 同一份),避免 schema 漂移。
 *
 * 首次访问时惰性建连 + 跑迁移。
 */
import Database from "@tauri-apps/plugin-sql"
import { KV_TABLE, MIGRATIONS } from "@amoeba/core"

/**
 * 库文件(appData 相对路径,插件解析为 BaseDirectory::App)。
 *
 * 按运行形态隔离,避免 VSCode 的 dev / release debug 与正式安装版互相污染:
 *   - 生产构建(Vite build,PROD=true)      → rss.db
 *   - `tauri dev --release`(VITE_AMOEBA_PROFILE) → rss.release-debug.db
 *   - 普通 dev                              → rss.dev.db
 * ⚠️ `import.meta.env` 用可选链容错:CLI(Bun)也会 import 本模块,但不会实例化。
 */
const viteEnv = (import.meta as unknown as { env?: { PROD?: unknown; VITE_AMOEBA_PROFILE?: unknown } }).env ?? {}
const DB_PATH =
  viteEnv.PROD === true
    ? "sqlite:rss.db"
    : viteEnv.VITE_AMOEBA_PROFILE === "release-debug"
      ? "sqlite:rss.release-debug.db"
      : "sqlite:rss.dev.db"

export class SqliteStorageBackend implements StorageBackend {
  private dbPromise: Promise<Database> | null = null
  private readyPromise: Promise<unknown> | null = null

  /** 惰性建连 + 建表(进程内只跑一次)。 */
  private ready(): Promise<Database> {
    this.dbPromise ??= Database.load(DB_PATH)
    if (!this.readyPromise) {
      // ⚠️ ready 失败(插件未注册/权限缺失/DB 一次性故障)必须**可重试**:`??=` 会把
      // rejected promise 永久留存,之后每次 get/set 都立刻 reject → 进程内 storage 全废。
      // 用 catch 清回 null 让下次调用重跑。
      this.readyPromise = (async () => {
        for (const m of MIGRATIONS) await (await this.dbPromise!).execute(m.sql)
      })().catch((e) => {
        this.readyPromise = null
        this.dbPromise = null // 连接也可能坏了(load 成功但 execute 失败)→ 一并重建
        throw e
      })
    }
    return this.readyPromise.then(() => this.dbPromise!)
  }

  async get(key: string): Promise<string | null> {
    const db = await this.ready()
    const rows = await db.select<Array<{ value: string }>>(`SELECT value FROM ${KV_TABLE} WHERE key = $1`, [key])
    return rows[0]?.value ?? null
  }

  async set(key: string, value: string): Promise<void> {
    const db = await this.ready()
    await db.execute(
      `INSERT INTO ${KV_TABLE} (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    )
  }

  async delete(key: string): Promise<void> {
    const db = await this.ready()
    await db.execute(`DELETE FROM ${KV_TABLE} WHERE key = $1`, [key])
  }

  async keys(prefix = ""): Promise<string[]> {
    const db = await this.ready()
    const rows = await db.select<Array<{ key: string }>>(
      `SELECT key FROM ${KV_TABLE} WHERE key LIKE $1 || '%'`,
      [prefix],
    )
    return rows.map((r) => r.key)
  }
}
