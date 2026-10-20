/**
 * NetworkGovernor —— 所有出站 HTTP 的单一准入点。
 *
 * 见 docs/crawler-risk-control.md §2。一条流水线:
 *
 *   classify(url) → 冷却 → 去重 → 全局并发 → 平台并发/最小间隔/RPM → 执行
 *
 * 关键取舍(照文档):
 *   - 只对「会触发平台风控的计量请求」做 RPM/冷却;媒体/图片/本地 CDP 不计量,
 *     但**仍共享**全局并发(§2.2)。
 *   - L0 完全直通(调试用)。等级只描述「配额/冷却收多紧」—— 「谁发起请求」
 *     (浏览器被动采集)是渠道属性,不是等级(2026-10-21)。
 *   - 冷却只由显式信号写入(412/418/403/429、平台风控码);超时/5xx 不写。
 *   - 冷却账本 best-effort 落 `appHost.storage` 的 `governor:cooldowns`,
 *     进程内为准(§2.3 简化版)。
 *
 * ⚠️ 原生 `<img>` / 原生 mp4 / 部分 HLS 不经过 `appHost.http`,governor 管不到,
 * 不要假设它能限住全部媒体流量。
 */

/**
 * 防御等级(数字统一):
 *   0 = 无限制(直通,仅调试)
 *   1 = 入门(L1,最宽松的受控档)
 *   2 = 标准(L2)
 *   3 = 严格(L3)
 *
 * ⚠️ 没有「浏览器被动」档:被动采集是渠道属性(`RssChannel.passive`),由 core
 * 决定谁来取数;把它做成等级会让该平台完全看不到内容,属于过度防御
 * (2026-10-21 移除原 L9)。
 */
export type NetLevel = 0 | 1 | 2 | 3

/** 单平台配额。 */
export interface PlatformPolicy {
  maxConcurrent: number
  rpm: number
  minIntervalMs: number
  cooldownBaseMs: number
}

export interface NetPolicy {
  /** 全局默认等级。 */
  level: NetLevel
  /**
   * 平台级等级覆盖(平台名 → 等级)。`"*"` 是兜底覆盖(未知 host / RSS),
   * 优先级:精确平台 → `"*"` → `level`。
   *
   * ⚠️ 只认**平台名**,不认 channelKey —— governor 从 URL host 推导平台,
   * 不知道订阅用的是哪个 channel。channel 级覆盖由 core 的抓取闸门消费。
   */
  levels: Record<string, NetLevel>
  globalMaxConcurrent: number
  platforms: Record<string, PlatformPolicy>
}

/** 请求级覆盖(对应 HttpRequest.policy)。 */
export interface RequestClassOverride {
  platform?: string
  metered?: boolean
  dedupeKey?: string
}

/** 一条请求的分类结果(自检/诊断也用它)。 */
export interface RequestClass {
  platform: string
  metered: boolean
}

/** 未知主机(通用 RSS / 外部 feed)的默认:按 host 各算一个平台。 */
const GENERIC_POLICY: PlatformPolicy = {
  maxConcurrent: 8,
  rpm: 300,
  minIntervalMs: 50,
  cooldownBaseMs: 300_000,
}

