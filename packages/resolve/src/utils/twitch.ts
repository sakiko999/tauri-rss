/**
 * Twitch 频道登录名归一化 —— resolver 路由与 crawler channel 共用。
 *
 * 接受三种输入:裸 login(`shroud`)、`@shroud`、频道 URL(`twitch.tv/shroud`,
 * 带不带 scheme 都行;host 仅限频道域,见 `CHANNEL_HOSTS`)。统一小写,只允许 Twitch 的 login 字符集
 * `[a-z0-9_]{3,25}`,并排除 `twitch.tv` 的一级路径保留字(`videos`/`directory`/…)。
 *
 * 一期只认**单段路径** `/ <login>`:多段路径(`/<login>/clip/<slug>`、`/videos/123`)
 * 返回 null,由 router 二期再单独加路由,避免把 clip 页误当频道。
 * ⚠️ host 也要限制:clip 链接是 `clips.twitch.tv/<slug>`(**单段路径**),只看段数会把
 * clip slug 归一成频道名 → 产出永远离线的假频道。
 */

/** Twitch login 字符集与长度(官方:3~25 位字母数字下划线)。 */
const LOGIN_RE = /^[a-z0-9_]{3,25}$/

/**
 * 可承载频道页的 host。`clips.`/`dashboard.`/`player.` 等子域是站内其它产品,
 * 它们的单段路径不是频道名(router 与输入归一化共用这一判据)。
 */
const CHANNEL_HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv"])

/** host 是否是频道页所在的 Twitch 域(大小写不敏感)。 */
export function isTwitchChannelHost(host: string | null | undefined): boolean {
  return CHANNEL_HOSTS.has(String(host ?? "").trim().toLowerCase())
}

/**
 * 一级路径保留字 —— 这些是 twitch.tv 的站内路由,不是频道名。
 * 命中即视为「非频道 URL」,避免 `/videos/123` 之类被归一成 login。
 */
const RESERVED = new Set([
  "about",
  "activate",
  "clips",
  "directory",
  "downloads",
  "drops",
  "embed",
  "following",
  "friends",
  "inventory",
  "jobs",
  "legal",
  "login",
  "messages",
  "oauth2",
  "p",
  "popout",
  "privacy",
  "search",
  "security",
  "settings",
  "signup",
  "store",
  "subscriptions",
  "turbo",
  "verify",
  "videos",
  "wallet",
])

/** URL 形态 → login 候选(校验频道域 + 单段路径);裸 login 不走这里。 */
function loginFromUrl(input: string): string | null {
  let url: URL
  try {
    // 允许 `twitch.tv/xxx` 这种无 scheme 写法。
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
  if (!isTwitchChannelHost(url.hostname)) return null
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length !== 1) return null
  let login: string
  try {
    login = decodeURIComponent(segments[0]!)
  } catch {
    return null
  }
  return login.toLowerCase()
}

/**
 * 归一化 Twitch 频道名:返回小写 login;非法/保留字/非频道 URL 返回 null。
 * 带 `/`(URL 形态)或含 `twitch.tv` 的输入按 URL 解析,其余按裸 login 处理。
 */
export function normalizeTwitchLogin(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  const login = raw.startsWith("@")
    ? raw.slice(1).toLowerCase()
    : raw.includes("/") || /twitch\.tv/i.test(raw)
      ? loginFromUrl(raw)
      : raw.toLowerCase()
  if (!login || !LOGIN_RE.test(login) || RESERVED.has(login)) return null
  return login
}

/**
 * 裸字符串是否是可作频道名的 login(router 用;**不做 URL 解析**)。
 * 与 `normalizeTwitchLogin` 同一套字符集 + 保留字规则,只是不做大小写/URL 归一。
 */
export function isTwitchLogin(value: string | null | undefined): boolean {
  const login = String(value ?? "").trim().toLowerCase()
  return LOGIN_RE.test(login) && !RESERVED.has(login)
}

/** 分类 slug 字符集与长度(`just-chatting` 这类)。 */
const CATEGORY_RE = /^[a-z0-9-]{2,64}$/

/** 目录页 URL → slug(只认频道域下的 `/directory/category/<slug>`)。 */
function categoryFromUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
  if (!isTwitchChannelHost(url.hostname)) return null
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length !== 3) return null
  if (segments[0]!.toLowerCase() !== "directory" || segments[1]!.toLowerCase() !== "category") return null
  let slug: string
  try {
    slug = decodeURIComponent(segments[2]!)
  } catch {
    return null
  }
  return slug.toLowerCase()
}

/**
 * 归一化 Twitch 分类 slug。接受裸 slug(`just-chatting`)与目录页链接
 * (`https://www.twitch.tv/directory/category/just-chatting`,带不带 scheme 都行);
 * host 仅 `twitch.tv` 频道域,slug 只允许 `[a-z0-9-]{2,64}`,其它返回 null。
 */
export function normalizeTwitchCategory(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  const slug = raw.includes("/") || /twitch\.tv/i.test(raw) ? categoryFromUrl(raw) : raw.toLowerCase()
  if (!slug || !CATEGORY_RE.test(slug)) return null
  return slug
}
