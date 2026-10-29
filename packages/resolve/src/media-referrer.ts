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
 * ⚠️ 值里**不带尾斜杠**(Origin 的语法就是 `scheme://host[:port]`):2026-10-30 实测
 * `https://www.twitch.tv/`(带斜杠)→ **403**,`https://www.twitch.tv` → 200。
 * 早先写带斜杠的版本在 dev 里测不出来(dev 页面 Origin `localhost:1420` 本就被放行,
 * 改写值根本没被 CDN 校验过),到 release(`*.tauri.localhost`)才暴露成 403。
 *
 * 本表**无 JS 消费方**:Rust(`media_referer.rs`)按它改写 Origin;TS 持有只为保持
 * 「平台知识单一权威在 resolve + parity 守护两边一致」的既有模式。
 */
export const XHR_ORIGIN_RULES: Array<[string, string]> = [["playlist.ttvnw.net", "https://www.twitch.tv"]]

/**
 * 媒体直链需要**去掉 ` Edg/<ver>` UA 段**的 host 后缀（Rust 侧改写）。
 *
 * 喜马拉雅 CDN（`aod.cos.tx.xmcdn.com`）回 **403 text/html** + `x-error-info: ua_acl.access`
 * —— 黑名单里是**一条完整的 UA 字面串**，恰好就是当前 Windows WebView2 的真实 UA
 * （`… Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0`）。2026-10-29 实测粒度：整串等值、
 * 大小写不敏感（`EDG` 也 403）；mac 平台串 / 去 `Mozilla/5.0` 前缀 / `Safari` 后双空格 /
 * `Edg/156`（无补丁位）/ `Edg/156.0.0.1` / `Chrome/155 + Edg/156` / 只留版本对 → 全 206。
 * 也就是说**没有「按 Edge 版本号拦」的规则**，只有那一条字面串会被撞上。403 又被 ORB
 * 拦成 `ERR_BLOCKED_BY_ORB`，媒体元素只报 `Format error`（表象像解码问题）。
 *
 * 只去掉 ` Edg/<ver>` 一段（保留真实 Chromium 版本），**不含版本号**：串一变就不等于
 * 黑名单条目，Edge 升级自动跟随，ACL 跟着更新也照样躲开。
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

/**
 * huya HLS CDN 只认这条播放器 UA(与 `platform/huya/play.ts` 的 `HUYA_PLAY_UA` 同源)。
 *
 * 2026-10-30 实测(manifest / 分片都试过):**只有 UA 是判据** —— 浏览器 UA → 403
 * `text/html`,这条 HYSDK 串 → 200;Referer / Origin 有无都不影响。CDN 回
 * `Access-Control-Allow-Origin: *`,所以直连 CORS 无碍。
 */
export const HUYA_HLS_UA = "HYSDK(Windows, 30000002)_APP(pc_exe&7060000&official)_SDK(trans&2.32.3.5646)"

/**
 * XHR/fetch 请求的 UA 改写规则(host 后缀 → 指定 UA)。
 *
 * hls.js 的 manifest/分片请求都是 XHR,`User-Agent` 是 forbidden header(JS 设不了),
 * 只能由 Rust 在 WebView2 网络层改 —— 与 Origin 改写同款分工。
 *
 * 本表同样**无 JS 消费方**(Rust 按它改写,TS 只为 parity 守护)。
 */
export const XHR_UA_RULES: Array<[string, string]> = [["hls.huya.com", HUYA_HLS_UA]]

/** XHR 请求 url 命中规则 → 应改写成的 UA;未命中返回 undefined。 */
export function xhrUserAgentFor(url: string): string | undefined {
  const m = url.match(/^https?:\/\/([^/]+)/)
  if (!m) return undefined
  return XHR_UA_RULES.find(([host]) => m[1].includes(host))?.[1]
}
