/**
 * 数据服务协议 —— desktop / CLI / rss --service 共用的类型与常量。
 *
 * 传输：`127.0.0.1` HTTP/1.1 + WS；token 走 Authorization / WS 首帧，绝不进 URL。
 * 版本：`protocol` 整数（不兼容才 +1），`serviceVersion` 为语义版本；同版本只做加法。
 */

import type {
  AppSettings,
  ChannelInfo,
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

/** 协议整数：不兼容变更才 +1；同版本内只做加法。 */
export const SERVICE_PROTOCOL = 1
export const SERVICE_VERSION = "0.2.0"
export const ENDPOINT_SCHEMA = "amoeba-service/1"

/**
 * endpoint.json 的内容（owner token 不在其中；client token 单独下发）。
 * `clientToken` 只给 attach 的客户端发命令，不能 `/v1/shutdown`。
 */
export interface EndpointInfo {
  schema: typeof ENDPOINT_SCHEMA
  pid: number
  bootId: string
  port: number
  protocol: number
  serviceVersion: string
  dataDir: string
  dbFile: string
  profileDir: string
  startedAt: number
  parentPid?: number
  /** attach 用只读+命令 token；owner token 只在 spawn 者的 token 文件里。 */
  clientToken?: string
}

export interface HelloResponse {
  protocol: number
  minClientProtocol: number
  serviceVersion: string
  bootId: string
  pid: number
  rev: number
  features: string[]
}

export interface HealthResponse {
  ok: boolean
  uptimeMs: number
  jobs: number
  rev: number
  bootId: string
}

/** 本服务实际支持的方法名（客户端可据此做能力探测）。 */
export const SERVICE_FEATURES = ["snapshot", "events", "jobs", "refreshAll", "diagnostics"] as const

/* ────────────────────────────── RPC ────────────────────────────── */

export interface RpcRequest {
  method: RpcMethod
  params?: unknown
  /** 幂等键；写命令/长任务必带。服务内 5 分钟 / 1024 条 LRU。 */
  opId?: string
  /** caller-only job（扫码/进度）由客户端指定，便于在响应前订阅进度。 */
  jobId?: string
}

export interface RpcResponse<T = unknown> {
  ok: boolean
  result?: T
  error?: { kind: string; message: string; retryable?: boolean }
  rev?: number
}

export interface AddSubscriptionMeta {
  groupId?: string | null
  refreshIntervalSec?: number
}

export interface AddSubscriptionResult {
  id: string
  refresh: RefreshResult
}

export interface LoadMoreResult {
  addedCount: number
  hasMore: boolean
}

export interface PreviewResult {
  items: MediaItem[]
  total?: number
}

export interface RefreshAllResult {
  results: RefreshResult[]
}

export interface DiagnosticsStats {
  keys: number
  bytes: number
}

/**
 * 方法 → 参数/结果。参数用对象而不是位置参数，便于同版本加字段。
 * `void` 方法发 `{}` 或省略 params。
 */
export interface RpcMethodMap {
  "channels.list": { params: Record<string, never>; result: ChannelInfo[] }
  "channels.kind": { params: { channelKey: string }; result: MediaKind | undefined }

  "subscriptions.list": { params: Record<string, never>; result: Subscription[] }
  "subscriptions.listGroups": { params: Record<string, never>; result: SubscriptionGroup[] }
  "subscriptions.get": { params: { id: string }; result: Subscription | undefined }
  "subscriptions.add": { params: { subscription: Subscription }; result: void }
  "subscriptions.update": {
    params: { id: string; patch: Partial<Omit<Subscription, "id">> }
    result: Subscription | undefined
  }
  "subscriptions.remove": { params: { id: string }; result: void }
  "subscriptions.addGroup": { params: { group: SubscriptionGroup }; result: void }
  "subscriptions.updateGroup": {
    params: { id: string; patch: Partial<Omit<SubscriptionGroup, "id">> }
    result: SubscriptionGroup | undefined
  }
  "subscriptions.removeGroup": { params: { id: string }; result: void }

  "reading.getAll": { params: Record<string, never>; result: ReadingMap }
  "reading.get": {
    params: { subscriptionId: string; itemId: string }
    result: ReadRecord | undefined
  }
  "reading.markRead": {
    params: { subscriptionId: string; itemId: string; read?: boolean }
    result: void
  }
  "reading.markManyRead": { params: { keys: string[]; read?: boolean }; result: void }
  "reading.setStarred": {
    params: { subscriptionId: string; itemId: string; starred: boolean }
    result: void
  }
  "reading.setPosition": {
    params: { subscriptionId: string; itemId: string; positionSec: number }
    result: void
  }
  "reading.setScrollRatio": {
    params: { subscriptionId: string; itemId: string; scrollRatio: number }
    result: void
  }

  "settings.get": { params: Record<string, never>; result: AppSettings }
  "settings.set": { params: { patch: Partial<AppSettings> }; result: AppSettings }
  "settings.setIfUnchanged": {
    params: { expected: Partial<AppSettings>; patch: Partial<AppSettings> }
    result: AppSettings | null
  }
  "settings.reset": { params: Record<string, never>; result: AppSettings }

  "store.all": { params: Record<string, never>; result: MediaItem[] }
  "store.query": { params: { query?: MediaQuery }; result: MediaItem[] }

  canLoadMore: { params: { subscriptionId: string }; result: boolean }
  totalOf: { params: { subscriptionId: string }; result: number | undefined }

  addSubscription: {
    params: {
      channelKey: string
      title: string
      info: Record<string, string>
      meta?: AddSubscriptionMeta
    }
    result: AddSubscriptionResult
  }
  previewChannel: {
    params: { channelKey: string; info: Record<string, string> }
    result: PreviewResult
  }
  refresh: { params: { subscriptionId: string; force?: boolean }; result: RefreshResult }
  refreshAll: { params: { force?: boolean }; result: RefreshAllResult }
  loadMore: { params: { subscriptionId: string }; result: LoadMoreResult }
  resolveDetail: {
    params: { subscriptionId: string; itemId: string }
    result: MediaItem | null
  }
  resolvePlay: {
    params: { subscriptionId: string; itemId: string }
    result: ResolvePlayback
  }
  resolveLivePlay: {
    params: { subscriptionId: string; roomId: string }
    result: ResolvePlayback
  }
  resolveHotWord: {
    params: { subscriptionId: string; word: string }
    result: MediaItem[]
  }
  scanLogin: {
    params: { channelKey: string; timeoutMs?: number }
    result: LoginResult
  }
  syncBrowserCookies: {
    params: Record<string, never>
    result: Array<keyof AppSettings>
  }

  "diagnostics.cacheStats": { params: Record<string, never>; result: DiagnosticsStats }
  "diagnostics.clearContentCache": { params: Record<string, never>; result: number }
  "diagnostics.clearCookies": { params: { hosts: string[] }; result: void }
  "diagnostics.clearAll": { params: Record<string, never>; result: void }
  "diagnostics.resetBrowserProfile": { params: Record<string, never>; result: string }

  // CLI 原始探针（fetch/item/play/dm 的远端路径；只读，不写库）。
  // route/streams/items 用 unknown 承载，类型仍由 CLI/resolve 各自持有。
  "probe.fetch": {
    params: { channelKey: string; info: Record<string, string>; passive?: boolean }
    result: { xml: string; tookMs: number }
  }
  "probe.resolve": {
    params: { url: string }
    result: { route: unknown; streams: unknown[]; tookMs: number }
  }
  "probe.danmaku": {
    params: { url: string; seconds?: number; n?: number }
    result: { route: unknown; kind: "vod" | "live"; items: unknown[]; tookMs: number }
  }
}

export type RpcMethod = keyof RpcMethodMap
export type RpcParams<M extends RpcMethod> = RpcMethodMap[M]["params"]
export type RpcResult<M extends RpcMethod> = RpcMethodMap[M]["result"]

/* ──────────────────────────── Snapshot ─────────────────────────── */

export interface SnapshotMeta {
  type: "meta"
  protocol: number
  serviceVersion: string
  bootId: string
  rev: number
  dataDir: string
  dbFile: string
  profileDir: string
  /** 渠道真实总数（weibo cardlistInfo.total 等）；客户端用来维护 totalOf。 */
  totals: Record<string, number>
}

export interface SnapshotSubscriptions {
  type: "subscriptions"
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
}

export interface SnapshotSettings {
  type: "settings"
  settings: AppSettings
}

export interface SnapshotReading {
  type: "reading"
  reading: ReadingMap
}

export interface SnapshotItems {
  type: "items"
  items: MediaItem[]
}

export interface SnapshotEnd {
  type: "snapshot.end"
  lastRev: number
}

export type SnapshotLine =
  SnapshotMeta | SnapshotSubscriptions | SnapshotSettings | SnapshotReading | SnapshotItems | SnapshotEnd

/* ───────────────────────────── Events ──────────────────────────── */

/**
 * 合帧后的状态提交：一次提交 `rev+1`，可包含多条事件（它们共享同一个 rev）；
 * 客户端把同一 rev 的所有事件应用完再推进 `appliedRev`。
 */
export type StateEvent =
  | {
      type: "subscriptions.changed"
      rev: number
      subscriptions: Subscription[]
      groups: SubscriptionGroup[]
    }
  | {
      type: "items.replaced"
      rev: number
      subscriptionId: string
      items: MediaItem[]
      /** 渠道真实总数；`null`/缺省 = 该订阅没有 total。 */
      total?: number | null
    }
  | {
      type: "items.appended"
      rev: number
      subscriptionId: string
      items: MediaItem[]
      total?: number | null
    }
  | {
      type: "items.patched"
      rev: number
      subscriptionId: string
      items: MediaItem[]
      total?: number | null
    }
  | { type: "items.cleared"; rev: number; subscriptionId: string }
  | { type: "settings.changed"; rev: number; settings: AppSettings }
  | {
      type: "reading.changed"
      rev: number
      /** 本次变更/删除的 key（`readingKey`）→ 记录；`null` 表示删除。 */
      records: Record<string, ReadRecord | null>
    }

/** caller-only：不占 rev，不进快照。 */
export type JobProgress =
  | { phase: "start"; label?: string }
  | { phase: "progress"; current?: number; total?: number; label?: string }
  | { phase: "qr"; qrDataUrl: string | null }

export type ServiceEvent =
  | StateEvent
  | { type: "job.progress"; jobId: string; progress: JobProgress }
  | {
      type: "job.done"
      jobId: string
      result?: unknown
      error?: { kind: string; message: string }
    }
  | { type: "service.shutdown"; reason?: string }

/** WS 下行信封。`hello` 在认证后立即发送。 */
export type WsServerMessage =
  | {
      type: "hello"
      data: HelloResponse & { clientToken: boolean }
    }
  | { type: "event"; event: ServiceEvent }
  | { type: "ping" }
  | { type: "pong" }
  /** 订阅 gap 超出事件环形缓冲：客户端必须重新 GET /v1/state。 */
  | { type: "resync"; reason: string }

/** WS 上行。 */
export type WsClientMessage =
  { type: "auth"; token: string } | { type: "subscribe"; sinceRev?: number } | { type: "ping" } | { type: "pong" }

/** 认证失败的统一形状（HTTP 401 / WS close）。 */
export interface AuthError {
  kind: "unauthorized"
  message: string
}
