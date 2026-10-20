/**
 * twitch 平台客户端 —— 匿名 GraphQL(无需账号;游标翻页时网页 Client-ID 会要求
 * Client-Integrity,故翻页改用 Android app 的公开 Client-ID)。
 *
 * 端点 `https://gql.twitch.tv/gql`,只带公开 Client-ID。实测(2026-10-20):
 * 频道元数据、离线态、播放 token、热门/分区流列表全部匿名可用;官方 Helix 匿名
 * 401(且不给播放地址),故不走 Helix。
 *
 * ⚠️ 这是未公开 API:只做低频、只读公共数据。换版时集中改上面的 Client-ID 常量。
 * ⚠️ 游标翻页(`after`)必须用 Android app 的 Client-ID —— 网页 ID 会触发
 * integrity 校验,见 `TWITCH_MOBILE_CLIENT_ID`。
 * ⚠️ 错误文案里**不得**出现 token/signature —— 本模块只发元数据查询与 persisted
 * token 查询,错误只带 HTTP 状态码,不拼接请求体。
 */
/** Twitch 网页端公开 Client-ID(非账号凭证;换版时只改这里)。 */
export const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"

/**
 * 游标翻页专用 Client-ID(Twitch Android app 的公开值,与 twitch-dl 一致)。
 *
 * ⚠️ **网页 Client-ID 不能用于带 `after` 的流列表请求**(实测 2026-10-20):
 * 第二页起上游返 `errors: [IntegrityCheckFailed]` + `data.streams = null`,
 * 需要浏览器端 KPSDK 算出的 `Client-Integrity`;匿名直接调 `/integrity` 拿到的
 * token 被标记 `is_bad_bot`,仍被拒。移动端 Client-ID 不要求该校验,分页正常
 * (首屏/翻页用同一个,游标本身可跨 Client-ID 复用)。
 * 频道元数据与播放 token 仍走网页 Client-ID(现状稳定,不受影响)。
 */
export const TWITCH_MOBILE_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"

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

/** 直播流条目(GraphQL `streams.edges[].node`;热门与分区共用同一形状)。 */
export interface TwitchStreamNode {
  id: string
  title: string
  viewersCount: number
  /** ISO 时间串(开播时间)。 */
  createdAt: string
  broadcaster: { login: string; displayName: string }
  game: { name: string; slug: string } | null
  previewImageURL: string | null
}

/** 一页直播流(热门 / 分区共用)。`endCursor` 是下一页游标。 */
export interface TwitchStreamPage {
  streams: TwitchStreamNode[]
  hasMore: boolean
  endCursor?: string
}

/** 流列表查询的字段选择(缩略图按 640×360 要,避免上游默认尺寸)。 */
const STREAM_FIELDS = `id title viewersCount createdAt broadcaster { login displayName } game { name slug } previewImageURL(width: 640, height: 360)`

interface RawStreamConnection {
  edges?: Array<{ cursor?: string; node?: TwitchStreamNode | null } | null> | null
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null
}

/** first 归一:非有限值回落 30,再 clamp 到 1..30(上游硬上限 = 30,超出报 400)。 */
function clampFirst(first: number): number {
  if (!Number.isFinite(first)) return 30
  return Math.min(30, Math.max(1, Math.trunc(first)))
}

/**
 * 一页 GraphQL 流列表 → `TwitchStreamPage`(单个 edge 的 node 为空时跳过)。
 * `conn` 缺失视为上游 schema 变化,抛清晰错误(不能静默返回空页 —— 那会被
 * core 当成「没有更多」,表现为热门/分区永远只有首页)。
 */
function mapStreamPage(conn: RawStreamConnection | null | undefined, missingMessage: string): TwitchStreamPage {
  if (!conn) throw new Error(missingMessage)
  const edges = Array.isArray(conn.edges) ? conn.edges : []
  const endCursor = conn.pageInfo?.endCursor ?? undefined
  return {
    streams: edges.map((e) => e?.node).filter((n): n is TwitchStreamNode => !!n),
    hasMore: conn.pageInfo?.hasNextPage === true,
    ...(endCursor ? { endCursor } : {}),
  }
}

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
 *
 * `throwOnErrors`:流列表页用。带 `after` 翻页时上游会返回
 * `errors: [IntegrityCheckFailed]` 且 `data.<field> = null`(data 本身非空),
 * 默认容忍策略会把它当成「字段缺失」;开启后直接透出上游错误原因。
 *
 * `clientId`:默认网页 Client-ID;流列表翻页必须传 `TWITCH_MOBILE_CLIENT_ID`
 * (网页 ID 在第二页起触发 integrity 校验,见该常量的说明)。
 */
