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
  private schema: StorageSchema | null = null

  /**
   * core 在 `createDataLayer()` 首次读写前注入 schema。host 不再 import core 的
   * `db/schema.ts` —— DDL 唯一权威仍是 core，但依赖方向恢复为「core → host」。
   */
  setSchema(schema: StorageSchema): void {
    if (this.dbPromise || this.readyPromise) {
      // 同一份 schema（同表、同一 migrations 数组）重复注入是幂等的：测试/多
      // DataLayer 实例可能复用同一个 backend；不同 schema 才说明装配顺序错了。
      if (this.schema?.table === schema.table && this.schema.migrations === schema.migrations) return
      throw new Error("SqliteStorageBackend: schema 必须在首次读写前注入")
    }
    this.schema = schema
  }

  private requireSchema(): StorageSchema {
    if (!this.schema) {
      throw new Error("SqliteStorageBackend: schema 未注入（core 的 createDataLayer 应先调用 setSchema）")
    }
    return this.schema
  }

  /** 惰性建连 + 建表(进程内只跑一次)。 */
  private ready(): Promise<Database> {
    const schema = this.requireSchema()
    this.dbPromise ??= Database.load(DB_PATH)
    if (!this.readyPromise) {
      // ⚠️ ready 失败(插件未注册/权限缺失/DB 一次性故障)必须**可重试**:`??=` 会把
      // rejected promise 永久留存,之后每次 get/set 都立刻 reject → 进程内 storage 全废。
      // 用 catch 清回 null 让下次调用重跑。
      this.readyPromise = (async () => {
        for (const sql of schema.migrations) await (await this.dbPromise!).execute(sql)
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
    const table = this.requireSchema().table
    const rows = await db.select<Array<{ value: string }>>(`SELECT value FROM ${table} WHERE key = $1`, [key])
    return rows[0]?.value ?? null
  }

  async set(key: string, value: string): Promise<void> {
    const db = await this.ready()
    const table = this.requireSchema().table
    await db.execute(
      `INSERT INTO ${table} (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    )
  }

  async delete(key: string): Promise<void> {
    const db = await this.ready()
    const table = this.requireSchema().table
    await db.execute(`DELETE FROM ${table} WHERE key = $1`, [key])
  }

  async keys(prefix = ""): Promise<string[]> {
    const db = await this.ready()
    const table = this.requireSchema().table
    const rows = await db.select<Array<{ key: string }>>(`SELECT key FROM ${table} WHERE key LIKE $1 || '%'`, [
      prefix,
    ])
    return rows.map((r) => r.key)
  }
}
