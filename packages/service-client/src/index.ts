/**
 * RemoteDataLayer — 桌面/CLI 共用的数据服务客户端。
 *
 * 读：本地镜像（`createMediaStore` + subscriptions/groups/settings/reading 数组），
 *     同步返回，desktop selectors 不需要改成全异步。
 * 写：POST /v1/rpc；长任务由服务端 job 化，客户端仍 await 原 Promise。
 * 事件：WS 维护镜像；rev gap / 断线重连一律重新取快照（不做事件补丁式恢复）。
 *
 * ⚠️ 本文件运行时不 import `@amoeba/core` 根入口（那会拉进 crawler/resolve）；
 *    只从 `@amoeba/core/media-store` 与 `@amoeba/core/reading` 取实现，
 *    其余 domain 类型全部 `import type`。
 */

import type {
  AppSettings,
  ChannelInfo,
  DanmakuItem,
  DanmakuStream,
  DataLayer,
  LoginResult,
  MediaItem,
  MediaKind,
  MediaQuery,
  ReadingMap,
  ReadRecord,
  RefreshResult,
  ResolvePlayback,
  Subscription,
  SubscriptionGroup,
} from "@amoeba/core"
import { createMediaStore } from "@amoeba/core/media-store"
import { findRecord, readingKey } from "@amoeba/core/reading"
import type {
  EndpointInfo,
  HealthResponse,
  JobProgress,
  RpcMethod,
  RpcParams,
  RpcResponse,
  RpcResult,
  ServiceEvent,
  SnapshotLine,
  SnapshotMeta,
  StateEvent,
  WsServerMessage,
} from "@amoeba/service-protocol"
import { SERVICE_PROTOCOL } from "@amoeba/service-protocol"

export interface RemoteStatus {
  /** HTTP/快照可用。 */
  online: boolean
  /** WS 事件通道已认证并订阅。 */
  events: boolean
  error?: string
}

export interface RemoteHooks {
  onSubscriptions?(subscriptions: Subscription[], groups: SubscriptionGroup[]): void
  onSettings?(settings: AppSettings): void
  onStatus?(status: RemoteStatus): void
  onJobProgress?(jobId: string, progress: JobProgress): void
  /**
   * 事件通道反复断开时询问宿主：服务进程是否已退出、能否重新拉起。
   *
   * 服务崩溃后端口/令牌都会变，旧 client 永远连不上 —— 返回新 endpoint 时客户端
   * 整体换连接（不用整页重载）。返回 null / 同值 = 没换，继续按退避重连。
   * Tauri 侧实现为再次 `service_endpoint`（Rust 会探活并按需 spawn）。
   */
  resolveEndpoint?(): Promise<EndpointInfo | null>
}

export type RemoteDataLayer = DataLayer & {
  readonly remote: true
  close(): void
}

export class ServiceRpcError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 慢方法（抓取/播放解析）单独放宽超时；未列出的默认 30s。 */
const TIMEOUT_MS: Partial<Record<RpcMethod, number>> = {
  refresh: 180_000,
  refreshAll: 600_000,
  loadMore: 120_000,
  resolveDetail: 120_000,
  resolvePlay: 180_000,
  resolveLivePlay: 120_000,
  // 这两个内部都会走一次真实抓取（addSubscription 末尾 await refresh），不能按 30s 默认。
  addSubscription: 180_000,
  previewChannel: 120_000,
  // 平台扫码截止默认 300s（xhs/weibo 的 login.ts）；客户端必须比它久，否则「扫码成功但
  // UI 已报超时」。
  scanLogin: 330_000,
  "probe.fetch": 120_000,
  "probe.resolve": 180_000,
  "probe.danmaku": 60_000,
}

export interface ParsedSnapshot {
  meta: SnapshotMeta
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  settings: AppSettings
  reading: ReadingMap
  items: MediaItem[]
  lastRev: number
}

export class ServiceClient {
  readonly base: string
  private readonly token: string

