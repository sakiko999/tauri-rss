/**
 * RemoteDataLayer 自检：真服务 + 本地 RSS，验证镜像读/写 RPC/WS 事件/诊断。
 *   bun scripts/remote-data-layer-check.ts
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { EndpointInfo } from "@amoeba/service-protocol"

import { createRemoteDataLayer } from "../packages/service-client/src/index.ts"

const ROOT = process.cwd()
const ENTRY = join(ROOT, "apps", "cli", "src", "main.ts")
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Remote Test</title><link>http://127.0.0.1/</link><description>t</description>
<item><title>Alpha</title><link>https://example.com/a</link><guid>alpha</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description>A</description></item>
<item><title>Beta</title><link>https://example.com/b</link><guid>beta</guid><pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate><description>B</description></item>
</channel></rss>`

async function main(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })

  // slowMs > 0 时 /feed.xml 延迟响应，用于验证取消。
  let slowMs = 0
  const feed = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== "/feed.xml") return new Response("nope", { status: 404 })
      if (slowMs > 0) await new Promise((r) => setTimeout(r, slowMs))
      return new Response(FEED, { headers: { "content-type": "application/rss+xml" } })
    },
  })
  const feedUrl = `http://127.0.0.1:${feed.port}/feed.xml`
  const dir = mkdtempSync(join(tmpdir(), "amoeba-remote-dl-"))
  const spawnService = () =>
    Bun.spawn(
      [
        process.execPath,
        ENTRY,
        "--service",
        "--data-dir",
        dir,
        "--db",
        join(dir, "rss.db"),
        "--profile-dir",
        join(dir, "profile"),
        "--no-browser",
        "--no-cookie-sync",
      ],
      { cwd: ROOT, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    )
  const child = spawnService()
  let child2: ReturnType<typeof spawnService> | null = null
  let dl: Awaited<ReturnType<typeof createRemoteDataLayer>> | null = null

  try {
    const ready = await firstLine(child.stdout)
    const m = ready.match(/^READY (\d+)$/)
    add("READY", !!m, ready)
    if (!m) throw new Error("no READY")
    await waitFor(async () => existsSync(join(dir, "endpoint.json")))
    const endpoint = JSON.parse(readFileSync(join(dir, "endpoint.json"), "utf8")) as EndpointInfo

    let subsEvents = 0
    let settingsEvents = 0
    let statusEvents = 0
    let lastOnline: boolean | null = null
    let lastEvents: boolean | null = null
    /** 模拟宿主（Rust service_endpoint）在服务崩溃后给出的新 endpoint。 */
    let recoverTo: EndpointInfo | null = null
    dl = await createRemoteDataLayer(endpoint, {
      onSubscriptions: () => {
        subsEvents++
      },
      onSettings: () => {
        settingsEvents++
      },
      onStatus: (status) => {
        statusEvents++
        lastOnline = status.online
        lastEvents = status.events
      },
      resolveEndpoint: async () => recoverTo,
    })
    add("remote 层创建", dl.remote === true)
    add("初始订阅为空", (await dl.subscriptions.list()).length === 0)
    add(
      "channels 可用",
      dl.listChannels().some((c) => c.key === "rss:hn"),
    )
    add("channelKind", dl.channelKind("rss:hn") === "article")

    const added = await dl.addSubscription("rss:hn", "Remote Test", { url: feedUrl })
    add("addSubscription 2 条", added.refresh.itemCount === 2, JSON.stringify(added.refresh))
    add("订阅镜像", (await dl.subscriptions.list()).length === 1)
    add("条目镜像 2 条", dl.store.all().length === 2, `count=${dl.store.all().length}`)
    add("订阅回调", subsEvents >= 1, `count=${subsEvents}`)
    const item = dl.store.all().find((it) => it.id === "alpha")
    add("条目可查", !!item && item.title === "Alpha")

    const settings = await dl.settings.set({ refreshIntervalMin: 9 })
    add("settings.set", settings.refreshIntervalMin === 9)
    add("settings 镜像", (await dl.settings.get()).refreshIntervalMin === 9)
    add("settings 回调", settingsEvents >= 1)

    await dl.reading.markRead(item!.subscriptionId, item!.id, true)
    const rec = await dl.reading.get(item!.subscriptionId, item!.id)
    add("reading 落库", rec?.read === true)
    const afterRead = dl.store.all().find((it) => it.id === "alpha")
    add("reading 同步镜像", afterRead?.isUnread === false)

    await dl.reading.setStarred(item!.subscriptionId, item!.id, true)
    add("星标镜像", dl.store.all().find((it) => it.id === "alpha")?.isStarred === true)

    const refreshed = await dl.refresh(added.id, { force: true })
    add("refresh 2 条", refreshed.itemCount === 2)
    add("refresh 后仍 2 条", dl.store.all().length === 2, `count=${dl.store.all().length}`)
    add("totalOf 可读", dl.totalOf(added.id) === undefined)

    // ── 取消：signal abort → 客户端立即返回，服务端 job 一并取消 ──
    slowMs = 1_200
    const ac = new AbortController()
    const cancelStart = Date.now()
    const pending = dl.refresh(added.id, { force: true, signal: ac.signal })
    await new Promise((r) => setTimeout(r, 150))
    ac.abort()
    let abortErr: unknown = null
    try {
      await pending
    } catch (e) {
      abortErr = e
    }
    const abortMs = Date.now() - cancelStart
    slowMs = 0
    add("signal 取消 → 抛错", !!abortErr, String(abortErr))
    add("取消立即返回", abortMs < 1_000, `${abortMs}ms`)
    // 等慢响应窗口过去：服务端 job 已取消，不应再写入内容/缓存。
    await new Promise((r) => setTimeout(r, 1_400))
    add("取消后内容不变", dl.store.all().length === 2, `count=${dl.store.all().length}`)

    const stats = await dl.diagnostics.cacheStats()
    add("cacheStats", stats.keys > 0 && stats.bytes > 0, JSON.stringify(stats))

    const preview = await dl.previewChannel("rss:hn", { url: feedUrl })
    add("previewChannel", preview.items.length === 2)

    const more = await dl.loadMore(added.id)
    add("loadMore", more.addedCount === 0 && more.hasMore === false)
    add("canLoadMore", (await dl.canLoadMore(added.id)) === false)

    const detail = await dl.resolveDetail(added.id, item!.id)
    add("resolveDetail 回退 item", detail?.id === "alpha")

    // 退订用第二条订阅验证（第一条留给后面的崩溃/重启收敛）。
    const added2 = await dl.addSubscription("rss:hn", "Remote Test 2", { url: feedUrl })
    add("第二条订阅镜像", (await dl.subscriptions.list()).length === 2)
    await dl.subscriptions.remove(added2.id)
    add("退订镜像", (await dl.subscriptions.list()).length === 1)
    add("退订清条目", dl.store.all().length === 2, `count=${dl.store.all().length}`)

    add("status 回调", statusEvents >= 1, `count=${statusEvents}`)

    // ── 崩溃：进程被杀 → status 转离线 → 写操作 fail-closed ──
    child.kill()
    await child.exited
    await waitFor(() => lastOnline === false, 5_000)
    add("崩溃后 status 离线", lastOnline === false)
    let writeRejected = false
    try {
      await dl.reading.markRead(item!.subscriptionId, item!.id, false)
    } catch {
      writeRejected = true
    }
    add("离线写 fail-closed", writeRejected)

    // ── 自愈：宿主重新拉起服务并返回新 endpoint → 同一客户端换连（免整页重载）──
    child2 = spawnService()
    const ready2 = await firstLine(child2.stdout)
    const m2 = ready2.match(/^READY (\d+)$/)
    add("重启 READY", !!m2, ready2)
    let endpoint2: EndpointInfo | null = null
    let owner2 = ""
    if (m2) {
      await waitFor(() => existsSync(join(dir, "endpoint.json")))
      endpoint2 = JSON.parse(readFileSync(join(dir, "endpoint.json"), "utf8")) as EndpointInfo
      owner2 = readFileSync(join(dir, "service.token"), "utf8").trim()
      recoverTo = endpoint2
      // 重连退避最长 10s；给足两轮。
      // ⚠️ 必须等 **events**（WS 认证成功）而不仅是 online：换连后用旧 token 连 WS 会
      // 4001，靠 applySnapshot 提前置 online 会假绿（2026-11-01 复核发现）。
      try {
        await waitFor(() => lastOnline === true && lastEvents === true, 25_000)
      } catch {
        /* 断言在下一行 */
      }
      add("宿主重建后自动重连（WS 认证成功）", lastOnline === true && lastEvents === true)
      add(
        "换连后镜像可用",
        dl.store.all().some((it) => it.id === "alpha"),
      )
    }
    dl.close()

    // ── 新客户端（同 data dir）：从快照收敛 ──
    if (endpoint2) {
      const dl2 = await createRemoteDataLayer(endpoint2, {})
      add("重启后快照含订阅", (await dl2.subscriptions.list()).length === 1)
      const alpha = dl2.store.all().find((it) => it.id === "alpha")
      add(
        "重启后已读/星标收敛",
        alpha?.isUnread === false && alpha?.isStarred === true,
        JSON.stringify({ unread: alpha?.isUnread, starred: alpha?.isStarred }),
      )
      dl2.close()
      const shutdown = await fetch(`http://127.0.0.1:${endpoint2.port}/v1/shutdown`, {
        method: "POST",
        headers: { authorization: `Bearer ${owner2}` },
      })
      add("owner shutdown", shutdown.status === 200, `status=${shutdown.status}`)
      add("服务退出", (await child2!.exited) === 0)
    }
  } finally {
    try {
      dl?.close()
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
    feed.stop(true)
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

async function waitFor(fn: () => Promise<boolean> | boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error("waitFor timeout")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
