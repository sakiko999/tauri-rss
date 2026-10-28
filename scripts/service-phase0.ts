/**
 * 数据服务阶段 0 实测 —— 只读用户库 + 临时库上的确定性实验。
 *
 *   bun scripts/service-phase0.ts
 *
 * 测三件事：
 *   1. bootstrap：content XML → items 的解析耗时、全量 JSON、列表投影体积；
 *   2. 双写者丢更新：两个 reading repo（各自一条 SQLite 连接）并发写，最后只保留一个；
 *      单写者对照：同一 repo 串行写，两个都保留；
 *   3. markManyRead 5k 条耗时（服务端一次事务的目标）。
 *
 * 阈值（超过即 exit 2）：
 *   - 列表投影 ≤ 1MB；解析 ≤ 500ms（服务 boot 预算）；
 *   - 双写者必须复现丢更新，单写者必须不丢（证明防线有效）；
 *   - markManyRead 5k ≤ 200ms。
 */
import { Database } from "bun:sqlite"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createReadingRepository } from "../packages/core/src/repo/reading-repo.ts"
import { deserializeFeed } from "../packages/core/src/processing/deserialize.ts"

const KV_DDL = "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"

type Barrier = { hit: () => void; wait: Promise<void> }

/** 两个读必须都完成旧值读取，再允许写 —— 把竞态变成确定性。 */
function makeBarrier(participants: number): Barrier {
  let hits = 0
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    wait,
    hit: () => {
      hits++
      if (hits >= participants) release()
    },
  }
}

type ClosableStorage = StorageBackend & { close(): void }

