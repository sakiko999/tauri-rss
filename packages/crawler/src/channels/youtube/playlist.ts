import { DESKTOP_CHROME_UA, httpText, now } from "@amoeba/resolve"
/**
 * youtube:playlist —— YouTube 播放列表订阅(官方 Atom feed)。
 *
 * 端点 `youtube.com/feeds/videos.xml?playlist_id=` 匿名可用,**最多 15 条**,无翻页。
 * 条目结构与频道 feed 同构(yt:videoId + media:group),复用 `entryToVideo`。
 *
 * ⚠️ 只适合「订阅一个列表接收最近更新」;需要完整列表请走 InnerTube `VL<playlistId>`
 * (100/页 + continuation,见 docs/channel-expansion-research.md §2.2)——暂不做。
 * ⚠️ 输入归一化在 refs.ts:`RD`/`WL`/`LL`/`LM` 前缀拒收(动态/私有/需登录)。
 */
import type { Item } from "@amoeba/xml"
import { parseFeed } from "@amoeba/xml"

import type { SourceInfo } from "../../index.ts"
import { makeApiChannel } from "../factory.ts"
import { entryToVideo } from "./channel.ts"
import { normalizeYoutubePlaylistId } from "./refs.ts"

/** 频道标题与链接共用:归一化失败时退回原串(与原 channelOptions 一致)。 */
function playlistIdOf(info: SourceInfo): string {
  return normalizeYoutubePlaylistId(info.playlistId ?? "") ?? String(info.playlistId ?? "")
}

export const YoutubePlaylistChannel = makeApiChannel({
  key: "youtube:playlist",
  name: "YouTube 播放列表",
  kind: "video",
  sourceInfoTpl: [{ key: "playlistId", label: "播放列表 ID 或链接", required: true }],
  channelTitle: (info) => `YouTube 播放列表 ${playlistIdOf(info)}`,
  channelLink: (info) => `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistIdOf(info))}`,
  fetchPage: async (info): Promise<Item[]> => {
    const raw = info.playlistId ?? ""
    const playlistId = normalizeYoutubePlaylistId(raw)
    if (!playlistId) {
      throw new Error("youtube:playlist 需要播放列表 ID 或链接（list=…；不支持 RD/WL/LL 这类动态或私有列表）")
    }
    const xml = await httpText(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
      { "user-agent": DESKTOP_CHROME_UA },
    )
    const feed = parseFeed(xml)
    const t = now()
    return feed.channel.item.map((entry) => entryToVideo(entry, t, "youtube:playlist"))
  },
})
