/**
 * bili:user —— 搜 UP主(搜索渠道,不直接订阅)。
 *
 * `search_type=bili_user`(匿名 + buvid,取数在 resolve/platform/bili/discover.ts 的
 * searchBiliUsers)。产出 Video item:每个 UP 主一条,url = 空间页 —— 候选提取从 url
 * 解析 mid(raw 不穿 XML 边界,serialize 不写;同 parseLive 的 liveFromUrl 先例)。
 *
 * 下游订阅走 `bili:user_video`(uid 参数):本渠道的角色同 `bili:search` 之于
 * `bili:live` —— 只作「搜索添加」的取数源(previewChannel 取候选),不设计为长期订阅。
 */
import type { Item, Video } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now, searchBiliUsers } from "@amoeba/resolve"

export class BiliUserChannel implements RssChannel {
  readonly key = "bili:user"
  readonly name = "bilibili 搜UP主"
  readonly kind = "video" as const
  // ⚠️ 刻意不声明 defaultInfo(防误入发现页「一键订阅」榜单,同 bili:search)。
  readonly sourceInfoTpl = [
    { key: "keyword", label: "UP主关键词", placeholder: "如:半佛仙人", required: true },
  ]

  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const kw = String(info.keyword ?? "").trim()
    if (!kw) throw new Error("bili:user 需要 keyword 参数")
    const users = await searchBiliUsers(kw)
    const t = now()
    return users.map((u): Video => ({
      id: `up-${u.mid}`,
      sourceId: this.key,
      kind: "video",
      title: u.uname,
      url: `https://space.bilibili.com/${u.mid}`,
      thumbnail: u.upic,
      // 候选行的次行信息(粉丝/投稿数)。raw 不穿 XML,summary 是唯一能到 UI 的自由字段。
      summary: `${u.fans ?? 0} 粉丝 · ${u.videos ?? 0} 个视频`,
      fetchedAt: t,
    }))
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `bilibili 搜UP主 ${info.keyword ?? ""}`,
      channelLink: "https://space.bilibili.com/",
    }
  }
}
