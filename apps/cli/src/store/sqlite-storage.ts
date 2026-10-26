/**
 * sqliteStorage — bun:sqlite 实现的 StorageBackend（CLI / 数据服务共用）。
 *
 * 与 desktop 的 SqliteStorageBackend 共用 core 的同一份 DDL（db/schema.ts）。
 * `sqliteStorage(path?)` 允许数据服务打开 desktop 的库；CLI 默认仍是
 * `apps/cli/.data/rss.db`（gitignore）。
 */
import { Database } from "bun:sqlite"
import { STORAGE_SCHEMA } from "@amoeba/core"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

/** 数据目录(apps/cli/.data/,gitignore)。本文件在 src/store/,上两级即包根。 */
export const DATA_DIR = join(import.meta.dir, "../../.data")

/** 库文件实际路径(env 命令展示用)。 */
export function sqliteFilePath(): string {
  return join(DATA_DIR, "rss.db")
}

/** 服务/CLI 共用的打开门禁（与 docs/architecture/system/06-data-service.md §6.2 对齐）。 */
function applyPragmas(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA wal_autocheckpoint = 1000")
  db.exec("PRAGMA journal_size_limit = 67108864")
}

function applySchema(db: Database, schema: StorageSchema): void {
  db.exec(schema.ddl)
  for (const sql of schema.migrations) db.exec(sql)
  if (!schema.versioned) return
  db.exec(schema.versioned.ddl)
  const select = db.prepare(`SELECT checksum FROM ${schema.versioned.table} WHERE version = ?`)
  const insert = db.prepare(
    `INSERT INTO ${schema.versioned.table} (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)`,
  )
  for (const migration of schema.versioned.migrations) {
    const row = select.get(migration.version) as { checksum: string } | undefined
    if (row && row.checksum !== migration.checksum) {
      throw new Error(
        `迁移 checksum 不匹配：version ${migration.version}（${migration.name}）；` +
          `已发布迁移不可修改，请追加新版本`,
      )
    }
    if (!row) insert.run(migration.version, migration.name, Date.now(), migration.checksum)
  }
}

export function sqliteStorage(dbFile = sqliteFilePath()): StorageBackend {
  // ⚠️ bun:sqlite 不会自建父目录 —— 新克隆/CI 上目录不存在时 `new Database`
  // 直接抛 "unable to open database file"(且堆栈里看不出该建目录)。先建。
  mkdirSync(dirname(dbFile), { recursive: true })
  const db = new Database(dbFile, { create: true })
  applyPragmas(db)
  applySchema(db, STORAGE_SCHEMA)

  const getStmt = db.prepare(`SELECT value FROM ${STORAGE_SCHEMA.table} WHERE key = ?`)
  const keysStmt = db.prepare(`SELECT key FROM ${STORAGE_SCHEMA.table} WHERE key LIKE ? || '%'`)
  const setStmt = db.prepare(
    `INSERT INTO ${STORAGE_SCHEMA.table} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
  const deleteStmt = db.prepare(`DELETE FROM ${STORAGE_SCHEMA.table} WHERE key = ?`)

  return {
    async get(key) {
      const row = getStmt.get(key) as { value: string } | undefined
      return row?.value ?? null
    },
    async set(key, value) {
      setStmt.run(key, value)
    },
    async delete(key) {
      deleteStmt.run(key)
    },
    async keys(prefix = "") {
      return (keysStmt.all(prefix) as Array<{ key: string }>).map((r) => r.key)
    },
    setSchema(schema) {
      // 构造时已按 core 的 STORAGE_SCHEMA 建表；注入不同 schema 说明装配顺序/版本错了。
      if (schema.table !== STORAGE_SCHEMA.table) {
        throw new Error(`sqliteStorage: schema 表名不一致（${schema.table} ≠ ${STORAGE_SCHEMA.table}）`)
      }
    },
    close() {
      db.close()
    },
  }
}
