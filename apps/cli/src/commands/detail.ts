/**
 * detail — xhs 单条详情探针(登录态 noteDetail 补全;bili/weibo 列表已完整)。
 *
 * 独立 by-url(不依赖订阅 store——CLI 不持久化 MediaItem):
 *   - 输入 **带 xsec_token 的列表项 URL**(详情页的开关,见 `tpl:xsecToken`);
 *   - 用登录 cookie 直接 GET 详情页,`extractNoteDetail` 解析 `noteDetailMap[noteId].note`;
 *   - cookie 来源: `--cookie <ck>` > CLI settings(`xhsCookie` provider)。
 *
 * ⚠️ 匿名态已移除,必须有登录 cookie。CLI **不拉列表**:`xhs:explore` 依赖桌面抓取浏览器
 * (登录态 HTTP SSR 是空壳),所以旧的 `--latest` 已删除 —— URL 请从列表项复制。
 */
import pc from "picocolors"
import { XHS_BASE, noteDetailToSocial, extractNoteDetail, resolveCookie, xhsClient } from "@amoeba/resolve"
import { fmtMs, printJson, startTimer, trunc } from "../ui/render.ts"

export interface DetailOptions {
  json?: boolean
  /** 显式登录 cookie(缺省回落 CLI settings 的 xhsCookie)。 */
  cookie?: string
}

export async function runDetail(url: string, opts: DetailOptions): Promise<void> {
  const elapsed = startTimer()
  if (!url) {
    console.error(pc.red(`✘ 需要 URL(CLI 不拉列表;请从列表项复制带 xsec_token 的链接)`))
    process.exit(1)
  }
  if (!url.includes("xiaohongshu.com/explore/")) {
    console.error(pc.red(`✘ 仅小红书(explore)走详情补全;${pc.dim("bili/weibo 列表已含完整图文")}`))
    process.exit(1)
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.error(pc.red(`✘ 无法解析 URL: ${url}`))
    process.exit(1)
  }
  const noteId = parsed.pathname.match(/\/explore\/([^/?#]+)/)?.[1] ?? ""
  if (!noteId) {
    console.error(pc.red(`✘ 无法从 url 提取 noteId: ${url}`))
    process.exit(1)
  }
  const xsecToken = parsed.searchParams.get("xsec_token") ?? ""
  if (!xsecToken) {
    console.error(pc.red(`✘ URL 缺少 xsec_token:详情页 noteDetailMap 需要列表项的 token(从列表复制完整链接)`))
    process.exit(1)
  }

  const cookie = resolveCookie(opts.cookie, "xhs")
  if (!cookie) {
    console.error(pc.red(`✘ 小红书需要登录:--cookie <ck>(或让 CLI settings 里有 xhsCookie)`))
    process.exit(1)
  }

  // 登录态抓详情页(带列表项 xsec_token),extractNoteDetail 解析 noteDetailMap[noteId].note。
  const detailUrl = `${XHS_BASE}/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_feed`
  const html = await xhsClient.getHtml(detailUrl, { cookie })
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
  const imgUrls = (detail?.images ?? []).map((img) => img.url)
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