export async function twitchGql<T = Record<string, unknown>>(
  body: unknown,
  opts?: { throwOnErrors?: boolean; clientId?: string },
): Promise<T> {
  const res = await globalThis.appHost.http.request({
    url: GQL_URL,
    method: "POST",
    headers: {
      "client-id": opts?.clientId ?? TWITCH_CLIENT_ID,
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
  if (message && (json.data == null || opts?.throwOnErrors)) throw new Error(`twitch gql: ${message}`)
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

/**
 * 热门直播(按观看数降序)。直查文本即可,不需要 persisted query。
 * `after` 传上一页的 `endCursor` 取下一页。
 * ⚠️ 必须用移动端 Client-ID:网页 Client-ID 在带 `after` 时触发 integrity 校验。
 */
export async function fetchTwitchTopStreams(first = 30, after?: string): Promise<TwitchStreamPage> {
  const args = [`first: ${clampFirst(first)}`, `options: { sort: VIEWER_COUNT }`]
  if (after) args.push(`after: ${JSON.stringify(after)}`)
  const data = await twitchGql<{ streams?: RawStreamConnection | null }>(
    {
      query: `query { streams(${args.join(", ")}) { edges { cursor node { ${STREAM_FIELDS} } } pageInfo { hasNextPage endCursor } } }`,
    },
    { throwOnErrors: true, clientId: TWITCH_MOBILE_CLIENT_ID },
  )
  return mapStreamPage(data.streams, "twitch gql: 热门直播缺少 streams")
}

/** 分类目录条目(GraphQL `games` 的 node;只含元数据,不含房间)。 */
export interface TwitchCategoryNode {
  id: string
  name: string
  slug: string
  viewersCount: number
  boxArtURL: string | null
}

/**
 * 分类榜(按观看数降序,匿名可用)。供目录订阅 `twitch:categories` 产 `kind:"category"`
 * 条目 —— **分类本身没有可播房间**,条目只作为「点开预览 `twitch:category`」的入口。
 * 实测 `first` 上限同样是 30;`games` 走移动端 Client-ID(与流列表一致)。
 */
export async function fetchTwitchTopCategories(first = 30): Promise<TwitchCategoryNode[]> {
  const data = await twitchGql<{
    games?: { edges?: Array<{ node?: TwitchCategoryNode | null } | null> | null } | null
  }>(
    {
      query: `query { games(first: ${clampFirst(first)}) { edges { node { id name slug viewersCount boxArtURL(width: 240, height: 320) } } } }`,
    },
    { throwOnErrors: true, clientId: TWITCH_MOBILE_CLIENT_ID },
  )
  if (!data.games) throw new Error("twitch gql: 分类列表缺少 games")
  return (data.games.edges ?? [])
    .map((e) => e?.node)
    .filter((n): n is TwitchCategoryNode => !!n && !!n.slug)
}

/**
 * 分区直播(`game(slug)` 下的流列表)。`slug` 由调用方归一(见 utils/twitch.ts 的
 * `normalizeTwitchCategory`),这里只做 JSON 转义,防止拼进查询串。
 * ⚠️ 同样必须用移动端 Client-ID(理由见 `TWITCH_MOBILE_CLIENT_ID`)。
 */
export async function fetchTwitchCategoryStreams(
  slug: string,
  first = 30,
  after?: string,
): Promise<TwitchStreamPage> {
  const args = [`first: ${clampFirst(first)}`]
  if (after) args.push(`after: ${JSON.stringify(after)}`)
  const data = await twitchGql<{
    game?: { displayName?: string; streams?: RawStreamConnection | null } | null
  }>(
    {
      query: `query { game(slug: ${JSON.stringify(slug)}) { displayName streams(${args.join(", ")}) { edges { cursor node { ${STREAM_FIELDS} } } pageInfo { hasNextPage endCursor } } } }`,
    },
    { throwOnErrors: true, clientId: TWITCH_MOBILE_CLIENT_ID },
  )
  if (!data.game) throw new Error(`twitch gql: 分区 ${slug} 不存在`)
  return mapStreamPage(data.game.streams, `twitch gql: 分区 ${slug} 缺少 streams`)
}
