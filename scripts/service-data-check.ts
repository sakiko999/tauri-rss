/**
 * 数据服务（阶段 1）自检：真实 DataLayer + 本地 RSS + HTTP/WS 协议。
 *
 *   bun scripts/service-data-check.ts
 *
 * 覆盖：addSubscription → 快照投影 → WS 事件/rev → 阅读态合帧 → settings →
 * refresh/preview/loadMore/canLoadMore → cacheStats → 幂等 opId → 退订清理 →
 * owner/client token 权限 → shutdown 清理。
 */
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ServiceEvent } from "@amoeba/service-protocol"

const ROOT = process.cwd()
const ENTRY = join(ROOT, "apps", "cli", "src", "main.ts")

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Local Test</title><link>http://127.0.0.1/</link><description>test</description>
  <item>
    <title>First</title><link>https://example.com/first</link><guid>first</guid>
    <pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
    <description>First summary</description>
  </item>
  <item>
    <title>Second</title><link>https://example.com/second</link><guid>second</guid>
    <pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate>
    <description>Second summary</description>
  </item>
</channel></rss>`

type Check = { name: string; ok: boolean; detail?: string }

async function main(): Promise<void> {
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })

  const feedServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/feed.xml") {
        return new Response(FEED, { headers: { "content-type": "application/rss+xml" } })
      }
      return new Response("not found", { status: 404 })
    },
  })
  const feedUrl = `http://127.0.0.1:${feedServer.port}/feed.xml`

  const dir = mkdtempSync(join(tmpdir(), "amoeba-service-data-"))
  const spawnService = (dataDir: string) =>
    Bun.spawn(
      [
        process.execPath,
        ENTRY,
        "--service",
        "--data-dir",
        dataDir,
        "--db",
        join(dataDir, "rss.db"),
        "--profile-dir",
        join(dataDir, "profile"),
        "--no-browser",
        "--no-cookie-sync",
      ],
      { cwd: ROOT, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    )
  const child = spawnService(dir)
  let child2: ReturnType<typeof spawnService> | null = null

  let ws: WebSocket | null = null
  const events: ServiceEvent[] = []
  const waiters: Array<{ predicate: (e: ServiceEvent) => boolean; resolve: (e: ServiceEvent) => void }> = []

  const waitEvent = (predicate: (e: ServiceEvent) => boolean, timeoutMs = 5_000) =>
    new Promise<ServiceEvent>((resolve, reject) => {
      const hit = events.find(predicate)
      if (hit) return resolve(hit)
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `等待事件超时；已收到: ${events.map((e) => e.type).join(",") || "(none)"}`,
            ),
          ),
        timeoutMs,
      )
      waiters.push({
        predicate,
        resolve: (e) => {
          clearTimeout(timer)
          resolve(e)
        },
      })
    })

  try {
    const ready = await firstLine(child.stdout)
    const m = ready.match(/^READY (\d+)$/)
    add("READY", !!m, ready)
    if (!m) throw new Error("no READY")
    const port = Number(m[1])
    const owner = readFileSync(join(dir, "service.token"), "utf8").trim()
    const endpoint = JSON.parse(readFileSync(join(dir, "endpoint.json"), "utf8")) as {
      clientToken?: string
      bootId?: string
    }
    const client = endpoint.clientToken ?? ""
    add("client token 下发", client.length > 0 && client !== owner)

    const authClient = { authorization: `Bearer ${client}`, "content-type": "application/json" }
    const authOwner = { authorization: `Bearer ${owner}`, "content-type": "application/json" }

    async function rpc<T>(
      method: string,
      params: unknown = {},
      extra: { opId?: string; jobId?: string } = {},
      token = authClient,
    ): Promise<T> {
      const res = await fetch(`http://127.0.0.1:${port}/v1/rpc`, {
        method: "POST",
        headers: token,
        body: JSON.stringify({ method, params, ...extra }),
      })
      const body = (await res.json()) as {
        ok?: boolean
        result?: T
        error?: { kind?: string; message?: string }
      }
      if (!body.ok) throw new Error(`${method} 失败: ${body.error?.kind} ${body.error?.message}`)
      return body.result as T
    }

    const channels = await rpc<Array<{ key: string }>>("channels.list")
    add("channels.list", channels.some((c) => c.key === "rss:hn"), `count=${channels.length}`)

    const added = await rpc<{ id: string; refresh: { itemCount: number; error?: string } }>(
      "addSubscription",
      { channelKey: "rss:hn", title: "Local Test", info: { url: feedUrl } },
      { opId: "op-add" },
    )
    add("addSubscription 首刷 2 条", added.refresh.itemCount === 2 && !added.refresh.error, JSON.stringify(added.refresh))
    const subId = added.id

    const retried = await rpc<{ id: string }>(
      "addSubscription",
      { channelKey: "rss:hn", title: "Local Test", info: { url: feedUrl } },
      { opId: "op-add" },
    )
    add("opId 幂等返回同一订阅", retried.id === subId)
    const subsAfterRetry = await rpc<unknown[]>("subscriptions.list")
    add("幂等未重复建订阅", subsAfterRetry.length === 1, `count=${subsAfterRetry.length}`)

    const stateText = await (
      await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: authClient })
    ).text()
    const lines = stateText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const meta = lines.find((l) => l.type === "meta") as { rev?: number; totals?: Record<string, number> }
    const snapItems = lines.filter((l) => l.type === "items").flatMap((l) => (l.items as Array<{ content?: string }>) ?? [])
    add("快照 rev > 0", (meta?.rev ?? 0) > 0, `rev=${meta?.rev}`)
    add("快照含 2 条", snapItems.length === 2, `count=${snapItems.length}`)
    add("快照投影去掉文章正文", snapItems.every((it) => it.content === undefined))
    add("快照有 snapshot.end", lines.some((l) => l.type === "snapshot.end"))

    // WS：先取快照 rev，再订阅；之后的事件 rev 必须连续。
    ws = new WebSocket(`ws://127.0.0.1:${port}/v1/events`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WS 认证超时")), 3_000)
      ws!.onopen = () => ws!.send(JSON.stringify({ type: "auth", token: client }))
      ws!.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as { type?: string; event?: ServiceEvent; data?: unknown }
        if (msg.type === "hello") {
          clearTimeout(timer)
          ws!.send(JSON.stringify({ type: "subscribe", sinceRev: meta?.rev ?? 0 }))
          resolve()
        } else if (msg.type === "event" && msg.event) {
          events.push(msg.event)
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i]!.predicate(msg.event)) {
              const w = waiters.splice(i, 1)[0]!
              w.resolve(msg.event)
            }
          }
        } else if (msg.type === "resync") {
          reject(new Error("unexpected resync"))
        }
      }
      ws!.onerror = () => {
        clearTimeout(timer)
        reject(new Error("WS error"))
      }
    })
    add("WS subscribe", true)

    const firstMark = waitEvent((e) => e.type === "reading.changed")
    await rpc("reading.markRead", { subscriptionId: subId, itemId: "first", read: true }, { opId: "op-read" })
    const readEvent = (await firstMark) as Extract<ServiceEvent, { type: "reading.changed" }>
    const key = `${subId}\u0000first`
    add("reading.changed 合帧", readEvent.records[key]?.read === true, JSON.stringify(readEvent.records[key]))

    const settingsEventP = waitEvent((e) => e.type === "settings.changed")
    await rpc("settings.set", { patch: { refreshIntervalMin: 7 } }, { opId: "op-settings" })
    const settingsEvent = (await settingsEventP) as Extract<ServiceEvent, { type: "settings.changed" }>
    add("settings.changed", settingsEvent.settings.refreshIntervalMin === 7)
    const settings = await rpc<{ refreshIntervalMin?: number }>("settings.get")
    add("settings.get", settings.refreshIntervalMin === 7)

    const refreshP = waitEvent((e) => e.type === "items.replaced" || e.type === "items.appended")
    const refreshed = await rpc<{ itemCount: number }>(
      "refresh",
      { subscriptionId: subId, force: true },
      { opId: "op-refresh" },
    )
    add("refresh 2 条", refreshed.itemCount === 2, `count=${refreshed.itemCount}`)
    await refreshP
    add("refresh 发出 items 事件", true)

    const preview = await rpc<{ items: unknown[]; total?: number }>("previewChannel", {
      channelKey: "rss:hn",
      info: { url: feedUrl },
    })
    add("previewChannel 2 条", preview.items.length === 2, `count=${preview.items.length}`)

    const probe = await rpc<{ xml: string; tookMs: number }>("probe.fetch", {
      channelKey: "rss:hn",
      info: { url: feedUrl },
    })
    add("probe.fetch 原始 XML", probe.xml.includes("<rss") && probe.xml.includes("First"), `bytes=${probe.xml.length}`)
    const probeMiss = await fetch(`http://127.0.0.1:${port}/v1/rpc`, {
      method: "POST",
      headers: authClient,
      body: JSON.stringify({ method: "probe.resolve", params: { url: "https://example.com/nope" } }),
    })
    const probeMissBody = (await probeMiss.json()) as { ok?: boolean }
    add("probe.resolve 未命中 → 4xx", probeMiss.status >= 400 && probeMiss.status < 500 && probeMissBody.ok === false, `status=${probeMiss.status}`)

    const more = await rpc<{ addedCount: number; hasMore: boolean }>("loadMore", { subscriptionId: subId })
    add("loadMore 无分页", more.addedCount === 0 && more.hasMore === false, JSON.stringify(more))
    const canMore = await rpc<boolean>("canLoadMore", { subscriptionId: subId })
    add("canLoadMore=false", canMore === false)

    const stats = await rpc<{ keys: number; bytes: number }>("diagnostics.cacheStats")
    add("内容缓存已写入", stats.keys > 0 && stats.bytes > 0, JSON.stringify(stats))

    const db = new Database(join(dir, "rss.db"), { readonly: true })
    const migrations = db.query("SELECT version, name, checksum FROM _migrations").all() as Array<{
      version: number
      name: string
      checksum: string
    }>
    db.close()
    add(
      "_migrations 已写入",
      migrations.length === 1 && migrations[0]?.version === 1 && !!migrations[0]?.checksum,
      JSON.stringify(migrations),
    )

    const clientShutdown = await fetch(`http://127.0.0.1:${port}/v1/shutdown`, {
      method: "POST",
      headers: authClient,
    })
    add("client 不能 shutdown", clientShutdown.status === 403, `status=${clientShutdown.status}`)

    const removeP = waitEvent((e) => e.type === "items.cleared")
    const removeReadP = waitEvent(
      (e) => e.type === "reading.changed" && (e as { records: Record<string, unknown> }).records[key] === null,
    )
    await rpc("subscriptions.remove", { id: subId }, { opId: "op-remove" })
    await Promise.all([removeP, removeReadP])
    add("退订清理事件", true)

    const emptyState = await (
      await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: authClient })
    ).text()
    add("退订后快照无条目", !emptyState.includes('"type":"items"'))

    // 一次提交可含多条事件（同 rev）；下一个提交必须恰好 +1，且首条 = 快照 rev + 1。
    const revs = events
      .filter((e) => "rev" in e && typeof e.rev === "number")
      .map((e) => (e as { rev: number }).rev)
    const contiguous = revs.every(
      (r, i) => i === 0 || r === revs[i - 1]! || r === revs[i - 1]! + 1,
    )
    add("事件 rev 连续（同提交可多条）", contiguous, revs.join(","))
    add("首条事件 = 快照 rev + 1", revs[0] === (meta?.rev ?? 0) + 1, `first=${revs[0]} snapshot=${meta?.rev}`)

    const shutdown = await fetch(`http://127.0.0.1:${port}/v1/shutdown`, {
      method: "POST",
      headers: authOwner,
    })
    add("owner shutdown 200", shutdown.status === 200, `status=${shutdown.status}`)
    const exit = await child.exited
    add("服务退出码 0", exit === 0, `code=${exit}`)
    add("endpoint 已删除", !existsSync(join(dir, "endpoint.json")))
    add("lock 已删除", !existsSync(join(dir, "instance.lock")))

    // 第二次启动：库已存在 → 应先做每日 VACUUM INTO 备份，再 READY。
    child2 = spawnService(dir)
    const ready2 = await firstLine(child2.stdout)
    const m2 = ready2.match(/^READY (\d+)$/)
    add("第二次启动 READY", !!m2, ready2)
    const backups = readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"))
    add("每日备份已生成", backups.length > 0, backups.join(","))
    if (m2) {
      const port2 = Number(m2[1])
      const shutdown2 = await fetch(`http://127.0.0.1:${port2}/v1/shutdown`, {
        method: "POST",
        headers: authOwner,
      })
      add("第二次 shutdown", shutdown2.status === 200, `status=${shutdown2.status}`)
      add("第二次退出码 0", (await child2.exited) === 0)
    }
  } finally {
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
    try {
      child.kill()
    } catch {
      /* exited */
    }
    try {
      child2?.kill()
    } catch {
      /* exited */
    }
    try {
      feedServer.stop(true)
    } catch {
      /* ignore */
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* handles */
    }
  }

  const pass = checks.every((c) => c.ok)
  console.log(JSON.stringify({ checks, pass }, null, 2))
  if (!pass) process.exitCode = 1
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
