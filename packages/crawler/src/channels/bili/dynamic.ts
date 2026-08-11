/**
 * bilibili 用户动态类 channel(bili:dynamic)。
 *
 * 参考 RSSHub `routes/bilibili/dynamic.ts` 的 `feed/space` 端点(UP 主空间动态专用),
 * 与旧的 `dynamic_svr/dynamic_new`(时间线,uid 不匹配)不同:
 *   - `GET /x/polymer/web-dynamic/v1/feed/space?host_mid={uid}&platform=web&features=...`
 *     返回 `data.items[]`,每条的 `modules.module_author.mid === host_mid` 即目标 UP 主本人
 *     (实测半佛仙人 uid=37883317 → 12 条全属本人,has_more + offset 翻页)。
 *   - 需 Referer(`space.bilibili.com/{uid}/`) + Cookie(SESSDATA)——未登录返回
 *     `code: -101`。core 层 `DEFAULT_BILIBILI_COOKIE` 经 info.cookie 注入。
 *
 * 动态类型(实测):
 *   - DYNAMIC_TYPE_FORWARD(转发):module_dynamic.desc.text + orig(被转内容)
 *   - DYNAMIC_TYPE_DRAW / OPUS(图文):module_dynamic.major.opus → pics[].url + summary.text
 *   - DYNAMIC_TYPE_AV(视频动态):major.archive → title/bvid/pic
 *   - DYNAMIC_TYPE_ARTICLE(专栏):major.opus.jump_url(cv 号)
 * 统一映射成 Social(content + images + likes/reposts/replies),链接指向 t.bilibili.com/{id_str}。
 */
import type { Item, Social, SocialImage } from "@tauri-playground/xml"
import { type SerializeOptions } from "@tauri-playground/xml"
import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "../../host.ts"
import { createBilibiliClient } from "./client.ts"
import { fetchImageSize } from "../../utils/img-size.ts"

const API = "https://api.bilibili.com"

interface DynModule {
  module_author?: { mid?: number; name?: string; face?: string; pub_ts?: number }
  module_dynamic?: {
    desc?: { text?: string }
    major?: {
      type?: string
      opus?: {
        summary?: { text?: string }
        /** 图文动态图片:B站 API 自带宽高,直接透传给瀑布流。 */
        pics?: Array<{ url?: string; width?: number; height?: number }>
        jump_url?: string
      }
      archive?: { title?: string; cover?: string; desc?: string; duration_text?: string }
    }
  }
  module_stat?: { like?: { count?: number } }
  module_interaction?: { like?: { count?: number } }
}

interface DynItem {
  id_str?: string
  type?: string
  modules?: DynModule
  /**
   * 转发动态的被转内容。**注意:是完整的 DynItem 结构**(有 id_str/type/modules/orig),
   * 不是 DynModule——module_dynamic 在 `orig.modules.module_dynamic` 下。
   * 实测被转内容通常是 opus(图文/专栏)或 archive(视频)。
   */
  orig?: DynItem
}

