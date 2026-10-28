/**
 * twitch:live 映射自检 —— `bun packages/crawler/src/example/twitch-live.check.ts`
 *
 * 用最小 GQL 样本直接调 channel 导出的纯函数，锁住字段映射：
 *   - `twitchLiveItem`（twitch:live）：live/offline 两态、标题回落、在线数、
 *     开播时间（坏 ISO 不污染排序）、平台字段；
 *   - `twitchStreamToLive`（twitch:hot / twitch:category）：流列表 → Live、
 *     缩略图回落模板、坏 login 丢弃、坏 createdAt。
 * 不需要网络 / 浏览器。
 */
import type { TwitchStreamNode, TwitchUser } from "@amoeba/resolve"

import { twitchLiveItem, twitchStreamToLive } from "../channels/twitch/live.ts"

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

// ── 4. 流列表 → Live（twitch:hot / twitch:category 共用映射）─────────────────
console.log("流列表 → Live:")
const streamNode: TwitchStreamNode = {
  id: "4132001",
  title: "Ranked grind",
  viewersCount: 12_345,
  createdAt: "2026-10-20T08:00:00.000Z",
  broadcaster: { login: "Shroud", displayName: "Shroud" },
  game: { name: "VALORANT", slug: "valorant" },
  previewImageURL: "https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-640x360.jpg",
}
const hot = twitchStreamToLive(streamNode, "twitch:hot", FIXED)

ok(hot !== null, "正常流产出 Live（不是 null）")
ok(hot?.id === "twitch:shroud", `id 用 login，且小写归一（得 ${hot?.id}）`)
ok(hot?.sourceId === "twitch:hot", `sourceId 透传（得 ${hot?.sourceId}）`)
ok(hot?.kind === "live", `kind（得 ${hot?.kind}）`)
ok(hot?.url === "https://www.twitch.tv/shroud", `url（得 ${hot?.url}）`)
ok(hot?.platform === "twitch", `platform（得 ${hot?.platform}）`)
ok(hot?.roomId === "shroud", `roomId = login（得 ${hot?.roomId}）`)
ok(hot?.liveStatus === "live", "列表里的流必定在播 → liveStatus 恒 live")
ok(hot?.online === 12_345, `online = viewersCount（得 ${hot?.online}）`)
ok(hot?.title === "Ranked grind", `title（得 ${hot?.title}）`)
ok(hot?.thumbnail === streamNode.previewImageURL, `thumbnail 用 previewImageURL（得 ${hot?.thumbnail}）`)
ok(hot?.author?.name === "Shroud", `author.name = displayName（得 ${hot?.author?.name}）`)
ok(hot?.showTime === "2026-10-20T08:00:00.000Z", `showTime = createdAt ISO（得 ${hot?.showTime}）`)
ok(hot?.fetchedAt === FIXED, `fetchedAt 透传（得 ${hot?.fetchedAt}）`)

const noPreview = twitchStreamToLive(
  {
    ...streamNode,
    broadcaster: { login: "some_streamer", displayName: "SomeStreamer" },
    previewImageURL: "",
  },
  "twitch:category",
  FIXED,
)
ok(
  noPreview?.thumbnail === "https://static-cdn.jtvnw.net/previews-ttv/live_user_some_streamer-640x360.jpg",
  `previewImageURL 为空回落模板（得 ${noPreview?.thumbnail}）`,
)
ok(noPreview?.sourceId === "twitch:category", `sourceId 透传 category（得 ${noPreview?.sourceId}）`)
ok(noPreview?.title === "Ranked grind", "空缩略图不影响标题")

const nullPreview = twitchStreamToLive({ ...streamNode, previewImageURL: null }, "twitch:hot", FIXED)
ok(
  nullPreview?.thumbnail === "https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-640x360.jpg",
  "previewImageURL = null 也回落模板",
)

// 没有 broadcaster.login 的脏数据编不出 id/url/roomId → 直接丢。
const noLogin = twitchStreamToLive(
  { ...streamNode, broadcaster: { login: "   ", displayName: "Ghost" } },
  "twitch:hot",
  FIXED,
)
ok(noLogin === null, `空 broadcaster.login → null（得 ${JSON.stringify(noLogin)}）`)
const missingLogin = twitchStreamToLive(
  { ...streamNode, broadcaster: { login: undefined as unknown as string, displayName: "Ghost" } },
  "twitch:hot",
  FIXED,
)
ok(missingLogin === null, "缺失 broadcaster.login 也 → null")

const badStreamTime = twitchStreamToLive({ ...streamNode, createdAt: "not-a-date" }, "twitch:hot", FIXED)
ok(badStreamTime?.showTime === undefined, `坏 createdAt → showTime undefined（得 ${badStreamTime?.showTime}）`)
ok(badStreamTime?.liveStatus === "live", "坏 createdAt 不影响 liveStatus")

const emptyStreamTitle = twitchStreamToLive(
  { ...streamNode, title: "", broadcaster: { login: "empty_title", displayName: "EmptyTitle" } },
  "twitch:hot",
  FIXED,
)
ok(emptyStreamTitle?.title === "EmptyTitle", `空标题回落 displayName（得 ${emptyStreamTitle?.title}）`)
const noStreamName = twitchStreamToLive(
  { ...streamNode, title: "", broadcaster: { login: "no_name", displayName: "" } },
  "twitch:hot",
  FIXED,
)
ok(noStreamName?.title === "no_name" && noStreamName?.author?.name === "no_name", "空 displayName 回落 login")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
