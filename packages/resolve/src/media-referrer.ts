/**
 * mediaReferrerFor — 媒体(图片/视频)防盗链 Referer 规则(唯一权威)。
 *
 * 部分图床(sinaimg.cn 等)对空 Referer / 非站内 Referer 返回 403,而 `<img>` 原生
 * 加载必带页面源 Referer(tauri://localhost),无解。此类媒体需经宿主隧道带站内
 * Referer 拉取。规则表收在 resolve(平台/媒体知识层),消费方只调用、不写死域名,
 * 加图床只改这里。
 *
 * ⚠️ 2026-10-23 从 host 下沉到 resolve:host 只为这张表把整包拖进 resolve 的模块图。
 * 现在 resolve 自己的 `utils/img-size.ts`、ui 的 MediaImage 隧道与 desktop 的实况
 * 播放都从这里取规则,host 不再持有它。
 *
 * 注:crawler channel 的 Referer 是**抓取请求**的业务头;这里管**媒体加载**的
 * 防盗链 Referer,两者用途不同、互不越界。
 */
export const MEDIA_REFERRERS: Array<[string, string]> = [
  // 新浪图床:weibo.com 系 Referer 放行,空/其它 403。
  ["sinaimg.cn", "https://weibo.com/"],
]

/** url 所属域名命中图床规则 → 需要的站内 Referer;未命中返回 undefined。 */
export function mediaReferrerFor(url: string): string | undefined {
  const m = url.match(/^https?:\/\/([^/]+)/)
  if (!m) return undefined
  return MEDIA_REFERRERS.find(([host]) => m[1].includes(host))?.[1]
}

/**
 * 视频直链的防盗链 Referer（与图片**分开**）。
 *
 * ⚠️ 小红书视频 CDN 对页面源 Referer（dev 的 `http://localhost:1420`、生产的
 * `tauri://localhost`）返回 **403 text/html**，浏览器再按 ORB 拦成
 * `net::ERR_BLOCKED_BY_ORB` / `MEDIA_ELEMENT_ERROR: Format error`——媒体错误不进
 * console，表现为「点了实况没反应且无报错」。`<video referrerPolicy>` 在 Chromium
 * 里不存在，只能经宿主隧道（Rust reqwest）重取：站内 Referer 或空 Referer 都是 200。
 *
 * 不并进 `MEDIA_REFERRERS`：那会让所有 xhs 图片也改走隧道（图片本来直连可用）。
 */
export const VIDEO_REFERRERS: Array<[string, string]> = [
  ["xhscdn.com", "https://www.xiaohongshu.com/"],
  // 微博实况视频（f.video.weibocdn.com）与图床同源策略。
  ["weibocdn.com", "https://weibo.com/"],
  ["sinaimg.cn", "https://weibo.com/"],
]

/** 视频直链所属域名命中规则 → 需要的站内 Referer;未命中返回 undefined（可空 Referer 拉取）。 */
export function videoReferrerFor(url: string): string | undefined {
  const m = url.match(/^https?:\/\/([^/]+)/)
  if (!m) return undefined
  return VIDEO_REFERRERS.find(([host]) => m[1].includes(host))?.[1]
}
