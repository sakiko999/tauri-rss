/**
 * rss --service —— 数据服务骨架（阶段 0）。
 *
 * 本文件只做「进程/发现/认证/握手/事件通道」，**不碰 SQLite、不读 crawler**：
 *   stdout 只输出一行 `READY <port>`；日志一律 stderr。
 *   endpoint.json / instance.lock / service.token 都在 dataDir 下。
 *   HTTP: /v1/hello /v1/health /v1/state /v1/rpc /v1/shutdown
 *   WS:   /v1/events（首帧 auth，之后 hello + ping/pong）
 *
 * 阶段 1 会在这个骨架上接 createDataLayer()/bun:sqlite/crawler/browser；
 * 那时 endpoint 增加 bootId/epoch/rev，快照与事件才有真实内容。
 */
import type { ServerWebSocket } from "bun"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  ENDPOINT_SCHEMA,
  SERVICE_PROTOCOL,
  SERVICE_VERSION,
  type EndpointInfo,
  type HealthResponse,
  type HelloResponse,
} from "@amoeba/service-protocol"

export interface ServiceOptions {
  dataDir: string
  dbFile: string
  profileDir: string
  port: number
  tokenFile: string
  parentPid?: number
}

const TOKEN_BYTES = 32
const AUTH_TIMEOUT_MS = 1_000
const PARENT_POLL_MS = 2_000

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex")
}

function canonical(path: string): string {
  return resolve(path).replace(/\\/g, "/").toLowerCase()
}

/** DB + profile 双重身份：同库不同 profile 也不能共享服务。 */
export function instanceKey(dbFile: string, profileDir: string): string {
  return createHash("sha256")
    .update(`${canonical(dbFile)}\0${canonical(profileDir)}`)
    .digest("hex")
    .slice(0, 16)
}

export function parseServiceArgs(argv: string[]): ServiceOptions | null {
  let dataDir = join(process.env.LOCALAPPDATA ?? tmpdir(), "app.amoeba.service", "default")
  let dbFile: string | undefined
  let profileDir: string | undefined
  let port = 0
  let tokenFile: string | undefined
  let parentPid: number | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (!v) throw new Error(`${arg} 缺少参数`)
      return v
    }
    switch (arg) {
      case "--service":
        break
      case "--data-dir":
        dataDir = resolve(next())
        break
      case "--db":
        dbFile = resolve(next())
        break
      case "--profile-dir":
        profileDir = resolve(next())
        break
      case "--port":
        port = Number(next())
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port 无效")
        break
      case "--token-file":
        tokenFile = resolve(next())
        break
      case "--parent-pid":
        parentPid = Number(next())
        break
      case "--help":
      case "-h":
        return null
      default:
        // 阶段 0 允许未知参数（main.ts 的全局 --browser 等），不在这里报错。
        break
    }
  }

  mkdirSync(dataDir, { recursive: true })
  return {
    dataDir,
    dbFile: dbFile ?? join(dataDir, "rss.db"),
    profileDir: profileDir ?? join(dataDir, "browser-profile"),
    port,
    tokenFile: tokenFile ?? join(dataDir, "service.token"),
    parentPid,
  }
}

