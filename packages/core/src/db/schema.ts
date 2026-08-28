/**
 * SQLite schema —— 两端共用的唯一 DDL 权威(docs/cli-plan.md §六:schema/migration
 * 归 core 管,禁止各写各的 SQL 导致漂移)。
 *
 * P1 形态:KV-over-SQLite。三 repo(subscriptions/reading/settings)的数据形态就是
 * 三个 JSON blob,StorageBackend(KV 字符串)语义不变——desktop 换 SQLiteBackend、
 * CLI 换 bun:sqlite,repo 实现零改动。将来需要结构化查询(阅读状态批量/缓存索引)
 * 时,按 repo 逐个拆表:新增表 DDL 加进 MIGRATIONS,两个后端各自执行同一份。
 */

/** KV 表名。 */
export const KV_TABLE = "kv"

/** KV 表 DDL(幂等;两端启动时各执行一次)。 */
export const KV_DDL = `CREATE TABLE IF NOT EXISTS ${KV_TABLE} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`

/**
 * 版本化迁移(表结构演进时追加;version 递增,两端按序执行已记录版本之后的条目)。
 * P1 只有 KV_DDL 一条,无需版本表——幂等 DDL 直接跑。引入非幂等迁移(如拆表搬数据)
 * 时,再补 `_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER)` 版本表,
 * 两个后端复用同一执行逻辑。
 */
export const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [{ version: 1, sql: KV_DDL }]
