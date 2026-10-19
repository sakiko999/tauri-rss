/**
 * passive/buffer —— LX 被动采集的内存缓冲（不落盘，见风控文档 §3.10）。
 *
 * CDP `Network` 抓到的原始 body 按 `(platform, endpoint, 规范化 URL)` 归并；
 * channel 的 `fetchPassive()` 从这里取最近一份解析。TTL / 限额到期即淘汰，
 * 进程退出清空——**没有持久化层**。
 *
 * ⚠️ 归一化会剥掉一次性签名参数（wts/w_rid/msToken/a_bogus/x-s/...），
 * 否则同一接口每次刷新都是新键，永远命中不了。
 */

export interface PassiveEntry {
  platform: string
  endpoint: string
  url: string
  status: number
  mime: string
  body: string
  /** 写入时间（epoch ms，由注入的 now() 决定，便于自检）。 */
  at: number
  /** 字符数近似字节（跨 runtime 不依赖 Buffer；用于内存预算足够）。 */
  bytes: number
}

export interface PassiveBufferOptions {
  ttlMs?: number
  maxEntryBytes?: number
  maxTotalBytes?: number
  now?: () => number
}

export type PassivePushInput = Omit<PassiveEntry, "at" | "bytes"> & { at?: number }

/** 一次性/易变的 query 参数：不参与 URL 归一化。 */
const VOLATILE_PARAMS = new Set([
  "wts",
  "w_rid",
  "mstoken",
  "a_bogus",
  "x-s",
  "x-t",
  "x-s-common",
  "x-rap-param",
  "x-b3-traceid",
  "xsec_token",
  "xsec_source",
  "signature",
  "token",
  "sign",
  "spm_id_from",
  "vd_source",
])

/** URL 归一化：去 hash、剥易变参数、参数排序。解析失败时原样返回。 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !VOLATILE_PARAMS.has(k.toLowerCase()))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const q = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    return `${u.origin}${u.pathname}${q ? `?${q}` : ""}`
  } catch {
    return raw
  }
}

const entryKey = (platform: string, endpoint: string, url: string) =>
  `${platform}\u0000${endpoint}\u0000${canonicalUrl(url)}`

export class PassiveBuffer {
  private entries = new Map<string, PassiveEntry>()
  private total = 0
  private readonly ttlMs: number
  private readonly maxEntryBytes: number
  private readonly maxTotalBytes: number
  private readonly now: () => number

  constructor(opts: PassiveBufferOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 30 * 60_000
    this.maxEntryBytes = opts.maxEntryBytes ?? 4 * 1024 * 1024
    this.maxTotalBytes = opts.maxTotalBytes ?? 32 * 1024 * 1024
    this.now = opts.now ?? (() => Date.now())
  }

  /** 写入一份响应体；超单条上限直接丢弃（返回 false）。 */
  push(input: PassivePushInput): boolean {
    const bytes = input.body.length
    if (bytes > this.maxEntryBytes || bytes > this.maxTotalBytes) return false
    this.prune()

    const key = entryKey(input.platform, input.endpoint, input.url)
    const old = this.entries.get(key)
    if (old) this.total -= old.bytes

    while (this.total + bytes > this.maxTotalBytes) {
      if (!this.evictOldest()) break
    }

    this.entries.set(key, {
      platform: input.platform,
      endpoint: input.endpoint,
      url: input.url,
      status: input.status,
      mime: input.mime,
      body: input.body,
      at: input.at ?? this.now(),
      bytes,
    })
    this.total += bytes
    return true
  }

  /** 取指定接口的最近一份响应；没有或已过期返回 null。 */
  get(platform: string, endpoint: string, url: string): PassiveEntry | null {
    this.prune()
    return this.entries.get(entryKey(platform, endpoint, url)) ?? null
  }

  /** 取该平台/接口下最新的一份（URL 不固定时用）。 */
  getLatest(platform: string, endpoint: string): PassiveEntry | null {
    this.prune()
    let best: PassiveEntry | null = null
    for (const e of this.entries.values()) {
      if (e.platform !== platform || e.endpoint !== endpoint) continue
      if (!best || e.at > best.at) best = e
    }
    return best
  }

  /** 当前占用（自检/调试用）。 */
  stats(): { count: number; bytes: number; maxBytes: number } {
    this.prune()
    return { count: this.entries.size, bytes: this.total, maxBytes: this.maxTotalBytes }
  }

  clear(): void {
    this.entries.clear()
    this.total = 0
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs
    for (const [k, e] of this.entries) {
      if (e.at < cutoff) {
        this.entries.delete(k)
        this.total -= e.bytes
      }
    }
  }

  private evictOldest(): boolean {
    let oldestKey: string | null = null
    let oldestAt = Infinity
    for (const [k, e] of this.entries) {
      if (e.at < oldestAt) {
        oldestAt = e.at
        oldestKey = k
      }
    }
    if (!oldestKey) return false
    const e = this.entries.get(oldestKey)!
    this.entries.delete(oldestKey)
    this.total -= e.bytes
    return true
  }
}

/** 进程级单例：CDP 采集端写入，channel 的 fetchPassive() 读取。 */
export const passiveBuffer = new PassiveBuffer()
