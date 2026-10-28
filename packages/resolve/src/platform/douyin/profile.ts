/**
 * 抖音用户资料（匿名）—— 主页链接 / sec_uid → 抖音号 / short_id / 直播状态。
 *
 * 端点：`www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=...`
 * 带 ABogus 签名 + ttwid（与 live 侧同一套 `signDouyinUrl` / `douyinCookie`），
 * **匿名 200**（2026-10-18 实测）。返回的 `user.unique_id` 可直接当 `web_rid`
 * 交给 enter API（见 `ids.ts` 文件头）。
 *
 * ⚠️ 只认 `sec_user_id`；传 `unique_id` / `short_id` / `uid` 均返回
 * `UserId不合法`（status_code 2）。
 * ⚠️ `room_id` 是 JSON number，超过 2^53 会丢精度；精确值用 `room_id_str`。
 * ⚠️ `live_status`：1=直播中，0=未开播（与 enter `room.status==2` 对应）。
 */
import { httpJson } from "../../host.ts"
import { signDouyinUrl, UA_ENTER } from "./abogus.ts"
import { douyinCookie } from "./client.ts"
import { parseDouyinSecUid } from "./ids.ts"

const PROFILE_API = "https://www.douyin.com/aweme/v1/web/user/profile/other/"

/** 抖音用户 → 当前直播间标识。 */
export interface DouyinUserLive {
  /** 用户主页里的 sec_uid（也接受主页链接输入）。 */
  secUid: string
  uid?: string
  /** 抖音号；可直接当 `web_rid`。 */
  uniqueId?: string
  /** 数字短 ID；`unique_id` 为空时可作兜底。 */
  shortId?: string
  nickname: string
  avatar?: string
  /** 精确长 room_id（`room_id_str`，不代表可直接订阅）。 */
  roomId?: string
  /** 0=未开播 / 1=直播中（实测）。 */
  liveStatus: number
  /** 可直接传给 enter API 的 web_rid：unique_id 优先，其次 short_id。 */
  webRid: string
}

/**
 * 解析用户主页链接 / sec_uid，并返回其直播间标识。
 *
 * 注意：这里只取资料，不保证用户当前在播；调用方仍应走 `fetchRoom(webRid)`
 * 拿真实的 status/title/stream_url（离线用户会返回 offline 条目）。
 */
export async function fetchDouyinUserLive(input: string): Promise<DouyinUserLive> {
  const secUid = parseDouyinSecUid(input)
  const qp = new URLSearchParams({
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    publish_video_strategy_type: "2",
    source: "channel_pc_web",
    sec_user_id: secUid,
    personal_center_strategy: "1",
    profile_other_record_enable: "1",
    land_to: "1",
    cookie_enabled: "true",
    screen_width: "1980",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Edge",
    browser_version: "125.0.0.0",
    browser_online: "true",
  })
  const url = signDouyinUrl(`${PROFILE_API}?${qp.toString()}`, UA_ENTER)
  const json = await httpJson<{
    status_code?: number
    status_msg?: string | null
    user?: Record<string, any>
  }>(url, {
    "user-agent": UA_ENTER,
    referer: `https://www.douyin.com/user/${secUid}`,
    cookie: await douyinCookie(),
  })

  if (!json) throw new Error("抖音用户资料接口返回空 body")
  if (Number(json.status_code ?? NaN) !== 0) {
    throw new Error(`抖音用户资料不可用:${json.status_msg ?? `status_code=${json.status_code}`}`)
  }
  if (!json.user) throw new Error("抖音用户资料为空（可能被风控或链接无效）")

  const u = json.user
  const uniqueId = String(u.unique_id ?? "").trim()
  const shortId = String(u.short_id ?? "").trim()
  // ⚠️ short_id 在资料接口里常是 "0"；只有非 0 才能当 web_rid。
  const webRid = [uniqueId, shortId].find((v) => v !== "" && v !== "0") ?? ""
  if (!webRid) throw new Error("该用户没有可用的抖音号/short_id，无法解析直播间")

  const avatarList = Array.isArray(u.avatar_thumb?.url_list) ? (u.avatar_thumb.url_list as unknown[]) : []

  return {
    secUid: String(u.sec_uid ?? secUid),
    uid: String(u.uid ?? "") || undefined,
    uniqueId: uniqueId || undefined,
    shortId: shortId && shortId !== "0" ? shortId : undefined,
    nickname: String(u.nickname ?? ""),
    avatar: avatarList[0] ? String(avatarList[0]) : undefined,
    roomId: String(u.room_id_str ?? "") || undefined,
    liveStatus: Number(u.live_status ?? 0) || 0,
    webRid,
  }
}