export const DEFAULT_NET_POLICY: NetPolicy = {
  level: 1,
  // 默认不做平台覆盖 —— 由用户在设置页按平台/渠道调整。
  levels: {},
  // 媒体分片/图片也走这个计数器;宽松到不会卡住 DASH 多分片并发。
  globalMaxConcurrent: 32,
  platforms: {
    // L1 是**只兜极端情况**的软限制:正常刷新/搜索/详情/解析不应感到排队。
    // L2 = ×0.5、L3 = ×0.25(见 effectivePlatformPolicy)才是真正的防御档。
    bili: { maxConcurrent: 12, rpm: 600, minIntervalMs: 50, cooldownBaseMs: 600_000 },
    douyin: { maxConcurrent: 8, rpm: 300, minIntervalMs: 50, cooldownBaseMs: 300_000 },
    xhs: { maxConcurrent: 8, rpm: 300, minIntervalMs: 50, cooldownBaseMs: 1_800_000 },
    weibo: { maxConcurrent: 8, rpm: 300, minIntervalMs: 50, cooldownBaseMs: 1_800_000 },
    youtube: { maxConcurrent: 12, rpm: 600, minIntervalMs: 50, cooldownBaseMs: 600_000 },
    apple: { maxConcurrent: 8, rpm: 300, minIntervalMs: 50, cooldownBaseMs: 300_000 },
    // Twitch 未公开 API,按 IP 限流且无公开阈值 —— 保守起步。
    twitch: { maxConcurrent: 6, rpm: 120, minIntervalMs: 100, cooldownBaseMs: 600_000 },
  },
}

function clonePolicy(p: NetPolicy): NetPolicy {
  const platforms: Record<string, PlatformPolicy> = {}
  for (const [name, quota] of Object.entries(p.platforms)) platforms[name] = { ...quota }
  return {
    level: p.level,
    levels: { ...p.levels },
    globalMaxConcurrent: p.globalMaxConcurrent,
    platforms,
  }
}

let _policy = clonePolicy(DEFAULT_NET_POLICY)

/**
 * 改运行期策略(局部字段合并;platform 逐项覆盖)。
 *
 * ⚠️ `levels` 是**整表替换**(不是合并):它是设置页"平台覆盖"的完整快照,
 * 删除某个平台的覆盖必须靠整表替换表达;逐项合并会让删掉的值一直留在宿主里。
 */
export function configureNetwork(
  input: { level?: NetLevel } & Partial<NetPolicy>,
): void {
  if (input.level !== undefined) _policy.level = input.level
  if (input.levels !== undefined) _policy.levels = { ...input.levels }
  if (input.globalMaxConcurrent !== undefined) {
    _policy.globalMaxConcurrent = Math.max(1, Math.floor(input.globalMaxConcurrent))
  }
  if (input.platforms) {
    for (const [name, quota] of Object.entries(input.platforms)) {
      if (quota) _policy.platforms[name] = { ...quota }
    }
  }
}

/**
 * 平台生效等级:精确平台覆盖 → `"*"` 兜底覆盖 → 全局默认。
 * 未知 host(通用 RSS)落到自己的 host 名,因此通常由 `"*"` 接管。
 */
export function levelFor(platform: string): NetLevel {
  return _policy.levels[platform] ?? _policy.levels["*"] ?? _policy.level
}

/** 等级对基准配额的缩放:L1 ×1(入门)、L2 ×0.5(标准)、L3 ×0.25(严格)。 */
const LEVEL_FACTOR: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.5, 3: 0.25 }

function tierOf(level: NetLevel): 1 | 2 | 3 {
  return level === 2 ? 2 : level === 3 ? 3 : 1
}

/**
 * 平台有效配额 = 基准配额 × 该平台等级的缩放系数。
 * 冷却基础值不随等级变(它描述平台本身);L0 不排队,系数不影响实际行为。
 */
export function effectivePlatformPolicy(platform: string): PlatformPolicy {
  const base = _policy.platforms[platform] ?? GENERIC_POLICY
  const factor = LEVEL_FACTOR[tierOf(levelFor(platform))]
  return {
    maxConcurrent: Math.max(1, Math.round(base.maxConcurrent * factor)),
    rpm: Math.max(1, Math.floor(base.rpm * factor)),
    minIntervalMs: Math.max(0, Math.round(base.minIntervalMs / factor)),
    cooldownBaseMs: base.cooldownBaseMs,
  }
}

// ── 分类:URL host → 平台 / 是否计量 ──────────────────────────────────────────

