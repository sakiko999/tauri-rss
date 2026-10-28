/**
 * YouTube 频道参数归一化(纯函数,可单测)。
 *
 * `youtube:playlist` 接受裸 playlistId、`youtube.com/playlist?list=`、
 * `watch?v=…&list=…`、`youtu.be/…?list=…`。
 *
 * ⚠️ 刻意拒收 `RD`(Mix)、`WL`(稍后再看)、`LL`(点赞)、`LM`(音乐库):前两个是动态/
 * 私有,后两个需登录 —— 接进来只会是一条永远取不到内容的订阅。
 */

/** playlistId 字符集(YouTube 的 ID 是 base64url 字母表,长度 13~80)。 */
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,80}$/

/** 动态/私有/需登录的列表前缀(见文件头)。 */
const REJECT_PREFIXES = ["RD", "WL", "LL", "LM"]

/** 可承载播放列表的 host。 */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"])

function parseUrl(input: string): URL | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
}

/**
 * 归一化播放列表 ID:接受裸 ID 与常见播放列表/带 list 参数的单视频链接。
 * 非法、非 YouTube host、私有/动态列表一律返回 null(调用方抛清晰错误)。
 */
export function normalizeYoutubePlaylistId(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  let id = raw
  if (raw.includes("/") || /youtu\.?be|youtube\.com/i.test(raw)) {
    const url = parseUrl(raw)
    if (!url || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null
    id = url.searchParams.get("list") ?? ""
  }
  if (!PLAYLIST_ID_RE.test(id) || REJECT_PREFIXES.some((p) => id.startsWith(p))) return null
  return id
}
