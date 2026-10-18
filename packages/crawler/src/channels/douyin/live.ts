/**
 * douyin 直播房间 channel —— HTTP + ABogus 签名(host.js)。
 *
 * 复刻 producer 的 DouyinSite:对 `live.douyin.com/webcast/...` 请求用 host.js
 * 执行 ABOGUS_JS 里的 `getABogus(query, UA)` 生成 a_bogus 参数;ttwid cookie 由
 * 首页 warmup 抓取(memoized)。
 *
 * 产 Live Item(状态 + 元数据);resolveLivePlay 懒解析走 platform/douyin/stream.ts
 * 的 douyinResolveStreams(enter → reflow → HTML 三级降级,每次独立取新鲜签名直链)。
 * liveStatus 判定:**status==2 才是直播中**(复刻 dart,实测在播房间返回 2);
 * status==4 是 roomId 一次性、需改用 webRid,非直播中。
 *
 * `roomIds` 接受 抖音号(unique_id) / 数字 short_id / 直播间链接,归一后当 web_rid 用
 * (2026-10-18 实测);主页链接需要先换 sec_uid → 抖音号,走 `live:douyin:user`。
 */
import type { Item, Live } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { LoginResult, Loginable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "@amoeba/resolve"
import { log } from "@amoeba/resolve"
import { toInt } from "@amoeba/resolve"
import { parseRoomIds } from "@amoeba/resolve"
import { strOr } from "@amoeba/resolve"
import { fetchRoom } from "@amoeba/resolve"
import { douyinOnline } from "@amoeba/resolve"
import { douyinScanLogin } from "@amoeba/resolve"
import { isDouyinProfileUrl } from "@amoeba/resolve"
import { normalizeDouyinRoomId } from "@amoeba/resolve"

const LIVE = "https://live.douyin.com"

export class DouyinLiveChannel implements RssChannel, Loginable {
  readonly key = "live:douyin"
  readonly name = "抖音直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [
    {
      key: "roomIds",
      label: "抖音号 / 直播间 ID(逗号分隔,可多个)",
      required: true,
      placeholder: "如 pvcyinse, 6753235366 或 live.douyin.com/6753235366",
    },
  ]

  /**
   * 扫码登录(channel 级能力)。抖音匿名直播 250 超清封顶、搜索硬登录门槛;登录后
   * 解锁原画档位。纯 HTTP(sso 通行证)优先,被 TLS 风控拦时在 resolve 侧回退
   * CDP 浏览器路径(同 xhs 模式)。同平台多 channel 共享 settings.douyinCookie。
   */
  scanLogin(
    emitQr: (qr: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    return douyinScanLogin(emitQr, opts)
  }

  // 仅输出 Live item(与 rsshub 一致);流/弹幕走 crawler/resolver(按 item.url→live.douyin.com)。
  // fetch 支持多房间(roomIds 逗号分隔)。
  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const raw = parseRoomIds(info)
    if (!raw.length) throw new Error("live:douyin 需要 roomIds")
    // 主页链接要先换 sec_uid → 抖音号，交给 live:douyin:user（这里静默失败只会得到
    // 「全部房间拉取失败」，用户看不出该用哪个渠道）。
    if (raw.some(isDouyinProfileUrl)) {
      throw new Error("live:douyin 不支持主页链接；请使用「抖音用户直播间」(live:douyin:user) 渠道")
    }
    // 允许抖音号 / 短 ID / 直播间 URL / @抖音号 / 「抖音号：xxx」。
    const roomIds = [...new Set(raw.map(normalizeDouyinRoomId).filter(Boolean))]
    if (!roomIds.length) throw new Error("live:douyin 需要 roomIds")
    const t = now()
    const rooms = await Promise.all(
      roomIds.map((roomId) =>
        this.fetchOne(roomId).catch((e) => {
          log.douyin.warn(`房间 ${roomId} 拉取失败,跳过:`, (e as Error)?.message)
          return null
        }),
      ),
    )
    const ok = rooms.filter((r): r is Live => r !== null)
    // ⚠️ 全部失败 ≠ 成功 0 条(离线房间仍返回 Live)。静默返回空会让 core 清空内容 → 抛出。
    if (!ok.length) throw new Error(`live:douyin 全部房间拉取失败(${roomIds.length} 个)`)
    return ok.map((live) => ({ ...live, fetchedAt: t }))
  }

  /** 单房间 → Live item(enter API;房间失败抛错,由调用方 catch 隔离)。 */
  private async fetchOne(roomId: string): Promise<Live> {
    return douyinLiveItem(await fetchRoom(roomId), roomId, "live:douyin")
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    const raw = String(info.roomIds ?? info.roomId ?? "")
    const first = normalizeDouyinRoomId(raw.split(/[,，\s]+/)[0] ?? "")
    return { channelTitle: `抖音直播 ${first}`, channelLink: first ? `${LIVE}/${first}` : LIVE }
  }
}

/**
 * enter API 响应 → Live item。
 * `live:douyin` 单房间抓取与 `live:douyin:user` 共用（后者已把 sec_uid 换成 web_rid）。
 */
export function douyinLiveItem(
  res: Record<string, any>,
  webRid: string,
  sourceId: string,
  fetchedAt = now(),
): Live {
  const room = (res?.data?.data?.[0] ?? res?.data?.room ?? {}) as Record<string, any>
  const user = (res?.data?.data?.[0]?.user ?? res?.data?.user ?? {}) as Record<string, any>
  const streamUrl = (room.stream_url ?? {}) as Record<string, any>
  // douyin room.status 语义:2=直播中(复刻 dart,实测 217952067344 在播时 status=2)。
  // 4=roomId 一次性(需改用 webRid,见 dart getRoomDetailByRoomId),非直播中。
  const isLive = toInt(room.status) === 2

  return {
    // id 用长号 id_str(唯一稳定);roomId 必须用订阅传入的 web_rid(短号/抖音号)——
    // douyin 的 enter API / HTML 页面 / resolveLivePlay 都用 web_rid,不是 room_id。
    id: `douyin:${String(room.id_str ?? webRid)}`,
    sourceId,
    kind: "live",
    title: String(room.title ?? ""),
    url: `${LIVE}/${webRid}`,
    thumbnail: String(streamUrl?.default?.push_hd?.main?.[0]?.flv ?? room?.cover?.url_list?.[0] ?? ""),
    author: { name: String(user.nickname ?? ""), avatar: String(user?.avatar_thumb?.url_list?.[0] ?? "") || undefined },
    fetchedAt,
    platform: "douyin",
    roomId: webRid,
    liveStatus: isLive ? "live" : "offline",
    online: douyinOnline(room),
    introduction: strOr(room.intro),
    // ⚠️ 不带 raw:stream_url —— raw 不经 XML 边界(serialize 从不写),且下游
    // resolveLivePlay 是**重新 fetchRoom 取新鲜签名直链**(直链有时效,不该复用)。
    // 曾放 raw:streamUrl 并注释「供下游解析」是死的误导字段。
  }
}
