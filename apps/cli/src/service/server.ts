/**
 * rss --service —— 数据服务（阶段 1）。
 *
 * 单写者：本进程独占 SQLite、crawler/resolve、浏览器、governor、jobs。
 *   stdout 只输出一行 `READY <port>`；日志一律 stderr。
 *   endpoint.json / instance.lock / service.token 都在 dataDir 下；库锁 `<db>.service.lock`
 *   在库旁边（单写者按库文件判，见 store/db-lock.ts）。
 *   HTTP: /v1/hello /v1/health /v1/state /v1/rpc /v1/jobs/:id/cancel /v1/shutdown
 *   WS:   /v1/events（首帧 auth → hello → subscribe sinceRev）
 *
 * 一致性：每个改变镜像状态的提交 rev+1，并广播一条到多条 StateEvent；
 * 事件环形缓冲供断线重连按 sinceRev 回放，gap 则要求客户端重新取快照。
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  type AppSettings,
  cookieFieldFor,
  createDataLayer,
  type DataLayer,
  errorKindOf,
  type MediaItem,
  type MediaQuery,
  readingKey,
  type ReadingMap,
  type ReadRecord,
  type RefreshResult,
  type Subscription,
  type SubscriptionGroup,
  type SubscriptionPatch,
} from "@amoeba/core"
import { getChannel as sourceGetChannel } from "@amoeba/core/source"
// RSSHub 是运行时注册的外部 source（import 副作用）。DataLayer 现在跑在本服务进程里，
// desktop 入口那句 import 够不到这里 —— 漏掉它，`rsshub:feed` 订阅刷新会 NoChannelError
// （桌面「发现 → RSSHub」添加的订阅全部静默失败）。见 docs/audit/refactor-candidates.md。
import "@amoeba/core/source/rsshub"
import { formatError } from "@amoeba/log"
import {
  getDanmakuByUrl,
  resolveLivePlayByUrl as resolveLiveByUrl,
  resolvePlayByUrl as resolveVideoByUrl,
  resolveRoute,
} from "@amoeba/resolve"
import {
  type AddSubscriptionMeta,
  ENDPOINT_SCHEMA,
  type EndpointInfo,
  type HealthResponse,
  type HelloResponse,
  type JobProgress,
  type RpcMethod,
  type RpcRequest,
  type RpcResponse,
  SERVICE_FEATURES,
  SERVICE_PROTOCOL,
  SERVICE_VERSION,
  type SnapshotLine,
  type StateEvent,
  type WsClientMessage,
  type WsServerMessage,
} from "@amoeba/service-protocol"
import type { ServerWebSocket } from "bun"

import { acquireLock, dbLockPath, pidAlive } from "../store/db-lock.ts"
import { backupDbIfNeeded, type ServiceHost, setupServiceHost } from "./host.ts"

export interface ServiceOptions {
  dataDir: string
  dbFile: string
  profileDir: string
  port: number
  tokenFile: string
  parentPid?: number
  browserSidecar?: string
  browser: boolean
  cookieSync: boolean
}

const TOKEN_BYTES = 32
const AUTH_TIMEOUT_MS = 1_000
const PARENT_POLL_MS = 2_000
const HEARTBEAT_MS = 5_000
const COOKIE_SYNC_DELAY_MS = 1_500
const READING_BATCH_MS = 1_000
const EVENT_LOG_LIMIT = 512
const MAX_RPC_BYTES = 16 * 1024 * 1024
const SNAPSHOT_CHUNK = 400
/** 客户端全部断开后弹幕订阅的空闲回收延时（WS 短暂重连不该杀掉正在收的弹幕）。 */
const DANMAKU_IDLE_MS = 60_000

type StateEventInput = StateEvent extends infer T ? (T extends StateEvent ? Omit<T, "rev"> : never) : never

interface WsData {
  authed: boolean
  role: "owner" | "client" | null
  subscribed: boolean
}

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
  let browserSidecar: string | undefined
  let browser = process.env.AMOEBA_BROWSER !== "0"
  let cookieSync = true

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (!v) throw new Error(`${arg} 缺少参数`)
      return v
    }
    switch (arg) {
      case "--service":
      case "--browser":
        break
      case "--no-browser":
        browser = false
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
      case "--browser-sidecar":
        browserSidecar = resolve(next())
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
      case "--no-cookie-sync":
        cookieSync = false
        break
      case "--help":
      case "-h":
        return null
      default:
        // 允许 main.ts 的全局参数透传，不在这里报错。
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
    browserSidecar,
    browser,
    cookieSync,
  }
}

function usage(): string {
  return [
    "rss --service — Amoeba 数据服务",
    "",
    "  --data-dir <path>         endpoint/lock/token 目录",
    "  --db <file>               SQLite 路径（默认 <data-dir>/rss.db）",
    "  --profile-dir <path>      浏览器 profile（默认 <data-dir>/browser-profile）",
    "  --browser-sidecar <path>  amoeba-browser.exe 路径（缺省自动探测）",
    "  --no-browser              不注入抓取浏览器",
    "  --no-cookie-sync          启动后不做浏览器 cookie 快照同步",
    "  --port <n>                0 = OS 分配",
    "  --token-file <path>       owner token（默认 <data-dir>/service.token）",
    "  --parent-pid <pid>        父进程退出即关闭",
    "",
    "stdout: READY <port>",
  ].join("\n")
}

