/**
 * 运行时启动器 + 服务骨架联调自检：
 *   bun scripts/service-runtime-check.ts
 *
 * 验证：amoeba-runtime 解析到 Bun → spawn 服务 → stdout 只有 READY →
 * token/health 可用 → shutdown 后启动器透传退出码 0。
 * 启动器的解析日志必须全在 stderr，不能污染 READY。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = process.cwd()
// 默认跑源码入口；`SERVICE_ENTRY=dist/service/service.js` 验证打包产物。
const ENTRY = process.env.SERVICE_ENTRY
  ? join(ROOT, process.env.SERVICE_ENTRY)
  : join(ROOT, "apps", "cli", "src", "main.ts")
const LAUNCHERS = [
  join(ROOT, "target", "debug", "amoeba-runtime.exe"),
  join(ROOT, "target", "release", "amoeba-runtime.exe"),
]

function launcher(): string {
  const found = LAUNCHERS.find((p) => existsSync(p))
  if (!found) throw new Error(`找不到 amoeba-runtime.exe；先 cargo build -p amoeba-runtime`)
  return found
}

function readStdout(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let text = ""
  let resolveReady: ((line: string) => void) | null = null
  const ready = new Promise<string>((resolve) => {
    resolveReady = resolve
  })
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      text += dec.decode(value, { stream: true })
      const i = text.indexOf("\n")
      if (i >= 0 && resolveReady) {
        resolveReady(text.slice(0, i).trim())
        resolveReady = null
      }
    }
    if (resolveReady) {
      resolveReady("")
      resolveReady = null
    }
  })()
  return { ready, pump, text: () => text }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "amoeba-service-runtime-"))
  const child = Bun.spawn([launcher(), ENTRY, "--service", "--data-dir", dir], {
    cwd: ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })
  const out = readStdout(child.stdout)

  try {
    const ready = await out.ready
    const m = ready.match(/^READY (\d+)$/)
    add("启动器透传 READY", !!m, ready)
    if (!m) throw new Error("没有 READY")

    const port = Number(m[1])
    const token = readFileSync(join(dir, "service.token"), "utf8").trim()
    const auth = { authorization: `Bearer ${token}` }
    const health = (await (await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: auth })).json()) as {
      ok?: boolean
    }
    add("health", health.ok === true)

    const shutdown = await fetch(`http://127.0.0.1:${port}/v1/shutdown`, { method: "POST", headers: auth })
    add("shutdown 200", shutdown.status === 200, `status=${shutdown.status}`)

    const exit = await child.exited
    add("启动器透传退出码 0", exit === 0, `code=${exit}`)

    await out.pump
    const allOut = out.text()
    add("stdout 只有 READY", allOut.trim() === ready, JSON.stringify(allOut.slice(0, 200)))

    const stderr = await new Response(child.stderr).text()
    add("解析日志在 stderr", stderr.includes("[runtime]"), stderr.trim().slice(0, 200))
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
