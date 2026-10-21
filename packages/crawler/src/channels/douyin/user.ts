/**
 * 抖音用户直播间 —— 输入**用户主页链接 / sec_uid**，解析并订阅该用户的直播间。
 *
 * ⚠️ 2026-10-19 起新入口统一走 `live:douyin`（`roomIds` 也接受主页链接）；
 * 本渠道保留给**存量订阅**，不再出现在「添加订阅」的渠道列表里。
 *
 * 流程（2026-10-18 实测）：
 *   1. 匿名资料 API `aweme/v1/web/user/profile/other/?sec_user_id=...`
 *      拿 `user.unique_id`（抖音号）/ `short_id` / `nickname` / `live_status`；
 *   2. 用 `unique_id` 当 `web_rid` 走 enter API（与 `live:douyin` 完全相同），
 *      在播返回 live、离线返回 offline（标题/头像为最近一场）。
 *
 * ⚠️ 为什么单独一个渠道：资料 API 只认 `sec_user_id`，而 `live:douyin` 的
 * `roomIds` 只接受抖音号/短 ID/web_rid；把主页链接直接填进去会 `10011`。
 * 这个渠道把「主页链接 → 抖音号 → 房间」的解析收口在一处。
 * ⚠️ 无匿名「昵称搜用户」能力；只知道昵称时仍需先拿到主页链接或抖音号。
 * ⚠️ 从未开播过的账号可能拿不到房间数据（enter `10011`/`4001038`），此时会报
 * 抓取失败；暂不生成占位 offline 条目（避免伪造标题/头像）。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetchItems } from "../factory.ts"
import { fetchDouyinUserLive, fetchRoom } from "@amoeba/resolve"
import { douyinLiveItem } from "./live.ts"

/**
 * 保留类实现(不走 makeApiChannel):输入(主页链接 / sec_uid)→ web_rid 的联网解析,
 * 再二次请求 enter API 取房间 —— 不是「单端点 GET → 列表 → 映射」的同形面。
 */
export class DouyinUserLiveChannel implements RssChannel {
  readonly key = "live:douyin:user"
  readonly name = "抖音用户直播间"
  readonly kind = "live" as const
  readonly sourceInfoTpl = [
    {
      key: "secUid",
      label: "用户主页链接 / sec_uid",
      required: true,
      placeholder: "https://www.douyin.com/user/MS4wLj...",
    },
  ]

  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetchItems(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const input = String(info.secUid ?? "").trim()
    if (!input) throw new Error("live:douyin:user 需要用户主页链接或 sec_uid")
    const user = await fetchDouyinUserLive(input)
    // 用解析出的抖音号走 enter API；离线用户仍会返回最近一场的标题/头像 + offline。
    const res = await fetchRoom(user.webRid)
    return [douyinLiveItem(res, user.webRid, this.key)]
  }

  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "抖音用户直播间", channelLink: "https://live.douyin.com" }
  }
}
