/**
 * SQLite schema —— 两端共用的唯一 DDL 权威(docs/cli-plan.md §六:schema/migration
 * 归 core 管,禁止各写各的 SQL 导致漂移)。
 *
 * P1 形态:KV-over-SQLite。三 repo(subscriptions/reading/settings)的数据形态就是
 * 三个 JSON blob,StorageBackend(KV 字符串)语义不变——desktop 换 SQLiteBackend、
 * CLI 换 bun:sqlite,repo 实现零改动。将来需要结构化查询(阅读状态批量/缓存索引)
 * 时,按 repo 逐个拆表:新增表 DDL 加进 MIGRATIONS,两个后端各自执行同一份。
 *
 * 版本表 `_migrations(version,name,applied_at,checksum)`：
 *   - 只向前；已应用版本 checksum 变化 → 拒绝启动（防「改了旧迁移没重跑」的静默漂移）；
 *   - DDL 仍幂等，旧库首次打开会补记录；
 *   - 旧 desktop 构建不读这张表，新增它不影响打开。
 */

/** KV 表名。 */
export const KV_TABLE = "kv"

/** KV 表 DDL(幂等;两端启动时各执行一次)。 */
export const KV_DDL = `CREATE TABLE IF NOT EXISTS ${KV_TABLE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`

export const MIGRATIONS_TABLE = "_migrations"

export const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
)`

export interface SchemaMigration {
  version: number
  name: string
  sql: string
  checksum: string
}

/** FNV-1a 32-bit：零依赖、确定性；只用于检测迁移文本变化，不是安全哈希。 */
export function schemaChecksum(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/**
 * 版本化迁移（只追加）。**不要改已发布条目的 sql**；改了 checksum 会让已迁移的库
 * 拒绝启动。要演进就追加新版本。
 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: "kv", sql: KV_DDL, checksum: schemaChecksum(KV_DDL) },
]

/**
 * 兼容旧调用方：按序执行的幂等 SQL。
 * 新代码应使用 `SCHEMA_MIGRATIONS`（带版本/校验和）。
 */
export const MIGRATIONS: readonly string[] = SCHEMA_MIGRATIONS.map((m) => m.sql)

/** 注入给 SQL 后端的完整 schema（core 是唯一权威）。 */
export const STORAGE_SCHEMA: StorageSchema = {
  table: KV_TABLE,
  ddl: KV_DDL,
  migrations: MIGRATIONS,
  versioned: {
    table: MIGRATIONS_TABLE,
    ddl: MIGRATIONS_TABLE_DDL,
    migrations: SCHEMA_MIGRATIONS,
  },
}
