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

/**
 * XHR/fetch 请求的 Origin 改写规则(host 后缀 → 站内 Origin)。
 *
 * Twitch 的 playlist 域对页面源 Origin(`http(s)://*.tauri.localhost`,即 Tauri 生产
 * 页面)直接回 **403**(2026-10-28 实测:无 Origin / 站内 Origin 均 200)。hls.js 的
 * manifest 请求是 XHR,JS 层禁止改 Origin(forbidden header),只能由 Rust 在
 * WebView2 网络层改写 —— 与图片/视频的 Referer 注入同款分工。
 *
 * 本表**无 JS 消费方**:Rust(`media_referer.rs`)按它改写 Origin;TS 持有只为保持
 * 「平台知识单一权威在 resolve + parity 守护两边一致」的既有模式。
 */
export const XHR_ORIGIN_RULES: Array<[string, string]> = [["playlist.ttvnw.net", "https://www.twitch.tv/"]]

/**
 * 媒体直链需要**去掉 ` Edg/<ver>` UA 段**的 host 后缀（Rust 侧改写）。
 *
 * 喜马拉雅 CDN（`aod.cos.tx.xmcdn.com`）的 WAF 把含 `Edg/156.0.0.0` 的完整 UA 串
 * 列进了黑名单，回 **403 text/html**；403 又被 ORB 拦成 `ERR_BLOCKED_BY_ORB`，媒体元素
 * 只报 `Format error`（表象像解码问题，实为 UA 黑名单）。2026-10-29 实测：
 * `Edg/156` 恒 403，`Edg/155` / `Edg/157` / `Chrome/156` / 无 UA 全部 206 合法音频。
 *
 * 只去掉 ` Edg/<ver>` 一段（保留真实 Chrome 版本），不硬编码 UA 串 —— WebView2
 * 升级后版本号自动跟随。
 *
 * 本表**无 JS 消费方**：Rust（`media_referer.rs`）按它改写；TS 持有只为「平台知识
 * 单一权威在 resolve + parity 守护」。
 */
export const MEDIA_UA_STRIP_HOSTS: string[] = ["xmcdn.com", "ximalaya.com"]

/** XHR 请求 url 命中规则 → 应改写成的站内 Origin;未命中返回 undefined。 */
export function xhrOriginFor(url: string): string | undefined {
  const m = url.match(/^https?:\/\/([^/]+)/)
  if (!m) return undefined
  return XHR_ORIGIN_RULES.find(([host]) => m[1].includes(host))?.[1]
}
