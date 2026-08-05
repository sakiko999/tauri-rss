/**
 * Built-in platform presets (bilibili / youtube) — these ride producer's own
 * adapters, not a direct feed URL.
 */
import type { PresetSubscription } from "./types.ts"

export const PLATFORM_PRESETS = [
  // ── bilibili（走 wbi 签名 / 多路由 API，零登录）──
  { kind: "bilibili-rank", id: "bili-hot", title: "bilibili 热搜", tag: "API · 热搜" },
  { kind: "bilibili", id: "bili-popular", title: "bilibili 综合热门", tag: "API · 视频", route: "popular" },
  { kind: "bilibili", id: "bili-ranking", title: "bilibili 排行榜·全站", tag: "API · 视频", route: "ranking", rid: "all" },
  { kind: "bilibili", id: "bili-weekly", title: "B站每周必看", tag: "API · 视频", route: "weekly" },
  { kind: "bilibili", id: "bili-3b1b", title: "3Blue1Brown (B 站)", tag: "API · UP主", route: "user-video", uid: "511068914" },

  // ── YouTube（官方频道 RSS，零登录）──
  { kind: "youtube", id: "yt-3b1b", title: "3Blue1Brown (YouTube)", tag: "API · 频道", channelId: "UCYO_jab_esuFRV4b17AJtAw" },
  { kind: "youtube", id: "yt-lex", title: "Lex Fridman (YouTube)", tag: "API · 频道", channelId: "UCSHZKyawb77ixDdsGog4iWA" },
  { kind: "youtube", id: "yt-kenjee", title: "Ken Jee (YouTube)", tag: "API · 频道", channelId: "UCiT9RITQ9PW6BhXK0y2jaeg" },
] as const satisfies readonly PresetSubscription[]
