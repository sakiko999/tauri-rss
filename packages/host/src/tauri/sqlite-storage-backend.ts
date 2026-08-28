/**
 * SqliteStorageBackend — StorageBackend 的 SQLite 实现(tauri-plugin-sql,sqlx 底层)。
 *
 * 2026-08-28 接入:desktop 存储从 webview localStorage 切到 SQLite(容量/可靠性,
 * 为离线内容缓存铺路)。选型与调研结论见 docs/sqlite-storage-research.md:
 * 用官方插件但**不用其 Rust 侧 migration**——DDL 归 core(db/schema.ts,两端共用,
 * CLI bun:sqlite 同一份),避免 schema 漂移。
 *
 * 首次访问时惰性建连 + 跑迁移 + **localStorage 一次性搬迁**(subscriptions/reading/
 * settings 三 key:sqlite 已有则放弃 local 值并删除 local key 防双源漂移;仅 sqlite
 * 为空时写入)。搬完 localStorage 不再持有状态。
 */
import Database from "@tauri-apps/plugin-sql"
import { KV_TABLE, MIGRATIONS } from "@tauri-playground/core"

/** 库文件(appData 相对路径,插件解析为 BaseDirectory::App)。 */
const DB_PATH = "sqlite:rss.db"

/** localStorage 迁移覆盖的 key(repo 层的三个存储键)。 */
const MIGRATE_KEYS = ["subscriptions", "reading", "settings"] as const

export class SqliteStorageBackend implements StorageBackend {
  private dbPromise: Promise<Database> | null = null
  private readyPromise: Promise<unknown> | null = null

  /** 惰性建连 + 建表 + localStorage 一次性迁移(进程内只跑一次)。 */
  private ready(): Promise<Database> {
    this.dbPromise ??= Database.load(DB_PATH)
    this.readyPromise ??= (async () => {
      const db = await this.dbPromise!
      for (const m of MIGRATIONS) await db.execute(m.sql)
      await this.migrateFromLocalStorage(db)
    })()
    // ready 失败(插件未注册/权限缺失)抛清晰错误。
    return this.readyPromise.then(() => this.dbPromise!)
  }

  private async migrateFromLocalStorage(db: Database): Promise<void> {
    for (const key of MIGRATE_KEYS) {
      const local = localStorage.getItem(`tauri-rss:${key}`)
      if (local === null) continue
      const rows = await db.select<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM ${KV_TABLE} WHERE key = $1`, [key])
      if ((rows[0]?.n ?? 0) === 0) {
        await db.execute(`INSERT INTO ${KV_TABLE} (key, value) VALUES ($1, $2)`, [key, local])
      }
      // sqlite 已有数据(local 是旧值)或刚搬完:移除 local key,杜绝双源漂移。
      localStorage.removeItem(`tauri-rss:${key}`)
    }
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