function tokenEquals(a: string, b: string): boolean {
  // ⚠️ token 来自 JSON,可能是 number/object;Buffer.from(1) 会抛 TypeError。
  if (typeof a !== "string" || typeof b !== "string") return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function ownerTokenFrom(opts: ServiceOptions): string {
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

function hostAllowed(req: Request): boolean {
  const host = req.headers.get("host") ?? ""
  const name = host
    .replace(/^\[|\]$/g, "")
    .split(":")[0]
    ?.toLowerCase()
  return name === "127.0.0.1" || name === "localhost"
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin")
  if (!origin) return {}
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-private-network": "true",
    vary: "origin",
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(req),
    },
  })
}

function errorResponse(req: Request, status: number, kind: string, message: string): Response {
  return json(req, { ok: false, error: { kind, message } } satisfies RpcResponse, status)
}

class ServiceError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new ServiceError("bad-request", 400, `${name} 无效`)
  }
  return value
}

function sameRefs(a: readonly MediaItem[], b: readonly MediaItem[]): boolean {
  return a.length === b.length && a.every((it, i) => it === b[i])
}

/** 轻量投影：文章正文按需 resolveDetail；social 的正文是列表卡片本身，必须保留。 */
function projectItem(item: MediaItem): MediaItem {
  if (item.kind !== "article" || item.content === undefined) return item
  const { content: _content, ...rest } = item
  return rest as MediaItem
}