  constructor(endpoint: EndpointInfo) {
    if (!endpoint.clientToken) throw new Error("服务 endpoint 缺少 clientToken")
    this.base = `http://127.0.0.1:${endpoint.port}`
    this.token = endpoint.clientToken
  }

  get wsUrl(): string {
    return this.base.replace(/^http/, "ws") + "/v1/events"
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, "content-type": "application/json" }
  }

  async hello(): Promise<void> {
    const res = await fetch(`${this.base}/v1/hello`, { headers: this.headers() })
    if (!res.ok) throw new Error(`服务握手失败：HTTP ${res.status}`)
    const hello = (await res.json()) as { protocol?: number; serviceVersion?: string }
    if (hello.protocol !== SERVICE_PROTOCOL) {
      throw new Error(`服务协议不兼容：${hello.protocol}（客户端 ${SERVICE_PROTOCOL}）`)
    }
  }

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.base}/v1/health`, { headers: this.headers() })
    if (!res.ok) throw new Error(`健康检查失败：HTTP ${res.status}`)
    return (await res.json()) as HealthResponse
  }

  async rpc<M extends RpcMethod>(
    method: M,
    params?: RpcParams<M>,
    opts: { opId?: string; jobId?: string; signal?: AbortSignal } = {},
  ): Promise<RpcResult<M>> {
    // 默认超时：底层卡住（抓取/解析走网络）时不能让界面无限转圈。
    // 抓取/解析类给足时间；其余 30s。调用方的 signal 仍可提前取消。
    const timeout = AbortSignal.timeout(TIMEOUT_MS[method] ?? 30_000)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    let res: Response
    try {
      res = await fetch(`${this.base}/v1/rpc`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          method,
          params: params ?? {},
          ...(opts.opId ? { opId: opts.opId } : {}),
          ...(opts.jobId ? { jobId: opts.jobId } : {}),
        }),
        signal,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        // 超时只打断本地请求：服务端 job 仍在跑（继续占浏览器 lane / 排队其它请求）。
        // 有 jobId 就显式取消；没有 jobId 的方法（如 addSubscription）服务端无法中止，
        // 只能等它跑完 —— 调用方不要把超时当「没发生」。
        if (opts.jobId) void this.cancel(opts.jobId)
        throw new ServiceRpcError("timeout", 504, `${method} 超时（${(TIMEOUT_MS[method] ?? 30_000) / 1000}s）`)
      }
      throw e
    }
    let body: RpcResponse<RpcResult<M>>
    try {
      body = (await res.json()) as RpcResponse<RpcResult<M>>
    } catch {
      throw new ServiceRpcError("bad-response", res.status, `服务返回非 JSON（HTTP ${res.status}）`)
    }
    if (!res.ok || !body.ok) {
      throw new ServiceRpcError(
        body.error?.kind ?? "unknown",
        res.status,
        body.error?.message ?? `RPC ${method} 失败（HTTP ${res.status}）`,
      )
    }
    return body.result as RpcResult<M>
  }

  async snapshot(): Promise<ParsedSnapshot> {
    const res = await fetch(`${this.base}/v1/state`, { headers: this.headers() })
    if (!res.ok) throw new Error(`快照失败：HTTP ${res.status}`)
    return parseSnapshot(await res.text())
  }

  async cancel(jobId: string): Promise<void> {
    await fetch(`${this.base}/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      headers: this.headers(),
    }).catch(() => {})
  }
}

function parseSnapshot(text: string): ParsedSnapshot {
  let meta: SnapshotMeta | undefined
  let subscriptions: Subscription[] | undefined
  let groups: SubscriptionGroup[] | undefined
  let settings: AppSettings | undefined
  let reading: ReadingMap | undefined
  let lastRev: number | undefined
  const items: MediaItem[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const value = JSON.parse(line) as SnapshotLine
    switch (value.type) {
      case "meta":
        meta = value
        break
      case "subscriptions":
        subscriptions = value.subscriptions
        groups = value.groups
        break
      case "settings":
        settings = value.settings
        break
      case "reading":
        reading = value.reading
        break
      case "items":
        items.push(...value.items)
        break
      case "snapshot.end":
        lastRev = value.lastRev
        break
    }
  }
  if (!meta || !subscriptions || !groups || !settings || !reading || lastRev === undefined) {
    throw new Error("快照不完整（缺 meta/subscriptions/settings/reading/snapshot.end）")
  }
  return { meta, subscriptions, groups, settings, reading, items, lastRev }
}

