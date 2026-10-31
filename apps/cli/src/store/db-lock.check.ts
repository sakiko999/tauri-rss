/**
 * 库锁 / 实例锁的回收判据自检 —— `bun apps/cli/src/store/db-lock.check.ts`
 *
 * 守的是两种静默错：
 *   - 并发启动时把别人「刚建、还没写完」的空锁当 stale 删掉 → 两个进程都以为持锁（双写者）；
 *   - 真正的 stale（持有者已死 / 很久以前的坏文件）没被回收 → 服务永远起不来。
 */

import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { acquireLock, assertDbNotServed, dbLockPath, releaseLock } from "./db-lock.ts"

const dir = mkdtempSync(join(tmpdir(), "amoeba-db-lock-"))
const me = { pid: process.pid, bootId: "check", dataDir: dir }
const DEAD_PID = 2 ** 22 + 12_345 // 远超常见 pid 范围，视作已死

try {
  // 1. 无锁 → 拿到
  const p1 = join(dir, "a.lock")
  assert.equal(acquireLock(p1, me), null, "无锁时应拿到锁")
  // 2. 活进程持有 → 返回持有者
  assert.equal(acquireLock(p1, { pid: DEAD_PID })?.pid, process.pid, "活进程持有时应返回持有者")

  // 3. 刚建出的空锁（别人 O_EXCL 建了还没写内容）→ 当作有人持有，不能删
  const p2 = join(dir, "b.lock")
  writeFileSync(p2, "")
  assert.deepEqual(acquireLock(p2, me), {}, "5 秒内的空锁应视为被持有（持有者未知）")

  // 4. 很久以前留下的坏锁 → 回收
  const old = new Date(Date.now() - 60_000)
  utimesSync(p2, old, old)
  assert.equal(acquireLock(p2, me), null, "陈旧坏锁应被回收")

  // 5. 持有者已死 → 回收
  const p3 = join(dir, "c.lock")
  writeFileSync(p3, JSON.stringify({ pid: DEAD_PID }))
  assert.equal(acquireLock(p3, me), null, "持有者已死的锁应被回收")

  // 6. 只释放自己持有的锁：bootId 不同就不能删别人的
  const p4 = join(dir, "d.lock")
  writeFileSync(p4, JSON.stringify({ ...me, bootId: "someone-else" }))
  releaseLock(p4, me)
  assert.ok(existsSync(p4), "bootId 不同就不能删别人的锁")
  releaseLock(p4, { pid: process.pid, bootId: "someone-else" })
  assert.ok(!existsSync(p4), "自己的锁应被释放")

  // 7. 进程内开库：自己持有不拦；别人（活）持有 / 刚建的空锁要拦；死人持有不拦
  const db = join(dir, "x.db")
  writeFileSync(dbLockPath(db), JSON.stringify({ pid: process.pid }))
  assertDbNotServed(db)
  writeFileSync(dbLockPath(db), JSON.stringify({ pid: DEAD_PID }))
  assertDbNotServed(db)
  writeFileSync(dbLockPath(db), "")
  assert.throws(() => assertDbNotServed(db), /正被数据服务使用/, "刚建出的空锁也应视为被持有")
  const parent = process.ppid
  if (parent && parent !== process.pid) {
    writeFileSync(dbLockPath(db), JSON.stringify({ pid: parent, dataDir: "other" }))
    assert.throws(() => assertDbNotServed(db), /正被数据服务使用/, "活着的其它进程持有库锁时应拒绝进程内打开")
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log("✔ 锁回收判据自检通过（空锁不误删 / 陈旧坏锁与死进程锁回收 / 进程内开库拦截）")
