/**
 * 统一错误分类 —— 跨 crawler/core/player/UI 的失败语义。
 *
 * 背景：平台 client 过去只 throw 普通 Error，core 用 `RefreshResult.error: string`
 * 承载，UI 只能靠正则猜「登录 / 风控 / 403」。这里给错误一个显式 `kind`，
 * 新抛错点优先用 `ResolveError`；旧普通 Error 由 `errorKindOf` 做一次保守归类，
 * 保证逐步迁移期间也有可用的分类。
 */

export type ErrorKind =
  | "auth" // 需要登录 / 登录失效
  | "risk" // 风控 / 验证码 / 403 拒绝
  | "rate-limit" // 平台冷却 / 429 / 配额
  | "network" // DNS / 连接 / fetch 失败
  | "timeout" // 超时 / abort
  | "unsupported" // 路由不支持 / 渠道不支持
  | "parse" // 上游响应无法解析
  | "no-data" // 被动采集没有可用数据（且无缓存）
  | "unknown"

/** 带分类的错误。跨包只认 `kind`，不依赖错误子类。 */
export class ResolveError extends Error {
  readonly kind: ErrorKind

  constructor(kind: ErrorKind, message: string, opts?: { cause?: unknown }) {
    super(message)
    this.name = "ResolveError"
    this.kind = kind
    if (opts?.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause
  }
}

/** UI 展示用的短标签（未知错误留给调用方兜底成自己的默认文案）。 */
export const ERROR_KIND_LABEL: Record<ErrorKind, string> = {
  auth: "需要登录",
  risk: "被平台拒绝",
  "rate-limit": "请求过于频繁",
  network: "网络失败",
  timeout: "请求超时",
  unsupported: "不支持的内容",
  parse: "解析失败",
  "no-data": "暂无可用数据",
  unknown: "未知错误",
}

const VALID_KINDS = new Set<string>(Object.keys(ERROR_KIND_LABEL))

/**
 * 错误 → 分类。
 *
 * 优先信任显式 `kind`（包括跨模块副本的 ResolveError，按结构判断）；否则按消息做
 * 保守归类。归类顺序有讲究：429/冷却先于 auth（冷却期一定伴随登录失败时，先报
 * 「请求过频」才是可行动的原因）；401/cookie 先于 403（403 可能是版权/CDN）。
 */
export function errorKindOf(err: unknown): ErrorKind {
  if (!err) return "unknown"
  const explicit = (err as { kind?: unknown }).kind
  if (typeof explicit === "string" && VALID_KINDS.has(explicit)) return explicit as ErrorKind

  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  if (/冷却|too many requests|rate.?limit|429/i.test(msg)) return "rate-limit"
  if (/需要登录|未登录|登录已失效|登录态|cookie|401|unauthorized/i.test(msg)) return "auth"
  if (/风控|验证码|412|418|403|forbidden|禁止访问|risk/i.test(msg)) return "risk"
  if (/timeout|timed out|超时|abort/i.test(msg)) return "timeout"
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network|网络|fetch failed/i.test(msg)) return "network"
  if (/没有可用数据|没有可用的数据|no data/i.test(msg)) return "no-data"
  if (/无法从 URL|不支持|unsupported|unknown channel|NoChannel/i.test(msg)) return "unsupported"
  if (/解析|parse|JSON|XML/i.test(msg)) return "parse"
  return "unknown"
}
