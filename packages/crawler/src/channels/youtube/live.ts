/**
 * youtube:live —— YouTube 直播订阅 channel。
 *
 * 与视频订阅(`youtube` channel)按 **channelKey 区分**:声明时定 kind,零判定请求。
 * YouTube 无独立「直播间 ID」,直播/视频共享 videoId 命名空间(`watch?v=xxx`),
 * 判定直播靠 player API 的 `playabilityStatus.liveStreamability`。因此「订阅直播」
 * 用 `youtube:live` + videoId 表达意图,不实时请求判定。
 *
 * fetch 产单个 Live item(liveStatus 信任声明为 "live";精确在线状态需 player API,
 * 留未来增强)。播放走懒解析:resolveLivePlay(roomId=videoId)→ resolveYoutubeStreams
 * (iOS client hlsManifestUrl,失败降级 web 页)。
 */
import type { Item, Live } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "@tauri-playground/resolve"

export class YoutubeLiveChannel implements RssChannel {
  readonly key = "youtube:live"
  readonly name = "YouTube 直播"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [{ key: "videoId", label: "直播 ID", required: true }]

  // 仅输出 Live item(与 rsshub 一致);流/弹幕走 crawler/resolver(按 item.url→watch?v=)。
  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const videoId = info.videoId ?? ""
    if (!videoId) throw new Error("youtube:live 需要 videoId")
    const t = now()
    const live: Live = {
      id: videoId,
      sourceId: "youtube:live",
      kind: "live",
      title: `YouTube ${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      // 稳定缩略图约定:i.ytimg.com/vi/<videoId>/hqdefault.jpg —— 零请求,直播未开播
      // 也有占位封面(与视频 channel 的 videoItem 一致)。
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      fetchedAt: t,
      // 声明态:订阅直播频道即预期在播。精确在线状态需 player API(liveStreamability),
      // 每次刷新判定有网络成本 + IP 风控风险,留未来增强。
      platform: "youtube",
      roomId: videoId,
      liveStatus: "live",
    }
    return [live]
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `YouTube 直播 ${info.videoId ?? ""}`, channelLink: `https://www.youtube.com/watch?v=${info.videoId ?? ""}` }
  }
}
