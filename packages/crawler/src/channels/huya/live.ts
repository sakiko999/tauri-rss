/**
 * huya 直播房间 channel —— 纯 HTTP,无签名。
 *
 * 数据源 `mp.huya.com/cache.php?m=Live&do=profileRoom`(与 play.ts 同源,干净 JSON)——
 * **2026-09 迁移**:此前爬 `m.huya.com/{roomId}` HTML 的 `HNF_GLOBAL_INIT`,现改用
 * 同一 API(字段等价:`liveData.*`),省掉 HTML 解析且与播放解析共用一次抓取。
 * ⚠️ 关播房间 `data.stream` 为空但 `liveData` 仍在,状态看 `liveStatus`(ON/OFF)。
 * resolveLivePlay 走 play.ts(profileRoom → 全档位 × 多线路)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { httpJson, now } from "@tauri-playground/resolve"
import { parseRoomIds } from "@tauri-playground/resolve"
import { log } from "@tauri-playground/resolve"
import { HUYA_UA } from "@tauri-playground/resolve"

/** 单房间 → Live item(profileRoom API)。房间失败抛错,由调用方 catch 隔离。 */
async function fetchHuyaRoom(roomId: string): Promise<Live> {
  const res = await httpJson<{ status?: number; data?: Record<string, any> }>(
    `https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid=${encodeURIComponent(roomId)}&showSecret=1`,
    { "user-agent": HUYA_UA, referer: "https://www.huya.com/", origin: "https://www.huya.com" },
  )
  const data = res?.data
  if (Number(res?.status) !== 200 || !data) throw new Error(`huya: profileRoom 失败(room ${roomId})`)
  const ld = (data.liveData ?? {}) as Record<string, unknown>
  const profileRoom = String(ld.profileRoom ?? roomId)
  return {
    id: `huya:${profileRoom}`,
    sourceId: "live:huya",
    kind: "live",
    title: String(ld.introduction ?? ld.roomName ?? ""),
    url: `https://www.huya.com/${roomId}`,
    thumbnail: String(ld.screenshot ?? ""),
    author: { name: String(ld.nick ?? "") },
    fetchedAt: now(),
    platform: "huya",
    roomId: profileRoom,
    liveStatus: String(data.liveStatus ?? "").toUpperCase() === "ON" ? "live" : "offline",
    online: Number(ld.totalCount ?? 0),
    introduction: ld.introduction ? String(ld.introduction) : undefined,
  }
}

export class HuyaLiveChannel implements RssChannel {
  readonly key = "live:huya"
  readonly name = "虎牙直播房间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "roomIds", label: "直播间 ID(逗号分隔,可多个)", required: true }]
  // 仅输出 Live item(与 rsshub 一致);流/弹幕走 crawler/resolver(按 item.url)。
  // fetch 支持多房间(roomIds 逗号分隔)。
  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const roomIds = parseRoomIds(info)
    if (!roomIds.length) throw new Error("live:huya 需要 roomIds")
    const t = now()
    const rooms = await Promise.all(
      roomIds.map((roomId) =>
        fetchHuyaRoom(roomId).catch((e) => {
          log.huya.warn(`房间 ${roomId} 拉取失败,跳过:`, (e as Error)?.message)
          return null
        }),
      ),
    )
    return rooms.filter((r): r is Live => r !== null).map((live) => ({ ...live, fetchedAt: t }))
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `虎牙直播 ${String(info.roomIds ?? info.roomId ?? "")}`, channelLink: `https://www.huya.com/${String(info.roomIds ?? info.roomId ?? "")}` }
  }
}
