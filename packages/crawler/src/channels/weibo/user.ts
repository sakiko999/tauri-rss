/**
 * weibo:user —— 微博用户主页 channel(kind: social)。
 *
 * 两步 container/getIndex(参考 RSSHub `weibo/user.ts`):
 *   1. `type=uid&value={uid}` → userInfo + tabsInfo.containerid;
 *   2. `type=uid&value={uid}&containerid={containerid}` → cards(微博列表)。
 * cards 过滤按 `c.mblog` 存在性(不按 card_type——JSON 里是数字 9)。
 * 长文展开 + 图宽高兜底由 mblogCardsToItems 统一处理(与热搜词流一致)。
 * 需完整登录 cookie(SUB),core 层 DEFAULT_WEIBO_COOKIE 经 info.cookie 注入。
 */
import type { Item } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { WB_BASE, mblogCardsToItems, wbJson } from "./client.ts"

export class WeiboUserChannel implements RssChannel {
  readonly key = "weibo:user"
  readonly name = "微博用户主页"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [{ key: "uid", label: "用户 uid", required: true }]
  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }

  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const uid = String(info.uid ?? "").trim()
    if (!/^\d+$/.test(uid)) throw new Error(`weibo:user 需要数字 uid,收到 "${uid}"`)
    const cookie = (info.cookie as string) || undefined
    const ref = { Referer: `${WB_BASE}/u/${uid}` }

    // 1. userInfo + containerid
    const s1 = await wbJson(`${WB_BASE}/api/container/getIndex?type=uid&value=${uid}`, cookie, ref)
    if (s1.body?.ok !== 1) throw new Error(`weibo 用户信息失败: ${s1.body?.msg ?? s1.body ?? s1.status}`)
    const containerId = s1.body.data?.tabsInfo?.tabs?.find((tb: any) => tb.tab_type === "weibo")?.containerid
    if (!containerId) throw new Error("weibo: 未找到用户微博 containerid")

    // 2. 微博列表 cards(过滤→归一→长文→图尺寸由 mblogCardsToItems 处理)。
    const s2 = await wbJson(
      `${WB_BASE}/api/container/getIndex?type=uid&value=${uid}&containerid=${containerId}`,
      cookie,
      ref,
    )
    if (s2.body?.ok !== 1) throw new Error(`weibo 微博列表失败: ${s2.body?.msg ?? s2.body ?? s2.status}`)
    return mblogCardsToItems(s2.body.data?.cards ?? [], this.key, cookie)
  }

  private channelOptions(info: SourceInfo): SerializeOptions {
    return { channelTitle: `微博 · ${info.uid}`, channelLink: `https://weibo.com/u/${info.uid}` }
  }
}
