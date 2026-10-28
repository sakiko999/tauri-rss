/**
 * RSS 文章正文提取 —— 通用 HTML → 纯文本(零依赖启发式)。
 *
 * 为什么自研:通用 RSS 只带 description 摘要(君子协定的痛点是「点开文章只有摘要」)。
 * 补全要读原文页 HTML,而 HTML 解析全仓无依赖(fast-xml-parser 只认 XML)。
 * HTMLRewriter 是 Bun 全局、DOMParser 是 WebView 全局,crawler 两端跑 → 只能选
 * **正则启发式**:去脚本/样式/导航/页脚 → 优先 <article>/<main>/<body> → 取 <p> 段落,
 * <p> 太少则整体去标签。够读正文即可,不做完整 DOM。
 *
 * 已知天花板:纯 JS 渲染的页面(SPA)拿不到正文 → 提取文本 < 阈值时返回 null,
 * 调用方回退原摘要(不空窗)。
 */

/** 整块丢弃:非正文内容(脚本/样式/导航/页脚/表单/媒体/…)。
 *  ⚠️ **不含 <figure>**:它常包裹正文图注(<figcaption>)或代码块(<pre>),整块删会吞正文;
 *  只丢 <picture>(纯 <source>/<img>,文案取不到)。 */
const DROP_BLOCKS =
  /<(script|style|noscript|template|svg|iframe|head|nav|footer|aside|form|button|select|video|audio|canvas|picture)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
}

/** 解 HTML 实体(命名 + 十进制 + 十六进制)。非法码点原样保留，不抛。 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** 块级结束标签 → 空行(段落边界),<br> → 单换行，其余标签剥掉，再解实体。
 *  ⚠️ 块尾用 "\n\n"(不是 "\n"):否则兜底路径 normalize 只压不扩,段落被压成单换行。 */
function tagToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section|article|main)\s*>/gi, "\n\n")
      .replace(/<[^>]*>/g, ""),
  )
}

/** 归一空白:行内多空格合成单空格，空行最多留一个。 */
function normalize(s: string): string {
  return s
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** 可见文本长度(去标签 + 解实体 + 归一空白)——判「feed 是否已带全文」用,
 *  不能用原始 HTML 长度(图片密集的短摘要标签一大堆,会虚高)。 */
export function visibleTextLength(html: string): number {
  return normalize(tagToText(html.replace(DROP_BLOCKS, " "))).length
}

/** 从正则在 head 里取 meta 内容(name/property 任意顺序)。 */
function metaContent(head: string, key: string): string | undefined {
  const re = new RegExp(
    `<meta\\s+[^>]*(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*\\scontent\\s*=\\s*["']([^"']*)["']`,
    "i",
  )
  const alt = new RegExp(
    `<meta\\s+[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
    "i",
  )
  return (re.exec(head)?.[1] ?? alt.exec(head)?.[1])?.trim() || undefined
}

/** 相对/协议相对 URL → 绝对(基于文章页地址);已是绝对则原样。 */
function absolutize(url: string | undefined, pageUrl: string | undefined): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  if (!pageUrl) return url.startsWith("//") ? `https:${url}` : url
  try {
    return new URL(url, pageUrl).href
  } catch {
    return url
  }
}

export interface ExtractedArticle {
  /** 归一后的正文纯文本。 */
  text: string
  /** 头图(og:image / twitter:image / 正文首个像样的 <img>)。 */
  image?: string
  /** og:title / <title>(补全标题,列表标题可能被截断)。 */
  title?: string
}

/**
 * 从文章页 HTML 提取正文。拿不到可读正文(SPA / 反爬占位页)返回 null。
 * @param html 文章页 HTML
 * @param pageUrl 文章页地址(把相对图片/链接转绝对)
 * @param minChars 正文最小字符数(低于此判为提取失败)
 */
export function extractArticle(html: string, pageUrl?: string, minChars = 120): ExtractedArticle | null {
  if (!html) return null
  const head = html.slice(0, 200_000)
  const ogImage = metaContent(head, "og:image") ?? metaContent(head, "twitter:image")
  const ogTitle =
    metaContent(head, "og:title") ??
    metaContent(head, "twitter:title") ??
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.trim()

  const body = html.replace(DROP_BLOCKS, " ")
  const scope =
    /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(body)?.[1] ??
    /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(body)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(body)?.[1] ??
    body

  // 优先 <p> 段落 + <figcaption> 图注(按文档顺序,否则图注会被 <p> 路径丢掉);
  // 合计太短则整体去标签兜底(以 <div>/<section> 为主的站点)。
  const paras = [...scope.matchAll(/<(p|figcaption)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
    .map((m) => normalize(tagToText(m[2]!)))
    .filter((t) => t.length > 0)
  let text = paras.join("\n\n")
  if (text.length < minChars) text = normalize(tagToText(scope))
  if (text.length < minChars) return null

  const image =
    absolutize(ogImage, pageUrl) ??
    (() => {
      for (const m of scope.matchAll(/<img\b[^>]*>/gi)) {
        const tag = m[0]
        const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
        if (!src || src.startsWith("data:")) continue
        const w = Number(/width\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? 0)
        const h = Number(/height\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? 0)
        // 跳过 1px 埋点 / 图标(有宽高且明显过小);无宽高属性则接受。
        if ((w && w < 120) || (h && h < 120)) continue
        return absolutize(src, pageUrl)
      }
      return undefined
    })()

  return { text, image, title: ogTitle }
}