function uid(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}-${uuid ?? Math.random().toString(36).slice(2)}`
}

function projectItem(item: MediaItem): MediaItem {
  if (item.kind !== "article" || item.content === undefined) return item
  const { content: _content, ...rest } = item
  return rest as MediaItem
}

function applyReadingToItem(item: MediaItem, map: ReadingMap): MediaItem {
  const rec = findRecord(map, item.subscriptionId, item.id)
  if (!rec) return item
  return {
    ...item,
    isUnread: !rec.read,
    isStarred: rec.starred === true,
    positionSec: rec.positionSec,
    scrollRatio: rec.scrollRatio,
    lastReadAt: rec.lastReadAt,
  } as MediaItem
}

function splitKey(key: string): { subscriptionId: string; itemId: string } | null {
  const i = key.indexOf("\u0000")
  if (i <= 0 || i === key.length - 1) return null
  return { subscriptionId: key.slice(0, i), itemId: key.slice(i + 1) }
}

/**
 * 连接服务并返回同形 DataLayer。
 * 初始化顺序：hello → 快照 → 镜像 → channels → WS（WS 失败不阻塞；重连会重取快照）。
 */
export async function createRemoteDataLayer(endpoint: EndpointInfo, hooks: RemoteHooks = {}): Promise<RemoteDataLayer> {
  let endpointInfo = endpoint
  let client = new ServiceClient(endpoint)
  await client.hello()

  const store = createMediaStore()
  let subscriptions: Subscription[] = []
  let groups: SubscriptionGroup[] = []
  let settings: AppSettings
  let reading: ReadingMap = {}
  let channels: ChannelInfo[] = []
  let lastSeenRev = 0
  let closed = false
  let ws: WebSocket | null = null
  let wsReady = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectBackoff = 500
  let resyncing = false
  const totals = new Map<string, number>()
  const kinds = new Map<string, MediaKind>()
  const jobProgressListeners = new Map<string, (progress: JobProgress) => void>()
  /** 弹幕批次按客户端生成的 subId 分发（服务端广播到全部连接，各端自行过滤）。 */
  const danmakuListeners = new Map<string, (items: DanmakuItem[]) => void>()
  /** 已打开的弹幕订阅参数：服务崩溃换连后要按同一 subId 重开（见 recoverEndpoint）。 */
  const danmakuOpen = new Map<string, { subscriptionId: string; url: string; kind: "vod" | "live" }>()
  let status: RemoteStatus = { online: true, events: false }

  function setStatus(next: RemoteStatus): void {
    status = next
    hooks.onStatus?.(next)
  }

  function applySnapshot(snap: ParsedSnapshot): void {
    const oldSubs = new Set(store.all().map((it) => it.subscriptionId))
    for (const id of oldSubs) store.clear(id)
    const grouped = new Map<string, MediaItem[]>()
    for (const raw of snap.items) {
      const item = applyReadingToItem(projectItem(raw), snap.reading)
      const list = grouped.get(item.subscriptionId)
      if (list) list.push(item)
      else grouped.set(item.subscriptionId, [item])
    }
    for (const [id, items] of grouped) store.replace(id, items)
    for (const sub of snap.subscriptions) {
      if (!grouped.has(sub.id)) store.clear(sub.id)
    }
    subscriptions = snap.subscriptions
    groups = snap.groups
    settings = snap.settings
    reading = snap.reading
    totals.clear()
    for (const [id, total] of Object.entries(snap.meta.totals ?? {})) totals.set(id, total)
    lastSeenRev = snap.lastRev
    hooks.onSubscriptions?.(subscriptions, groups)
    hooks.onSettings?.(settings)
    setStatus({ online: true, events: wsReady, error: wsReady ? undefined : status.error })
  }

  function applyReadingRecords(records: Record<string, ReadRecord | null>): void {
    for (const [key, rec] of Object.entries(records)) {
      const parts = splitKey(key)
      if (!parts) continue
      if (rec === null) delete reading[key]
      else reading[key] = rec
      store.patch(
        parts.subscriptionId,
        parts.itemId,
        rec === null
          ? {
              isUnread: true,
              isStarred: false,
              positionSec: undefined,
              scrollRatio: undefined,
              lastReadAt: undefined,
            }
          : {
              isUnread: !rec.read,
              isStarred: rec.starred === true,
              positionSec: rec.positionSec,
              scrollRatio: rec.scrollRatio,
              lastReadAt: rec.lastReadAt,
            },
      )
    }
  }

  function requestResync(reason: string): void {
    if (closed || resyncing) return
    resyncing = true
    setStatus({ online: status.online, events: false, error: reason })
    try {
      ws?.close()
    } catch {
      /* already closed */
    }
    scheduleReconnect(0)
  }

  function applyStateEvent(event: StateEvent): void {
    if (event.rev < lastSeenRev) return
    if (event.rev > lastSeenRev + 1) {
      requestResync(`event gap: ${lastSeenRev} → ${event.rev}`)
      return
    }
    switch (event.type) {
      case "subscriptions.changed":
        subscriptions = event.subscriptions
        groups = event.groups
        hooks.onSubscriptions?.(subscriptions, groups)
        break
      case "items.replaced":
        store.replace(event.subscriptionId, event.items)
        if (event.total !== undefined) {
          if (event.total === null) totals.delete(event.subscriptionId)
          else totals.set(event.subscriptionId, event.total)
        }
        break
      case "items.appended":
        store.append(event.subscriptionId, event.items)
        if (event.total !== undefined) {
          if (event.total === null) totals.delete(event.subscriptionId)
          else totals.set(event.subscriptionId, event.total)
        }
        break
      case "items.patched":
        for (const item of event.items) store.patch(item.subscriptionId, item.id, item)
        break
      case "items.cleared":
        store.clear(event.subscriptionId)
        totals.delete(event.subscriptionId)
        break
      case "settings.changed":
        settings = event.settings
        hooks.onSettings?.(settings)
        break
      case "reading.changed":
        applyReadingRecords(event.records)
        break
    }
    lastSeenRev = event.rev
  }

  function handleEvent(event: ServiceEvent): void {
    if ("rev" in event && typeof event.rev === "number") {
      applyStateEvent(event as StateEvent)
      return
    }
    switch (event.type) {
      case "job.progress":
        hooks.onJobProgress?.(event.jobId, event.progress)
        jobProgressListeners.get(event.jobId)?.(event.progress)
        break
      case "job.done":
        // caller 的 HTTP 请求负责结果；这里只清进度订阅。
        jobProgressListeners.delete(event.jobId)
        break
      case "danmaku.items":
        danmakuListeners.get(event.subId)?.(event.items)
        break
      case "service.shutdown":
        closed = true
        setStatus({ online: false, events: false, error: "数据服务已关闭" })
        try {
          ws?.close()
        } catch {
          /* already closed */
        }
        break
    }
  }

  async function openWs(): Promise<void> {
    if (closed || ws) return
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      let socket: WebSocket
      try {
        socket = new WebSocket(client.wsUrl)
      } catch {
        done()
        return
      }
      ws = socket
      socket.onopen = () => {
        // ⚠️ 用**当前** endpointInfo 的 token：服务崩溃重连时端口/token 都可能换
        // （见 recoverEndpoint）；用创建时的入参会永远 4001。
        socket.send(JSON.stringify({ type: "auth", token: endpointInfo.clientToken }))
      }
      socket.onmessage = (e) => {
        let msg: WsServerMessage
        try {
          msg = JSON.parse(String(e.data)) as WsServerMessage
        } catch {
          return
        }
        if (msg.type === "hello") {
          wsReady = true
          reconnectBackoff = 500
          resyncing = false
          setStatus({ online: true, events: true })
          socket.send(JSON.stringify({ type: "subscribe", sinceRev: lastSeenRev }))
          done()
          return
        }
        if (msg.type === "event") {
          handleEvent(msg.event)
          return
        }
        if (msg.type === "resync") {
          requestResync(`server resync: ${msg.reason}`)
          return
        }
        if (msg.type === "ping") {
          try {
            socket.send(JSON.stringify({ type: "pong" }))
          } catch {
            /* closed */
          }
        }
      }
      socket.onerror = () => done()
      socket.onclose = () => {
        wsReady = false
        if (ws === socket) ws = null
        done()
        if (closed) return
        // ⚠️ 握手反复失败（token 失效 / 4001）时也要退避：只在快照失败分支翻倍的话，
        // 每次 onclose 都以 500ms 重连，且每轮都先拉一遍全量快照。hello 到达时重置。
        reconnectBackoff = Math.min(Math.max(reconnectBackoff, 500) * 2, 10_000)
        setStatus({ online: true, events: false, error: "事件通道断开，正在重连" })
        scheduleReconnect(reconnectBackoff)
      }
    })
  }

  /**
   * 服务进程可能已退出（崩溃/被外部结束）：宿主（Tauri）能重新拉起并返回**新
   * endpoint**（端口与 token 都会变）。旧 client 永远连不上 —— 换掉后重取快照并
   * 重连，否则只能整页重载才能恢复（2026-11-01 修）。
   */
  async function recoverEndpoint(): Promise<boolean> {
    if (!hooks.resolveEndpoint) return false
    try {
      const fresh = await hooks.resolveEndpoint()
      if (!fresh) return false
      if (fresh.port === endpointInfo.port && fresh.clientToken === endpointInfo.clientToken) return false
      endpointInfo = fresh
      client = new ServiceClient(fresh)
      await client.hello()
      const next = await client.snapshot()
      applySnapshot(next)
      resyncing = false
      reconnectBackoff = 500
      await openWs()
      // 弹幕连接随旧进程消失：用同一 subId 在新服务上重开，播放端不用重新 resolve。
      for (const [subId, params] of danmakuOpen) {
        void client.rpc("danmaku.open", { subId, ...params }, { opId: uid("op") }).catch(() => {})
      }
      return true
    } catch {
      return false // 宿主也拉不起来 → 继续退避
    }
  }

  function scheduleReconnect(delay = reconnectBackoff): void {
    if (closed || reconnectTimer) return
    reconnectBackoff = Math.min(Math.max(delay, 0), 10_000)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void (async () => {
        try {
          // 断线期间可能漏事件：先全量快照再重连，避免依赖事件补放。
          const snap = await client.snapshot()
          applySnapshot(snap)
          resyncing = false
          await openWs()
        } catch (e) {
          if (await recoverEndpoint()) return
          reconnectBackoff = Math.min(reconnectBackoff * 2 || 500, 10_000)
          setStatus({
            online: false,
            events: false,
            error: e instanceof Error ? e.message : String(e),
          })
          scheduleReconnect(reconnectBackoff)
        }
      })()
    }, reconnectBackoff)
  }

  // ── 初始快照 + channels + WS ────────────────────────────────
  const snap = await client.snapshot()
  applySnapshot(snap)
  channels = await client.rpc("channels.list")
  kinds.clear()
  for (const channel of channels) kinds.set(channel.key, channel.kind)
  await openWs()

  async function refreshSubs(): Promise<void> {
    const [nextSubs, nextGroups] = await Promise.all([
      client.rpc("subscriptions.list"),
      client.rpc("subscriptions.listGroups"),
    ])
    subscriptions = nextSubs
    groups = nextGroups
    hooks.onSubscriptions?.(subscriptions, groups)
  }

  function setTotal(subscriptionId: string, total: number | undefined): void {
    if (total === undefined) totals.delete(subscriptionId)
    else totals.set(subscriptionId, total)
  }

  async function syncItems(subscriptionId: string): Promise<void> {
    const [items, total] = await Promise.all([
      client.rpc("store.query", { query: { subscriptionId } }),
      client.rpc("totalOf", { subscriptionId }),
    ])
    store.replace(
      subscriptionId,
      items.map((item) => applyReadingToItem(projectItem(item), reading)),
    )
    setTotal(subscriptionId, total)
  }

  function putRecord(subscriptionId: string, itemId: string, patch: Partial<ReadRecord>): ReadRecord {
    const key = readingKey(subscriptionId, itemId)
    const prev = reading[key]
    const rec: ReadRecord = {
      ...prev,
      read: prev?.read ?? false,
      ...patch,
      lastReadAt: Date.now(),
    }
    reading[key] = rec
    return rec
  }

  const diagnostics = {
    cacheStats: () => client.rpc("diagnostics.cacheStats"),
    clearContentCache: () => client.rpc("diagnostics.clearContentCache"),
    clearCookies: (hosts: string[]) => client.rpc("diagnostics.clearCookies", { hosts }),
    clearAll: async () => {
      const ids = await client.rpc("diagnostics.clearAll")
      subscriptions = []
      groups = []
      reading = {}
      totals.clear()
      for (const id of ids) store.clear(id)
      hooks.onSubscriptions?.([], [])
      return ids
    },
    resetBrowserProfile: () => client.rpc("diagnostics.resetBrowserProfile"),
  }

  const layer: RemoteDataLayer = {
    remote: true,
    listChannels: () => [...channels],
    channelKind: (channelKey) => kinds.get(channelKey),

    async addSubscription(channelKey, title, info, meta) {
      const result = await client.rpc(
        "addSubscription",
        { channelKey, title, info, ...(meta ? { meta } : {}) },
        { opId: uid("op") },
      )
      await refreshSubs()
      await syncItems(result.id).catch(() => {})
      return result
    },

    async previewChannel(channelKey, info) {
      return client.rpc("previewChannel", { channelKey, info }, { opId: uid("op") })
    },

    subscriptions: {
      list: async () => [...subscriptions],
      listGroups: async () => [...groups],
      get: async (id) => subscriptions.find((sub) => sub.id === id),
      async add(subscription) {
        await client.rpc("subscriptions.add", { subscription }, { opId: uid("op") })
        await refreshSubs()
      },
      async update(id, patch) {
        const updated = await client.rpc("subscriptions.update", { id, patch }, { opId: uid("op") })
        subscriptions = updated
          ? subscriptions.map((sub) => (sub.id === id ? updated : sub))
          : subscriptions.filter((sub) => sub.id !== id)
        hooks.onSubscriptions?.(subscriptions, groups)
        return updated
      },
      async remove(id) {
        await client.rpc("subscriptions.remove", { id }, { opId: uid("op") })
        subscriptions = subscriptions.filter((sub) => sub.id !== id)
        store.clear(id)
        totals.delete(id)
        for (const key of Object.keys(reading)) {
          if (key.startsWith(`${id}\u0000`)) delete reading[key]
        }
        hooks.onSubscriptions?.(subscriptions, groups)
      },
      async addGroup(group) {
        await client.rpc("subscriptions.addGroup", { group }, { opId: uid("op") })
        await refreshSubs()
      },
      async updateGroup(id, patch) {
        const updated = await client.rpc("subscriptions.updateGroup", { id, patch }, { opId: uid("op") })
        if (updated) groups = groups.map((group) => (group.id === id ? updated : group))
        hooks.onSubscriptions?.(subscriptions, groups)
        return updated
      },
      async removeGroup(id) {
        await client.rpc("subscriptions.removeGroup", { id }, { opId: uid("op") })
        await refreshSubs()
      },
    },

    reading: {
      getAll: async () => ({ ...reading }),
      get: async (subscriptionId, itemId) => findRecord(reading, subscriptionId, itemId),
      async markRead(subscriptionId, itemId, read = true) {
        await client.rpc("reading.markRead", { subscriptionId, itemId, read }, { opId: uid("op") })
        putRecord(subscriptionId, itemId, { read })
        store.patch(subscriptionId, itemId, { isUnread: !read, lastReadAt: Date.now() })
      },
      async markManyRead(keys, read = true) {
        if (!keys.length) return
        await client.rpc("reading.markManyRead", { keys, read }, { opId: uid("op") })
        const now = Date.now()
        for (const key of keys) {
          const parts = splitKey(key)
          if (!parts) continue
          reading[key] = { ...(reading[key] ?? { read: false }), read, lastReadAt: now }
          store.patch(parts.subscriptionId, parts.itemId, { isUnread: !read, lastReadAt: now })
        }
      },
      async setStarred(subscriptionId, itemId, starred) {
        await client.rpc("reading.setStarred", { subscriptionId, itemId, starred }, { opId: uid("op") })
        putRecord(subscriptionId, itemId, { starred })
        store.patch(subscriptionId, itemId, { isStarred: starred, lastReadAt: Date.now() })
      },
      async setPosition(subscriptionId, itemId, positionSec) {
        await client.rpc("reading.setPosition", { subscriptionId, itemId, positionSec }, { opId: uid("op") })
        putRecord(subscriptionId, itemId, { positionSec })
        store.patch(subscriptionId, itemId, { positionSec, lastReadAt: Date.now() })
      },
      async setScrollRatio(subscriptionId, itemId, scrollRatio) {
        await client.rpc("reading.setScrollRatio", { subscriptionId, itemId, scrollRatio }, { opId: uid("op") })
        putRecord(subscriptionId, itemId, { scrollRatio })
        store.patch(subscriptionId, itemId, { scrollRatio, lastReadAt: Date.now() })
      },
      async deleteBySubscription(subscriptionId) {
        // 服务端 subscriptions.remove 已做事务清理；本方法只清本地镜像。
        for (const key of Object.keys(reading)) {
          if (key.startsWith(`${subscriptionId}\u0000`)) delete reading[key]
        }
      },
    },

    settings: {
      get: async () => settings,
      async set(patch) {
        const next = await client.rpc("settings.set", { patch }, { opId: uid("op") })
        settings = next
        hooks.onSettings?.(settings)
        return next
      },
      async setIfUnchanged(expected, patch) {
        const next = await client.rpc("settings.setIfUnchanged", { expected, patch }, { opId: uid("op") })
        if (next) {
          settings = next
          hooks.onSettings?.(settings)
        }
        return next
      },
      async reset() {
        const next = await client.rpc("settings.reset", {}, { opId: uid("op") })
        settings = next
        hooks.onSettings?.(settings)
        return next
      },
    },

    store: {
      all: () => store.all(),
      query: (query?: MediaQuery) => store.query(query),
      patch: (subscriptionId, id, patch) => store.patch(subscriptionId, id, patch),
      subscribe: (listener) => store.subscribe(listener),
      clear: (subscriptionId) => store.clear(subscriptionId),
    },

    async refresh(subscriptionId, opts) {
      // jobId + cancel：客户端超时/取消时让服务端**真的停下这条抓取**（旧实现只
      // abort 本地 fetch，服务端 job 继续跑完并把结果广播出去）。
      const jobId = uid("job")
      const controller = new AbortController()
      const onAbort = () => {
        controller.abort()
        void client.cancel(jobId)
      }
      opts?.signal?.addEventListener("abort", onAbort, { once: true })
      if (opts?.signal?.aborted) onAbort()
      try {
        const result = await client.rpc(
          "refresh",
          { subscriptionId, force: opts?.force === true },
          { opId: uid("op"), jobId, signal: controller.signal },
        )
        // WS 事件会更新 items；WS 未连上时显式拉一次镜像，避免静默停留在旧内容。
        if (!wsReady) await syncItems(subscriptionId).catch(() => {})
        else setTotal(subscriptionId, await client.rpc("totalOf", { subscriptionId }))
        return result
      } finally {
        opts?.signal?.removeEventListener("abort", onAbort)
      }
    },

    hydrate: async () => {
      // 快照已经是水化后的镜像。
    },

    async resolvePlay(subscriptionId, itemId) {
      return client.rpc("resolvePlay", { subscriptionId, itemId }, { opId: uid("op") })
    },
    async resolveLivePlay(subscriptionId, roomId) {
      return client.rpc("resolveLivePlay", { subscriptionId, roomId }, { opId: uid("op") })
    },
    async resolveDanmaku(subscriptionId, url, kind) {
      // 连接开在服务进程里（凭证不过界），这里只做「订阅 → 批次 → 退订」的桥。
      // subId 由客户端生成且**先挂监听**：服务端一开始推流就可能发首批
      // （VOD 是一次性全量），等 RPC 返回再挂回调会丢掉第一批。
      const stream: DanmakuStream = (onItems) => {
        const subId = uid("dm")
        danmakuListeners.set(subId, onItems)
        danmakuOpen.set(subId, { subscriptionId, url, kind })
        const opening = client
          .rpc("danmaku.open", { subId, subscriptionId, url, kind }, { opId: uid("op") })
          .catch(() => {
            // 该条目不支持弹幕（或解析失败）：静默无弹幕，不阻塞播放。
            danmakuListeners.delete(subId)
            danmakuOpen.delete(subId)
          })
        return () => {
          // ⚠️ 等 open 落地再关：否则 close 先到、open 后到，服务端会留下没人听的连接。
          void opening.finally(() => {
            danmakuListeners.delete(subId)
            danmakuOpen.delete(subId)
            void client.rpc("danmaku.close", { subId }, { opId: uid("op") }).catch(() => {})
          })
        }
      }
      return stream
    },
    async resolveHotWord(subscriptionId, word) {
      return client.rpc("resolveHotWord", { subscriptionId, word }, { opId: uid("op") })
    },
    async resolveDetail(subscriptionId, itemId) {
      return client.rpc("resolveDetail", { subscriptionId, itemId }, { opId: uid("op") })
    },

    async canLoadMore(subscriptionId) {
      return client.rpc("canLoadMore", { subscriptionId })
    },
    async loadMore(subscriptionId) {
      const result = await client.rpc("loadMore", { subscriptionId }, { opId: uid("op") })
      if (!wsReady) await syncItems(subscriptionId).catch(() => {})
      else setTotal(subscriptionId, await client.rpc("totalOf", { subscriptionId }))
      return result
    },
    totalOf: (subscriptionId) => totals.get(subscriptionId),

    async scanLogin(channelKey, emitQr, opts) {
      const jobId = uid("job")
      jobProgressListeners.set(jobId, (progress) => {
        if (progress.phase === "qr") emitQr(progress.qrDataUrl)
      })
      const controller = new AbortController()
      const onAbort = () => {
        controller.abort()
        void client.cancel(jobId)
      }
      opts?.signal?.addEventListener("abort", onAbort, { once: true })
      if (opts?.signal?.aborted) onAbort()
      try {
        return await client.rpc(
          "scanLogin",
          { channelKey, ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) },
          { opId: uid("op"), jobId, signal: controller.signal },
        )
      } finally {
        jobProgressListeners.delete(jobId)
        opts?.signal?.removeEventListener("abort", onAbort)
      }
    },

    async syncBrowserCookies() {
      // 服务在 boot 后自己同步；桌面不再维护浏览器 profile。
      return []
    },

    diagnostics,

    close() {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      try {
        ws?.close()
      } catch {
        /* already closed */
      }
      ws = null
      wsReady = false
    },
  }

  // 类型收窄：`close` 不在 DataLayer 接口里，但返回类型要求它。
  return layer
}

export type { LoginResult, ResolvePlayback, RefreshResult }
