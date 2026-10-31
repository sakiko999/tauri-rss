/**
 * rss restore —— 从每日备份恢复数据库（服务停止时执行）。
 *
 * 服务每天 `VACUUM INTO` 一份整库备份到 `<dataDir>/backups/rss-*.db`。此前恢复只能
 * 手工拷文件（评审 2026-11-01）。这里：
 *   - `--list` 列出可用备份；
 *   - 默认取最新一份；`--file` 指定；
 *   - 覆盖前把当前库另存为 `<db>.pre-restore-<时间>`（误恢复可再换回来）；
 *   - **服务在跑时拒绝**（库锁判据），否则就是双写者。
 *
 * ⚠️ 库路径由实例身份决定（dev = `rss.dev.db`，安装版 = `rss.db`），这里不猜：
 * 必须给 `--db`（报错里给出两个典型路径）。
 */

import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import pc from "picocolors"

import { assertDbNotServed } from "../store/db-lock.ts"

const IDENTIFIER: Record<string, string> = {
  dev: "app.amoeba.dev",
  desktop: "app.amoeba.desktop",
}

function defaultServiceDir(profile = "dev"): string {
  const id = IDENTIFIER[profile]
  if (!id) throw new Error(`--profile 只能是 dev|desktop（收到 ${profile}）`)
  const local = process.env.LOCALAPPDATA ?? process.env.HOME ?? process.cwd()
  return join(local, id, "service")
}

function backupsOf(dataDir: string): Array<{ path: string; mtime: number }> {
  const dir = join(dataDir, "backups")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.startsWith("rss-") && n.endsWith(".db"))
    .map((n) => ({ path: join(dir, n), mtime: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
}

export function runRestore(opts: {
  db?: string
  dataDir?: string
  file?: string
  profile?: string
  list?: boolean
}): void {
  const dataDir = opts.dataDir ? resolve(opts.dataDir) : defaultServiceDir(opts.profile)
  const backups = backupsOf(dataDir)
  if (opts.list || !backups.length) {
    if (!backups.length) throw new Error(`没有可用备份：${join(dataDir, "backups")}`)
    console.log(pc.bold(`备份（${dataDir}）：`))
    for (const b of backups) console.log(`  ${new Date(b.mtime).toISOString()}  ${b.path}`)
    if (opts.list) return
  }
  const source = opts.file ? resolve(opts.file) : backups[0]!.path
  if (!existsSync(source)) throw new Error(`备份不存在：${source}`)
  if (!opts.db) {
    throw new Error(
      "需要 --db <库文件>（恢复要覆盖哪个库由实例身份决定）：\n" +
        `  dev     %LOCALAPPDATA%/app.amoeba.dev/rss.dev.db\n` +
        `  安装版  %APPDATA%/app.amoeba.desktop/rss.db\n` +
        `当前备份目录：${dataDir}/backups`,
    )
  }
  const db = resolve(opts.db)
  // 服务在跑 = 库锁被活进程持有：直接拒绝（覆盖就是双写者/撕裂）。
  assertDbNotServed(db)
  if (existsSync(db)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const keep = `${db}.pre-restore-${stamp}`
    copyFileSync(db, keep)
    console.log(pc.dim(`当前库已另存：${keep}`))
  }
  for (const suffix of ["-wal", "-shm"]) rmSync(db + suffix, { force: true })
  copyFileSync(source, db)
  console.log(`${pc.green("✔")} 已从备份恢复：${source}`)
  console.log(pc.dim("重启桌面 / 服务后生效。若恢复错了，用上面的 .pre-restore-* 文件再覆盖回去。"))
}
