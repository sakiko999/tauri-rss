/**
 * HTML 探测 —— 判定一段正文是不是「真要按 HTML 渲染」。
 *
 * ⚠️ 不能用 `s.includes("<")` 或 `<[a-z]` 这类宽正则:真实正文常含裸 `<`(数学/代码
 * 「x < y」、链接「<https://…>」),宽正则会把它们误判成 HTML → 走 dangerouslySetInnerHTML
 * → 浏览器把 `< y` 当未知标签解析,正文被吞一截。这里**要求出现已知 HTML 标签名**才算 HTML;
 * `<y>`/`<foo>`/`<https:` 不认识 → 按纯文本 pre-wrap 显示。
 */
const KNOWN_TAG =
  /<\/?(?:a|p|div|span|br|img|picture|source|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|b|i|u|s|del|ins|mark|table|thead|tbody|tfoot|tr|td|th|caption|figure|figcaption|hr|sup|sub|small|video|audio|iframe|section|article|header|footer|aside|nav|dl|dt|dd)\b[^>]*>/i

export function looksLikeHtml(s: string): boolean {
  return KNOWN_TAG.test(s)
}
