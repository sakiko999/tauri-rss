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
 * 幂等迁移(表结构演进时追加,两端按序全量执行)。
 * P1 只有 KV_DDL 一条:全部带 `IF NOT EXISTS`,重跑无副作用,所以没有版本表,
 * 也就不保留无消费者的 `version` 字段。引入**非幂等**迁移(如拆表搬数据)时,
 * 先补 `_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER)` 版本表,
 * 再把条目改成 `{ version, sql }`,两个后端复用同一执行逻辑。
 */
export const MIGRATIONS: readonly string[] = [KV_DDL]