function usage(): string {
  return [
    "rss --service — Amoeba 数据服务（阶段 0 骨架）",
    "",
    "  --data-dir <path>    data/endpoint/lock/token 目录",
    "  --db <file>          SQLite 路径（阶段 1 使用）",
    "  --profile-dir <path> 浏览器 profile（阶段 1 使用）",
    "  --port <n>           0 = OS 分配",
    "  --token-file <path>  读取/写入 token（默认 <data-dir>/service.token）",
    "  --parent-pid <pid>   父进程退出即关闭",
    "",
    "stdout: READY <port>",
  ].join("\n")
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function tokenFrom(opts: ServiceOptions): string {
  if (existsSync(opts.tokenFile)) {
    const existing = readFileSync(opts.tokenFile, "utf8").trim()
    if (existing) return existing
  }
  const token = hex(TOKEN_BYTES)
  writeFileSync(opts.tokenFile, token, { mode: 0o600 })
  return token
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin")
  if (!origin) return true
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === "127.0.0.1" || host === "localhost" || host === "tauri.localhost"
  } catch {
    return false
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

export async function runService(opts: ServiceOptions): Promise<number> {
  const bootId = hex(8)
  const startedAt = Date.now()
  const lockPath = join(opts.dataDir, "instance.lock")
  const endpointPath = join(opts.dataDir, "endpoint.json")

  // 单实例：O_EXCL 创建；stale 锁先探活再回收。
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, bootId, startedAt }), { flag: "wx" })
  } catch {
    let old: { pid?: number; bootId?: string } = {}
    try {
      old = JSON.parse(readFileSync(lockPath, "utf8")) as typeof old
    } catch {
      /* 坏锁当 stale */
    }
    if (old.pid && pidAlive(old.pid)) {
      console.error(`ALREADY_RUNNING pid=${old.pid} bootId=${old.bootId ?? "?"}`)
      return 3
    }
    rmSync(lockPath, { force: true })
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, bootId, startedAt }), { flag: "wx" })
  }

  const token = tokenFrom(opts)
  const key = instanceKey(opts.dbFile, opts.profileDir)
  let stopping = false
  let rev = 0
  const sockets = new Set<ServerWebSocket<{ authed: boolean }>>()

  const server = Bun.serve<{ authed: boolean }>({
    hostname: "127.0.0.1",
    port: opts.port,
    async fetch(req, srv) {
      if (!originAllowed(req)) return json({ kind: "forbidden", message: "origin" }, 403)
      const url = new URL(req.url)
      const auth = req.headers.get("authorization")
      const authed = auth === `Bearer ${token}`

      if (url.pathname === "/v1/events") {
        if (srv.upgrade(req, { data: { authed: false } })) return undefined
        return json({ kind: "bad-request", message: "websocket upgrade failed" }, 400)
      }

      if (url.pathname === "/v1/hello" && req.method === "GET") {
        if (!authed) return json({ kind: "unauthorized", message: "token" }, 401)
        const body: HelloResponse = {
          protocol: SERVICE_PROTOCOL,
          minClientProtocol: SERVICE_PROTOCOL,
          serviceVersion: SERVICE_VERSION,
          bootId,
          pid: process.pid,
          rev,
          features: ["skeleton"],
        }
        return json(body)
      }

      if (url.pathname === "/v1/health" && req.method === "GET") {
        if (!authed) return json({ kind: "unauthorized", message: "token" }, 401)
        const body: HealthResponse = {
          ok: true,
          uptimeMs: Date.now() - startedAt,
          jobs: 0,
          rev,
          bootId,
        }
        return json(body)
      }

      if (url.pathname === "/v1/state" && req.method === "GET") {
        if (!authed) return json({ kind: "unauthorized", message: "token" }, 401)
        // 阶段 0：只是空快照；阶段 1 换成真实 NDJSON。
        const lines = [
          JSON.stringify({
            type: "meta",
            protocol: SERVICE_PROTOCOL,
            bootId,
            rev,
            dataDir: opts.dataDir,
            dbFile: opts.dbFile,
            profileDir: opts.profileDir,
          }),
          JSON.stringify({ type: "snapshot.end", lastRev: rev }),
        ]
        return new Response(lines.join("\n") + "\n", {
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        })
      }

      if (url.pathname === "/v1/rpc" && req.method === "POST") {
        if (!authed) return json({ kind: "unauthorized", message: "token" }, 401)
        return json({ ok: false, error: { kind: "not-implemented", message: "阶段 1" } }, 501)
      }

      if (url.pathname === "/v1/shutdown" && req.method === "POST") {
        if (!authed) return json({ kind: "unauthorized", message: "token" }, 401)
        setTimeout(() => void stop(0), 20)
        return json({ ok: true })
      }

      return json({ kind: "not-found", message: url.pathname }, 404)
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
        setTimeout(() => {
          if (!ws.data.authed) ws.close(4001, "unauthorized")
        }, AUTH_TIMEOUT_MS)
      },
      message(ws, raw) {
        let msg: { type?: string; token?: string } = {}
        try {
          msg = JSON.parse(String(raw)) as typeof msg
        } catch {
          return
        }
        if (!ws.data.authed) {
          if (msg.type === "auth" && msg.token === token) {
            ws.data.authed = true
            ws.send(
              JSON.stringify({
                type: "hello",
                data: {
                  protocol: SERVICE_PROTOCOL,
                  serviceVersion: SERVICE_VERSION,
                  bootId,
                  rev,
                  pid: process.pid,
                },
              }),
            )
          } else {
            ws.close(4001, "unauthorized")
          }
          return
        }
        if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
      },
      close(ws) {
        sockets.delete(ws)
      },
    },
  })

  const port = server.port ?? 0
  if (!port) throw new Error("Bun.serve 未返回端口")
  const endpoint: EndpointInfo = {
    schema: ENDPOINT_SCHEMA,
    pid: process.pid,
    bootId,
    port,
    protocol: SERVICE_PROTOCOL,
    serviceVersion: SERVICE_VERSION,
    dataDir: opts.dataDir,
    dbFile: opts.dbFile,
    profileDir: opts.profileDir,
    startedAt,
    ...(opts.parentPid ? { parentPid: opts.parentPid } : {}),
  }
  const tmp = `${endpointPath}.tmp`
  writeFileSync(tmp, JSON.stringify(endpoint, null, 2))
  // rename 在 Windows 上不覆盖已存在文件；先删再 rename。
  rmSync(endpointPath, { force: true })
  renameSync(tmp, endpointPath)

  process.stdout.write(`READY ${port}\n`)
  console.error(`[service] ready port=${port} bootId=${bootId} instance=${key}`)

  const parentTimer = opts.parentPid
    ? setInterval(() => {
        if (!pidAlive(opts.parentPid as number)) {
          console.error(`[service] parent ${opts.parentPid} exited`)
          void stop(0)
        }
      }, PARENT_POLL_MS)
    : null

  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (ws.data.authed) ws.send(JSON.stringify({ type: "ping" }))
    }
  }, 5_000)

  async function stop(code: number): Promise<void> {
    if (stopping) return
    stopping = true
    if (parentTimer) clearInterval(parentTimer)
    clearInterval(heartbeat)
    for (const ws of sockets) {
      try {
        ws.close(1001, "service shutdown")
      } catch {
        /* 已关 */
      }
    }
    sockets.clear()
    server.stop(true)
    rmSync(endpointPath, { force: true })
    rmSync(lockPath, { force: true })
    process.exit(code)
  }

  process.on("SIGINT", () => void stop(0))
  process.on("SIGTERM", () => void stop(0))

  await new Promise<void>(() => {})
  return 0
}

export async function runServiceFromArgv(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseServiceArgs(argv)
  if (!opts) {
    console.error(usage())
    return 0
  }
  try {
    return await runService(opts)
  } catch (e) {
    console.error(`[service] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
    return 1
  }
}
