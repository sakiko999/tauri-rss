/**
 * 快照体积实测：给定一份库（默认取桌面 dev 库），在临时副本上起服务，
 * 分别按 identity / gzip 拉 `/v1/state`，报原始与传输字节数。
 *
 *   bun scripts/service-snapshot-size.ts [--db <rss.db>] [--max-kb 1024]
 *
 * 断言：gzip 传输量 ≤ --max-kb（默认 1MB，文档里的快照预算）。
 * 只读副本：原库不会被服务写（--no-browser / --no-cookie-sync）。
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = process.cwd()
const ENTRY = join(ROOT, "apps", "cli", "src", "main.ts")

const argv = process.argv.slice(2)
const dbArg = argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : undefined
const maxKb = Number(argv.includes("--max-kb") ? argv[argv.indexOf("--max-kb") + 1] : "1024")
const sourceDb = dbArg ?? join(process.env.APPDATA ?? "", "app.amoeba.desktop", "rss.dev.db")

async function main(): Promise<void> {
  if (!sourceDb || !existsSync(sourceDb)) {
    throw new Error(`找不到库：${sourceDb}（用 --db 指定）`)
  }
  const dir = mkdtempSync(join(tmpdir(), "amoeba-snapshot-size-"))
  const dbFile = join(dir, "rss.db")
  copyFileSync(sourceDb, dbFile)
  // WAL 里有未落盘的提交，一起复制（不存在则跳过）。
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(sourceDb + suffix)) copyFileSync(sourceDb + suffix, dbFile + suffix)
  }

  const child = Bun.spawn(
    [
      process.execPath,
      ENTRY,
      "--service",
      "--data-dir",
      dir,
      "--db",
      dbFile,
      "--profile-dir",
      join(dir, "profile"),
      "--no-browser",
      "--no-cookie-sync",
    ],
    { cwd: ROOT, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  )

  try {
    const ready = await firstLine(child.stdout)
    const m = ready.match(/^READY (\d+)$/)
    if (!m) throw new Error(`服务未就绪：${ready}`)
    const port = Number(m[1])
    const token = readFileSync(join(dir, "service.token"), "utf8").trim()
    const auth = { authorization: `Bearer ${token}` }

    // identity：不声明 gzip，服务端原样返回 NDJSON。
    const identity = await (await fetch(`http://127.0.0.1:${port}/v1/state`, {
      headers: { ...auth, "accept-encoding": "identity" },
    })).text()
    // gzip：fetch 自动解压，用同一文本重压一次得到**线上传输字节**（与服务端同库同级别）。
    const gzipRes = await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: auth })
    const gzipText = await gzipRes.text()
    const encoding = gzipRes.headers.get("content-encoding")

    const items = identity
      .trim()
      .split("\n")
      .filter((l) => l.startsWith('{"type":"items"'))
      .flatMap((l) => (JSON.parse(l) as { items?: unknown[] }).items ?? []).length
    const identityBytes = new TextEncoder().encode(identity).length
    const gzipBytes = Bun.gzipSync(new TextEncoder().encode(gzipText)).length

    const ok = gzipText === identity && gzipBytes <= maxKb * 1024
    console.log(
      JSON.stringify(
        {
          db: sourceDb,
          items,
          identityBytes,
          gzipBytes,
          gzipRatio: Number((gzipBytes / identityBytes).toFixed(3)),
          contentEncoding: encoding,
          maxKb,
          pass: ok,
        },
        null,
        2,
      ),
    )
    if (!ok) process.exitCode = 1

    await fetch(`http://127.0.0.1:${port}/v1/shutdown`, { method: "POST", headers: auth })
    await child.exited
  } finally {
    try {
      child.kill()
    } catch {
      /* exited */
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* handles */
    }
  }
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`stdout ended without READY: ${buf}`)
    buf += dec.decode(value, { stream: true })
    const i = buf.indexOf("\n")
    if (i >= 0) return buf.slice(0, i).trim()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
