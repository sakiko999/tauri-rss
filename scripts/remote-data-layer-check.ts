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

  const feed = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      return new URL(req.url).pathname === "/feed.xml"
        ? new Response(FEED, { headers: { "content-type": "application/rss+xml" } })
        : new Response("nope", { status: 404 })
    },
  })
  const feedUrl = `http://127.0.0.1:${feed.port}/feed.xml`
  const dir = mkdtempSync(join(tmpdir(), "amoeba-remote-dl-"))
  const child = Bun.spawn(
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
  let dl: Awaited<ReturnType<typeof createRemoteDataLayer>> | null = null

  try {
    const ready = await firstLine(child.stdout)
    const m = ready.match(/^READY (\d+)$/)
    add("READY", !!m, ready)
    if (!m) throw new Error("no READY")
    const port = Number(m[1])
    await waitFor(async () => existsSync(join(dir, "endpoint.json")))
    const endpoint = JSON.parse(readFileSync(join(dir, "endpoint.json"), "utf8")) as EndpointInfo
    const owner = readFileSync(join(dir, "service.token"), "utf8").trim()

    let subsEvents = 0
    let settingsEvents = 0
    let statusEvents = 0
    dl = await createRemoteDataLayer(endpoint, {
      onSubscriptions: () => {
        subsEvents++
      },
      onSettings: () => {
        settingsEvents++
      },
      onStatus: () => {
        statusEvents++
      },
    })
    add("remote 层创建", dl.remote === true)
    add("初始订阅为空", (await dl.subscriptions.list()).length === 0)
    add("channels 可用", dl.listChannels().some((c) => c.key === "rss:hn"))
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

    const stats = await dl.diagnostics.cacheStats()
    add("cacheStats", stats.keys > 0 && stats.bytes > 0, JSON.stringify(stats))

    const preview = await dl.previewChannel("rss:hn", { url: feedUrl })
    add("previewChannel", preview.items.length === 2)

    const more = await dl.loadMore(added.id)
    add("loadMore", more.addedCount === 0 && more.hasMore === false)
    add("canLoadMore", (await dl.canLoadMore(added.id)) === false)

    const detail = await dl.resolveDetail(added.id, item!.id)
    add("resolveDetail 回退 item", detail?.id === "alpha")

    await dl.subscriptions.remove(added.id)
    add("退订镜像", (await dl.subscriptions.list()).length === 0)
    add("退订清条目", dl.store.all().length === 0)

    add("status 回调", statusEvents >= 1, `count=${statusEvents}`)
    dl.close()

    const shutdown = await fetch(`http://127.0.0.1:${port}/v1/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner}` },
    })
    add("owner shutdown", shutdown.status === 200, `status=${shutdown.status}`)
    add("服务退出", (await child.exited) === 0)
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