/** 最小 StorageBackend（bun:sqlite），只实现 reading repo 用到的方法。 */
function kvStorage(file: string, barrier?: Barrier): ClosableStorage {
  const db = new Database(file, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec(KV_DDL)
  const getStmt = db.prepare("SELECT value FROM kv WHERE key = ?")
  const setStmt = db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
  const delStmt = db.prepare("DELETE FROM kv WHERE key = ?")
  const keysStmt = db.prepare("SELECT key FROM kv WHERE key LIKE ? || '%'")

  return {
    async get(key) {
      const row = getStmt.get(key) as { value?: string } | undefined
      // ⚠️ 先读到旧值，再等另一方也读完；否则 barrier 只能证明“写完再读”。
      barrier?.hit()
      await barrier?.wait
      return row?.value ?? null
    },
    async set(key, value) {
      setStmt.run(key, value)
    },
    async delete(key) {
      delStmt.run(key)
    },
    async keys(prefix = "") {
      return (keysStmt.all(prefix) as Array<{ key: string }>).map((r) => r.key)
    },
    close() {
      db.close()
    },
  } as ClosableStorage
}

function seedReading(file: string): void {
  const db = new Database(file, { create: true })
  db.exec(KV_DDL)
  const seed = {
    [`sub\u0000a`]: { read: true, lastReadAt: 1 },
    [`sub\u0000b`]: { read: true, lastReadAt: 1 },
  }
  db.query("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run("reading", JSON.stringify(seed))
  db.close()
}

function readReading(file: string): Record<string, { read?: boolean }> {
  const db = new Database(file, { readonly: true })
  const row = db.query("SELECT value FROM kv WHERE key = 'reading'").get() as { value?: string } | undefined
  db.close()
  return row?.value ? JSON.parse(row.value) : {}
}

async function dualWriterRepro(dir: string): Promise<{ dualLost: boolean; singleLost: boolean }> {
  const dualFile = join(dir, "dual.db")
  seedReading(dualFile)
  const barrier = makeBarrier(2)
  const s1 = kvStorage(dualFile, barrier)
  const s2 = kvStorage(dualFile, barrier)
  const r1 = createReadingRepository(s1, () => 100)
  const r2 = createReadingRepository(s2, () => 200)
  // 两条命令各自改不同的 item；两个 repo 都基于同一份旧 blob 写回。
  await Promise.all([r1.markRead("sub", "a", false), r2.markRead("sub", "b", false)])
  const afterDual = readReading(dualFile)
  s1.close()
  s2.close()

  const singleFile = join(dir, "single.db")
  seedReading(singleFile)
  const s3 = kvStorage(singleFile)
  const r3 = createReadingRepository(s3, () => 300)
  await r3.markRead("sub", "a", false)
  await r3.markRead("sub", "b", false)
  const afterSingle = readReading(singleFile)
  s3.close()

  return {
    dualLost: !(afterDual["sub\u0000a"]?.read === false && afterDual["sub\u0000b"]?.read === false),
    singleLost: !(afterSingle["sub\u0000a"]?.read === false && afterSingle["sub\u0000b"]?.read === false),
  }
}

async function dbStats(dbFile: string): Promise<Record<string, unknown> | null> {
  if (!(await Bun.file(dbFile).exists())) return null
  const db = new Database(dbFile, { readonly: true })
  const rows = db.query("SELECT key, value FROM kv WHERE key LIKE 'content:%'").all() as Array<{
    key: string
    value: string
  }>
  db.close()

  const t0 = performance.now()
  const items: Array<Record<string, unknown>> = []
  for (const r of rows) {
    const subId = r.key.slice("content:".length)
    try {
      items.push(
        ...(deserializeFeed(r.value, { subscriptionId: subId, now: 0 }) as unknown as Array<Record<string, unknown>>),
      )
    } catch {
      /* 坏缓存跳过：阶段 0 只统计可解析部分 */
    }
  }
  const parseMs = Math.round(performance.now() - t0)
  const full = JSON.stringify(items)
  const projection = items.map((it) => ({
    id: it.id,
    subscriptionId: it.subscriptionId,
    title: it.title,
    url: it.url,
    thumbnail: it.thumbnail,
    kind: it.kind,
    publishedAt: it.publishedAt,
    durationSec: it.durationSec,
    isUnread: it.isUnread,
    isStarred: it.isStarred,
  }))
  const projectionBytes = JSON.stringify(projection).length
  return {
    dbFile,
    contentKeys: rows.length,
    items: items.length,
    parseMs,
    fullJsonMB: +(full.length / 1024 / 1024).toFixed(2),
    projectionJsonMB: +(projectionBytes / 1024 / 1024).toFixed(2),
  }
}

async function markMany5k(dir: string): Promise<number> {
  const file = join(dir, "many.db")
  const db = new Database(file, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec(KV_DDL)
  const seed: Record<string, { read: boolean; lastReadAt: number }> = {}
  for (let i = 0; i < 5000; i++) seed[`sub\u0000${i}`] = { read: false, lastReadAt: 1 }
  db.query("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run("reading", JSON.stringify(seed))
  db.close()

  const storage = kvStorage(file)
  const repo = createReadingRepository(storage, () => 400)
  const keys = Array.from({ length: 5000 }, (_, i) => `sub\u0000${i}`)
  const t0 = performance.now()
  await repo.markManyRead(keys, true)
  const ms = Math.round(performance.now() - t0)
  storage.close()
  return ms
}

async function main(): Promise<void> {
  const dir = join(tmpdir(), `amoeba-service-phase0-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const dbFile = process.env.AMOEBA_PHASE0_DB ?? join(process.env.APPDATA ?? "", "app.amoeba.desktop", "rss.dev.db")

  try {
    const stats = await dbStats(dbFile)
    const { dualLost, singleLost } = await dualWriterRepro(dir)
    const manyMs = await markMany5k(dir)

    const checks = [
      { name: "双写者复现丢更新", ok: dualLost, detail: dualLost ? "已复现（需要单写者）" : "未复现（实验无效）" },
      { name: "单写者不丢更新", ok: !singleLost, detail: singleLost ? "对照也丢（实验无效）" : "两条都保留" },
      {
        name: "列表投影 ≤1MB",
        ok: stats ? (stats.projectionJsonMB as number) <= 1 : true,
        detail: stats ? `${stats.projectionJsonMB}MB` : "无 DB，跳过",
      },
      {
        name: "解析 ≤500ms",
        ok: stats ? (stats.parseMs as number) <= 500 : true,
        detail: stats ? `${stats.parseMs}ms` : "无 DB，跳过",
      },
      { name: "markManyRead 5k ≤200ms", ok: manyMs <= 200, detail: `${manyMs}ms` },
    ]

    console.log(
      JSON.stringify(
        {
          stats,
          dualWriter: { dualLost, singleLost },
          markMany5kMs: manyMs,
          checks,
          pass: checks.every((c) => c.ok),
        },
        null,
        2,
      ),
    )
    if (!checks.every((c) => c.ok)) process.exitCode = 2
  } finally {
    // Windows 上 SQLite/WAL 句柄释放有延迟；清理失败不影响测量结果。
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 留给系统临时目录清理 */
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
