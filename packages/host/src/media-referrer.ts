/**
 * mediaReferrerFor — 媒体(图片)防盗链 Referer 规则(唯一权威)。
 *
 * 部分图床(sinaimg.cn 等)对空 Referer / 非站内 Referer 返回 403,而 `<img>` 原生
 * 加载必带页面源 Referer(tauri://localhost),无解。此类媒体需经宿主隧道带站内
 * Referer 拉取。规则表收在宿主层,消费方(ui MediaImage 隧道)只调用不写死域名,
 * 加图床只改这里——与 crawler 各 channel 抓取带 Referer 的哲学同层。
 *
 * 注:crawler channel 的 Referer 是**抓取请求**的业务头;这里管**媒体加载**的
 * 防盗链 Referer,两者都归宿主能力,互不越界。
 */
const HOTLINK_REFERRERS: Array<[string, string]> = [
  // 新浪图床:weibo.com 系 Referer 放行,空/其它 403。
  ["sinaimg.cn", "https://weibo.com/"],
]

/** url 所属域名命中图床规则 → 需要的站内 Referer;未命中返回 undefined。 */
export function mediaReferrerFor(url: string): string | undefined {
  const m = url.match(/^https?:\/\/([^/]+)/)
  if (!m) return undefined
  return HOTLINK_REFERRERS.find(([host]) => m[1].includes(host))?.[1]
}