/** http 封面升 https(bilibili 混用 http,浏览器混载会报错)。 */
function httpsUrl(u: string): string {
  return u.replace(/^http:\/\//, "https://")
}

/** 单个动态模块 → 可渲染字段。按 major 结构(opus/archive)分支,major.type 只是形态标签。 */
function parseModule(d: DynModule): { content: string; images: SocialImage[]; likes: number; title: string } {
  const dyn = d.module_dynamic
  const desc = dyn?.desc?.text ?? ""
  const major = dyn?.major
  const opus = major?.opus
  const archive = major?.archive
  let content = desc
  const images: SocialImage[] = []
  let title = ""

  // 图文动态/专栏:major.opus → 图片(带 API 宽高)+ summary。专栏标题用 cv 号。
  if (opus) {
    const pics = opus.pics ?? []
    for (const p of pics) {
      if (!p?.url) continue
      const img: SocialImage = { url: httpsUrl(p.url) }
      if (p.width) img.width = p.width
      if (p.height) img.height = p.height
      images.push(img)
    }
    if (opus.summary?.text) content = `${content}\n${opus.summary.text}`.trim()
    title = opus.jump_url?.match(/cv(\d+)/)?.[0] ?? ""
  }
  // 视频动态:major.archive → 标题 + 封面。desc 为空时正文用标题。
  if (archive) {
    title = archive.title ?? ""
    if (archive.cover) images.push({ url: httpsUrl(archive.cover) })
    if (!content) content = archive.desc ?? ""
  }

  const likeCount = d.module_interaction?.like?.count ?? d.module_stat?.like?.count ?? 0
  return { content: content || title || "(无正文)", images, likes: likeCount, title }
}

/** 动态 + 被转内容(orig)→ 完整社交字段(正文含转发来源,图含被转图)。 */
function parseItem(it: DynItem): { content: string; images: SocialImage[]; likes: number; title: string } {
  const mods = it?.modules ?? {}
  const parsed = parseModule(mods)
  // 转发动态:正文拼上被转内容来源(「//转发自: @name: title/desc」,RSSHub 同款)。
  if (it?.orig?.modules) {
    // orig 是完整 DynItem,module_dynamic 在 orig.modules.module_dynamic 下。
    const origin = parseModule(it.orig.modules)
    const originName = it.orig.modules.module_author?.name
    const parts: string[] = []
    if (originName) parts.push(`//转发自: @${originName}:`)
    if (origin.title) parts.push(origin.title)
    if (origin.content) parts.push(origin.content)
    if (parts.length) parsed.content = `${parsed.content}\n${parts.join("\n")}`.trim()
    // 被转内容没图时,用被转的图(转发视频动态带原封面)。
    if (!parsed.images.length) parsed.images = origin.images
  }
  return parsed
}

/** bilibili 用户动态(社交)channel。 */
export class BiliDynamicChannel implements RssChannel {
  readonly key = "bili:dynamic"
  readonly name = "bilibili 用户动态"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [
    { key: "uid", label: "UP 主 uid", required: true },
  ]
  getSource(info: SourceInfo): RssSource {
    return { fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)) }
  }
  private async fetchItems(info: SourceInfo): Promise<Item[]> {
    const uid = String(info.uid ?? "")
    if (!/^\d+$/.test(uid)) throw new Error(`bili:dynamic 需要数字 uid,收到 "${uid}"`)
    // 登录 cookie:订阅级 info.cookie > core 层 DEFAULT(core 注入 sourceInfoFor)。
    const client = createBilibiliClient({ cookie: (info.cookie as string) || undefined })
    const data = await client.getJson<{ data?: { items?: DynItem[] } }>(
      `${API}/x/polymer/web-dynamic/v1/feed/space?host_mid=${uid}&platform=web&features=itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote`,
      { referer: `https://space.bilibili.com/${uid}/` },
    )
    const items = data?.data?.items ?? []
    const t = now()
    // 先一次性 parse 全部(缓存结果,map 时复用)——兜底 fill 尺寸的必须是同一个对象,
    // 否则 fill 完再 map 又 parse 一次生成新对象,宽高丢失。
    const parsedItems = items.map((it) => parseItem(it))
    // 补全缺宽高的图(archive 封面等):Range 预取文件头。失败静默(UI 退化默认比例)。
    // 仅当存在缺宽高的图才发请求,避免每条动态都网络预取。
    const needsSize = (img: SocialImage) => !img.width || !img.height
    await Promise.all(
      parsedItems.flatMap((p) => {
        const missing = p.images.filter(needsSize)
        return missing.map(async (img) => {
          const size = await fetchImageSize(img.url)
          if (size) {
            img.width = size.width
            img.height = size.height
          }
        })
      }),
    )
    return items.map((it, i): Social => {
      const idStr = it?.id_str ?? ""
      const mods = it?.modules
      const author = mods?.module_author
      const parsed = parsedItems[i]!
      return {
        id: `bili-dyn-${idStr}`,
        sourceId: "bili:dynamic",
        kind: "social",
        title: parsed.title || parsed.content.slice(0, 30),
        url: `https://t.bilibili.com/${idStr}`,
        content: parsed.content,
        images: parsed.images.length ? parsed.images : undefined,
        likes: parsed.likes || undefined,
        author: author?.name ? { name: author.name, avatar: author.face } : undefined,
        publishedAt: author?.pub_ts ? author.pub_ts * 1000 : undefined,
        fetchedAt: t,
      }
    })
  }
  private channelOptions(info: SourceInfo): SerializeOptions {
    return {
      channelTitle: `bilibili 动态 · ${info.uid}`,
      channelLink: `https://space.bilibili.com/${info.uid}/dynamic`,
    }
  }
}
