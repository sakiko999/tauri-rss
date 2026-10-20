/**
 * twitch 平台客户端 —— 公开 web GraphQL(匿名,无账号/无 Client-Integrity)。
 *
 * 端点 `https://gql.twitch.tv/gql`,只带公开 web Client-ID。实测(2026-10-20):
 * 频道元数据、离线态、播放 token 全部匿名可用;官方 Helix 匿名 401(且不给播放
 * 地址),故不走 Helix。
 *
 * ⚠️ 这是未公开 API:只做低频、只读公共数据。Client-ID 是 Twitch 网页端的公开值,
 * 不是账号凭证;换版时集中改 `TWITCH_CLIENT_ID`。
 * ⚠️ 错误文案里**不得**出现 token/signature —— 本模块只发元数据查询与 persisted
 * token 查询,错误只带 HTTP 状态码,不拼接请求体。
 */
/** Twitch 网页端公开 Client-ID(非账号凭证;换版时只改这里)。 */
export const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"

const GQL_URL = "https://gql.twitch.tv/gql"

/** 直播流信息(`stream == null` 即离线)。 */
export interface TwitchStreamInfo {
  id: string
  title: string
  viewersCount: number
  /** ISO 时间串(开播时间)。 */
  createdAt: string
  /** 通常为 "live"。 */
  type: string
  game: { name: string } | null
}

/** 频道元数据(`user == null` 即频道不存在)。 */
export interface TwitchUser {
  login: string
  displayName: string
  description: string
  stream: TwitchStreamInfo | null
}

/** GraphQL 查询的字段选择(频道元数据;头像 `profileImageURL` 实测报 server error,不查)。 */
const USER_FIELDS = `login displayName description stream { id title viewersCount createdAt type game { name } }`

/**
 * 风控信号上报(best-effort):宿主未注入 `net` 时静默,不影响请求/返回逻辑。
 * 契约 `appHost.net.reportRisk(platform, signal)` 见 docs/crawler-risk-control.md §2.6。
 */
function reportRisk(signal: string): void {
  globalThis.appHost?.net?.reportRisk("twitch", signal)
}

interface GqlEnvelope<T> {
  data?: T | null
  errors?: Array<{ message?: string }>
}

/**
 * POST 一次 GraphQL,返回 `data`(不含 envelope)。非 2xx 抛清晰错误;
 * 429/403 上报风控。GraphQL 顶层错误(且无 data)也抛出(只带其 message,
 * 不含任何 token/signature —— 本模块的查询本身不带凭证)。
 */
export async function twitchGql<T = Record<string, unknown>>(body: unknown): Promise<T> {
  const res = await globalThis.appHost.http.request({
    url: GQL_URL,
    method: "POST",
    headers: {
      "client-id": TWITCH_CLIENT_ID,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    responseType: "text",
  })
  const status = Number(res.status)
  // 429 = 限流;403 = 被 WAF/地区拦截(明确风控信号)
  if (status === 429 || status === 403) reportRisk(String(status))
  if (status < 200 || status >= 300) throw new Error(`twitch gql HTTP ${status}`)

  const text = typeof res.body === "string" ? res.body : String(res.body ?? "")
  let json: GqlEnvelope<T>
  try {
    json = JSON.parse(text) as GqlEnvelope<T>
  } catch {
    throw new Error("twitch gql: 响应不是合法 JSON")
  }
  const message = json.errors?.[0]?.message
  if (message && json.data == null) throw new Error(`twitch gql: ${message}`)
  return (json.data ?? {}) as T
}

/**
 * 批量查频道元数据:用 GraphQL 别名(`u0: user(login: ...)`)合并成**一次**请求
 * (Twitch 按 IP 限流且无公开阈值,别逐频道发)。返回顺序与入参一致;
 * 不存在的频道对应项为 null。
 */
export async function fetchTwitchUsers(logins: string[]): Promise<Array<TwitchUser | null>> {
  if (!logins.length) return []
  const fields = logins
    .map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) { ${USER_FIELDS} }`)
    .join(" ")
  const data = await twitchGql<Record<string, TwitchUser | null>>({ query: `query { ${fields} }` })
  return logins.map((_, i) => data[`u${i}`] ?? null)
}