function recordKey(subscriptionId: string, itemId: string): string {
  return readingKey(subscriptionId, itemId)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** CLI probe 的 info 合并：与 core `sourceInfoFor` 同一规则（rsshub→baseUrl，其余补 cookie）。 */
function mergeProbeInfo(
  channelKey: string,
  info: Record<string, string>,
  settings: AppSettings,
): Record<string, string> {
  if (channelKey.startsWith("rsshub:")) {
    if (info["baseUrl"]) return info
    return { ...info, baseUrl: settings.rsshubBaseUrl }
  }
  const field = cookieFieldFor(channelKey)
  const cookie = field ? (settings[field] as string | undefined) : undefined
  if (info["cookie"] !== undefined || !cookie) return info
  return { ...info, cookie }
}

export async function runService(opts: ServiceOptions): Promise<number> {
  const bootId = hex(8)
  const startedAt = Date.now()
  const lockPath = join(opts.dataDir, "instance.lock")
  const endpointPath = join(opts.dataDir, "endpoint.json")
  const owner = { pid: process.pid, bootId, startedAt, dataDir: opts.dataDir }

  // 单实例：O_EXCL 创建；stale 锁先探活再回收。
  const running = acquireLock(lockPath, owner)
  if (running) {
    console.error(`ALREADY_RUNNING pid=${running.pid ?? "?"} bootId=${running.bootId ?? "?"}`)
    return 3
  }
  // 单写者按**库文件**判：dataDir 锁挡不住「两个 dataDir 指向同一份库」（见 store/db-lock.ts）。
  // 退出码 4 ≠ 3：后者是「同一 dataDir 已有服务」，客户端可以接管；前者没有可接管的 endpoint。
  mkdirSync(dirname(opts.dbFile), { recursive: true })
  const dbLock = dbLockPath(opts.dbFile)
  const dbOwner = acquireLock(dbLock, owner)
  if (dbOwner) {
    rmSync(lockPath, { force: true })
    console.error(
      `DB_IN_USE pid=${dbOwner.pid ?? "?"} dataDir=${dbOwner.dataDir ?? "?"}：该库已被另一个数据服务使用（单写者）。` +
        `先停掉它，或让两边用同一个 --data-dir（会直接接管已在跑的服务）。锁文件：${dbLock}`,
    )
    return 4
  }
  const releaseLocks = (): void => {
    rmSync(lockPath, { force: true })
    rmSync(dbLock, { force: true })
  }

  const ownerToken = ownerTokenFrom(opts)
  const clientToken = hex(TOKEN_BYTES)
  const key = instanceKey(opts.dbFile, opts.profileDir)

  let host: ServiceHost | undefined
  let dl: DataLayer | undefined
  let server: ReturnType<typeof Bun.serve<WsData>> | undefined
  let stopping = false
  let rev = 0
  const sockets = new Set<ServerWebSocket<WsData>>()
  const eventLog: StateEvent[] = []
  const lastItems = new Map<string, MediaItem[]>()
  const jobs = new Map<string, { controller: AbortController; promise: Promise<unknown> }>()
  /** 弹幕订阅：客户端生成的 subId → unsubscribe。连接在服务进程内（凭证不过界）。 */
  const danmakuSubs = new Map<string, () => void>()
  let danmakuIdleTimer: ReturnType<typeof setTimeout> | null = null
  const opCache = new Map<string, { at: number; promise: Promise<unknown> }>()
  const pendingReading = new Map<string, ReadRecord | null>()
  let readingTimer: ReturnType<typeof setTimeout> | null = null
  let parentTimer: ReturnType<typeof setInterval> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let cookieTimer: ReturnType<typeof setTimeout> | null = null

  const dataLayer = (): DataLayer => {
    if (!dl) throw new ServiceError("unavailable", 503, "data layer not ready")
    return dl
  }

  function broadcast(message: WsServerMessage): void {
    const text = JSON.stringify(message)
    for (const ws of sockets) {
      if (!ws.data.authed) continue
      try {
        ws.send(text)
      } catch {
        /* 已关闭 */
      }
    }
  }

  function closeDanmaku(subId: string): void {
    const off = danmakuSubs.get(subId)
    danmakuSubs.delete(subId)
    try {
      off?.()
    } catch {
      /* 连接已断 */
    }
  }

  function closeAllDanmaku(): void {
    for (const subId of danmakuSubs.keys()) closeDanmaku(subId)
  }

  function commit(...inputs: StateEventInput[]): number {
    if (!inputs.length) return rev
    rev++
    const events = inputs.map((e) => ({ ...e, rev }) as StateEvent)
    for (const event of events) {
      eventLog.push(event)
      if (eventLog.length > EVENT_LOG_LIMIT) eventLog.shift()
      broadcast({ type: "event", event })
    }
    return rev
  }

  function queueReading(records: Record<string, ReadRecord | null>): void {
    for (const [key, value] of Object.entries(records)) pendingReading.set(key, value)
    if (readingTimer) return
    readingTimer = setTimeout(flushReading, READING_BATCH_MS)
  }

  function flushReading(): void {
    if (readingTimer) {
      clearTimeout(readingTimer)
      readingTimer = null
    }
    if (!pendingReading.size) return
    const records = Object.fromEntries(pendingReading)
    pendingReading.clear()
    commit({ type: "reading.changed", records })
  }

  async function subsEvent(): Promise<StateEventInput> {
    const layer = dataLayer()
    const [subscriptions, groups] = await Promise.all([layer.subscriptions.list(), layer.subscriptions.listGroups()])
    return { type: "subscriptions.changed", subscriptions, groups }
  }

  async function settingsEvent(): Promise<StateEventInput> {
    return { type: "settings.changed", settings: await dataLayer().settings.get() }
  }

  /** 对比上一份 store 快照，产出替换/追加/清空事件。 */
  function diffItems(subscriptionId: string): StateEventInput | null {
    const layer = dataLayer()
    const prev = lastItems.get(subscriptionId) ?? []
    const next = layer.store.query({ subscriptionId })
    lastItems.set(subscriptionId, next)
    if (sameRefs(prev, next)) return null
    const total = layer.totalOf(subscriptionId)
    if (!next.length) return { type: "items.cleared", subscriptionId }
    if (!prev.length) {
      return {
        type: "items.replaced",
        subscriptionId,
        items: next.map(projectItem),
        total: total ?? null,
      }
    }
    if (next.length >= prev.length && prev.every((it, i) => it === next[i])) {
      if (next.length === prev.length) return null
      return {
        type: "items.appended",
        subscriptionId,
        items: next.slice(prev.length).map(projectItem),
        total: total ?? null,
      }
    }
    return {
      type: "items.replaced",
      subscriptionId,
      items: next.map(projectItem),
      total: total ?? null,
    }
  }

  function seedLastItems(): void {
    const layer = dataLayer()
    lastItems.clear()
    for (const item of layer.store.all()) {
      const list = lastItems.get(item.subscriptionId)
      if (list) list.push(item)
      else lastItems.set(item.subscriptionId, [item])
    }
    // store.all 是插入序；diff 用 query 的排序序，先对齐一次。
    for (const id of lastItems.keys()) lastItems.set(id, layer.store.query({ subscriptionId: id }))
  }

  async function readingRecords(keys: string[]): Promise<Record<string, ReadRecord | null>> {
    const layer = dataLayer()
    const map: ReadingMap = await layer.reading.getAll().catch(() => ({}))
    const out: Record<string, ReadRecord | null> = {}
    for (const key of keys) out[key] = map[key] ?? null
    return out
  }

  function progress(jobId: string, value: JobProgress): void {
    broadcast({ type: "event", event: { type: "job.progress", jobId, progress: value } })
  }

  function runJob<T>(jobId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const existing = jobs.get(jobId)
    if (existing) return existing.promise as Promise<T>
    const controller = new AbortController()
    const promise = (async () => {
      progress(jobId, { phase: "start" })
      try {
        const result = await fn(controller.signal)
        broadcast({ type: "event", event: { type: "job.done", jobId } })
        return result
      } catch (e) {
        broadcast({
          type: "event",
          event: {
            type: "job.done",
            jobId,
            error: { kind: errorKindOf(e), message: e instanceof Error ? e.message : String(e) },
          },
        })
        throw e
      } finally {
        jobs.delete(jobId)
      }
    })()
    jobs.set(jobId, { controller, promise })
    return promise
  }

  function pruneOps(): void {
    const cutoff = Date.now() - 5 * 60_000
    for (const [key, entry] of opCache) {
      if (entry.at < cutoff) opCache.delete(key)
    }
    while (opCache.size > 1024) {
      const oldest = opCache.keys().next().value
      if (oldest === undefined) break
      opCache.delete(oldest)
    }
  }

  function opRun<T>(opId: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!opId) return fn()
    pruneOps()
    const hit = opCache.get(opId)
    if (hit) return hit.promise as Promise<T>
    const entry = { at: Date.now(), promise: fn() }
    entry.promise.catch(() => {
      if (opCache.get(opId) === entry) opCache.delete(opId)
    })
    opCache.set(opId, entry)
    return entry.promise as Promise<T>
  }

  async function snapshot(): Promise<string> {
    const layer = dataLayer()
    const lastRev = rev
    const [subscriptions, groups, settings, reading] = await Promise.all([
      layer.subscriptions.list(),
      layer.subscriptions.listGroups(),
      layer.settings.get(),
      layer.reading.getAll(),
    ])
    const totals: Record<string, number> = {}
    for (const sub of subscriptions) {
      const total = layer.totalOf(sub.id)
      if (total !== undefined) totals[sub.id] = total
    }
    const items = layer.store.all().map(projectItem)
    const lines: SnapshotLine[] = [
      {
        type: "meta",
        protocol: SERVICE_PROTOCOL,
        serviceVersion: SERVICE_VERSION,
        bootId,
        rev: lastRev,
        dataDir: opts.dataDir,
        dbFile: opts.dbFile,
        profileDir: opts.profileDir,
        totals,
      },
      { type: "subscriptions", subscriptions, groups },
      { type: "settings", settings },
      { type: "reading", reading },
    ]
    for (let i = 0; i < items.length; i += SNAPSHOT_CHUNK) {
      lines.push({ type: "items", items: items.slice(i, i + SNAPSHOT_CHUNK) })
    }
    lines.push({ type: "snapshot.end", lastRev })
    return lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  }

  async function dispatch(
    method: RpcMethod,
    rawParams: unknown,
    ctx: { role: "owner" | "client"; jobId: string },
  ): Promise<unknown> {
    const layer = dataLayer()
    const p = (rawParams ?? {}) as Record<string, unknown>
    const jobId = ctx.jobId

    switch (method) {
      // ── 读 ─────────────────────────────────────────────────────
      case "channels.list":
        return layer.listChannels()
      case "channels.kind":
        return layer.channelKind(asString(p.channelKey, "channelKey"))

      case "subscriptions.list":
        return layer.subscriptions.list()
      case "subscriptions.listGroups":
        return layer.subscriptions.listGroups()
      case "subscriptions.get":
        return layer.subscriptions.get(asString(p.id, "id"))

      case "reading.getAll":
        return layer.reading.getAll()
      case "reading.get":
        return layer.reading.get(asString(p.subscriptionId, "subscriptionId"), asString(p.itemId, "itemId"))

      case "settings.get":
        return layer.settings.get()

      case "store.all":
        return layer.store.all()
      case "store.query":
        return layer.store.query((p.query as MediaQuery | undefined) ?? {})

      case "canLoadMore":
        return layer.canLoadMore(asString(p.subscriptionId, "subscriptionId"))
      case "totalOf":
        return layer.totalOf(asString(p.subscriptionId, "subscriptionId"))

      // ── 订阅/分组语义命令 ─────────────────────────────────────
      case "subscriptions.add": {
        const subscription = p.subscription as Subscription
        if (!subscription?.id || !subscription.channelKey) {
          throw new ServiceError("bad-request", 400, "subscription 无效")
        }
        await layer.subscriptions.add(subscription)
        commit(await subsEvent())
        return undefined
      }
      case "subscriptions.update": {
        const updated = await layer.subscriptions.update(asString(p.id, "id"), (p.patch ?? {}) as SubscriptionPatch)
        commit(await subsEvent())
        return updated
      }
      case "subscriptions.remove": {
        const id = asString(p.id, "id")
        const map = await layer.reading.getAll().catch(() => ({}))
        const removedKeys = Object.keys(map).filter((k) => k.startsWith(`${id}\u0000`))
        await layer.subscriptions.remove(id)
        // 不能先删 lastItems：diff 需要旧快照才能识别「清空」。
        const itemEvent = diffItems(id)
        commit(await subsEvent(), ...(itemEvent ? [itemEvent] : []), {
          type: "reading.changed",
          records: Object.fromEntries(removedKeys.map((k) => [k, null])),
        })
        return undefined
      }
      case "subscriptions.addGroup": {
        const group = p.group as SubscriptionGroup
        if (!group?.id) throw new ServiceError("bad-request", 400, "group 无效")
        await layer.subscriptions.addGroup(group)
        commit(await subsEvent())
        return undefined
      }
      case "subscriptions.updateGroup": {
        const updated = await layer.subscriptions.updateGroup(
          asString(p.id, "id"),
          (p.patch ?? {}) as Partial<Omit<SubscriptionGroup, "id">>,
        )
        commit(await subsEvent())
        return updated
      }
      case "subscriptions.removeGroup": {
        await layer.subscriptions.removeGroup(asString(p.id, "id"))
        commit(await subsEvent())
        return undefined
      }

      // ── 阅读态语义命令 ───────────────────────────────────────
      case "reading.markRead": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const itemId = asString(p.itemId, "itemId")
        const read = p.read === undefined ? true : p.read === true
        await layer.reading.markRead(subscriptionId, itemId, read)
        queueReading(await readingRecords([recordKey(subscriptionId, itemId)]))
        return undefined
      }
      case "reading.markManyRead": {
        const keys = Array.isArray(p.keys) ? (p.keys as string[]) : []
        if (!keys.length) return undefined
        const read = p.read === undefined ? true : p.read === true
        await layer.reading.markManyRead(keys, read)
        queueReading(await readingRecords(keys))
        return undefined
      }
      case "reading.setStarred": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const itemId = asString(p.itemId, "itemId")
        await layer.reading.setStarred(subscriptionId, itemId, p.starred === true)
        queueReading(await readingRecords([recordKey(subscriptionId, itemId)]))
        return undefined
      }
      case "reading.setPosition": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const itemId = asString(p.itemId, "itemId")
        await layer.reading.setPosition(subscriptionId, itemId, Number(p.positionSec) || 0)
        queueReading(await readingRecords([recordKey(subscriptionId, itemId)]))
        return undefined
      }
      case "reading.setScrollRatio": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const itemId = asString(p.itemId, "itemId")
        await layer.reading.setScrollRatio(subscriptionId, itemId, Number(p.scrollRatio) || 0)
        queueReading(await readingRecords([recordKey(subscriptionId, itemId)]))
        return undefined
      }

      // ── settings ─────────────────────────────────────────────
      case "settings.set": {
        const next = await layer.settings.set((p.patch ?? {}) as Partial<AppSettings>)
        commit({ type: "settings.changed", settings: next })
        return next
      }
      case "settings.setIfUnchanged": {
        const next = await layer.settings.setIfUnchanged(
          (p.expected ?? {}) as Partial<AppSettings>,
          (p.patch ?? {}) as Partial<AppSettings>,
        )
        if (next) commit({ type: "settings.changed", settings: next })
        return next
      }
      case "settings.reset": {
        const next = await layer.settings.reset()
        commit({ type: "settings.changed", settings: next })
        return next
      }

      // ── 长任务 ───────────────────────────────────────────────
      case "addSubscription": {
        const channelKey = asString(p.channelKey, "channelKey")
        const title = asString(p.title, "title")
        const info = (p.info ?? {}) as Record<string, string>
        const meta = p.meta as AddSubscriptionMeta | undefined
        const result = await runJob(jobId, async () => {
          const r = await layer.addSubscription(channelKey, title, info, meta)
          return r
        })
        const itemEvent = diffItems(result.id)
        commit(await subsEvent(), ...(itemEvent ? [itemEvent] : []))
        return result
      }
      case "previewChannel": {
        return runJob(jobId, () =>
          layer.previewChannel(asString(p.channelKey, "channelKey"), (p.info ?? {}) as Record<string, string>),
        )
      }
      case "refresh": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const result = await runJob(jobId, (signal) =>
          layer.refresh(subscriptionId, { force: p.force === true, signal }),
        )
        const itemEvent = diffItems(subscriptionId)
        if (itemEvent) commit(itemEvent)
        return result
      }
      case "refreshAll": {
        return runJob(jobId, async (signal) => {
          const subs = await layer.subscriptions.list()
          const results: RefreshResult[] = []
          for (let i = 0; i < subs.length; i++) {
            if (signal.aborted) break
            const sub = subs[i]!
            progress(jobId, { phase: "progress", current: i, total: subs.length, label: sub.title })
            const result = await layer.refresh(sub.id, { force: p.force === true, signal })
            results.push(result)
            const itemEvent = diffItems(sub.id)
            if (itemEvent) commit(itemEvent)
            // 取消落在抓取途中 → 当前订阅返回「刷新已取消」，整轮到此为止。
            // ⚠️ 先 commit diff：取消与抓取成功可能同时发生，漏发事件会让镜像停在旧内容。
            if (signal.aborted) break
          }
          return { results }
        })
      }
      case "loadMore": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const result = await runJob(jobId, () => layer.loadMore(subscriptionId))
        const itemEvent = diffItems(subscriptionId)
        if (itemEvent) commit(itemEvent)
        return result
      }
      case "resolveDetail": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const itemId = asString(p.itemId, "itemId")
        return runJob(jobId, () => layer.resolveDetail(subscriptionId, itemId))
      }
      case "resolvePlay": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const itemId = asString(p.itemId, "itemId")
        return runJob(jobId, () => layer.resolvePlay(subscriptionId, itemId))
      }
      case "resolveLivePlay": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const roomId = asString(p.roomId, "roomId")
        return runJob(jobId, () => layer.resolveLivePlay(subscriptionId, roomId))
      }
      case "resolveHotWord": {
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const word = asString(p.word, "word")
        return runJob(jobId, () => layer.resolveHotWord(subscriptionId, word))
      }
      case "scanLogin": {
        const channelKey = asString(p.channelKey, "channelKey")
        const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : undefined
        const result = await runJob(jobId, (signal) =>
          layer.scanLogin(channelKey, (qrDataUrl) => progress(jobId, { phase: "qr", qrDataUrl }), {
            ...(timeoutMs ? { timeoutMs } : {}),
            signal,
          }),
        )
        commit(await settingsEvent())
        return result
      }
      case "syncBrowserCookies": {
        const fields = await runJob(jobId, () => layer.syncBrowserCookies())
        if (fields.length) commit(await settingsEvent())
        return fields
      }

      // ── 弹幕订阅（服务端建连 + 推送；凭证不过界）──────────────
      case "danmaku.open": {
        const subId = asString(p.subId, "subId")
        if (danmakuSubs.has(subId)) return undefined
        const subscriptionId = asString(p.subscriptionId, "subscriptionId")
        const url = asString(p.url, "url")
        const kind: "vod" | "live" = p.kind === "live" ? "live" : "vod"
        const stream = await layer.resolveDanmaku(subscriptionId, url, kind)
        // 等 resolveDanmaku 期间可能又来一次同 id 的 open（重试）→ 只装一次。
        if (danmakuSubs.has(subId)) return undefined
        const off = stream((items) => {
          if (!items.length) return
          broadcast({ type: "event", event: { type: "danmaku.items", subId, items } })
        })
        danmakuSubs.set(subId, off)
        return undefined
      }
      case "danmaku.close": {
        closeDanmaku(asString(p.subId, "subId"))
        return undefined
      }

      // ── 诊断（桌面不直连 storage/browser；实现一律归 core）─────
      case "diagnostics.cacheStats":
        return layer.diagnostics.cacheStats()
      case "diagnostics.clearContentCache":
        return layer.diagnostics.clearContentCache()
      case "diagnostics.clearCookies": {
        const hosts = Array.isArray(p.hosts)
          ? (p.hosts as unknown[]).filter((h): h is string => typeof h === "string" && !!h)
          : []
        await layer.diagnostics.clearCookies(hosts)
        return undefined
      }
      case "diagnostics.clearAll": {
        // 内存态（墓碑/游标/总数/凭证快照）由 core 清；这里只收尾服务自己的投影与事件。
        const before = await layer.reading.getAll().catch(() => ({}))
        const removedKeys = Object.keys(before)
        for (const job of jobs.values()) job.controller.abort()
        const ids = await layer.diagnostics.clearAll()
        lastItems.clear()
        commit(
          { type: "subscriptions.changed", subscriptions: [], groups: [] },
          { type: "settings.changed", settings: await layer.settings.get() },
          { type: "reading.changed", records: Object.fromEntries(removedKeys.map((k) => [k, null])) },
          ...ids.map((subscriptionId) => ({ type: "items.cleared" as const, subscriptionId })),
        )
        // 库都清了，进行中的弹幕订阅也没有意义。
        closeAllDanmaku()
        return ids
      }
      case "diagnostics.resetBrowserProfile":
        return layer.diagnostics.resetBrowserProfile()

      // ── CLI 原始探针（只读；cookie/被动规则与抓取同源）────────
      case "probe.fetch": {
        // 走 source 聚合注册表（含 rsshub），不是 crawler 单表：探针与真实刷新同源。
        const channel = sourceGetChannel(asString(p.channelKey, "channelKey"))
        if (!channel) throw new ServiceError("bad-request", 404, "未知渠道")
        const settings = await layer.settings.get()
        const info = mergeProbeInfo(channel.key, (p.info ?? {}) as Record<string, string>, settings)
        const source = channel.getSource(info) as {
          fetch(): Promise<string>
          fetchPassive?(): Promise<string | null>
        }
        const passive = p.passive !== false && channel.passive === true && !!globalThis.appHost.browser
        const started = Date.now()
        const xml = passive ? ((await source.fetchPassive?.()) ?? null) : await source.fetch()
        if (!xml) throw new ServiceError("no-data", 502, "无可用数据")
        return { xml, tookMs: Date.now() - started }
      }
      case "probe.resolve": {
        const url = asString(p.url, "url")
        const route = resolveRoute(url)
        if (!route) throw new ServiceError("bad-request", 404, "url 未命中 resolver 路由")
        const started = Date.now()
        const { streams } = route.kind === "live" ? await resolveLiveByUrl(url) : await resolveVideoByUrl(url)
        return { route, streams, tookMs: Date.now() - started }
      }
      case "probe.danmaku": {
        const url = asString(p.url, "url")
        const route = resolveRoute(url)
        if (!route) throw new ServiceError("bad-request", 404, "url 未命中 resolver 路由")
        const kind: "vod" | "live" = route.kind === "video" ? "vod" : "live"
        const started = Date.now()
        const stream = getDanmakuByUrl(url, { kind })
        const items: unknown[] = []
        const unsub = stream((batch) => items.push(...(batch as unknown[])))
        try {
          if (kind === "vod") {
            const deadline = Date.now() + 10_000
            while (items.length === 0 && Date.now() < deadline) await sleep(100)
          } else {
            const seconds = Math.min(Math.max(typeof p.seconds === "number" ? p.seconds : 5, 1), 30)
            await sleep(seconds * 1000)
          }
        } finally {
          unsub()
        }
        const fallback = kind === "vod" ? 10 : 3
        const n = typeof p.n === "number" ? p.n : fallback
        return { route, kind, items: items.slice(0, n), tookMs: Date.now() - started }
      }

      default:
        throw new ServiceError("not-found", 404, `未知方法：${method}`)
    }
  }

  async function handleRpc(req: Request, role: "owner" | "client"): Promise<Response> {
    const length = Number(req.headers.get("content-length") ?? 0)
    if (length > MAX_RPC_BYTES) {
      return errorResponse(req, 413, "too-large", "RPC body 过大")
    }
    let body: RpcRequest
    try {
      body = (await req.json()) as RpcRequest
    } catch {
      return errorResponse(req, 400, "bad-request", "JSON 解析失败")
    }
    if (!body || typeof body.method !== "string") {
      return errorResponse(req, 400, "bad-request", "缺少 method")
    }
    const jobId = typeof body.jobId === "string" && body.jobId ? body.jobId : `j-${randomBytes(6).toString("hex")}`
    try {
      const result = await opRun(body.opId, () => dispatch(body.method as RpcMethod, body.params, { role, jobId }))
      return json(req, { ok: true, result, rev } satisfies RpcResponse)
    } catch (e) {
      const status = e instanceof ServiceError ? e.status : 500
      const kind = e instanceof ServiceError ? e.kind : errorKindOf(e)
      return errorResponse(req, status, kind, e instanceof Error ? e.message : String(e))
    }
  }

  // ── 启动 ───────────────────────────────────────────────────
  try {
    backupDbIfNeeded(opts.dbFile, opts.dataDir)
    host = setupServiceHost({
      dbFile: opts.dbFile,
      profileDir: opts.profileDir,
      browserSidecar: opts.browserSidecar,
      browser: opts.browser,
    })
    dl = createDataLayer()
    await dl.settings.get()
    await dl.hydrate()
    seedLastItems()
  } catch (e) {
    console.error(`[service] bootstrap failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    await host?.close().catch(() => {})
    releaseLocks()
    return 1
  }

  server = Bun.serve<WsData>({
    hostname: "127.0.0.1",
    port: opts.port,
    async fetch(req, srv) {
      if (!originAllowed(req) || !hostAllowed(req)) {
        return errorResponse(req, 403, "forbidden", "origin/host")
      }
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(req) })
      }
      const url = new URL(req.url)
      const auth = req.headers.get("authorization") ?? ""
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
      const role =
        token && tokenEquals(token, ownerToken) ? "owner" : token && tokenEquals(token, clientToken) ? "client" : null

      if (url.pathname === "/v1/events") {
        if (srv.upgrade(req, { data: { authed: false, role: null, subscribed: false } })) {
          return undefined
        }
        return errorResponse(req, 400, "bad-request", "websocket upgrade failed")
      }

      if (url.pathname === "/v1/hello" && req.method === "GET") {
        if (!role) return errorResponse(req, 401, "unauthorized", "token")
        const body: HelloResponse = {
          protocol: SERVICE_PROTOCOL,
          minClientProtocol: SERVICE_PROTOCOL,
          serviceVersion: SERVICE_VERSION,
          bootId,
          pid: process.pid,
          rev,
          features: [...SERVICE_FEATURES],
        }
        return json(req, body)
      }

      if (url.pathname === "/v1/health" && req.method === "GET") {
        if (!role) return errorResponse(req, 401, "unauthorized", "token")
        const body: HealthResponse = {
          ok: true,
          uptimeMs: Date.now() - startedAt,
          jobs: jobs.size,
          rev,
          bootId,
        }
        return json(req, body)
      }

      if (url.pathname === "/v1/state" && req.method === "GET") {
        if (!role) return errorResponse(req, 401, "unauthorized", "token")
        const body = await snapshot()
        const headers = {
          "content-type": "application/x-ndjson; charset=utf-8",
          vary: "accept-encoding",
          ...corsHeaders(req),
        }
        // 快照是整库投影（2.5k 条 ≈ 2.3MB，播客 summary 占大头）：gzip 后降到
        // ~0.5MB 传输量。浏览器/Node/Bun 的 fetch 都自动解压，客户端无感。
        if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
          return new Response(Bun.gzipSync(new TextEncoder().encode(body)), {
            headers: { ...headers, "content-encoding": "gzip" },
          })
        }
        return new Response(body, { headers })
      }

      if (url.pathname === "/v1/rpc" && req.method === "POST") {
        if (!role) return errorResponse(req, 401, "unauthorized", "token")
        return handleRpc(req, role)
      }

      if (url.pathname.startsWith("/v1/jobs/") && url.pathname.endsWith("/cancel") && req.method === "POST") {
        if (!role) return errorResponse(req, 401, "unauthorized", "token")
        const id = decodeURIComponent(url.pathname.slice("/v1/jobs/".length, -"/cancel".length))
        const job = jobs.get(id)
        if (!job) return errorResponse(req, 404, "not-found", "job 不存在")
        job.controller.abort()
        return json(req, { ok: true })
      }

      if (url.pathname === "/v1/shutdown" && req.method === "POST") {
        if (!role) return errorResponse(req, 401, "unauthorized", "token")
        if (role !== "owner") return errorResponse(req, 403, "forbidden", "仅 owner 可 shutdown")
        setTimeout(() => void stop(0), 20)
        return json(req, { ok: true })
      }

      return errorResponse(req, 404, "not-found", url.pathname)
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
        // 有客户端回来了：取消空闲回收（WS 重连不该打断正在看的弹幕）。
        if (danmakuIdleTimer) {
          clearTimeout(danmakuIdleTimer)
          danmakuIdleTimer = null
        }
        setTimeout(() => {
          if (!ws.data.authed) ws.close(4001, "unauthorized")
        }, AUTH_TIMEOUT_MS)
      },
      message(ws, raw) {
        // ⚠️ 回调抛错会逃出 Bun.serve 的 try(发生在另一个 tick),本机任意进程一帧
        // 畸形 JSON 就能打死整个数据服务。协议错误只该断这条连接。
        try {
          let msg: WsClientMessage = { type: "ping" }
          try {
            msg = JSON.parse(String(raw)) as WsClientMessage
          } catch {
            return
          }
          if (!ws.data.authed) {
            if (msg.type !== "auth" || typeof msg.token !== "string" || !msg.token) {
              ws.close(4001, "unauthorized")
              return
            }
            const role = tokenEquals(msg.token, ownerToken)
              ? "owner"
              : tokenEquals(msg.token, clientToken)
                ? "client"
                : null
            if (!role) {
              ws.close(4001, "unauthorized")
              return
            }
            ws.data.authed = true
            ws.data.role = role
            const helloSelf: WsServerMessage = {
              type: "hello",
              data: {
                protocol: SERVICE_PROTOCOL,
                minClientProtocol: SERVICE_PROTOCOL,
                serviceVersion: SERVICE_VERSION,
                bootId,
                pid: process.pid,
                rev,
                features: [...SERVICE_FEATURES],
                clientToken: role === "client",
              },
            }
            ws.send(JSON.stringify(helloSelf))
            return
          }
          if (msg.type === "subscribe") {
            ws.data.subscribed = true
            const since = typeof msg.sinceRev === "number" ? msg.sinceRev : undefined
            if (since === undefined) return
            const first = eventLog[0]?.rev
            // 日志起点晚于 since → 中间事件已丢，只能让客户端全量快照收敛。
            if (since > rev || (first !== undefined && first > since)) {
              ws.send(JSON.stringify({ type: "resync", reason: "event gap" } satisfies WsServerMessage))
              return
            }
            // ⚠️ 用 `>=` ：一次 commit 的多条事件共享同一个 rev，而客户端只能记住
            // 「已应用到哪个 rev」。断线时若只应用了该 rev 的一部分，`>` 会把剩余事件
            // 永久丢掉（gap 检测也发现不了）。事件应用本身是幂等的，重放安全。
            for (const event of eventLog) {
              if (event.rev >= since) ws.send(JSON.stringify({ type: "event", event } satisfies WsServerMessage))
            }
            return
          }
          if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" } satisfies WsServerMessage))
        } catch (e) {
          console.error(`[service] ws message failed: ${formatError(e)}`)
          try {
            ws.close(1011, "internal-error")
          } catch {
            /* 连接已断 */
          }
        }
      },
      close(ws) {
        sockets.delete(ws)
        // 客户端全断了：弹幕订阅没有消费者，延时回收（给 WS 重连留窗口）。
        if (!sockets.size && danmakuSubs.size && !danmakuIdleTimer) {
          danmakuIdleTimer = setTimeout(() => {
            danmakuIdleTimer = null
            if (!sockets.size) closeAllDanmaku()
          }, DANMAKU_IDLE_MS)
        }
      },
    },
  })

  const port = server.port ?? 0
  if (!port) {
    console.error("[service] Bun.serve 未返回端口")
    await host.close().catch(() => {})
    server.stop(true)
    releaseLocks()
    return 1
  }

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
    clientToken,
    ...(opts.parentPid ? { parentPid: opts.parentPid } : {}),
  }
  const tmp = `${endpointPath}.tmp`
  writeFileSync(tmp, JSON.stringify(endpoint, null, 2))
  rmSync(endpointPath, { force: true })
  renameSync(tmp, endpointPath)

  process.stdout.write(`READY ${port}\n`)
  console.error(
    `[service] ready port=${port} bootId=${bootId} instance=${key} db=${opts.dbFile} profile=${opts.profileDir}`,
  )

  if (opts.cookieSync) {
    cookieTimer = setTimeout(() => {
      if (stopping || !globalThis.appHost.browser) return
      void dataLayer()
        .syncBrowserCookies()
        .then(async (fields) => {
          if (fields.length) commit(await settingsEvent())
        })
        .catch((e) => console.error(`[service] cookie sync failed: ${String(e)}`))
    }, COOKIE_SYNC_DELAY_MS)
  }

  parentTimer = opts.parentPid
    ? setInterval(() => {
        if (!pidAlive(opts.parentPid as number)) {
          console.error(`[service] parent ${opts.parentPid} exited`)
          void stop(0)
        }
      }, PARENT_POLL_MS)
    : null

  heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (ws.data.authed) {
        try {
          ws.send(JSON.stringify({ type: "ping" } satisfies WsServerMessage))
        } catch {
          /* 已关闭 */
        }
      }
    }
  }, HEARTBEAT_MS)

  async function stop(code: number): Promise<void> {
    if (stopping) return
    stopping = true
    if (parentTimer) clearInterval(parentTimer)
    if (heartbeat) clearInterval(heartbeat)
    if (cookieTimer) clearTimeout(cookieTimer)
    if (danmakuIdleTimer) clearTimeout(danmakuIdleTimer)
    closeAllDanmaku()
    flushReading()
    broadcast({ type: "event", event: { type: "service.shutdown", reason: "shutdown" } })
    for (const ws of sockets) {
      try {
        ws.close(1001, "service shutdown")
      } catch {
        /* 已关 */
      }
    }
    sockets.clear()
    server?.stop(true)
    await host?.close().catch(() => {})
    rmSync(endpointPath, { force: true })
    releaseLocks()
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
    console.error(`[service] fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    return 1
  }
}
