/**
 * mobile 正文渲染 —— 把 article 的 content 转成「安全的可显示节点」。
 *
 * ⚠️ 与 desktop ReaderMain 的难点相同:content 可能是 HTML(feed 带 `content:encoded`
 * 全文,如阮一峰周刊)也可能是纯文本(补全抓来的正文)。差别在于 **mobile 没有
 * DOMPurify 依赖**(desktop 有)——而 feed 内容是不可信输入,绝不能直接 innerHTML。
 *
 * 这里的取法:先判是不是 HTML(looksLikeHtml,要求出现已知标签名,不误判裸 `<`),
 * 是 HTML 则**剥标签转纯文本**(丢了粗体/链接等排版,但避免 XSS);否则按纯文本 pre-wrap。
 * 这是刻意的降级——移动端定位「看内容」,排版让位安全;要富文本再引 sanitizer。
 */
/**
 * 是否像 HTML:**要求出现已知标签名**才算(与 desktop lib/html.ts 同款)。
 * 不能用 `includes("<")`——真实正文常含裸 `<`(数学/代码「x < y」),会误判。
 */
const KNOWN_TAG =
  /<\/?(?:a|p|div|span|br|img|picture|source|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|u|s|del|ins|mark|table|thead|tbody|tfoot|tr|td|th|caption|figure|figcaption|hr|sup|sub|small|video|audio|iframe|section|article|header|footer|aside|nav|dl|dt|dd)\b[^>]*>/i

export function looksLikeHtml(s: string): boolean {
  return KNOWN_TAG.test(s)
}

const BLOCK = /<\/(p|div|li|h[1-6]|blockquote|tr|section|article|main|figure|figcaption)\s*>/gi

/** HTML → 归一纯文本(块尾 → 换行;解常见实体;压空白)。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** 是 HTML 则剥成纯文本,否则原样返回。 */
export function displayBody(content: string): string {
  return looksLikeHtml(content) ? htmlToText(content) : content
}
