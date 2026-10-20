/**
 * twitch:live —— Twitch 直播频道订阅 channel(一期)。
 *
 * 数据源 = resolve 的匿名 web GraphQL(`fetchTwitchUsers`,别名合并成一次请求)。
 * 频道元数据里 `stream == null` 即离线,`user == null` 即频道不存在:
 * 离线仍产 Live(下播后订阅不空),不存在/单项失败只跳过;**全部失败才抛错**
 * (对齐 bili/douyin「不能静默清空」护栏)。
 *
 * 一期只做 `fetch`:不实现 fetchMore / resolveDetail / fetchPassive / Loginable /
 * supportsL9。播放走 resolver by-url(见 docs/twitch-channel.md §4.1)。
 */
import type { Item, Live } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import {
  fetchTwitchUsers,
  log,
  normalizeTwitchLogin,
  now,
  parseRoomIds,
  type TwitchUser,
} from "@amoeba/resolve"

/** 缩略图模板(Twitch 预览图;离线频道也返回占位图)。 */
function thumbnailFor(login: string): string {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`
}

/**
 * 单个频道 → Live item(纯函数,供自检 `twitch-live.check.ts` 直接调用)。
 * 标题按直播态分别回落:离线 → `<displayName>（离线）`;直播中标题为空 → `displayName`
 * (不能带「离线」字样,否则与 `liveStatus="live"` 自相矛盾);
 * 开播时间只接受可解析的 ISO 串,解析失败给 undefined(不让错值污染排序)。
 */
export function twitchLiveItem(user: TwitchUser, login: string, fetchedAt: number): Live {
  const stream = user.stream
  const createdAt = stream?.createdAt
  const showTime =
    createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : undefined
  // GQL 理论上给 displayName,但外部输入/结构变化时可能为空;空作者名不如回落 login。
  const displayName = user.displayName || login
  return {
    id: `twitch:${login}`,
    sourceId: "twitch:live",
    kind: "live",
    url: `https://www.twitch.tv/${login}`,
    platform: "twitch",
    roomId: login,
    liveStatus: stream ? "live" : "offline",
    online: stream?.viewersCount ?? 0,
    title: stream ? stream.title || displayName : `${displayName}（离线）`,
    thumbnail: thumbnailFor(login),
    author: { name: displayName },
    introduction: user.description || undefined,
    showTime,
    fetchedAt,
  }
}

export class TwitchLiveChannel implements RssChannel {
  readonly key = "twitch:live"
  readonly name = "Twitch 直播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [
    {
      key: "roomIds",
      label: "Twitch 频道名（逗号分隔，可多个）",
      required: true,
      placeholder: "shroud,riotgames 或 twitch.tv/xxx",
    },
  ]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const raw = parseRoomIds(info)
    if (!raw.length) throw new Error("twitch:live 需要 roomIds")
    // 裸 login / @login / 频道 URL 都归一成小写 login;非法/保留字/重复项丢弃。
    const logins = [...new Set(raw.map((r) => normalizeTwitchLogin(r)).filter((l): l is string => !!l))]
    if (!logins.length) throw new Error(`twitch:live 没有合法频道名(${raw.length} 个)`)

    const t = now()
    // 一次 GraphQL 批量查询;整批请求失败 = 全部频道失败,直接抛出(不静默清空)。
    const users = await fetchTwitchUsers(logins)
    const items: Live[] = []
    users.forEach((user, i) => {
      const login = logins[i]!
      // user == null = 频道不存在;只跳过该条,其余照常产出。
      if (!user) {
        log.twitch.warn(`频道 ${login} 不存在,跳过`)
        return
      }
      items.push(twitchLiveItem(user, login, t))
    })
    // ⚠️ 全部失败 ≠ 成功 0 条(离线频道仍返回 Live)。空结果会让 core 清空内容 → 抛出。
    if (!items.length) throw new Error(`twitch:live 全部频道拉取失败(${logins.length} 个)`)
    return items
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    const label = String(info.roomIds ?? info.roomId ?? "")
    const first = normalizeTwitchLogin(parseRoomIds(info)[0])
    return {
      channelTitle: `Twitch 直播 ${label}`,
      channelLink: first ? `https://www.twitch.tv/${first}` : "https://www.twitch.tv/",
    }
  }
}