/** 媒体/图片/字体扩展名 —— 不计量(播放器/图片自己有调度与并发控制)。 */
const MEDIA_EXT_RE =
  /\.(?:mp4|m4s|m4a|mp3|aac|ogg|oga|webm|ts|flv|m3u8|mpd|jpg|jpeg|png|webp|avif|gif|bmp|ico|svg|woff2?)$/i

/** 已知媒体 CDN —— 即使 URL 没有扩展名也不计量(签名直链常见无后缀)。 */
const MEDIA_CDN_SUFFIXES: readonly string[] = [
  // B 站视频/图片
  "hdslb.com",
  "bilivideo.com",
  "bilivideo.cn",
  // 抖音 / 字节
  "douyinvod.com",
  "douyinpic.com",
  "douyinstatic.com",
  "douyincdn.com",
  "byteimg.com",
  "zjcdn.com",
  // 斗鱼
  "douyucdn.cn",
  "douyucdn2.cn",
  "douyucdn.com",
  // 虎牙(只列 CDN,www.huya.com 仍是 API)
  "huyacdn.com",
  // YouTube / Google
  "googlevideo.com",
  "ytimg.com",
  "ggpht.com",
  // 小红书
  "xhscdn.com",
  // 微博 / 新浪图床
  "sinaimg.cn",
  "weibocdn.com",
  // Apple 播客封面/预览
  "mzstatic.com",
  // Twitch 播放 CDN(usher master / 分片 / 预览图)
  "ttvnw.net",
  "jtvnw.net",
  // 通用 CDN
  "akamaized.net",
  "akamaized.com",
  "cloudfront.net",
  "fastly.net",
  "fbcdn.net",
  "cdninstagram.com",
  "doubanio.com",
]

function matchesSuffix(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`))
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host.startsWith("127.") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1"
  )
}

function hostOf(url: string): string {
  const raw = String(url ?? "")
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    // 少数调用方给的是半截 URL;补协议再试一次,失败按未知处理。
    try {
      return new URL(`https://${raw.replace(/^\/+/, "")}`).hostname.toLowerCase()
    } catch {
      return ""
    }
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return String(url).split(/[?#]/, 1)[0] ?? ""
  }
}

/** 平台由 host 推导;未知 host 去掉 `www.` 后原样作平台(每站一个桶)。 */
function platformOf(host: string): string {
  if (!host) return "unknown"
  if (host === "bilibili.com" || host.endsWith(".bilibili.com")) return "bili"
  if (
    host === "weibo.com" ||
    host.endsWith(".weibo.com") ||
    host === "weibo.cn" ||
    host.endsWith(".weibo.cn")
  ) {
    return "weibo"
  }
  if (host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com")) return "xhs"
  if (host === "douyin.com" || host.endsWith(".douyin.com")) return "douyin"
  if (host === "douyu.com" || host.endsWith(".douyu.com")) return "douyu"
  if (host === "huya.com" || host.endsWith(".huya.com")) return "huya"
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtubei.googleapis.com") {
    return "youtube"
  }
  if (host === "itunes.apple.com" || host.endsWith(".itunes.apple.com")) return "apple"
  if (
    host === "twitch.tv" ||
    host.endsWith(".twitch.tv") ||
    host === "ttvnw.net" ||
    host.endsWith(".ttvnw.net") ||
    host === "jtvnw.net" ||
    host.endsWith(".jtvnw.net")
  ) {
    return "twitch"
  }
  return host.startsWith("www.") ? host.slice(4) : host
}

function isMeteredHost(host: string, url: string): boolean {
  if (!host) return true
  if (isLocalHost(host)) return false
  if (matchesSuffix(host, MEDIA_CDN_SUFFIXES)) return false
  return !MEDIA_EXT_RE.test(pathOf(url))
}

/**
 * 分类:**唯一权威**。平台默认由 host 推导;请求级 policy 可覆盖 platform 与
 * metered(调用方明确知道是媒体/图片时不必依赖 host 猜测)。
 */
