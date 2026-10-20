/**
 * twitch:live 映射自检 —— `bun packages/crawler/src/example/twitch-live.check.ts`
 *
 * 用最小 GQL 样本直接调 channel 导出的纯函数 `twitchLiveItem`，锁住字段映射：
 * live/offline 两态、标题回落、在线数、开播时间（坏 ISO 不污染排序）、平台字段。
 * 不需要网络 / 浏览器。
 */
import type { TwitchUser } from "@amoeba/resolve"
import { twitchLiveItem } from "../channels/twitch/live.ts"

const FIXED = 1_700_000_000_000

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

// ── 1. 直播中 ────────────────────────────────────────────────────────────────
console.log("直播中:")
const liveUser: TwitchUser = {
  login: "shroud",
  displayName: "Shroud",
  description: "FPS streamer",
  stream: {
    id: "4132001",
    title: "Ranked grind",
    viewersCount: 12_345,
    createdAt: "2026-10-20T08:00:00.000Z",
    type: "live",
    game: { name: "VALORANT" },
  },
}
const live = twitchLiveItem(liveUser, "shroud", FIXED)

ok(live.id === "twitch:shroud", `id（得 ${live.id}）`)
ok(live.sourceId === "twitch:live", `sourceId（得 ${live.sourceId}）`)
ok(live.kind === "live", `kind（得 ${live.kind}）`)
ok(live.url === "https://www.twitch.tv/shroud", `url（得 ${live.url}）`)
ok(live.platform === "twitch", `platform（得 ${live.platform}）`)
ok(live.roomId === "shroud", `roomId = login（得 ${live.roomId}）`)
ok(live.liveStatus === "live", `liveStatus（得 ${live.liveStatus}）`)
ok(live.online === 12_345, `online = viewersCount（得 ${live.online}）`)
ok(live.title === "Ranked grind", `title（得 ${live.title}）`)
ok(
  live.thumbnail === "https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-640x360.jpg",
  `thumbnail 用 login 拼（得 ${live.thumbnail}）`,
)
ok(live.author?.name === "Shroud", `author.name = displayName（得 ${live.author?.name}）`)
ok(live.introduction === "FPS streamer", `introduction = description（得 ${live.introduction}）`)
ok(live.showTime === "2026-10-20T08:00:00.000Z", `showTime = createdAt ISO（得 ${live.showTime}）`)
ok(live.fetchedAt === FIXED, `fetchedAt 透传（得 ${live.fetchedAt}）`)

// ── 2. 离线（stream == null，仍产 item，避免下播后订阅空掉） ─────────────────
console.log("离线:")
const offlineUser: TwitchUser = {
  login: "some_streamer",
  displayName: "SomeStreamer",
  description: "",
  stream: null,
}
const offline = twitchLiveItem(offlineUser, "some_streamer", FIXED)

ok(offline.liveStatus === "offline", `liveStatus（得 ${offline.liveStatus}）`)
ok(offline.online === 0, `online 缺省 0（得 ${offline.online}）`)
ok(offline.title === "SomeStreamer（离线）", `title 回落 displayName（离线）（得 ${offline.title}）`)
ok(offline.showTime === undefined, `离线无 showTime（得 ${offline.showTime}）`)
ok(offline.introduction === undefined, "空 description 归一为 undefined")
ok(offline.id === "twitch:some_streamer", `id 用 login（得 ${offline.id}）`)

// ── 3. 边界：title 空串回落 / 坏 ISO 不产错值 ────────────────────────────────
console.log("边界:")
const emptyTitle: TwitchUser = {
  ...liveUser,
  login: "empty_title",
  displayName: "EmptyTitle",
  stream: { ...liveUser.stream!, title: "" },
}
const et = twitchLiveItem(emptyTitle, "empty_title", FIXED)
// 直播中标题为空只回落 displayName —— 带「（离线）」会与 liveStatus 自相矛盾。
ok(et.title === "EmptyTitle", `空标题回落 displayName（得 ${et.title}）`)
ok(et.liveStatus === "live", "空标题不影响 liveStatus")

const badTime: TwitchUser = {
  ...liveUser,
  login: "bad_time",
  displayName: "BadTime",
  stream: { ...liveUser.stream!, createdAt: "not-a-date" },
}
const bt = twitchLiveItem(badTime, "bad_time", FIXED)
ok(bt.showTime === undefined, `坏 createdAt → showTime undefined（得 ${bt.showTime}）`)
ok(bt.liveStatus === "live", "坏 createdAt 不影响 liveStatus")

const noName: TwitchUser = {
  ...liveUser,
  login: "no_name",
  displayName: "",
  stream: { ...liveUser.stream!, title: "" },
}
const nn = twitchLiveItem(noName, "no_name", FIXED)
ok(nn.title === "no_name" && nn.author?.name === "no_name", "空 displayName 回落 login")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
