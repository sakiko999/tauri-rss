/**
 * 库文件级单写者锁（2026-11-01）。
 *
 * 锁文件 = `<db>.service.lock`（与库同目录），由数据服务在打开库**之前**持有；
 * 进程内打开同一份库的 CLI 只检查、不持有（并行探针各开各的 CLI 库不受影响）。
 *
 * ⚠️ 为什么不只靠 dataDir 的 instance.lock：两个 dataDir 不同的服务指向同一份库时各自都能
 * 拿到 dataDir 锁 → 双写者，core 的整表 blob 读-改-写会静默丢数据（`--data-dir` 与 `--db`
 * 是两个独立参数，手动起服务时很容易只对齐了 db）。
 * 已知上限：pid 复用 —— 持有者已死而 pid 恰被复用时误判为仍在运行（fail-closed：拒绝启动，
 * 不双写；报错里给出锁文件路径，确认没有服务后可手动删除）。跨机/网络盘不在考虑范围。
 */

import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs"

export interface LockOwner {
  pid?: number
  bootId?: string
  dataDir?: string
  startedAt?: number
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function dbLockPath(dbFile: string): string {
  return `${dbFile}.service.lock`
}

function readLockOwner(path: string): LockOwner | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockOwner
  } catch {
    return null // 不存在 / 坏锁：都当无主
  }
}

/**
 * O_EXCL 建锁；被活进程持有 → 返回持有者；stale（进程已死 / 坏文件）→ 回收重建，返回 null。
 * ⚠️ 「建文件」与「写内容」不是一步：并发启动时可能读到别人刚建、还没写完的空锁。
 * 5 秒内的空/坏锁当作有人持有（返回 `{}`，持有者未知）—— 当 stale 删掉会变成双持有。
 */
export function acquireLock(path: string, owner: LockOwner): LockOwner | null {
  try {
    writeFileSync(path, JSON.stringify(owner), { flag: "wx" })
    return null
  } catch {
    const old = readLockOwner(path)
    if (old?.pid && pidAlive(old.pid)) return old
    if (!old?.pid && createdWithin(path, FRESH_LOCK_MS)) return {}
    rmSync(path, { force: true })
    writeFileSync(path, JSON.stringify(owner), { flag: "wx" })
    return null
  }
}

const FRESH_LOCK_MS = 5_000

function createdWithin(path: string, ms: number): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < ms
  } catch {
    return false
  }
}

/** 库正被另一个活着的数据服务持有时抛错 —— 进程内再打开它就是第二写者。 */
export function assertDbNotServed(dbFile: string): void {
  const owner = readLockOwner(dbLockPath(dbFile))
  if (owner?.pid && owner.pid !== process.pid && pidAlive(owner.pid)) {
    throw new Error(
      `库 ${dbFile} 正被数据服务使用（pid ${owner.pid}，dataDir ${owner.dataDir ?? "?"}）；` +
        `进程内再打开就是第二写者。改用 --via-service / rss attach，或先停掉该服务。`,
    )
  }
}
