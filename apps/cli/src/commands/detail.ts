/**
 * detail — social 内容单条详情探针(xhs 匿名 noteDetail 补全;bili/weibo 列表已完整)。
 *
 * 独立 by-url(不依赖订阅 store——CLI 不持久化 MediaItem):
 *   - xhs:抓一个 xhs:explore 列表拿该 noteId 对应的 xsec_token(详情开关),
 *     再匿名 GET /explore/<id>?xsec_token= 拉 noteDetail 补全全文/多图/tag/video。
 *   - bili/weibo:列表已含完整图文,此命令仅提示(无独立详情接口需求)。
 */
import pc from "picocolors"
import { getChannel } from "@tauri-playground/crawler"
import { parseFeed } from "@tauri-playground/xml"
import { XHS_BASE, noteDetailToSocial, extractNoteDetail, xhsClient } from "@tauri-playground/resolve"
import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"

export interface DetailOptions {
  json?: boolean
  /** 用当前 explore 列表首条(不依赖用户 URL 匹配——推荐流每次刷新随机)。 */
  latest?: boolean
}

/** 抓 explore 列表 → 匹配 noteId 的 item(带列表项 xsec_token)。 */
async function fetchListItems(): Promise<Array<{ noteId: string; xsecToken?: string }>> {
  const ch = getChannel("xhs:explore")
  if (!ch) return []
  const xml = await ch.getSource({}).fetch()
  return parseFeed(xml).channel.item.map((it: any) => ({
    noteId: String(it.link ?? "").match(/\/explore\/([^?/?#]+)/)?.[1] ?? "",
    xsecToken: String(it.raw?.["tpl:xsecToken"] ?? ""),
  }))
}

export async function runDetail(url: string, opts: DetailOptions): Promise<void> {
  const elapsed = startTimer()
  // 平台判定:仅 xhs 需要补全详情(列表缺全文/图),其余平台列表即完整。--latest 免 URL。
  const isXhs = opts.latest || url.includes("xiaohongshu.com/explore/")
  if (!isXhs) {
    console.error(pc.red(`✘ 仅小红书(explore)走详情补全;${pc.dim("bili/weibo 列表已含完整图文,无独立详情接口")}`))
    process.exit(1)
  }

  // --latest:用当前 explore 列表首条(推荐流随机,用户 URL 的 noteId 可能不在最新列表)。
  let noteId: string
  let xsecToken: string
  if (opts.latest) {
    const list = await fetchListItems()
    if (!list.length) {
      console.error(pc.red(`✘ explore 列表空(可能需登录/风控)`))
      process.exit(1)
    }
    noteId = list[0].noteId
    xsecToken = list[0].xsecToken ?? ""
  } else {
    noteId = url.match(/\/explore\/([^?/?#]+)/)?.[1] ?? ""
    if (!noteId) {
      console.error(pc.red(`✘ 无法从 url 提取 noteId: ${url}`))
      process.exit(1)
    }
    // 从列表找该 noteId 的 xsec_token(纯 URL 无 token → noteDetailMap 空)。
    const list = await fetchListItems()
    const hit = list.find((it) => it.noteId === noteId)
    xsecToken = hit?.xsecToken ?? ""
  }

  // 匿名抓详情页(带列表项 xsec_token),extractNoteDetail 解析 noteDetailMap[noteId].note。
  const detailUrl = xsecToken
    ? `${XHS_BASE}/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_feed`
    : `${XHS_BASE}/explore/${noteId}`
  const html = await xhsClient.getHtml(detailUrl, {})
  const note = extractNoteDetail(html, noteId)
  const ms = elapsed()
  if (!note) {
    console.error(pc.red(`✘ 详情页 noteDetailMap 空(可能风控/xsec_token 失效): ${noteId}`))
    process.exit(1)
  }
  const detail = noteDetailToSocial(note, "xhs:detail", Date.now())

  if (opts.json) {
    printJson({ url, noteId, tookMs: Math.round(ms), detail })
    return
  }

  console.log(`${pc.cyan(detail?.title ?? "(untitled)")} — ${fmtMs(ms)}`)
  if (detail?.content) console.log(pc.dim(detail.content))
  // images 是 (string | SocialImage)[](xml Social 混合),统一取 url(字符串直用)。
  const imgUrls = (detail?.images ?? []).map((img) => (typeof img === "string" ? img : img.url))
  if (imgUrls.length) {
    console.log(pc.dim(`图: ${imgUrls.length} 张`))
    for (const u of imgUrls.slice(0, 5)) console.log(`  · ${trunc(u, 90)}`)
    if (imgUrls.length > 5) console.log(pc.dim(`  … 共 ${imgUrls.length} 张`))
  }
  console.log(
    `互动: ${detail?.likes !== undefined ? `赞 ${detail.likes}` : "-"} · ${
      detail?.reposts !== undefined ? `转 ${detail.reposts}` : "-"
    } · ${detail?.replies !== undefined ? `评 ${detail.replies}` : "-"}`,
  )
  if (detail?.author?.name) console.log(`作者: ${detail.author.name}`)
}