export function classifyRequest(url: string, override?: RequestClassOverride): RequestClass {
  const host = hostOf(url)
  return {
    platform: override?.platform ?? platformOf(host),
    metered: override?.metered ?? isMeteredHost(host, url),
  }
}

// ── 运行期状态 ────────────────────────────────────────────────────────────────

interface Semaphore {
  acquire(): Promise<void>
  release(): void
}

/** FIFO 计数信号量;limit 动态读取(改配置立即生效)。 */
function createSemaphore(limit: () => number): Semaphore {
  let active = 0
  const waiters: Array<() => void> = []
  return {
    async acquire() {
      if (active < Math.max(1, limit())) {
        active++
        return
      }
      // 名额由 release 转移过来(active 已计入,这里不再 ++)。
      await new Promise<void>((resolve) => waiters.push(resolve))
    },
    release() {
      const next = waiters.shift()
      if (next) next()
      else active--
    },
  }
}

const _globalSem = createSemaphore(() => _policy.globalMaxConcurrent)
const _platformSems = new Map<string, Semaphore>()

function platformSem(platform: string): Semaphore {
  let sem = _platformSems.get(platform)
  if (!sem) {
    sem = createSemaphore(() => effectivePlatformPolicy(platform).maxConcurrent)
    _platformSems.set(platform, sem)
  }
  return sem
}

interface CooldownEntry {
  until: number
  signal: string
}

/** 平台级冷却账本(不做 endpoint 粒度,§2.3)。 */
const _cooldowns = new Map<string, CooldownEntry>()
/** 计量请求 in-flight 去重:key → 共享 promise。 */
const _inflight = new Map<string, Promise<HttpResponse>>()
/** 平台级最小间隔与 RPM 滑动窗口。 */
const _nextAllowedAt = new Map<string, number>()
const _rpmLog = new Map<string, number[]>()
/** 浏览器操作最近一次放行时间(平台 → epoch ms)。 */
const _lastBrowserAt = new Map<string, number>()

const RPM_WINDOW_MS = 60_000
/** 这些状态码视为平台风控信号,自动写冷却(§2.3 规则 2)。 */
const RISK_STATUSES = new Set([403, 412, 418, 429])

let _queued = 0
let _inFlight = 0
/** 最近一次 HTTP(含媒体分片)的端到端耗时 —— 播放器「统计信息」用。 */
let _lastLatency: { ms: number; platform: string } | null = null
/** 进程内累计出站请求数与响应体大小(≈ 字节;base64 字符串按字符数估)。 */
let _netRequests = 0
let _netBytes = 0

/** 廉价估算响应体大小(媒体分片可达 MB 级,不能逐字节编码)。 */
function bodySize(body: unknown): number {
  if (typeof body === "string") return body.length
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  return 0
}

