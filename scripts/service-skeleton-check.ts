/**
 * 阶段 0 服务骨架自检：
 *   bun scripts/service-skeleton-check.ts
 *
 * 验证：READY、token 认证、/v1/hello、/v1/state、WS 首帧认证、单实例锁、库文件锁
 * （同库异 dataDir → 4；进程内直开 → 拒绝）、shutdown 清理。
 * 临时 dataDir 结束后删除。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sqliteStorage } from "../apps/cli/src/store/sqlite-storage.ts"

const ROOT = process.cwd()
const ENTRY = join(ROOT, "apps", "cli", "src", "main.ts")

function spawnService(dir: string, extra: string[] = []) {
  return Bun.spawn([process.execPath, ENTRY, "--service", "--data-dir", dir, ...extra], {
    cwd: ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`stdout 结束但没有 READY（已收到: ${buf}）`)
    buf += dec.decode(value, { stream: true })
    const i = buf.indexOf("\n")
    if (i >= 0) return buf.slice(0, i).trim()
  }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "amoeba-service-skeleton-"))
  const child = spawnService(dir)
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })

  try {
    const ready = await firstLine(child.stdout)
    const m = ready.match(/^READY (\d+)$/)
    add("stdout READY", !!m, ready)
    if (!m) throw new Error("没有 READY")

    const port = Number(m[1])
    const token = readFileSync(join(dir, "service.token"), "utf8").trim()
    add("token 已写入", token.length > 0)

    const unauth = await fetch(`http://127.0.0.1:${port}/v1/hello`)
    add("无 token → 401", unauth.status === 401, `status=${unauth.status}`)

    const auth = { authorization: `Bearer ${token}` }
    const hello = (await (await fetch(`http://127.0.0.1:${port}/v1/hello`, { headers: auth })).json()) as {
      protocol?: number
      bootId?: string
      pid?: number
    }
    add("hello 协议", hello.protocol === 1 && !!hello.bootId && hello.pid === child.pid)

    const health = (await (await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: auth })).json()) as {
      ok?: boolean
    }
    add("health", health.ok === true)

    const stateText = await (await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: auth })).text()
    add("state 有 snapshot.end", stateText.includes('"type":"snapshot.end"'))

    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/events`)
    const wsHello = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3_000)
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }))
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as { type?: string }
        if (msg.type === "hello") {
          clearTimeout(timer)
          resolve(true)
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        resolve(false)
      }
    })
    ws.close()
    add("WS 首帧认证 + hello", wsHello)

    // 第二个实例：同 dataDir 必须拒绝。
    const second = spawnService(dir)
    const code = await second.exited
    const stderr = await new Response(second.stderr).text()
    add("单实例锁 → 退出码 3", code === 3, `code=${code}`)
    add("ALREADY_RUNNING", stderr.includes("ALREADY_RUNNING"), stderr.trim().slice(-200))

    // 第三个实例：dataDir 不同但指向同一份库 —— dataDir 锁各拿各的，必须由库锁拒绝（退出码 4）。
    const dbFile = join(dir, "rss.db")
    const otherDir = mkdtempSync(join(tmpdir(), "amoeba-service-skeleton-b-"))
    try {
      const third = spawnService(otherDir, ["--db", dbFile])
      const code4 = await third.exited
      const stderr4 = await new Response(third.stderr).text()
      add("同库异 dataDir → 退出码 4", code4 === 4, `code=${code4}`)
      add("DB_IN_USE", stderr4.includes("DB_IN_USE"), stderr4.trim().slice(-200))
      add("被拒实例不留 dataDir 锁", !existsSync(join(otherDir, "instance.lock")))
    } finally {
      rmSync(otherDir, { recursive: true, force: true })
    }

    // 进程内直开服务持有的库（CLI 直开桌面库的形态）→ 拒绝，而不是成为第二写者。
    let refused = ""
    try {
      sqliteStorage(dbFile)
    } catch (e) {
      refused = String(e)
    }
    add("进程内直开服务持有的库 → 拒绝", refused.includes("正被数据服务使用"), refused.slice(0, 120))

    const shutdown = await fetch(`http://127.0.0.1:${port}/v1/shutdown`, { method: "POST", headers: auth })
    add("shutdown 200", shutdown.status === 200, `status=${shutdown.status}`)
    const exit = await child.exited
    add("服务退出码 0", exit === 0, `code=${exit}`)
    add("endpoint 已删除", !existsSync(join(dir, "endpoint.json")))
    add("lock 已删除", !existsSync(join(dir, "instance.lock")))
    add("库锁已删除", !existsSync(`${dbFile}.service.lock`))
  } finally {
    try {
      child.kill()
    } catch {
      /* 已退出 */
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 句柄延迟 */
    }
  }

  const pass = checks.every((c) => c.ok)
  console.log(JSON.stringify({ checks, pass }, null, 2))
  if (!pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
