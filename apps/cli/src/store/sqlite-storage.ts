/**
 * sqliteStorage — bun:sqlite 实现的 StorageBackend(CLI 存储后端,2026-08-28 起
 * 替换 file-JSON 版)。与 desktop 的 SqliteStorageBackend 共用 core 的同一份
 * DDL(db/schema.ts),schema 细节零漂移(docs/cli-plan.md §六)。
 *
 * bun:sqlite 内置零依赖同步 API;库文件 apps/cli/.data/rss.db(gitignore)。
 */
import { Database } from "bun:sqlite"
import { KV_TABLE, MIGRATIONS } from "@tauri-playground/core"
import { join } from "node:path"

/** 数据目录(apps/cli/.data/,gitignore)。本文件在 src/store/,上两级即包根。 */
export const DATA_DIR = join(import.meta.dir, "../../.data")

/** 库文件实际路径(env 命令展示用)。 */
export function sqliteFilePath(): string {
  return join(DATA_DIR, "rss.db")
}

export function sqliteStorage(): StorageBackend {
  const db = new Database(sqliteFilePath(), { create: true })
  for (const m of MIGRATIONS) db.exec(m.sql)

  const getStmt = db.prepare(`SELECT value FROM ${KV_TABLE} WHERE key = ?`)
  const keysStmt = db.prepare(`SELECT key FROM ${KV_TABLE} WHERE key LIKE ? || '%'`)
  const setStmt = db.prepare(
    `INSERT INTO ${KV_TABLE} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
  const deleteStmt = db.prepare(`DELETE FROM ${KV_TABLE} WHERE key = ?`)

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
  }
}