function nowMs(): number {
  try {
    return globalThis.appHost?.now?.() ?? Date.now()
  } catch {
    return Date.now()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── 冷却 ─────────────────────────────────────────────────────────────────────

const MINUTE = 60_000

/** 平台 + 显式信号 → 冷却时长。未列出的信号走 cooldownBaseMs。 */
const SIGNAL_COOLDOWNS: Record<string, Record<string, number>> = {
  bili: { "412": 15 * MINUTE, "-352": 30 * MINUTE, "-509": 30 * MINUTE },
  xhs: { "verify-box": 60 * MINUTE, "300011": 60 * MINUTE },
  weibo: { "418": 30 * MINUTE, "403": 30 * MINUTE, "-100": 30 * MINUTE, "432": 10 * MINUTE },
  douyin: { "4031": 30 * MINUTE, "2483": 30 * MINUTE },
  youtube: { "429": 15 * MINUTE },
  // 429 = 限流,显式 10 分钟;403 多为地区/版权限制,未单列信号 → 走 cooldownBaseMs 兜底。
  twitch: { "429": 10 * MINUTE },
}

/**
 * reportRisk —— 显式风控信号写平台冷却。
 *
 * 只对计量请求生效:平台名本身是 localhost 或已知媒体 CDN 时忽略
 * (媒体/图片不读写冷却,§2.3 规则 1)。冷却期内重复信号只刷新 reason,
 * 不叠加时间。
 */
export function reportRisk(platform: string, signal: string): void {
  if (!platform) return
  const name = platform.toLowerCase()
  if (isLocalHost(name) || matchesSuffix(name, MEDIA_CDN_SUFFIXES)) return

  const sig = String(signal ?? "").trim()
  const table = SIGNAL_COOLDOWNS[platform]
  const specific = table?.[sig] ?? table?.[sig.toLowerCase()]
  const ms = specific ?? effectivePlatformPolicy(platform).cooldownBaseMs
  if (!(ms > 0)) return

  const now = nowMs()
  const current = _cooldowns.get(platform)
  if (current && current.until > now) {
    // 已处于冷却:只刷新 signal,不延长(§2.3 规则 4)。
    current.signal = sig
    persistCooldowns()
    return
  }
  _cooldowns.set(platform, { until: now + ms, signal: sig })
  persistCooldowns()
}

/**
 * browserGate —— 浏览器(CDP)操作的准入闸门。
 *
 * ⚠️ CDP 流量不经过 `governedHttp`,平台配额/冷却原本只作用于 `appHost.http`;
 * 而 xhs 的**真实主路径恰恰是浏览器导航**(整页导航 + 页面自身 XHR)。不在入口补闸,
 * 「风控后冷却 60 分钟」就只是一句安慰:下一次刷新仍会驱动已登录的 Edge 撞验证页。
 *
 * 语义:
 *   1. L0 直通(调试,与 HTTP 一致);
 *   2. 平台冷却未到期 → 拒绝,文案与 HTTP 通路相同;
 *   3. 同平台两次浏览器操作之间至少间隔 `max(600ms, minIntervalMs × 12)` + 0~400ms
 *      随机抖动(L2/L3 随等级放大)。浏览器操作比单个 HTTP 请求重得多,基准取 600ms;
 *      抖动避免 N 个订阅刷新时形成完全固定的节奏。
 *
 * ⚠️ **登录流程不要调用它**:冷却期正是用户需要重新扫码恢复的时候,拦住登录会让
 * 账号永远无法自救。登录只用 `withBrowserMode` 的互斥锁即可。
 */
export async function browserGate(platform: string): Promise<void> {
  if (levelFor(platform) === 0) return
  ensureLoaded()

  const now = nowMs()
  const cooldown = _cooldowns.get(platform)
  if (cooldown) {
    if (cooldown.until > now) {
      const left = Math.ceil((cooldown.until - now) / 1000)
      const wait = left >= 60 ? `${Math.ceil(left / 60)} 分钟` : `${left} 秒`
      throw new Error(`平台冷却中（${platform}，剩余 ${wait}，信号 ${cooldown.signal}）`)
    }
    _cooldowns.delete(platform)
  }

  const pol = effectivePlatformPolicy(platform)
  const interval = Math.max(600, pol.minIntervalMs * 12)
  const jitter = Math.floor(Math.random() * 400)
  const last = _lastBrowserAt.get(platform) ?? 0
  const wait = last + interval + jitter - nowMs()
  if (wait > 0) await sleep(wait)
  _lastBrowserAt.set(platform, nowMs())
}

/** 供诊断:活跃冷却的剩余毫秒;过期项顺手清理。 */
export function governorStats(): {
  cooldowns: Record<string, number>
  inFlight: number
  queued: number
  /** 最近一次 HTTP 端到端耗时(ms)与所属平台;无请求过为 null。 */
  lastLatency: { ms: number; platform: string } | null
  /** 进程内累计出站请求数与响应体大小。 */
  network: { requests: number; bytes: number }
} {
  ensureLoaded()
  const now = nowMs()
  const cooldowns: Record<string, number> = {}
  for (const [platform, entry] of _cooldowns) {
    const left = entry.until - now
    if (left > 0) cooldowns[platform] = left
    else _cooldowns.delete(platform)
  }
  return {
    cooldowns,
    inFlight: _inFlight,
    queued: _queued,
    lastLatency: _lastLatency,
    network: { requests: _netRequests, bytes: _netBytes },
  }
}

// ── 冷却持久化(best-effort;进程内为准) ──────────────────────────────────────

const COOLDOWN_KEY = "governor:cooldowns"
let _loaded = false

function getStorage(): StorageBackend | undefined {
  try {
    return globalThis.appHost?.storage
  } catch {
    return undefined
  }
}

/** 首次用到时恢复冷却;storage 尚未注入则不标记,下次再试。 */
function ensureLoaded(): void {
  if (_loaded) return
  const storage = getStorage()
  if (!storage) return
  _loaded = true
  void storage
    .get(COOLDOWN_KEY)
    .then((raw) => {
      if (!raw) return
      const data = JSON.parse(raw) as Record<string, { until?: unknown; signal?: unknown }>
      const now = nowMs()
      for (const [platform, entry] of Object.entries(data)) {
        // 进程内已有的值优先(它更新)。
        if (_cooldowns.has(platform)) continue
        if (!entry || typeof entry.until !== "number" || entry.until <= now) continue
        _cooldowns.set(platform, {
          until: entry.until,
          signal: typeof entry.signal === "string" ? entry.signal : "restored",
        })
      }
    })
    .catch(() => {
      // 存储不可用/数据损坏一律静默:进程内账本照常工作。
    })
}

function persistCooldowns(): void {
  const storage = getStorage()
  if (!storage) return
  const now = nowMs()
  const data: Record<string, CooldownEntry> = {}
  for (const [platform, entry] of _cooldowns) {
    if (entry.until > now) data[platform] = entry
  }
  void storage.set(COOLDOWN_KEY, JSON.stringify(data)).catch(() => {})
}

// ── 配额 ─────────────────────────────────────────────────────────────────────

/**
 * 预约平台的最小间隔与 RPM 名额(原子:读-算-写之间没有 await),
 * 返回需要等待的毫秒数。并发调用各自排到未来,不会同时醒来突刺。
 */
function reservePlatformSlot(platform: string, pol: PlatformPolicy): number {
  const now = nowMs()

  // 最小间隔
  const interval = Math.max(0, pol.minIntervalMs)
  const intervalAt = Math.max(now, _nextAllowedAt.get(platform) ?? 0)
  _nextAllowedAt.set(platform, intervalAt + interval)

  // RPM 滑动窗口:窗口内第 rpm 个请求放行时,再往前一个名额空出。
  const rpm = Math.max(1, Math.floor(pol.rpm))
  let log = _rpmLog.get(platform)
  if (!log) {
    log = []
    _rpmLog.set(platform, log)
  }
  while (log.length && log[0] <= now - RPM_WINDOW_MS) log.shift()
  let at = intervalAt
  if (log.length >= rpm) at = Math.max(at, log[log.length - rpm] + RPM_WINDOW_MS)
  log.push(at)
  if (log.length > rpm * 2) log.splice(0, log.length - rpm)

  return at - now
}

// ── 执行 ─────────────────────────────────────────────────────────────────────

async function runGlobal<T>(fn: () => Promise<T>): Promise<T> {
  await _globalSem.acquire()
  try {
    return await fn()
  } finally {
    _globalSem.release()
  }
}

function dedupeKeyFor(req: HttpRequest, platform: string): string {
  if (req.policy?.dedupeKey) return `k:${platform}:${req.policy.dedupeKey}`
  return `${(req.method ?? "GET").toUpperCase()}\u0000${req.url}\u0000${req.body ?? ""}`
}

/** 计量请求:冷却 → 去重 → 平台并发/配额 → 全局并发 → 执行。 */
function meteredRequest(
  backend: HttpBackend,
  req: HttpRequest,
  platform: string,
): Promise<HttpResponse> {
  ensureLoaded()

  // 1. 平台冷却:未到期直接 reject,不发请求。
  const cooldown = _cooldowns.get(platform)
  if (cooldown) {
    const now = nowMs()
    if (cooldown.until > now) {
      // 不给用户看完整 URL（吐司放不下）；subscriptionId 已在 data-layer 的日志里。
      const left = Math.ceil((cooldown.until - now) / 1000)
      const wait = left >= 60 ? `${Math.ceil(left / 60)} 分钟` : `${left} 秒`
      return Promise.reject(
        new Error(`平台冷却中（${platform}，剩余 ${wait}，信号 ${cooldown.signal}）`),
      )
    }
    _cooldowns.delete(platform)
  }

  // 2. in-flight 去重:同 method+url+body 共享同一个 promise。
  const key = dedupeKeyFor(req, platform)
  const existing = _inflight.get(key)
  if (existing) return existing

  const promise = (async () => {
    _queued++
    let waiting = true
    const markStarted = () => {
      if (waiting) {
        waiting = false
        _queued--
      }
    }
    try {
      const pol = effectivePlatformPolicy(platform)
      const sem = platformSem(platform)
      await sem.acquire()
      try {
        const wait = reservePlatformSlot(platform, pol)
        if (wait > 0) await sleep(wait)
        await _globalSem.acquire()
        markStarted()
        try {
          _inFlight++
          try {
            const res = await backend.request(req)
            // 3. 状态码自动写冷却(仅计量路径)。
            if (RISK_STATUSES.has(res.status)) reportRisk(platform, String(res.status))
            return res
          } finally {
            _inFlight--
          }
        } finally {
          _globalSem.release()
        }
      } finally {
        sem.release()
      }
    } finally {
      // 出错/提前返回时 queued 也要归零。
      markStarted()
    }
  })()

  _inflight.set(key, promise)
  const cleanup = () => {
    if (_inflight.get(key) === promise) _inflight.delete(key)
  }
  // 用 then 而不是 finally:后者会派生一个可能未处理的 rejected promise。
  void promise.then(cleanup, cleanup)
  return promise
}

/**
 * 用 governor 包住任意 HttpBackend(runtime 在注入时统一套这一层)。
 * 所有经过 `appHost.http` 的请求都从这里过。
 */
export function governedHttp(backend: HttpBackend): HttpBackend {
  // 端到端耗时只记**最后一次**(播放器诊断用);所有分支都经过它,包括 L0 与媒体分片。
  const timed: HttpBackend = {
    async request(req) {
      const t0 = nowMs()
      try {
        const res = await backend.request(req)
        _netBytes += bodySize(res.body)
        return res
      } finally {
        _netRequests++
        _lastLatency = {
          ms: Math.round(nowMs() - t0),
          platform: classifyRequest(req.url, req.policy).platform,
        }
      }
    },
  }
  return {
    request(req) {
      ensureLoaded()
      const cls = classifyRequest(req.url, req.policy)
      // 等级按**平台**解析(设置页可给单个平台/渠道单独设档)。
      const level = levelFor(cls.platform)

      // L0:直通,不排队/不去重/不写冷却(仅调试)。
      if (level === 0) return timed.request(req)

      // 媒体/图片/本地 CDP:不计量,但仍占全局并发(§2.2)。
      if (!cls.metered) {
        return runGlobal(async () => {
          _inFlight++
          try {
            return await timed.request(req)
          } finally {
            _inFlight--
          }
        })
      }

      return meteredRequest(timed, req, cls.platform)
    },
  }
}
